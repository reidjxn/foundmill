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
 *   audit row in the same transaction. The first publish also records the milestone "Page live" in that transaction
 *   (`awardPageLiveMilestone`, at the page's `published_at`; publishing changes later awards nothing new).
 * - **The public read** (`publicPageBySlug`): the view `public_project_pages` on the service connection (since 0081 the
 *   view is the service role's only), so only its columns leave, plus the logo of a page the view lists. Limited per
 *   caller, then per address and across all of them; a lookup that finds nothing gives those back and draws from a
 *   ceiling of its own (`PUBLIC_PAGE_LIMITS`).
 * - **The team's first draft** (packages 1.2 and 1.3): the foundations runners write the row with the Product lead's
 *   draft and the note "Your project's page is ready" (`repos.pages.writeTeamDraft`); `decidePageNote` answers that
 *   note, and publishing answers it too.
 * - **Following** (`followPage`, package 1.6, double opt-in): a signed-out visitor leaves an email address on a published
 *   page whose "Follow" form is on; that writes a pending consent record and asks the gateway for the one confirmation
 *   email. `page.followed` is written when the person confirms (ingest `/mail/confirm`), not here.
 */
import { communityScreenLocalFlags } from "@foundmill/agents";
import { tierShowsBuiltOnMark } from "@foundmill/config";
import { siteSlugProblem, sitesDomain } from "@foundmill/shared/sites";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { awardPageLiveMilestone, markBilling, repos, showsBuiltOnMark, type DbTx, type InboxItem, type ProjectPage } from "@foundmill/db";
import {
  pageIsListed,
  AppError,
  FOLLOW_ERRORS,
  FOLLOW_TURNSTILE_ACTION,
  followConsentText,
  followEmailProblem,
  ForbiddenError,
  PAGE_HOLD_MESSAGES,
  PAGE_READY_NOTE,
  PAGE_SLUG_TAKEN,
  ConflictError,
  ProjectPageContent,
  ProjectPageDraft,
  ValidationError,
  WRITE_ROLES,
  hasSectionAccess,
  pageContentProblems,
  isAdminRole,
  limitAddress,
  pageSlugProblem,
  pageUrl,
  readPageContent,
  samePageContent,
  starterPageDraft,
  suggestPageSlug,
  type Env,
  mockResultsAllowed,
  platformMailLive,
  isIndexNowKey,
  type PageHoldReason,
  type ProjectPageContent as PageContent,
} from "@foundmill/shared";
import { z } from "zod";
import { audit, emit, type BusinessContext } from "../trpc";
import type { Context } from "../context";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";
import { queueShowcaseCheck } from "./showcase";
import { queuePostDraft } from "./post-drafts";
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
  /** `logo`: the business's checked logo as a `data:` URL, the same one the published page shows; null for none. */
  preview: { name: string; brandPrimary: string; brandSecondary: string; founderNames: string[]; logo: string | null };
  /** How many people follow the page now (package 1.6): a count only, never who. */
  followers: number;
  /** Whether the page carries the small "Built on" mark for its visitors (the free plan; docs/NETWORK.md F2). */
  mark: boolean;
  /** Whether Follow can confirm an address here (platform mail live, or a development or test stack). */
  followAvailable: boolean;
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
const canPublishPage = (ctx: BusinessContext): boolean => isAdminRole(ctx.role) && hasSectionAccess(ctx.membership, "product", "write");

/**
 * The address a first save uses: the business's own slug made into a page address, with a short suffix of the business
 * id when another project already holds it. Asked on the service connection: under RLS a member sees no other row.
 */
export async function suggestedSlug(ctx: BusinessContext): Promise<string> {
  // The same rule as the team's first draft (package 1.2, the foundations runners): `repos.pages.suggestSlug`.
  return repos.pages.suggestSlug(ctx.db, ctx.businessId);
}

/**
 * The view of a stored row (or of the starter draft at `suggested` when there is none), as this reader may use it.
 * Inside the caller's transaction: everything that needs the service connection (`suggestedSlug`) is asked before it.
 */
async function viewOf(tx: DbTx, ctx: BusinessContext, row: ProjectPage | null, suggested: string | null = null): Promise<PageView> {
  const [draft, founderNames, followers, logo] = await Promise.all([
    // A draft saved before the follow form existed reads with it on, like every new page; the published copy reads as it went out.
    row ? Promise.resolve(readPageContent(row.draft, true) ?? starterPageDraft({ businessName: ctx.business.name })) : repos.pages.starterInputs(tx, ctx.businessId).then((inputs) => starterPageDraft({ businessName: ctx.business.name, ...inputs })),
    repos.pages.ownerNames(tx, ctx.businessId),
    row ? repos.followers.count(tx, ctx.businessId) : Promise.resolve(0),
    repos.logos.get(tx, ctx.businessId).then((l) => l?.dataUrl ?? null),
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
    preview: { name: ctx.business.name, brandPrimary: ctx.business.kitPrimary, brandSecondary: ctx.business.kitSecondary, founderNames, logo },
    followers,
    mark: await showsBuiltOnMark(ctx.db, ctx.business, markBilling(ctx.env)),
    followAvailable: followAvailable(ctx.env),
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
    const { page, previousSlug } = await repos.pages.setSlug(tx, ctx.businessId, { slug, draft: draft ?? readPageContent(existing?.draft, true) ?? starterPageDraft({ businessName: ctx.business.name }), userId: ctx.userId });
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
  let wentLive = false;
  const page = await ctx.rls(async (tx) => {
    const { page: row, wasLive } = await repos.pages.publish(tx, ctx.businessId, { content, slug, userId: ctx.userId });
    wentLive = !wasLive;
    const url = pageUrl(ctx.env.APP_URL, row.slug);
    await emit(tx, ctx, { type: "page.published", payload: { pageId: row.id, slug: row.slug, url } });
    // The page is live: the project's first early milestone, recorded once at the moment it went live (0089). A page
    // that was already live before this existed gets it here too, with its original date.
    if (row.publishedAt) await awardPageLiveMilestone(tx, ctx.businessId, { pageId: row.id, at: row.publishedAt });
    // The Product lead's "Your project's page is ready" note asked for exactly this: it stops waiting in Needs you.
    await repos.pages.closeReadyNote(tx, ctx.businessId, ctx.userId);
    await audit(tx, ctx, { action: "page.published", target: { kind: "project_page", id: row.id }, details: { slug: row.slug, url, changes: wasLive } });
    return viewOf(tx, ctx, row);
  });
  // The page went live (not a change to a live page): the social agent may draft a post about it for the founder to
  // share by tap, where the founder put the social channel on the board (services/post-drafts.ts). Never waited on.
  if (wentLive) queuePostDraft(ctx, ctx.businessId, { kind: "page_published" });
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
  // The page is private now: a showcase ask about the project is withdrawn (services/showcase.ts).
  if (view) queueShowcaseCheck(ctx, ctx.businessId);
  return view ?? pageView(ctx);
}

/**
 * The Product lead's "Your project's page is ready" note (package 1.3), decided in-process like a sign-off or the goal
 * (no plan compiler): "Check it and publish" answers it and the client opens Product › Public page; "Later" answers it
 * and Today shows its quiet line to the page instead. Neither publishes anything: that stays the founder's own press.
 */
export async function decidePageNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const option = input.chosenOption;
  if (option !== PAGE_READY_NOTE.options.check && option !== PAGE_READY_NOTE.options.later) throw new ValidationError(`Choose ${PAGE_READY_NOTE.checkLabel} or ${PAGE_READY_NOTE.laterLabel}.`, { itemId: item.id });
  const summary = option === PAGE_READY_NOTE.options.check ? "Opened the public page to check it." : "The public page waits until later.";
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { page_option: option }, result: { pageOption: option } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
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
  /** When the published copy last changed (0119): the page's `dateModified` and "Updated" line. */
  updatedAt: Date;
  /** Whether search engines may list the page (`pageIsListed`); a page that is not listed is still public. */
  listed: boolean;
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a `data:` URL, or null for the initials mark. */
  logo: string | null;
  /** Empty unless the page names its founders. */
  founderNames: string[];
  /** Whether the page carries the "Follow" form (`publicPage.follow`). */
  followForm: boolean;
  /** Whether the page carries the small "Built on" mark (a project on the free plan; a paid plan removes it). */
  mark: boolean;
  /** Whether the founders show at least one milestone: the project then has a story at `/p/<slug>/story` (0089). */
  story: boolean;
}

/**
 * Signed-out reads of public pages, shared by every api replica (`ctx.limits`), in the order `publicPageBySlug` takes
 * them:
 *   - `perCaller`: by the address the api itself sees (`ctx.clientAddress`, as the Follow form). A page rendered by the
 *     web comes from the web's egress addresses, so every reader of the web shares a few buckets here: generous, and it
 *     is what stops a caller hitting the api directly from emptying the ceilings below alone.
 *   - `perSlug` and `all`: ceilings that keep a flood off the database, one per address and one across all of them.
 *   - `unknown`: a lookup that finds nothing (an unknown address, or a page that is not public) gives its `perSlug` and
 *     `all` hits back and draws from this ceiling instead, so random addresses cannot use up what real pages read from.
 */
export const PUBLIC_PAGE_LIMITS = {
  perCaller: { limit: 300, windowMs: 60_000 },
  perSlug: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
  unknown: { limit: 600, windowMs: 60_000 },
} as const;

export const publicPageLimitKeys = {
  caller: (env: Pick<Env, "SESSION_TOKEN_SECRET">, address: string) => callerLimitKey(env, "public-page", address),
  slug: (slug: string) => `public-page:slug:${slug}`,
  all: "public-page:all",
  unknown: "public-page:unknown",
} as const;

/**
 * `publicPage.indexNowKeyFile`: what `/p/<slug>/<key>.txt` serves (founder, 2026-11-12), the key itself when it is the one
 * the project's founders connected IndexNow with for this public page, else null (an unknown address, a page that is not
 * public, IndexNow not connected for the hosted page, or another key: all the same not-found). Under the same limits as
 * a page view; a miss draws from the `unknown` ceiling, so guessing keys cannot use up what real pages read from. The
 * key is public by protocol, so the comparison need not be constant-time.
 */
export async function publicIndexNowKeyFile(ctx: Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null }, input: { slug: string; key: string }): Promise<{ key: string } | null> {
  const clean = input.slug.trim().toLowerCase();
  if (pageSlugProblem(clean) || !isIndexNowKey(input.key)) return null;
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Page view", [{ key: publicPageLimitKeys.caller(ctx.env, ctx.clientAddress), rule: PUBLIC_PAGE_LIMITS.perCaller }]);
  const ticket = await takeOrThrow(ctx.limits, "Page view", [
    { key: publicPageLimitKeys.slug(clean), rule: PUBLIC_PAGE_LIMITS.perSlug },
    { key: publicPageLimitKeys.all, rule: PUBLIC_PAGE_LIMITS.all },
  ]);
  const key = await repos.pages.public.indexNowKeyBySlug(ctx.db, clean);
  if (key === null || key !== input.key) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, "Page view", [{ key: publicPageLimitKeys.unknown, rule: PUBLIC_PAGE_LIMITS.unknown }]);
    return null;
  }
  return { key };
}

/**
 * Whether a Follow confirmation can be sent here (WP-02 T7): platform mail is live, or this is a development or test
 * stack, where the mock answers. On staging or production without it no visitor is offered the form, so nobody is told
 * "Check your email to confirm." for an email that cannot go out.
 */
export function followAvailable(env: Pick<Env, "APP_ENV" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS"> & Partial<Pick<Env, "PLATFORM_MAIL_DOMAIN">>): boolean {
  return platformMailLive(env) || mockResultsAllowed(env.APP_ENV, false);
}

/** `publicPage.bySlug`: the published page at `slug`, or null for an unknown address or a page that is not public. */
export async function publicPageBySlug(ctx: Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null }, slug: string): Promise<PublicPageView | null> {
  const clean = slug.trim().toLowerCase();
  if (pageSlugProblem(clean)) return null;
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Page view", [{ key: publicPageLimitKeys.caller(ctx.env, ctx.clientAddress), rule: PUBLIC_PAGE_LIMITS.perCaller }]);
  const ticket = await takeOrThrow(ctx.limits, "Page view", [
    { key: publicPageLimitKeys.slug(clean), rule: PUBLIC_PAGE_LIMITS.perSlug },
    { key: publicPageLimitKeys.all, rule: PUBLIC_PAGE_LIMITS.all },
  ]);
  const page = await repos.pages.public.bySlug(ctx.db, clean);
  if (!page) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, "Page view", [{ key: publicPageLimitKeys.unknown, rule: PUBLIC_PAGE_LIMITS.unknown }]);
    return null;
  }
  const [logo, planTier, story] = await Promise.all([repos.pages.public.logoBySlug(ctx.db, clean), repos.pages.public.planBySlug(ctx.db, clean), repos.pages.public.hasStory(ctx.db, clean)]);
  const { pitch, about, forWhom, stage, showFounders, followForm } = page.content;
  return {
    slug: page.slug,
    url: pageUrl(ctx.env.APP_URL, page.slug),
    name: page.name,
    pitch,
    about,
    forWhom,
    stage,
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
    listed: pageIsListed({ name: page.name, content: page.content }).listed,
    brandPrimary: page.brandPrimary,
    brandSecondary: page.brandSecondary,
    logo,
    founderNames: showFounders ? page.founderNames : [],
    followForm: followForm && followAvailable(ctx.env),
    // Taken down between the two reads: no plan to go by, so the mark stays (the free plan's rule).
    mark: planTier ? await showsBuiltOnMark(ctx.db, planTier, markBilling(ctx.env)) : tierShowsBuiltOnMark("free"),
    story,
  };
}

/**
 * Listed pages for the sitemap (`publicPage.listed`; WP-08 T7): address, last change and whether there is a story,
 * paged by address. Rate-limited per caller like a page view, and only what the founders published and the listing
 * rule lets through, so it lists nothing that is not already meant to be found.
 */
export async function publicListedPages(ctx: Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null }, input: { cursor?: string | null; limit: number }) {
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Page view", [{ key: publicPageLimitKeys.caller(ctx.env, ctx.clientAddress), rule: PUBLIC_PAGE_LIMITS.perCaller }]);
  return repos.pages.public.listed(ctx.db, { cursor: input.cursor ?? null, limit: input.limit });
}

/**
 * Signed-out follows (`publicPage.follow`, package 1.6), shared by every api replica (`ctx.limits`), in the order
 * `followPage` takes them (the bot check, Turnstile, comes after `perCaller` and before the rest, so a script never
 * spends a real person's allowance):
 *   - `perCaller`: by the address the api itself sees (`ctx.clientAddress`). A follow comes through the web's server
 *     action, so every visitor of the web shares the web's egress address here: the limit is generous, and the per-visitor
 *     limit is the Vercel Firewall rule on POST `/p/*` (docs/DEPLOY.md). No address forwarded by the web is trusted.
 *   - `perAddress` (per page address and email) and `confirmAnyProject` (one confirmation email per email address across
 *     every project per day): before the page is looked up, so repeats cost no page budget. Over either: the same
 *     answer, nothing written.
 *   - `closed`: an address that is not a page taking followers, site-wide, after the lookup (and nothing else is spent).
 *   - `perPageHour`, `perPageDay` and `all`: only for a page that takes followers.
 * The email keys are an HMAC of the address (`followAddressKey`), never the address or its plain hash.
 */
export const PAGE_FOLLOW_LIMITS = {
  perCaller: { limit: 120, windowMs: 60_000 },
  // One a day per page and address: a repeat never reaches the page's budget (it already has its pending record).
  perAddress: { limit: 1, windowMs: 24 * 60 * 60_000 },
  // Three a day across every project: a real person may follow a few projects in one sitting; a script cannot turn
  // the form into a mail cannon at one address.
  confirmAnyProject: { limit: 3, windowMs: 24 * 60 * 60_000 },
  closed: { limit: 60, windowMs: 60_000 },
  perPageHour: { limit: 60, windowMs: 60 * 60_000 },
  perPageDay: { limit: 300, windowMs: 24 * 60 * 60_000 },
  all: { limit: 600, windowMs: 60_000 },
} as const;

const FOLLOW_KEY_LABEL = "foundmill/page-follow-key/v1";
/** Development and test without SESSION_TOKEN_SECRET: a key for this process only. */
const PROCESS_FOLLOW_KEY = randomBytes(32).toString("base64url");

/**
 * HMAC-SHA256 of a value (an email address trimmed and lowercased, or a caller's address) under SESSION_TOKEN_SECRET with
 * its own label, as base64url: the rate-limit keys of `publicPage.follow`. Without the secret (it is required wherever
 * the api reaches the gateway) a key for this process stands in, so a lookup table of plain hashes never matches.
 */
export function followAddressKey(env: Pick<Env, "SESSION_TOKEN_SECRET">, kind: "email" | "caller", value: string): string {
  const secret = env.SESSION_TOKEN_SECRET && env.SESSION_TOKEN_SECRET.length >= 16 ? env.SESSION_TOKEN_SECRET : PROCESS_FOLLOW_KEY;
  return createHmac("sha256", secret).update(`${FOLLOW_KEY_LABEL}\n${kind}\n${value.trim().toLowerCase()}`).digest("base64url");
}

/**
 * A per-caller rate-limit key for `scope` (`public-page`, `public-person`, `page-follow`, the milestone cards,
 * `invite-read`, `invite-decline`): the caller's address, keyed. An IPv6 caller counts by their /64 (`limitAddress`,
 * second security review P2-2), so the addresses of one subscriber's block share one window.
 */
export function callerLimitKey(env: Pick<Env, "SESSION_TOKEN_SECRET">, scope: string, address: string): string {
  return `${scope}:caller:${followAddressKey(env, "caller", limitAddress(address))}`;
}

export const followLimitKeys = {
  caller: (env: Pick<Env, "SESSION_TOKEN_SECRET">, address: string) => callerLimitKey(env, "page-follow", address),
  perAddress: (env: Pick<Env, "SESSION_TOKEN_SECRET">, slug: string, email: string) => `page-follow:addr:${slug}:${followAddressKey(env, "email", email)}`,
  confirmAnyProject: (env: Pick<Env, "SESSION_TOKEN_SECRET">, email: string) => `page-follow:confirm:${followAddressKey(env, "email", email)}`,
  closed: "page-follow:closed",
  perPageHour: (pageId: string) => `page-follow:page:${pageId}:hour`,
  perPageDay: (pageId: string) => `page-follow:page:${pageId}:day`,
  all: "page-follow:all",
} as const;

/** The answer to every follow that is not refused, written or not: it never says whether the address was already there. */
export type FollowAnswer = { ok: true };

export interface FollowInput {
  slug: string;
  email: string;
  consent: boolean;
  /** The hidden field: a person never fills it in. */
  website?: string | null;
  /** The page's Turnstile token (the widget's `page_follow` action); without a valid one nothing is recorded or sent. */
  turnstile?: string | null;
  /** The last post code the visitor arrived with (the web's `fm_post` cookie): kept only for the project's own visited link. */
  post?: string | null;
  /**
   * Where the form is (WP-07 T6): the project's public page (the default) or its site's sign-up form, posted by
   * apps/sites. With `site`, `slug` is the site's address and the bot check expects the site's own host.
   */
  via?: "page" | "site";
}

/** The token the web sends without a Turnstile site key (development stacks); the gateway's mock passes it. */
export const FOLLOW_MOCK_TURNSTILE_TOKEN = "mock-ok";

const followRefusal = (code: "follow_email" | "follow_consent" | "follow_closed" | "follow_unverified" | "follow_unavailable") =>
  code === "follow_email"
    ? new AppError(code, FOLLOW_ERRORS.email, 400, { field: "email" })
    : code === "follow_consent"
      ? new AppError(code, FOLLOW_ERRORS.consent, 400, { field: "consent" })
      : code === "follow_unverified"
        ? new AppError(code, FOLLOW_ERRORS.unverified, 403)
        : code === "follow_unavailable"
          ? new AppError(code, FOLLOW_ERRORS.unavailable, 503)
          : new AppError(code, FOLLOW_ERRORS.closed, 404);

const devStack = (appEnv: string) => appEnv === "development" || appEnv === "test";

/** The site's hostname without "www." from APP_URL (never the request) on staging and production; null elsewhere. */
function followTurnstileHostname(env: Pick<Env, "APP_ENV" | "APP_URL">): string | null {
  if (env.APP_ENV !== "production" && env.APP_ENV !== "staging") return null;
  try {
    return env.APP_URL ? new URL(env.APP_URL).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/**
 * The page's bot check (security audit 2026-11-13, finding 10), through the gateway's `POST /v1/turnstile/verify`, the
 * idea box's verifier. Fails closed: no token, a refused one, or a check that cannot run is a refusal, and nothing is
 * recorded or sent. The visitor's address is not sent: through the web's Server Action the api sees the web's address,
 * not the visitor's. A development or test stack on mock integrations without the gateway passes the mock token only.
 */
async function checkFollowTurnstile(ctx: Pick<Context, "gateway" | "env" | "log">, token: string | null | undefined, hostname: string | null = followTurnstileHostname(ctx.env)): Promise<void> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length > 2048) throw followRefusal("follow_unverified");
  const mockPasses = devStack(ctx.env.APP_ENV) && ctx.env.INTEGRATIONS_MODE === "mock" && t === FOLLOW_MOCK_TURNSTILE_TOKEN;
  if (!ctx.gateway.verifyTurnstile) {
    if (mockPasses) return;
    throw followRefusal("follow_unavailable");
  }
  const check = await ctx.gateway.verifyTurnstile({ token: t, remoteIp: null, hostname, action: FOLLOW_TURNSTILE_ACTION }).catch((err: unknown) => {
    if (mockPasses) return { ok: true, reason: "ok" as const, simulated: true };
    ctx.log.warn({ err: err instanceof Error ? err.message : String(err) }, "follow: turnstile check failed");
    return { ok: false, reason: "unavailable" as const, simulated: false };
  });
  if (check.ok) return;
  throw followRefusal(check.reason === "unavailable" || check.reason === "unconfigured" ? "follow_unavailable" : "follow_unverified");
}

const EmailShape = z.email();

type FollowContext = Pick<Context, "db" | "limits" | "env" | "gateway" | "log"> & { clientAddress?: string | null };

/**
 * `publicPage.follow`: a visitor signs up to follow the published page at `slug` (package 1.6, double opt-in). In order:
 *   1. the hidden field filled in: the same answer, nothing written, no limit spent;
 *   2. the address (trimmed, lowercased, at most 200 characters, the shared check and Zod's) and the box ticked, else a
 *      plain refusal;
 *   3. the per-caller limit (TOO_MANY_REQUESTS), then the bot check (`checkFollowTurnstile`: `follow_unverified`, or
 *      `follow_unavailable` when it cannot run; nothing written, sent or spent but the caller's window);
 *   4. the per-address allowance (one a day per page address and email) and, taken separately, the day's three confirmations
 *      email for this address across every project: over either, the same answer and nothing written, before the page
 *      is even looked up;
 *   5. the page: published, committed, not archived, not a sample (the public view) and its switch on, else
 *      `follow_closed`, counted only against the small `closed` ceiling (TOO_MANY_REQUESTS past it); the day's
 *      confirmation is given back;
 *   6. the page's hourly and daily caps and the ceiling across all pages (TOO_MANY_REQUESTS; the confirmation given back);
 *   7. one transaction on the service connection: the pending consent record (`repos.followers.record`: an existing
 *      contact is left as it is, a new one is a lead named "Follower (ma***@example.com)" with no lawful basis; nothing
 *      for a confirmed or withdrawn record, a suppressed address or an archived contact), the reservation of the
 *      confirmation email on the record (one per address per project per 30 days) and an audit row for a new signup;
 *   8. the confirmation email through the gateway (`gateway.confirmFollow`, the project's Foundmill address). Not sent
 *      (platform mail off, a cap, the gateway unreachable): the reservation is given back and the record stays pending,
 *      and so does the day's confirmation unless the gateway may have sent it.
 * Nothing here writes `page.followed`: that waits for the person's confirmation (ingest `/mail/confirm`). No email
 * address leaves in the answer, the audit row or the logs.
 */
export async function followPage(ctx: FollowContext, input: FollowInput): Promise<FollowAnswer> {
  const ok: FollowAnswer = { ok: true };
  if (typeof input.website === "string" && input.website.trim() !== "") return ok;
  const email = input.email.trim().toLowerCase();
  if (followEmailProblem(email) || !EmailShape.safeParse(email).success) throw followRefusal("follow_email");
  if (input.consent !== true) throw followRefusal("follow_consent");
  const slug = input.slug.trim().toLowerCase();
  const site = input.via === "site";
  const domain = sitesDomain(ctx.env);
  if (site ? !domain || siteSlugProblem(slug) : pageSlugProblem(slug)) throw followRefusal("follow_closed");
  // A site's form arrives from apps/sites, whose address is every site visitor's: its window is the site's own, so a flood
  // on one site closes only that site's form, never every site's.
  const caller = site ? `site:${slug}` : ctx.clientAddress;
  if (caller) await takeOrThrow(ctx.limits, "Follow", [{ key: followLimitKeys.caller(ctx.env, caller), rule: PAGE_FOLLOW_LIMITS.perCaller }]);
  // Before anything a real person's address or the page's budget could lose. A site's widget runs on the site's host.
  await checkFollowTurnstile(ctx, input.turnstile, site ? (followTurnstileHostname(ctx.env) === null ? null : `${slug}.${domain}`) : followTurnstileHostname(ctx.env));

  // Repeats are dropped before anything else is spent or read.
  if (!(await ctx.limits.take([{ key: followLimitKeys.perAddress(ctx.env, site ? `site:${slug}` : slug, email), rule: PAGE_FOLLOW_LIMITS.perAddress }])).ok) return ok;
  const confirmSlot = await ctx.limits.take([{ key: followLimitKeys.confirmAnyProject(ctx.env, email), rule: PAGE_FOLLOW_LIMITS.confirmAnyProject }]);
  if (!confirmSlot.ok) return ok;
  let slotKept = false;
  const giveSlotBack = async () => {
    if (!slotKept) return;
    slotKept = false;
    await ctx.limits.refund(confirmSlot.ticket);
  };
  slotKept = true;

  try {
    const target = site ? await repos.followers.siteTarget(ctx.db, slug) : await repos.followers.target(ctx.db, slug);
    if (!target || !target.followForm || !followAvailable(ctx.env)) {
      await giveSlotBack();
      await takeOrThrow(ctx.limits, "Follow", [{ key: followLimitKeys.closed, rule: PAGE_FOLLOW_LIMITS.closed }]);
      throw followRefusal("follow_closed");
    }
    await takeOrThrow(ctx.limits, "Follow", [
      // A project's page and site share its caps (one budget per project, whichever form).
      { key: followLimitKeys.perPageHour(target.pageId ?? `site:${target.businessId}`), rule: PAGE_FOLLOW_LIMITS.perPageHour },
      { key: followLimitKeys.perPageDay(target.pageId ?? `site:${target.businessId}`), rule: PAGE_FOLLOW_LIMITS.perPageDay },
      { key: followLimitKeys.all, rule: PAGE_FOLLOW_LIMITS.all },
    ]);
    const consentText = followConsentText(target.name);
    const nonce = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(nonce, "utf8").digest("hex");
    const reserved = await ctx.db.transaction(async (tx) => {
      // The post the visitor last arrived through, when it is this project's own, real and was visited (item 8). The
      // follow is credited to it only once the person confirms from their inbox.
      const postLinkId = await repos.postLinks.followable(tx, target.businessId, input.post);
      const recorded = await repos.followers.record(tx, target.businessId, { pageId: target.pageId, slug: target.slug, sourceRef: site ? `site:${target.slug}` : target.slug, email, consentText, postLinkId });
      if (recorded.status === "nothing") return null;
      if (recorded.status === "new") {
        await repos.audit.append(tx, target.businessId, {
          actorKind: "system",
          actorId: null,
          action: "page.follow_requested",
          target: { kind: "entity", id: recorded.entityId },
          details: { pageId: target.pageId, slug: target.slug, via: site ? "site" : "page", consentId: recorded.consentId, newContact: recorded.entityCreated },
        });
      }
      return (await repos.followers.reserveConfirmation(tx, target.businessId, recorded.consentId, { tokenHash })) ? recorded.consentId : null;
    });
    if (!reserved) {
      await giveSlotBack();
      return ok;
    }
    let answer: Awaited<ReturnType<Context["gateway"]["confirmFollow"]>> | null = null;
    try {
      answer = await ctx.gateway.confirmFollow({ businessId: target.businessId, consentId: reserved, email, nonce });
    } catch (e) {
      // The gateway did not answer (or answered an error): perhaps nothing went out, perhaps it did. The record stays
      // pending and may be sent again on a later signup; the day's confirmation for the address stays spent.
      ctx.log.warn({ businessId: target.businessId, consentId: reserved, code: e instanceof AppError ? e.code : "unknown" }, "follow confirmation not sent: the gateway did not answer");
      slotKept = false;
    }
    if (!answer?.sent) {
      await repos.followers.releaseConfirmation(ctx.db, target.businessId, reserved, tokenHash);
      if (answer) {
        ctx.log.info({ businessId: target.businessId, consentId: reserved, reason: answer.reason }, "follow confirmation not sent");
        await giveSlotBack();
      }
    }
    return ok;
  } catch (e) {
    await giveSlotBack();
    throw e;
  }
}

/**
 * `publicPage.siteConsent` (WP-07 T6): the consent sentence for the live site at `slug`, as its sign-up page shows it
 * and as `followPage` records it, or null when the site is not live (or Sites are off). Only the project's name, which
 * the live site shows anyway.
 */
export async function siteFollowConsent(ctx: Pick<Context, "db" | "env" | "limits">, slug: string): Promise<{ consentText: string } | null> {
  const clean = slug.trim().toLowerCase();
  if (!sitesDomain(ctx.env) || siteSlugProblem(clean)) return null;
  // The follow's own per-caller window, for the site (apps/sites calls this once per sign-up page shown).
  await takeOrThrow(ctx.limits, "Follow", [{ key: `${followLimitKeys.caller(ctx.env, `site:${clean}`)}:consent`, rule: PAGE_FOLLOW_LIMITS.perCaller }]);
  const target = await repos.followers.siteTarget(ctx.db, clean);
  return target ? { consentText: followConsentText(target.name) } : null;
}

