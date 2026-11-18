/**
 * project_pages (0077): a project's public page, one row per business.
 *
 * The api writes as the signed-in user through RLS: owner, admin and member save the draft and, while the page is not
 * live, its address; only an owner or an admin publishes, takes it down or changes a live page's address (the table's
 * guard trigger refuses anyone else, whichever client wrote). `publish` and `unpublish` are conditional on the row's
 * state, so a second tab or a second member changes nothing twice.
 *
 * When a page went live and when it was taken down are the database's to record (0090): for a signed-in client the
 * guard writes `published_at` and `unpublished_at` from its own clock and ignores a date sent with the write, so the
 * date on the public page and on the milestone "Page live" is never one somebody typed in. `publish` and `unpublish`
 * return the row as stored: read the dates from it. Their `at` is the service connection's only (a seed, a backfill, a
 * test fixture that needs a known date).
 *
 * `public.*` is the one read without a business: the signed-out page asks by address, on the service connection, and
 * gets only what the view `public_project_pages` lists (0077). An unknown address and a page that is not published
 * answer the same: null.
 */
import { ConflictError, isIndexNowKey, OWNER_ROLES, PAGE_READY_NOTE, PAGE_SLUG_TAKEN, ProjectPageContent, ProjectPageDraft, ProjectPageSlug, readPageContent, suffixPageSlug, suggestPageSlug, type ProjectPageContent as PageContent } from "@foundmill/shared";
import { toLogoDataUrl } from "@foundmill/shared/logo";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { businessFoundations, businessLogos, businesses, founderProfiles, ideaVersions, ideas, inboxItems, integrations, memberships, projectPages, publicProjectMilestones, publicProjectPages, type InboxItem, type ProjectPage } from "../schema";
import { auditRepo } from "./audit";
import { inboxRepo } from "./inbox";
import { toBytes } from "./logos";
import { Id, maybeOne, parseInput, uniqueViolation, type Executor } from "./_shared";

/** One option of the team's page note (Composer schema shape; packages/agents `projectPageReadyNote`). */
export interface TeamDraftNoteOption {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
  because?: string;
}

/** `writeTeamDraft`'s input: the draft, its address, who wrote it and how, and the Product lead's note. */
export interface TeamDraftInput {
  draft: PageContent;
  slug: string;
  /** The Product lead (else the Chief of Staff), named in the audit row and as the note's sender. */
  agentId: string | null;
  /** `model`: the Product lead's draft; `starter`: the deterministic draft the step fell back to. */
  source: "model" | "starter";
  reason: string | null;
  /** Route, model and cost (an Estimate), kept in the audit row. */
  model?: Record<string, unknown>;
  note: { subject: string; bodyMd: string; options: TeamDraftNoteOption[] } | null;
  onInboxItem?: (tx: Executor, item: InboxItem) => Promise<unknown>;
  /** The page catch-up wrote this draft for a project older than the feature: its note is held back from email (`ComposerDecision.catch_up`). */
  catchUp?: boolean;
}

const SLUG_CONSTRAINT = "project_pages_slug_key";

const SaveDraftInput = z.object({ draft: ProjectPageDraft, slug: ProjectPageSlug, userId: Id.nullable() });
const SetSlugInput = z.object({ slug: ProjectPageSlug, draft: ProjectPageDraft, userId: Id.nullable() });
/** `at`: the date to record, on the service connection only. For a signed-in client the database's clock is used instead (0090). */
const PublishInput = z.object({ content: ProjectPageContent, slug: ProjectPageSlug, userId: Id.nullable(), at: z.date().optional() });
const UnpublishInput = z.object({ userId: Id.nullable(), at: z.date().optional() });

export type SavePageDraftInput = z.input<typeof SaveDraftInput>;
export type SetPageSlugInput = z.input<typeof SetSlugInput>;
export type PublishPageInput = z.input<typeof PublishInput>;

/** A published page as anyone may read it: the view's columns, with the published copy read defensively. */
export interface PublicPage {
  slug: string;
  content: PageContent;
  publishedAt: Date;
  name: string;
  logoVersion: string | null;
  brandPrimary: string;
  brandSecondary: string;
  /** Empty unless the page says to name its founders. */
  founderNames: string[];
}

/** A milestone the founders chose to show, as anyone may read it (the view `public_project_milestones`, 0089). */
export interface PublicMilestone {
  /** The card's address: `/m/<id>`. */
  id: string;
  /** The page it belongs to: `/p/<slug>`. */
  slug: string;
  key: string;
  /** The public words, built from the key: never a customer's name. */
  label: string;
  achievedAt: Date;
}

const UUID = z.guid();

/** What the starter draft is built from (packages/shared `starterPageDraft`). */
export interface PageStarterInputs {
  founderWords: string | null;
  visionStatement: string | null;
  visionForWhom: string | null;
}

/** The studio's own entry among an idea version's citations: the founder's words, the brief, the Q&A (repos/foundations.ts). */
const IDEA_META_KIND = "foundmill:meta";
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A unique violation on the address becomes the founder's sentence; anything else is rethrown as it came. */
async function slugGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (uniqueViolation(err)?.constraint === SLUG_CONSTRAINT) throw new ConflictError(PAGE_SLUG_TAKEN, { field: "slug" });
    throw err;
  }
}

export const pagesRepo = {
  /** The business's page row, or null before anything was saved. */
  async get(db: Executor, businessId: string): Promise<ProjectPage | null> {
    return maybeOne(await db.select().from(projectPages).where(eq(projectPages.businessId, businessId)).limit(1));
  },

  /** Whether another business already holds this address. Service connection only: under RLS a member sees no other row. */
  async slugTaken(db: Executor, businessId: string, slug: string): Promise<boolean> {
    const rows = await db.select({ id: projectPages.id }).from(projectPages).where(and(eq(projectPages.slug, slug), ne(projectPages.businessId, businessId))).limit(1);
    return rows.length > 0;
  },

  /**
   * What a starter draft reads, from the business's own rows: the idea in the founder's words (kept by the studio on
   * the committed idea's current version: the card they wrote or edited, else the brief they typed) and the vision's
   * statement and "for whom". No model call anywhere.
   */
  async starterInputs(db: Executor, businessId: string): Promise<PageStarterInputs> {
    const [foundations, idea] = await Promise.all([
      db.select({ vision: businessFoundations.vision }).from(businessFoundations).where(eq(businessFoundations.businessId, businessId)).limit(1),
      db
        .select({ research: ideaVersions.research })
        .from(ideas)
        .innerJoin(ideaVersions, and(eq(ideaVersions.id, ideas.currentVersionId), eq(ideaVersions.businessId, businessId)))
        .where(eq(ideas.businessId, businessId))
        .limit(1),
    ]);
    const vision = (foundations[0]?.vision ?? null) as { statement?: unknown; forWhom?: unknown } | null;
    const citations = ((idea[0]?.research as { citations?: unknown } | null | undefined)?.citations ?? []) as unknown[];
    const meta = (Array.isArray(citations) ? citations : []).find((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && (c as { kind?: unknown }).kind === IDEA_META_KIND);
    return { founderWords: text(meta?.founder_words) ?? text(meta?.brief), visionStatement: text(vision?.statement), visionForWhom: text(vision?.forWhom) };
  },

  /**
   * Saves the draft. The first save writes the row at `slug`; later saves leave the address as it is (`setSlug` changes
   * it). The published copy is never touched.
   */
  async saveDraft(db: Executor, businessId: string, input: SavePageDraftInput): Promise<ProjectPage> {
    const v = parseInput(SaveDraftInput, input, "page draft");
    return slugGuard(async () => {
      const rows = await db
        .insert(projectPages)
        .values({ businessId, slug: v.slug, draft: v.draft, updatedBy: v.userId })
        .onConflictDoUpdate({ target: projectPages.businessId, set: { draft: v.draft, updatedBy: v.userId, updatedAt: new Date() } })
        .returning();
      return rows[0]!;
    });
  },

  /**
   * Changes the address (the row is written with `draft` when the business has none yet). ConflictError when another
   * project holds it. A live page's address is an owner's or an admin's to change (the guard trigger).
   */
  async setSlug(db: Executor, businessId: string, input: SetPageSlugInput): Promise<{ page: ProjectPage; previousSlug: string | null }> {
    const v = parseInput(SetSlugInput, input, "page address");
    const existing = await pagesRepo.get(db, businessId);
    return slugGuard(async () => {
      if (!existing) {
        const rows = await db.insert(projectPages).values({ businessId, slug: v.slug, draft: v.draft, updatedBy: v.userId }).returning();
        return { page: rows[0]!, previousSlug: null };
      }
      if (existing.slug === v.slug) return { page: existing, previousSlug: existing.slug };
      const rows = await db.update(projectPages).set({ slug: v.slug, updatedBy: v.userId, updatedAt: new Date() }).where(eq(projectPages.businessId, businessId)).returning();
      return { page: rows[0]!, previousSlug: existing.slug };
    });
  },

  /**
   * Publishes `content`: it becomes the draft and the published copy together. `wasLive` says whether the page was
   * already public (a publish of changes keeps `published_at`, so "Live since" does not move). The row is written at
   * `slug` when the business has none yet; an existing row keeps its address. The returned row carries the date as
   * stored: for a signed-in client that is the database's clock, not `at` and not this process's (0090).
   */
  async publish(db: Executor, businessId: string, input: PublishPageInput): Promise<{ page: ProjectPage; wasLive: boolean }> {
    const v = parseInput(PublishInput, input, "page");
    const at = v.at ?? new Date();
    const existing = maybeOne(await db.select().from(projectPages).where(eq(projectPages.businessId, businessId)).limit(1).for("update"));
    return slugGuard(async () => {
      if (!existing) {
        const rows = await db.insert(projectPages).values({ businessId, slug: v.slug, draft: v.content, published: v.content, publishedAt: at, publishedBy: v.userId, updatedBy: v.userId }).returning();
        return { page: rows[0]!, wasLive: false };
      }
      const wasLive = existing.published !== null;
      const rows = await db
        .update(projectPages)
        .set({ draft: v.content, published: v.content, publishedAt: wasLive ? (existing.publishedAt ?? at) : at, publishedBy: v.userId, unpublishedAt: null, updatedBy: v.userId, updatedAt: new Date() })
        .where(eq(projectPages.businessId, businessId))
        .returning();
      return { page: rows[0]!, wasLive };
    });
  },

  /**
   * Takes the page down: the published copy is cleared, the draft stays. Null when it was not live. `unpublished_at`
   * is the database's clock for a signed-in client, like `published_at` (0090).
   */
  async unpublish(db: Executor, businessId: string, input: z.input<typeof UnpublishInput>): Promise<ProjectPage | null> {
    const v = parseInput(UnpublishInput, input, "page");
    const rows = await db
      .update(projectPages)
      .set({ published: null, unpublishedAt: v.at ?? new Date(), updatedBy: v.userId, updatedAt: new Date() })
      .where(and(eq(projectPages.businessId, businessId), isNotNull(projectPages.published)))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * The address a first save uses: the business's own slug (else its name) made into a page address, with a short
   * suffix of the business id when another project holds it. Service connection only (`slugTaken`).
   */
  async suggestSlug(db: Executor, businessId: string): Promise<string> {
    const rows = await db.select({ slug: businesses.slug, name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const plain = suggestPageSlug(rows[0]?.slug || rows[0]?.name || "project");
    if (!(await pagesRepo.slugTaken(db, businessId, plain))) return plain;
    return suffixPageSlug(plain, businessId.replace(/-/g, "").slice(0, 6));
  },

  /**
   * Whether the team should draft the page (package 1.2): the business has no page row yet and is not a sample
   * business. A row means the founder already saved or an earlier attempt drafted it: never written over.
   */
  async teamDraftNeeded(db: Executor, businessId: string): Promise<boolean> {
    const rows = await db
      .select({ isDemo: businesses.isDemo, page: projectPages.id })
      .from(businesses)
      .leftJoin(projectPages, eq(projectPages.businessId, businesses.id))
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = rows[0];
    return !!row && !row.isDemo && row.page === null;
  },

  /**
   * The projects the page catch-up covers (WP-12 T1), oldest first, at most `limit`: committed before `committedBefore`,
   * not archived, not a sample, the team not stopped, and no page row at all (a founder's saved draft counts as one).
   * Service connection.
   */
  async listMissingTeamDraft(db: Executor, opts: { committedBefore: Date; limit: number }): Promise<string[]> {
    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        and(
          isNotNull(businesses.committedAt),
          sql`${businesses.committedAt} < ${opts.committedBefore.toISOString()}::timestamptz`,
          isNull(businesses.archivedAt),
          eq(businesses.isDemo, false),
          isNull(businesses.agentsStoppedAt),
          sql`not exists (select 1 from ${projectPages} where ${projectPages.businessId} = ${businesses.id})`,
        ),
      )
      .orderBy(asc(businesses.committedAt), asc(businesses.id))
      .limit(Math.max(0, opts.limit));
    return rows.map((r) => r.id);
  },

  /**
   * The team's first draft (package 1.2), in one transaction: the row at `slug` with the draft (only when the business
   * has none: a founder's save is never written over, and a retried step writes nothing twice), never published;
   * `updated_by` stays null (it names people) and the audit row names the agent; then the Product lead's note, a
   * decision that never holds Continue and is not a sign-off (its `decision.key` marks it), with `onInboxItem` for its
   * event in the same transaction. Service connection (the foundations runners).
   */
  async writeTeamDraft(db: Executor, businessId: string, input: TeamDraftInput): Promise<{ page: ProjectPage | null; item: InboxItem | null; written: boolean }> {
    const draft = parseInput(ProjectPageDraft, { ...input.draft, showFounders: false }, "page draft");
    const slug = parseInput(ProjectPageSlug, input.slug, "page address");
    return db.transaction(async (tx) => {
      const rows = await slugGuard(() => tx.insert(projectPages).values({ businessId, slug, draft, updatedBy: null }).onConflictDoNothing({ target: projectPages.businessId }).returning());
      const page = rows[0] ?? null;
      if (!page) return { page: null, item: null, written: false };
      await auditRepo.append(tx, businessId, {
        actorKind: input.agentId ? "agent" : "system",
        actorId: input.agentId,
        action: "page.draft_written",
        target: { kind: "project_page", id: page.id },
        details: { slug: page.slug, source: input.source, reason: input.reason, published: false, ...(input.model ? { model: input.model } : {}) },
      });
      let item: InboxItem | null = null;
      if (input.note && input.agentId) {
        item = await inboxRepo.createItem(tx, businessId, {
          type: "decision",
          from_agent_id: input.agentId,
          subject: input.note.subject.slice(0, 80),
          body_md: input.note.bodyMd,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: { options: input.note.options.map((o) => ({ ...o })), free_text: false, expires_at: null, key: PAGE_READY_NOTE.key, ...(input.catchUp ? { catch_up: true as const } : {}) },
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        });
        await input.onInboxItem?.(tx, item);
      }
      return { page, item, written: true };
    });
  },

  /** The Product lead's "Your project's page is ready" note while it is open (unread or read), else null. */
  async openReadyNote(db: Executor, businessId: string): Promise<InboxItem | null> {
    return maybeOne(
      await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.state, ["unread", "read"]), sql`${inboxItems.decision}->>'key' = ${PAGE_READY_NOTE.key}`))
        .orderBy(desc(inboxItems.createdAt))
        .limit(1),
    );
  },

  /**
   * Publishing answers the page note (the founder did what it asked), so it never waits in Needs you after the page is
   * live. Null when no note is open.
   */
  async closeReadyNote(db: Executor, businessId: string, userId: string | null): Promise<InboxItem | null> {
    const open = await pagesRepo.openReadyNote(db, businessId);
    if (!open) return null;
    return (await inboxRepo.decide(db, businessId, open.id, { chosenOption: PAGE_READY_NOTE.options.check, decidedByKind: "user", decidedBy: userId })).item;
  },

  /** Whether the business has no page live right now (Today's quiet reminder reads this). */
  async isUnpublished(db: Executor, businessId: string): Promise<boolean> {
    const rows = await db.select({ id: projectPages.id }).from(projectPages).where(and(eq(projectPages.businessId, businessId), isNotNull(projectPages.published))).limit(1);
    return rows.length === 0;
  },

  /** The display names the public page would show for this business's founders, its owners and cofounders (the view's own rule, 0092), for the preview. */
  async ownerNames(db: Executor, businessId: string): Promise<string[]> {
    const rows = await db
      .select({ name: founderProfiles.displayName })
      .from(memberships)
      .innerJoin(founderProfiles, eq(founderProfiles.userId, memberships.userId))
      .where(and(eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES]), isNull(founderProfiles.archivedAt)))
      .orderBy(memberships.createdAt, memberships.id);
    return rows.map((r) => r.name.trim()).filter(Boolean);
  },

  public: {
    /** A published page by its address, as the view exposes it; null for an unknown address or a page that is not public. */
    async bySlug(db: Executor, slug: string): Promise<PublicPage | null> {
      if (!ProjectPageSlug.safeParse(slug).success) return null;
      const row = maybeOne(await db.select().from(publicProjectPages).where(eq(publicProjectPages.slug, slug)).limit(1));
      if (!row) return null;
      const content = readPageContent(row.published);
      if (!content) return null;
      return { slug: row.slug, content, publishedAt: row.publishedAt, name: row.name, logoVersion: row.logoVersion ?? null, brandPrimary: row.kitPrimary, brandSecondary: row.kitSecondary, founderNames: row.founderNames ?? [] };
    },

    /**
     * The project's story: the milestones its founders chose to show, oldest first (0089). Empty for an unknown
     * address, a page that is not public and a page that shows none: the view lists a milestone only while its page is
     * in `public_project_pages`. Service connection only.
     */
    async storyBySlug(db: Executor, slug: string): Promise<PublicMilestone[]> {
      if (!ProjectPageSlug.safeParse(slug).success) return [];
      return db.select().from(publicProjectMilestones).where(eq(publicProjectMilestones.slug, slug)).orderBy(publicProjectMilestones.achievedAt, publicProjectMilestones.id);
    },

    /** Whether the page at `slug` shows at least one milestone (the page links to its story only then). */
    async hasStory(db: Executor, slug: string): Promise<boolean> {
      if (!ProjectPageSlug.safeParse(slug).success) return false;
      const rows = await db.select({ id: publicProjectMilestones.id }).from(publicProjectMilestones).where(eq(publicProjectMilestones.slug, slug)).limit(1);
      return rows.length > 0;
    },

    /** One shown milestone by its id (the card at `/m/<id>`), or null: unknown, hidden, or its page is not public. */
    async cardById(db: Executor, id: string): Promise<PublicMilestone | null> {
      if (!UUID.safeParse(id).success) return null;
      return maybeOne(await db.select().from(publicProjectMilestones).where(eq(publicProjectMilestones.id, id)).limit(1));
    },

    /**
     * The logo of the business behind a public page, as a `data:` URL, or null. Joined through the view, so only a page
     * the view lists gives its logo out. Service connection only (`business_logos` is members-only under RLS).
     */
    async logoBySlug(db: Executor, slug: string): Promise<string | null> {
      const row = maybeOne(
        await db
          .select({ mime: businessLogos.mime, content: businessLogos.content })
          .from(publicProjectPages)
          .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
          .innerJoin(businessLogos, eq(businessLogos.businessId, projectPages.businessId))
          .where(eq(publicProjectPages.slug, slug))
          .limit(1),
      );
      if (!row) return null;
      return toLogoDataUrl(row.mime, Buffer.from(toBytes(row.content)).toString("base64"));
    },

    /**
     * The plan of the business behind a public page, or null for an address the view does not list. Joined through the
     * view like the logo, on the service connection. The api turns it into one fact a visitor can already see for
     * themselves, whether the page carries the "Built on" mark (`tierShowsBuiltOnMark`); the plan's name goes no further.
     */
    async planTierBySlug(db: Executor, slug: string): Promise<(typeof businesses.$inferSelect)["planTier"] | null> {
      return (await pagesRepo.public.planBySlug(db, slug))?.planTier ?? null;
    },

    /** `planTierBySlug` with the business id, for the mark's paid-entry rule (`showsBuiltOnMark`); never sent to a visitor. */
    async planBySlug(db: Executor, slug: string): Promise<{ id: string; planTier: (typeof businesses.$inferSelect)["planTier"] } | null> {
      const row = maybeOne(
        await db
          .select({ id: businesses.id, planTier: businesses.planTier })
          .from(publicProjectPages)
          .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
          .innerJoin(businesses, eq(businesses.id, projectPages.businessId))
          .where(eq(publicProjectPages.slug, slug))
          .limit(1),
      );
      return row ?? null;
    },

    /**
     * The IndexNow key a public page's key file serves (`/p/<slug>/<key>.txt`; founder, 2026-11-12), or null. Only for a
     * page the view lists (published, not a sample), whose business connected IndexNow for its hosted page (`hosted` in
     * the integration's stored config, written at connect) and has not disconnected it. The key is public by protocol:
     * anyone may read the file, which is how search engines check that a submission comes from the page's owner.
     */
    async indexNowKeyBySlug(db: Executor, slug: string): Promise<string | null> {
      if (!ProjectPageSlug.safeParse(slug).success) return null;
      const row = maybeOne(
        await db
          .select({ settings: integrations.settings })
          .from(publicProjectPages)
          .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
          .innerJoin(integrations, eq(integrations.businessId, projectPages.businessId))
          .where(and(eq(publicProjectPages.slug, slug), eq(integrations.connectorKey, "indexnow"), isNull(integrations.archivedAt), inArray(integrations.status, ["connected", "degraded"])))
          .limit(1),
      );
      const config = (row?.settings as { config?: { hosted?: unknown; slug?: unknown; key?: unknown } } | undefined)?.config;
      if (!config || config.hosted !== true || config.slug !== slug || !isIndexNowKey(config.key)) return null;
      return config.key;
    },
  },
};
