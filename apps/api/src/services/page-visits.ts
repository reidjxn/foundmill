/**
 * Visits to a project's public page, counted by Foundmill (founder, Nov 25, 2026; packages/shared `page-visits.ts`,
 * packages/db `page_visit_days` 0175).
 *
 * - `recordPageVisit` (`publicPage.visited` with a `slug`, signed out): the page's beacon, sent once the page has loaded
 *   in a browser that is not automated (components/public/PostVisitBeacon.tsx). It adds one to the project's count for
 *   today (UTC) and the visit's source. Left out: an address that is not a published page (samples have none), a
 *   signed-in member of the project, and a caller over its limit. Nothing about the visitor is stored: the referrer and
 *   the address's query only choose a source bucket and are dropped. The answer is always the same.
 * The founder's numbers for Product › Public page come with `page.get` (services/pages.ts `viewOf`, under RLS).
 */
import { repos } from "@foundmill/db";
import { parseTouchSource, type TouchMedium } from "@foundmill/journey";
import type { PageVisitSource } from "@foundmill/shared/page-visits";
import { VIA_PARAM, parseVia } from "@foundmill/shared/via";
import type { Context } from "../context";
import { callerLimitKey } from "./pages";
import type { WindowLimit } from "./rate-limit";

/** One page load sends one beacon: 30 a minute from one address is plenty for a person and caps a flood. */
export const PAGE_VISIT_LIMIT = { limit: 30, windowMs: 60_000 } as const satisfies WindowLimit;

const MEDIUM_SOURCE: Partial<Record<TouchMedium, PageVisitSource>> = {
  organic_search: "search",
  ai_search: "ai",
  social: "social",
  email: "email",
  paid: "paid",
  referral: "referral",
  pr: "referral",
  direct: "direct",
};

const hostOf = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * The source bucket of a visit. A team post's link and a link from inside Foundmill (`via`) come first; otherwise the
 * UTM tags and the referrer, through the same rules as the journey's attribution (`parseTouchSource`).
 */
export function pageVisitSource(input: { via?: string | null; search?: string | null; referrer?: string | null }, appUrl: string): PageVisitSource {
  const via = parseVia(input.via);
  if (via?.kind === "post") return "post";
  if (via) return "foundmill";
  const refHost = hostOf(input.referrer);
  if (refHost && refHost === hostOf(appUrl)) return "foundmill";
  const query = new URLSearchParams(input.search ?? "");
  // `via` is ours, not an affiliate code: the journey's parser would read it as one.
  query.delete(VIA_PARAM);
  const medium = parseTouchSource({ url: `https://page.invalid/?${query.toString()}`, referrer: input.referrer ?? null }).medium;
  return MEDIUM_SOURCE[medium] ?? "other";
}

type VisitContext = Pick<Context, "db" | "env" | "limits" | "log"> & { clientAddress?: string | null; userId?: string | null; now?: () => Date };

/** Counts one visit to the page at `slug` (see the file comment). Never throws and never says what happened. */
export async function recordPageVisit(ctx: VisitContext, input: { slug: string; via?: string | null; search?: string | null; referrer?: string | null }): Promise<void> {
  try {
    if (ctx.clientAddress) {
      const taken = await ctx.limits.take([{ key: callerLimitKey(ctx.env, "page-visit", ctx.clientAddress), rule: PAGE_VISIT_LIMIT }]);
      if (!taken.ok) return;
    }
    const page = await repos.pages.public.planBySlug(ctx.db, input.slug);
    if (!page) return;
    // The project's own people opening their page are not visitors.
    if (ctx.userId && (await repos.memberships.get(ctx.db, page.id, ctx.userId))) return;
    const day = (ctx.now ?? (() => new Date()))().toISOString().slice(0, 10);
    await repos.pageVisits.count(ctx.db, page.id, day, pageVisitSource(input, ctx.env.APP_URL));
  } catch (err) {
    ctx.log.warn({ err: err instanceof Error ? err.name : "unknown" }, "page visit not counted");
  }
}
