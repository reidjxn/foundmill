/**
 * Foundmill sites (0124 `sites`, `site_releases`; WP-07 T2). The services write sites and releases; an owner or an
 * admin publishes and unpublishes inside `withRls` as themselves (`sites_publish` and `site_releases_publish` let them
 * set only the publishing columns, never on a taken-down site, never to a held release or another business's).
 *
 * - `ensure` and `saveRelease` are service-only (app roles hold no insert).
 * - `saveRelease` is idempotent on `sessionId`: a retried finish returns the release the session already saved.
 * - `resolveHost`, `readFile` and `report` call `site_resolve`, `site_file` and `site_report`, the functions apps/sites
 *   (`sites_reader`) may execute.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog, inboxItems, siteReleases, sites, type InboxItem, type Site, type SiteRelease, type SiteScreening } from "../schema";
import { SITE_READY_NOTE, SITE_TAB } from "@foundmill/shared/sites";
import type { LaunchCheck } from "@foundmill/shared/launch-checklist";
import { inboxRepo } from "./inbox";
import { departmentsRepo } from "./departments";
import { screensRepo } from "./screens";
import { Id, maybeOne, parseInput, rowsOf, type Executor } from "./_shared";

const ManifestEntry = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});

export const SaveSiteReleaseInput = z.object({
  files: z.array(ManifestEntry),
  state: z.enum(["preview", "held"]),
  screening: z.object({ flags: z.array(z.unknown()) }).catchall(z.unknown()).default({ flags: [] }),
  parentReleaseId: Id.nullable().default(null),
  taskId: Id.nullable().default(null),
  sessionId: Id.nullable().default(null),
  agentId: Id.nullable().default(null),
});
export type SaveSiteReleaseInput = z.input<typeof SaveSiteReleaseInput>;

/** sha256 over the manifest's sorted `path:sha256` lines, each ending in a newline. */
export function siteContentHash(files: readonly { path: string; sha256: string }[]): string {
  const lines = files.map((f) => `${f.path}:${f.sha256}\n`).sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** What a host label resolves to (`site_resolve`). `releaseId` is null only for `taken_down`. */
export interface SiteHost {
  releaseId: string | null;
  businessId: string;
  kind: "preview" | "live" | "taken_down";
  /** The business's plan (`businesses.plan_tier`), for the "Built on Foundmill" mark. */
  planTier: string;
}

export const SITE_REPORT_REASONS = ["scam", "phishing", "illegal", "offensive", "other"] as const;
export type SiteReportReason = (typeof SITE_REPORT_REASONS)[number];
/** What `site_report` answered. */
export type SiteReportResult = "recorded" | "unknown" | "invalid" | "limited";

export interface SiteFile {
  content: Uint8Array;
  sha256: string;
  size: number;
}

const utcMidnight = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const sitesRepo = {
  /** The business's site, or null. */
  async get(db: Executor, businessId: string): Promise<Site | null> {
    return maybeOne(await db.select().from(sites).where(eq(sites.businessId, businessId)).limit(1));
  },

  /** The business's site, created as a draft with this slug when it has none (an existing site keeps its slug). */
  async ensure(db: Executor, businessId: string, input: { slug: string }): Promise<Site> {
    const [created] = await db.insert(sites).values({ businessId, slug: input.slug }).onConflictDoNothing({ target: sites.businessId }).returning();
    if (created) {
      await sitesRepo.ensureTab(db, businessId);
      return created;
    }
    const existing = await sitesRepo.get(db, businessId);
    if (!existing) throw new Error("sites.ensure: no site after insert");
    return existing;
  },

  /**
   * The Product › Site tab, added to the department that holds the Product module when the business's site is created
   * (WP-07 T5). It is not in `MODULE_TABS`, so no business gets it at Commit: a project has the tab only once the
   * platform made it a site, which happens only where SITES_DOMAIN is set. Idempotent; a business without a Product
   * department gets no tab.
   */
  async ensureTab(db: Executor, businessId: string): Promise<void> {
    const product = (await departmentsRepo.list(db, businessId)).find((d) => d.moduleKeys.includes("product"));
    if (!product) return;
    const tabs = await screensRepo.list(db, businessId, product.id);
    if (tabs.some((t) => t.tabSlug === SITE_TAB.slug)) return;
    await screensRepo.upsert(db, businessId, { departmentId: product.id, tabSlug: SITE_TAB.slug, title: SITE_TAB.title, layout: { widgets: [{ key: `module:product/${SITE_TAB.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] } });
  },

  /** The newest `preview` release, or null. */
  async latestRelease(db: Executor, businessId: string): Promise<SiteRelease | null> {
    return maybeOne(
      await db
        .select()
        .from(siteReleases)
        .where(and(eq(siteReleases.businessId, businessId), eq(siteReleases.state, "preview")))
        .orderBy(desc(siteReleases.number))
        .limit(1),
    );
  },

  /** Saves the next release of the business's site (which must exist). Idempotent on `sessionId`. */
  async saveRelease(db: Executor, businessId: string, input: SaveSiteReleaseInput): Promise<SiteRelease> {
    const v = parseInput(SaveSiteReleaseInput, input, "site release");
    const bySession = async () =>
      v.sessionId ? maybeOne(await db.select().from(siteReleases).where(and(eq(siteReleases.businessId, businessId), eq(siteReleases.sessionId, v.sessionId))).limit(1)) : null;
    const prior = await bySession();
    if (prior) return prior;
    const site = await sitesRepo.get(db, businessId);
    if (!site) throw new Error("sites.saveRelease: the business has no site");
    const [{ next } = { next: 1 }] = await db
      .select({ next: sql<number>`coalesce(max(${siteReleases.number}), 0)::int + 1` })
      .from(siteReleases)
      .where(eq(siteReleases.siteId, site.id));
    const [row] = await db
      .insert(siteReleases)
      .values({
        businessId,
        siteId: site.id,
        number: next,
        parentReleaseId: v.parentReleaseId,
        taskId: v.taskId,
        sessionId: v.sessionId,
        agentId: v.agentId,
        files: v.files,
        fileCount: v.files.length,
        totalBytes: v.files.reduce((n, f) => n + f.size, 0),
        contentHash: siteContentHash(v.files),
        state: v.state,
        screening: v.screening as SiteScreening,
        previewToken: randomBytes(16).toString("hex"),
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    // A conflict: the same session saved meanwhile (return its release), or another save took this number.
    const raced = await bySession();
    if (raced) return raced;
    throw new Error("sites.saveRelease: release number taken by a concurrent save; retry");
  },

  /**
   * Turns the site live on a `preview` release of this business and stamps who published it. Run as the founder inside
   * `withRls` (owner or admin) or with the service role. Throws when the release is not a preview of this business, or
   * when the site is missing, taken down or not the caller's to publish.
   */
  async publish(tx: Executor, businessId: string, input: { releaseId: string; userId: string }): Promise<{ site: Site; release: SiteRelease }> {
    const release = maybeOne(
      await tx
        .select({ id: siteReleases.id })
        .from(siteReleases)
        .where(and(eq(siteReleases.id, input.releaseId), eq(siteReleases.businessId, businessId), eq(siteReleases.state, "preview")))
        .limit(1),
    );
    if (!release) throw new Error("sites.publish: the release is not a preview of this business");
    const [site] = await tx
      .update(sites)
      .set({ status: "live", liveReleaseId: input.releaseId })
      .where(and(eq(sites.businessId, businessId), ne(sites.status, "taken_down")))
      .returning();
    if (!site) throw new Error("sites.publish: the site is missing, taken down or not yours to publish");
    const [stamped] = await tx
      .update(siteReleases)
      .set({ publishedBy: input.userId, publishedAt: sql`now()` })
      .where(and(eq(siteReleases.id, input.releaseId), eq(siteReleases.businessId, businessId)))
      .returning();
    if (!stamped) throw new Error("sites.publish: the release could not be stamped");
    return { site, release: stamped };
  },

  /** Back to draft: visitors see nothing. Throws when the site is missing, taken down or not the caller's. */
  async unpublish(tx: Executor, businessId: string): Promise<Site> {
    const [site] = await tx
      .update(sites)
      .set({ status: "draft", liveReleaseId: null })
      .where(and(eq(sites.businessId, businessId), ne(sites.status, "taken_down")))
      .returning();
    if (!site) throw new Error("sites.unpublish: the site is missing, taken down or not yours to unpublish");
    return site;
  },

  /** A new address for the site (owner or admin under RLS). Throws when the site is missing or taken down. */
  async setSlug(tx: Executor, businessId: string, slug: string): Promise<Site> {
    const [site] = await tx.update(sites).set({ slug }).where(and(eq(sites.businessId, businessId), ne(sites.status, "taken_down"))).returning();
    if (!site) throw new Error("sites.setSlug: the site is missing, taken down or not yours to change");
    return site;
  },

  /** One release of the business, or null (another business's id reads as null). */
  async getRelease(db: Executor, businessId: string, releaseId: string): Promise<SiteRelease | null> {
    return maybeOne(await db.select().from(siteReleases).where(and(eq(siteReleases.businessId, businessId), eq(siteReleases.id, releaseId))).limit(1));
  },

  /** Serializes the publishes of one business inside the caller's transaction (the daily limit counts under it). */
  async lockPublishes(tx: Executor, businessId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('site_publish'), hashtext(${businessId}))`);
  },

  /** The open "Your site is ready to look at" note (unread or read), else null. */
  async openReadyNote(db: Executor, businessId: string): Promise<InboxItem | null> {
    return maybeOne(
      await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.state, ["unread", "read"]), sql`${inboxItems.decision}->>'key' = ${SITE_READY_NOTE.key}`))
        .orderBy(desc(inboxItems.createdAt))
        .limit(1),
    );
  },

  /**
   * The Product lead's note for a new preview, from the agent that made it: written only when no note is open and no
   * publish happened since the last note (one note per round of looking, never one per version).
   */
  async writeReadyNote(db: Executor, businessId: string, input: { agentId: string; agentName: string; previewUrl: string; launchChecklist?: LaunchCheck[] }): Promise<InboxItem | null> {
    if (await sitesRepo.openReadyNote(db, businessId)) return null;
    const [last] = await db.select({ at: inboxItems.createdAt }).from(inboxItems).where(and(eq(inboxItems.businessId, businessId), sql`${inboxItems.decision}->>'key' = ${SITE_READY_NOTE.key}`)).orderBy(desc(inboxItems.createdAt)).limit(1);
    if (last) {
      const [published] = await db.select({ n: count() }).from(siteReleases).where(and(eq(siteReleases.businessId, businessId), gte(siteReleases.publishedAt, last.at)));
      if (Number(published?.n ?? 0) === 0) return null;
    }
    return inboxRepo.createItem(db, businessId, {
      type: "decision",
      from_agent_id: input.agentId,
      subject: SITE_READY_NOTE.subject,
      body_md: SITE_READY_NOTE.body(input.agentName, input.previewUrl),
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: {
        options: [
          { id: SITE_READY_NOTE.options.publish, label: SITE_READY_NOTE.publishLabel, recommended: true, consequence: "The newest version of your site goes live at its address.", cost_minor: 0, reversible: true },
          { id: SITE_READY_NOTE.options.later, label: SITE_READY_NOTE.laterLabel, recommended: false, consequence: "Nothing is public. You can publish from the Site tab any time.", cost_minor: 0, reversible: true },
        ], free_text: false, expires_at: null, key: SITE_READY_NOTE.key, ...(input.launchChecklist ? { launch_checklist: input.launchChecklist } : {}) },
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [],
    });
  },

  /** Publishing answers the note (the founder did what it asked). */
  async closeReadyNote(db: Executor, businessId: string, userId: string | null): Promise<void> {
    const open = await sitesRepo.openReadyNote(db, businessId);
    if (open) await inboxRepo.decide(db, businessId, open.id, { chosenOption: SITE_READY_NOTE.options.publish, decidedByKind: "user", decidedBy: userId });
  },

  /** The business's releases, newest first. */
  async listReleases(db: Executor, businessId: string, limit = 20): Promise<SiteRelease[]> {
    const n = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return db.select().from(siteReleases).where(eq(siteReleases.businessId, businessId)).orderBy(desc(siteReleases.number)).limit(n);
  },

  /** What a host's first label serves (`site_resolve`), or null. */
  async resolveHost(db: Executor, label: string): Promise<SiteHost | null> {
    const [row] = rowsOf<{ release_id: string | null; business_id: string; kind: SiteHost["kind"]; plan_tier: string }>(
      await db.execute(sql`select release_id, business_id, kind, plan_tier from site_resolve(${label})`),
    );
    return row ? { releaseId: row.release_id, businessId: row.business_id, kind: row.kind, planTier: row.plan_tier } : null;
  },

  /** A visitor's report of a live site (`site_report`): one audit row, nothing about the reporter. */
  async report(db: Executor, label: string, input: { reason: string; detail?: string | null }): Promise<SiteReportResult> {
    const [row] = rowsOf<{ result: SiteReportResult }>(await db.execute(sql`select site_report(${label}, ${input.reason}, ${input.detail ?? null}) as result`));
    return row!.result;
  },

  /** One file of a release (`site_file`), or null. */
  async readFile(db: Executor, releaseId: string, path: string): Promise<SiteFile | null> {
    const [row] = rowsOf<{ content: Uint8Array; sha256: string; size: number }>(await db.execute(sql`select content, sha256, size from site_file(${releaseId}::uuid, ${path})`));
    return row ? { content: row.content, sha256: row.sha256, size: Number(row.size) } : null;
  },

  /** Releases of the business published since UTC midnight. */
  async publishesToday(db: Executor, businessId: string, options: { now?: Date } = {}): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(siteReleases)
      .where(and(eq(siteReleases.businessId, businessId), gte(siteReleases.publishedAt, utcMidnight(options.now ?? new Date()))));
    return Number(row?.n ?? 0);
  },

  /**
   * Presses of Publish since UTC midnight (the `site.published` audit rows apps/api writes), republishing the same
   * release included: what `SITE_LIMITS.publishesPerDay` counts.
   */
  async publishPressesToday(db: Executor, businessId: string, options: { now?: Date } = {}): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, "site.published"), gte(auditLog.createdAt, utcMidnight(options.now ?? new Date()))));
    return Number(row?.n ?? 0);
  },
};
