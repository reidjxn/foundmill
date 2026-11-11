/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1; migration 0077 `project_pages`; CLAUDE.md "Foundmill hosts
 * every project's public page at a Foundmill address for free"). The console's Public page tab reads and writes it
 * through `page.*`; the signed-out page at `/p/<slug>` reads `publicPage.bySlug`.
 *
 * - **Reading** (`page.get`, any member with Product read): the stored row, or, before anything was saved, a starter
 *   draft built from what the project already has (`starterPageDraft`: the pitch from the idea in the founder's own
 *   words, else the name; "about" from the vision; stage "idea"; the address from the business's own slug) without
 *   writing a row and without a model call.
 * - **Writing the draft and the address** (`page.saveDraft`, `page.setSlug`): Product write, the right that edits the
 *   vision. A live page's address is an owner's or an admin's to change (the table's guard trigger says the same).
 * - **Publishing and taking down** (`page.publish`, `page.unpublish`): an owner or an admin with Product write, by
 *   their own press only (no agent tool reaches this). Publishing validates with the shared schema, refuses a sample
 *   business, and screens the text with the deterministic checks of `community-screen` (markup and script links, email
 *   addresses, phone numbers). A held page stays unpublished and the answer says why in one plain sentence
 *   (`PAGE_HOLD_MESSAGES`). No model is called anywhere here. Each change writes its event through the outbox and an
 *   audit row in the same transaction.
 * - **The public read** (`publicPageBySlug`): the view `public_project_pages` on the service connection, so only its
 *   columns leave, plus the logo of a page the view lists.
 */
import { communityScreenLocalFlags } from "@foundmill/agents";
import { repos, type DbTx, type ProjectPage } from "@foundmill/db";
import {
  AppError,
  ForbiddenError,
  PAGE_HOLD_MESSAGES,
  PAGE_SLUG_TAKEN,
  ConflictError,
  ProjectPageContent,
  ProjectPageDraft,
  ValidationError,
  WRITE_ROLES,
  hasSectionAccess,
  pageContentProblems,
  pageSlugProblem,
  pageUrl,
  readPageContent,
  samePageContent,
  starterPageDraft,
  suffixPageSlug,
  suggestPageSlug,
  type PageHoldReason,
  type ProjectPageContent as PageContent,
} from "@foundmill/shared";
import { audit, emit, type BusinessContext } from "../trpc";
import type { Context } from "../context";
import { takeOrThrow } from "./rate-limit";

/** What the console's Public page tab reads (`page.get`) and every change answers. */
export interface PageView {
  /** The page's address: the stored one, or the suggestion a first save will use. */
  slug: string;
  /** The full public URL at that address (`APP_URL` + `/p/<slug>`). */
  url: string;
  /** False until something was saved: `draft` is then the starter draft, built from what the project has. */
  saved: boolean;
  draft: PageContent;
  /** The copy anyone can read now, or null while the page is not public. */
  published: PageContent | null;
  live: boolean;
  /** When the page went live (kept after it is taken down). */
  publishedAt: Date | null;
  /** When it was taken down, while it is not live. */
  unpublishedAt: Date | null;
  /** True while live and the draft reads differently from what is published. */
  changed: boolean;
  /** The reader may write the draft and, while the page is not live, its address (Product write). */
  canEdit: boolean;
  /** The reader may publish, publish changes, take it down and change a live page's address (owner or admin, Product write). */
  canPublish: boolean;
  /** A sample business never has a public page. */
  isSample: boolean;
  /** What the preview draws: the business's name, brand colors and the names "Built by" would show. */
  preview: { name: string; brandPrimary: string; brandSecondary: string; founderNames: string[] };
}

/** `page.publish`'s answer: published, or held with the reason and its sentence (the page stays as it was). */
export type PublishResult = { outcome: "published"; page: PageView } | { outcome: "held"; reason: PageHoldReason; message: string; page: PageView };

/** The sentence for a sample business (a typed refusal, `appCode: "page_sample_business"`). */
export const PAGE_SAMPLE_MESSAGE = "This is a sample business, so it has no public page. Start your own project to publish one.";
/** Changing a live page's address moves a public link: an owner's or an admin's to do. */
export const PAGE_LIVE_SLUG_MESSAGE = "Only an owner or an admin can change the address of a live page.";
export const PAGE_PUBLISH_ROLE_MESSAGE = "Only an owner or an admin can publish this page or take it down.";

const sampleRefusal = () => new AppError("page_sample_business", PAGE_SAMPLE_MESSAGE, 409);

const canEditPage = (ctx: BusinessContext): boolean => WRITE_ROLES.includes(ctx.role) && hasSectionAccess(ctx.membership, "product", "write");
const canPublishPage = (ctx: BusinessContext): boolean => (ctx.role === "owner" || ctx.role === "admin") && hasSectionAccess(ctx.membership, "product", "write");

/**
 * The address a first save uses: the business's own slug made into a page address, with a short suffix of the business
 * id when another project already holds it. Asked on the service connection: under RLS a member sees no other row.
 */
export async function suggestedSlug(ctx: BusinessContext): Promise<string> {
  const plain = suggestPageSlug(ctx.business.slug || ctx.business.name);
  if (!(await repos.pages.slugTaken(ctx.db, ctx.businessId, plain))) return plain;
  return suffixPageSlug(plain, ctx.businessId.replace(/-/g, "").slice(0, 6));
}

/**
 * The view of a stored row (or of the starter draft at `suggested` when there is none), as this reader may use it.
 * Inside the caller's transaction: everything that needs the service connection (`suggestedSlug`) is asked before it.
 */
async function viewOf(tx: DbTx, ctx: BusinessContext, row: ProjectPage | null, suggested: string | null = null): Promise<PageView> {
  const [draft, founderNames] = await Promise.all([
    row ? Promise.resolve(readPageContent(row.draft) ?? starterPageDraft({ businessName: ctx.business.name })) : repos.pages.starterInputs(tx, ctx.businessId).then((inputs) => starterPageDraft({ businessName: ctx.business.name, ...inputs })),
    repos.pages.ownerNames(tx, ctx.businessId),
  ]);
  const slug = row?.slug ?? suggested ?? suggestPageSlug(ctx.business.slug || ctx.business.name);
  const published = row ? readPageContent(row.published) : null;
  return {
    slug,
    url: pageUrl(ctx.env.APP_URL, slug),
    saved: row !== null,
    draft,
    published,
    live: published !== null,
    publishedAt: row?.publishedAt ?? null,
    unpublishedAt: published ? null : (row?.unpublishedAt ?? null),
    changed: published !== null && !samePageContent(draft, published),
    canEdit: canEditPage(ctx),
    canPublish: canPublishPage(ctx),
    isSample: ctx.business.isDemo,
    preview: { name: ctx.business.name, brandPrimary: ctx.business.kitPrimary, brandSecondary: ctx.business.kitSecondary, founderNames },
  };
}

/** `page.get`: the page as it stands, or the starter draft (nothing is written). */
export async function pageView(ctx: BusinessContext): Promise<PageView> {
  const existing = await repos.pages.get(ctx.db, ctx.businessId);
  const suggested = existing ? null : await suggestedSlug(ctx);
  return ctx.rls(async (tx) => viewOf(tx, ctx, await repos.pages.get(tx, ctx.businessId), suggested));
}

/** `page.saveDraft`: saves the founder's words. The first save writes the row at the suggested address. */
export async function savePageDraft(ctx: BusinessContext, input: { draft: PageContent }): Promise<PageView> {
  const draft = ProjectPageDraft.parse(input.draft);
  const slug = (await repos.pages.get(ctx.db, ctx.businessId))?.slug ?? (await suggestedSlug(ctx));
  return ctx.rls(async (tx) => {
    const row = await repos.pages.saveDraft(tx, ctx.businessId, { draft, slug, userId: ctx.userId });
    await audit(tx, ctx, { action: "page.draft_saved", target: { kind: "project_page", id: row.id }, details: { slug: row.slug } });
    return viewOf(tx, ctx, row);
  });
}

/**
 * `page.setSlug`: a new address. Refused in the founder's words when it breaks the rule or another project has it
 * (checked here first, and by the unique constraint for a race). Moving a live page takes the old address down and
 * puts the page up at the new one, so both events are written.
 */
export async function setPageSlug(ctx: BusinessContext, input: { slug: string; draft?: PageContent }): Promise<PageView> {
  const slug = input.slug.trim().toLowerCase();
  const problem = pageSlugProblem(slug);
  if (problem) throw new ValidationError(problem, { field: "slug" });
  const existing = await repos.pages.get(ctx.db, ctx.businessId);
  if (existing?.published && existing.slug !== slug && !canPublishPage(ctx)) throw new ForbiddenError(PAGE_LIVE_SLUG_MESSAGE);
  if (await repos.pages.slugTaken(ctx.db, ctx.businessId, slug)) throw new ConflictError(PAGE_SLUG_TAKEN, { field: "slug" });
  const draft = input.draft ? ProjectPageDraft.parse(input.draft) : existing ? undefined : (await pageView(ctx)).draft;
  return ctx.rls(async (tx) => {
    const { page, previousSlug } = await repos.pages.setSlug(tx, ctx.businessId, { slug, draft: draft ?? readPageContent(existing?.draft) ?? starterPageDraft({ businessName: ctx.business.name }), userId: ctx.userId });
    if (previousSlug !== page.slug) {
      await audit(tx, ctx, { action: "page.address_changed", target: { kind: "project_page", id: page.id }, details: { from: previousSlug, to: page.slug, live: page.published !== null } });
      if (page.published && previousSlug) {
        await emit(tx, ctx, { type: "page.unpublished", payload: { pageId: page.id, slug: previousSlug, url: pageUrl(ctx.env.APP_URL, previousSlug) } });
        await emit(tx, ctx, { type: "page.published", payload: { pageId: page.id, slug: page.slug, url: pageUrl(ctx.env.APP_URL, page.slug) } });
      }
    }
    return viewOf(tx, ctx, page);
  });
}

/** The first deterministic hold among the page's texts (markup before personal data), or null when it may go out. */
export function pageHoldReason(content: PageContent): PageHoldReason | null {
  const flags = communityScreenLocalFlags([content.pitch, content.about, content.forWhom].join("\n\n"));
  if (flags.includes("markup")) return "markup";
  if (flags.includes("personal_data")) return "personal_data";
  return null;
}

/**
 * `page.publish`: `content` (what the founder sees in the preview) becomes the draft and the published copy. A sample
 * business is refused; a page that breaks the shared limits is a validation error naming the field; a page the screen
 * holds keeps the founder's words as the draft and stays as it was (not published, or still showing the last
 * published copy).
 */
export async function publishPage(ctx: BusinessContext, input: { content: PageContent }): Promise<PublishResult> {
  if (ctx.business.isDemo) throw sampleRefusal();
  if (!canPublishPage(ctx)) throw new ForbiddenError(PAGE_PUBLISH_ROLE_MESSAGE);
  const draft = ProjectPageDraft.parse(input.content);
  const problems = pageContentProblems(draft);
  const first = Object.entries(problems)[0];
  if (first) throw new ValidationError(first[1], { field: first[0], problems });
  const content = ProjectPageContent.parse(draft);
  const reason = pageHoldReason(content);
  const existing = await repos.pages.get(ctx.db, ctx.businessId);
  const slug = existing?.slug ?? (await suggestedSlug(ctx));
  if (reason) {
    const page = await ctx.rls(async (tx) => {
      const row = await repos.pages.saveDraft(tx, ctx.businessId, { draft: content, slug, userId: ctx.userId });
      await audit(tx, ctx, { action: "page.publish_held", target: { kind: "project_page", id: row.id }, details: { reason } });
      return viewOf(tx, ctx, row);
    });
    return { outcome: "held", reason, message: PAGE_HOLD_MESSAGES[reason], page };
  }
  const page = await ctx.rls(async (tx) => {
    const { page: row, wasLive } = await repos.pages.publish(tx, ctx.businessId, { content, slug, userId: ctx.userId });
    const url = pageUrl(ctx.env.APP_URL, row.slug);
    await emit(tx, ctx, { type: "page.published", payload: { pageId: row.id, slug: row.slug, url } });
    await audit(tx, ctx, { action: "page.published", target: { kind: "project_page", id: row.id }, details: { slug: row.slug, url, changes: wasLive } });
    return viewOf(tx, ctx, row);
  });
  return { outcome: "published", page };
}

/** `page.unpublish`: takes the page down (the draft stays). Taking down a page that is not live changes nothing. */
export async function unpublishPage(ctx: BusinessContext): Promise<PageView> {
  if (!canPublishPage(ctx)) throw new ForbiddenError(PAGE_PUBLISH_ROLE_MESSAGE);
  const view = await ctx.rls(async (tx) => {
    const row = await repos.pages.unpublish(tx, ctx.businessId, { userId: ctx.userId });
    if (!row) return null;
    const url = pageUrl(ctx.env.APP_URL, row.slug);
    await emit(tx, ctx, { type: "page.unpublished", payload: { pageId: row.id, slug: row.slug, url } });
    await audit(tx, ctx, { action: "page.unpublished", target: { kind: "project_page", id: row.id }, details: { slug: row.slug, url } });
    return viewOf(tx, ctx, row);
  });
  return view ?? pageView(ctx);
}

/** What anyone may read of a published page (`publicPage.bySlug`). */
export interface PublicPageView {
  slug: string;
  url: string;
  name: string;
  pitch: string;
  about: string;
  forWhom: string;
  stage: PageContent["stage"];
  publishedAt: Date;
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a `data:` URL, or null for the initials mark. */
  logo: string | null;
  /** Empty unless the page names its founders. */
  founderNames: string[];
}

/**
 * Signed-out reads of public pages, shared by every api replica (`ctx.limits`). The api sees the web server, not the
 * reader, so these are ceilings that keep a flood off the database: one per address and one across all of them.
 */
export const PUBLIC_PAGE_LIMITS = {
  perSlug: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
} as const;

/** `publicPage.bySlug`: the published page at `slug`, or null for an unknown address or a page that is not public. */
export async function publicPageBySlug(ctx: Pick<Context, "db" | "env" | "limits">, slug: string): Promise<PublicPageView | null> {
  const clean = slug.trim().toLowerCase();
  if (pageSlugProblem(clean)) return null;
  await takeOrThrow(ctx.limits, "Page view", [
    { key: `public-page:slug:${clean}`, rule: PUBLIC_PAGE_LIMITS.perSlug },
    { key: "public-page:all", rule: PUBLIC_PAGE_LIMITS.all },
  ]);
  const [page, logo] = await Promise.all([repos.pages.public.bySlug(ctx.db, clean), repos.pages.public.logoBySlug(ctx.db, clean)]);
  if (!page) return null;
  const { pitch, about, forWhom, stage, showFounders } = page.content;
  return {
    slug: page.slug,
    url: pageUrl(ctx.env.APP_URL, page.slug),
    name: page.name,
    pitch,
    about,
    forWhom,
    stage,
    publishedAt: page.publishedAt,
    brandPrimary: page.brandPrimary,
    brandSecondary: page.brandSecondary,
    logo,
    founderNames: showFounders ? page.founderNames : [],
  };
}
