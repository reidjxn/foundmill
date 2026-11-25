/**
 * The source bucket of a visit to a project's public page or Site (packages/shared `page-visits.ts`; founder, Nov 25,
 * 2026). Shared by the api (the page's beacon) and apps/sites (a Site's HTML responses). The referrer and the query only
 * choose the bucket; neither is kept.
 */
import type { PageVisitSource } from "@foundmill/shared/page-visits";
import { VIA_PARAM, parseVia } from "@foundmill/shared/via";
import { parseTouchSource, type TouchMedium } from "./attribution";

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
