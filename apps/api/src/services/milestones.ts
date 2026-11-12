/**
 * Milestones a founder chooses to show (docs/NETWORK.md F2 "the story", F3 "cards"; docs/THESIS_REVIEW.md package 5.3;
 * migration 0087).
 *
 * - **Showing and hiding** (`journey.showMilestone`, `journey.hideMilestone`): an owner or an admin with Product write,
 *   by their own press, one milestone at a time (founder, Nov 12, 2026: nothing becomes public on its own; no agent
 *   tool reaches this). Only a milestone the platform recorded and the project has reached can be shown, and only
 *   while the project's page is published; a sample business shows nothing. Each change writes its event through the
 *   outbox and an audit row in the same transaction, as the signed-in user through RLS (the table's guard trigger
 *   holds the same rule for a write made around the api).
 * - **The public reads** (`publicStoryBySlug`, `publicCardById`): the view `public_project_milestones` on the service
 *   connection (the service role's only), so only its five columns leave, with the page's own public facts beside
 *   them. The words of a milestone are built from its key: a milestone about a customer says "First customer" and
 *   nothing of who. Limited like the page read: per caller, then per address (or card) and across all of them; a
 *   lookup that finds nothing gives those back and draws from a ceiling of its own, so probing cannot use up what
 *   real stories and cards read from.
 *
 * Nothing here counts anything: a story is dated things that happened, never a tally (founder, Nov 12, 2026).
 */
import { tierShowsBuiltOnMark } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { isTrophyKey } from "@foundmill/journey";
import {
  AppError,
  ForbiddenError,
  MILESTONE_NEEDS_PAGE_MESSAGE,
  MILESTONE_NOT_FOUND_MESSAGE,
  MILESTONE_SAMPLE_MESSAGE,
  MILESTONE_SHOW_ROLE_MESSAGE,
  cardUrl,
  hasSectionAccess,
  pageSlugProblem,
  pageUrl,
  storyUrl,
  type Env,
} from "@foundmill/shared";
import { z } from "zod";
import type { Context } from "../context";
import { audit, emit, type BusinessContext } from "../trpc";
import { callerLimitKey } from "./pages";
import { takeOrThrow, type WindowLimit } from "./rate-limit";

/** What showing or hiding answers: the milestone, how it reads now, and its public addresses. */
export interface MilestoneShownView {
  milestoneId: string;
  key: string;
  shown: boolean;
  /** The card's full public URL (`/m/<id>`); it answers not found while the milestone is hidden. */
  url: string;
  /** The story's full public URL (`/p/<slug>/story`), or null while the project has no page row. */
  storyUrl: string | null;
}

const sampleRefusal = () => new AppError("page_sample_business", MILESTONE_SAMPLE_MESSAGE, 409);
const needsPageRefusal = () => new AppError("milestone_needs_page", MILESTONE_NEEDS_PAGE_MESSAGE, 409);
const notFound = () => new AppError("milestone_not_found", MILESTONE_NOT_FOUND_MESSAGE, 404);

/** The right that publishes the page shows things on it: an owner or an admin with Product write. */
const canShow = (ctx: BusinessContext): boolean => (ctx.role === "owner" || ctx.role === "admin") && hasSectionAccess(ctx.membership, "product", "write");

const keyOf = (ref: Record<string, unknown> | null | undefined): string | null => (typeof ref?.trophyKey === "string" ? ref.trophyKey : null);

async function setShown(ctx: BusinessContext, milestoneId: string, shown: boolean): Promise<MilestoneShownView> {
  if (ctx.business.isDemo) throw sampleRefusal();
  if (!canShow(ctx)) throw new ForbiddenError(MILESTONE_SHOW_ROLE_MESSAGE);
  return ctx.rls(async (tx) => {
    const milestone = await repos.journeys.getMilestone(tx, ctx.businessId, milestoneId);
    const key = keyOf(milestone?.ref);
    // Only what the platform recorded: a note someone typed in (no key) is not a milestone to show.
    if (!milestone || !key || !isTrophyKey(key)) throw notFound();
    const page = await repos.pages.get(tx, ctx.businessId);
    // Showing needs the page it is shown on. Hiding never does: a founder can always take something back.
    if (shown && !page?.published) throw needsPageRefusal();
    const url = cardUrl(ctx.env.APP_URL, milestone.id);
    const changed = await repos.journeys.setMilestoneShown(tx, ctx.businessId, milestone.id, shown);
    if (changed) {
      const slug = page?.slug ?? null;
      // An event names the page's address; a milestone hidden after the page row was deleted has none to name.
      if (slug) await emit(tx, ctx, { type: shown ? "milestone.shown" : "milestone.hidden", payload: { milestoneId: milestone.id, key, slug, url } });
      await audit(tx, ctx, { action: shown ? "milestone.shown" : "milestone.hidden", target: { kind: "milestone", id: milestone.id }, details: { key, slug, url } });
    }
    return { milestoneId: milestone.id, key, shown, url, storyUrl: page ? storyUrl(ctx.env.APP_URL, page.slug) : null };
  });
}

/** `journey.showMilestone`: the milestone becomes a line of the project's story and gets its card. Pressing twice changes nothing twice. */
export function showMilestone(ctx: BusinessContext, input: { milestoneId: string }): Promise<MilestoneShownView> {
  return setShown(ctx, input.milestoneId, true);
}

/** `journey.hideMilestone`: off the story, and its card answers not found. The milestone itself stays reached. */
export function hideMilestone(ctx: BusinessContext, input: { milestoneId: string }): Promise<MilestoneShownView> {
  return setShown(ctx, input.milestoneId, false);
}

/** One shown milestone as anyone may read it: the label and the date, nothing else about it. */
export interface PublicMilestoneView {
  id: string;
  key: string;
  /** The public words, built from the key ("First customer"): never a customer's name. */
  label: string;
  achievedAt: Date;
  /** The card's full public URL. */
  url: string;
}

/** The project a story or a card belongs to, as its public page already shows it. */
export interface PublicMilestoneProject {
  slug: string;
  name: string;
  /** The project page's full public URL. */
  pageUrl: string;
  /** The story's full public URL. */
  storyUrl: string;
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a `data:` URL, or null for the initials mark. */
  logo: string | null;
  /** Whether the "Built on" mark is shown (a project on the free plan; a paid plan removes every part of it). */
  mark: boolean;
}

/** `publicPage.storyBySlug`: the project and its shown milestones, oldest first. */
export interface PublicStoryView extends PublicMilestoneProject {
  milestones: PublicMilestoneView[];
}

/** `publicPage.cardById`: one shown milestone with its project. */
export interface PublicCardView extends PublicMilestoneProject {
  milestone: PublicMilestoneView;
}

/**
 * Signed-out reads of stories and cards, shared by every api replica (`ctx.limits`), in the order the reads take them
 * (the shape of `PUBLIC_PAGE_LIMITS`): `perCaller` by the address the api itself sees; `perKey` (one story address or
 * one card id) and `all`, the ceilings that keep a flood off the database; `unknown`, which a lookup that finds nothing
 * draws from after giving its `perKey` and `all` hits back.
 */
export const PUBLIC_STORY_LIMITS = {
  perCaller: { limit: 300, windowMs: 60_000 },
  perKey: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
  unknown: { limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, WindowLimit>;

type Scope = "public-story" | "public-card";

const limitKeys = (scope: Scope) =>
  ({
    caller: (env: Pick<Env, "SESSION_TOKEN_SECRET">, address: string) => callerLimitKey(env, scope, address),
    key: (key: string) => `${scope}:key:${key}`,
    all: `${scope}:all`,
    unknown: `${scope}:unknown`,
  }) as const;

export const publicStoryLimitKeys = limitKeys("public-story");
export const publicCardLimitKeys = limitKeys("public-card");

type PublicContext = Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null };

/** One limited public read: the caller's own budget, then the key's and the overall one; nothing found moves the hit to `unknown`. */
async function limitedRead<T>(ctx: PublicContext, what: string, scope: Scope, key: string, read: () => Promise<T | null>): Promise<T | null> {
  const keys = limitKeys(scope);
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, what, [{ key: keys.caller(ctx.env, ctx.clientAddress), rule: PUBLIC_STORY_LIMITS.perCaller }]);
  const ticket = await takeOrThrow(ctx.limits, what, [
    { key: keys.key(key), rule: PUBLIC_STORY_LIMITS.perKey },
    { key: keys.all, rule: PUBLIC_STORY_LIMITS.all },
  ]);
  const found = await read();
  if (found === null) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, what, [{ key: keys.unknown, rule: PUBLIC_STORY_LIMITS.unknown }]);
  }
  return found;
}

/** The public facts of the project behind `slug`, or null when its page is not public (the view lists nothing). */
async function projectFacts(ctx: PublicContext, slug: string): Promise<PublicMilestoneProject | null> {
  const page = await repos.pages.public.bySlug(ctx.db, slug);
  if (!page) return null;
  const [logo, planTier] = await Promise.all([repos.pages.public.logoBySlug(ctx.db, slug), repos.pages.public.planTierBySlug(ctx.db, slug)]);
  return {
    slug: page.slug,
    name: page.name,
    pageUrl: pageUrl(ctx.env.APP_URL, page.slug),
    storyUrl: storyUrl(ctx.env.APP_URL, page.slug),
    brandPrimary: page.brandPrimary,
    brandSecondary: page.brandSecondary,
    logo,
    // Taken down between the reads: no plan to go by, so the mark stays (the free plan's rule, as on the page).
    mark: tierShowsBuiltOnMark(planTier ?? "free"),
  };
}

const milestoneView = (ctx: PublicContext, m: { id: string; key: string; label: string; achievedAt: Date }): PublicMilestoneView => ({ id: m.id, key: m.key, label: m.label, achievedAt: m.achievedAt, url: cardUrl(ctx.env.APP_URL, m.id) });

/**
 * `publicPage.storyBySlug`: the project at `slug` and the milestones its founders chose to show, oldest first; null for
 * an unknown address, a page that is not public and a page that shows no milestone (all three read the same).
 */
export async function publicStoryBySlug(ctx: PublicContext, slug: string): Promise<PublicStoryView | null> {
  const clean = slug.trim().toLowerCase();
  if (pageSlugProblem(clean)) return null;
  return limitedRead(ctx, "Story view", "public-story", clean, async () => {
    const milestones = await repos.pages.public.storyBySlug(ctx.db, clean);
    if (!milestones.length) return null;
    const project = await projectFacts(ctx, clean);
    if (!project) return null;
    return { ...project, milestones: milestones.map((m) => milestoneView(ctx, m)) };
  });
}

const CardId = z.guid();

/** `publicPage.cardById`: one shown milestone with its project; null for an unknown id, a hidden milestone and a page that is not public. */
export async function publicCardById(ctx: PublicContext, id: string): Promise<PublicCardView | null> {
  const clean = id.trim().toLowerCase();
  if (!CardId.safeParse(clean).success) return null;
  return limitedRead(ctx, "Card view", "public-card", clean, async () => {
    const card = await repos.pages.public.cardById(ctx.db, clean);
    if (!card) return null;
    const project = await projectFacts(ctx, card.slug);
    if (!project) return null;
    return { ...project, milestone: milestoneView(ctx, card) };
  });
}
