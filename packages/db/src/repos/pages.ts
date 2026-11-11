/**
 * project_pages (0077): a project's public page, one row per business.
 *
 * The api writes as the signed-in user through RLS: owner, admin and member save the draft and, while the page is not
 * live, its address; only an owner or an admin publishes, takes it down or changes a live page's address (the table's
 * guard trigger refuses anyone else, whichever client wrote). `publish` and `unpublish` are conditional on the row's
 * state, so a second tab or a second member changes nothing twice.
 *
 * `public.*` is the one read without a business: the signed-out page asks by address, on the service connection, and
 * gets only what the view `public_project_pages` lists (0077). An unknown address and a page that is not published
 * answer the same: null.
 */
import { ConflictError, PAGE_SLUG_TAKEN, ProjectPageContent, ProjectPageDraft, ProjectPageSlug, readPageContent, type ProjectPageContent as PageContent } from "@foundmill/shared";
import { toLogoDataUrl } from "@foundmill/shared/logo";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { businessFoundations, businessLogos, founderProfiles, ideaVersions, ideas, memberships, projectPages, publicProjectPages, type ProjectPage } from "../schema";
import { toBytes } from "./logos";
import { Id, maybeOne, parseInput, uniqueViolation, type Executor } from "./_shared";

const SLUG_CONSTRAINT = "project_pages_slug_key";

const SaveDraftInput = z.object({ draft: ProjectPageDraft, slug: ProjectPageSlug, userId: Id.nullable() });
const SetSlugInput = z.object({ slug: ProjectPageSlug, draft: ProjectPageDraft, userId: Id.nullable() });
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
   * `slug` when the business has none yet; an existing row keeps its address.
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

  /** Takes the page down: the published copy is cleared, the draft stays. Null when it was not live. */
  async unpublish(db: Executor, businessId: string, input: z.input<typeof UnpublishInput>): Promise<ProjectPage | null> {
    const v = parseInput(UnpublishInput, input, "page");
    const rows = await db
      .update(projectPages)
      .set({ published: null, unpublishedAt: v.at ?? new Date(), updatedBy: v.userId, updatedAt: new Date() })
      .where(and(eq(projectPages.businessId, businessId), isNotNull(projectPages.published)))
      .returning();
    return rows[0] ?? null;
  },

  /** Whether the business has no page live right now (Today's quiet reminder reads this). */
  async isUnpublished(db: Executor, businessId: string): Promise<boolean> {
    const rows = await db.select({ id: projectPages.id }).from(projectPages).where(and(eq(projectPages.businessId, businessId), isNotNull(projectPages.published))).limit(1);
    return rows.length === 0;
  },

  /** The display names the public page would show for this business's owners (the view's own rule), for the preview. */
  async ownerNames(db: Executor, businessId: string): Promise<string[]> {
    const rows = await db
      .select({ name: founderProfiles.displayName })
      .from(memberships)
      .innerJoin(founderProfiles, eq(founderProfiles.userId, memberships.userId))
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, "owner"), isNull(founderProfiles.archivedAt)))
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
  },
};
