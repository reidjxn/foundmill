/**
 * Visits to a project's public page, counted by Foundmill itself (founder, Nov 25, 2026: free on every plan, so the team
 * has page numbers without PostHog). packages/db `page_visit_days` (0175) keeps one count per project, day and source;
 * apps/api services/page-visits.ts writes it from the page's beacon. Nothing names a visitor: no cookie, no address, no
 * device, no referrer is stored, only the bucket below.
 *
 * The count is an estimate: the beacon skips browsers that say they are automated and the project's own members, and
 * counts a tab once a day per page, but a person who opens the page in two tabs or two browsers counts twice.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/page-visits".
 */

/** Where a visit came from. `post` is a team post's own link (`?via=s.<code>`); `foundmill` a link from inside Foundmill. */
export const PAGE_VISIT_SOURCES = ["direct", "post", "foundmill", "search", "ai", "social", "email", "paid", "referral", "other"] as const;
export type PageVisitSource = (typeof PAGE_VISIT_SOURCES)[number];

export const PAGE_VISIT_SOURCE_LABELS: Readonly<Record<PageVisitSource, string>> = {
  direct: "Direct or unknown",
  post: "Team posts",
  foundmill: "Foundmill",
  search: "Search engines",
  ai: "AI assistants",
  social: "Social sites",
  email: "Email",
  paid: "Ads",
  referral: "Other websites",
  other: "Other",
};

/** How many days of counts the screen and the team read. */
export const PAGE_VISIT_WINDOW_DAYS = 28;

/** User agents that are not a person reading the page. Cheap, not exhaustive: the count stays an estimate. */
export const PAGE_VISIT_BOT_UA = /bot|crawl|spider|slurp|headless|preview|fetch|monitor|lighthouse|pingdom|curl|wget|python|httpclient/i;

/** Whether a browser should send a counted visit: not automated, not a known bot. */
export function countableBrowser(nav: { userAgent: string; webdriver?: boolean }): boolean {
  return !nav.webdriver && !PAGE_VISIT_BOT_UA.test(nav.userAgent);
}

export interface PageVisitDay {
  /** "YYYY-MM-DD", the day in UTC. */
  day: string;
  source: PageVisitSource;
  visits: number;
}

export interface PageVisitSummary {
  /** Always true: the count is filtered, not exact (label it "Estimate"). */
  estimate: true;
  windowDays: number;
  last7: number;
  /** Visits over the whole window. */
  total: number;
  /** Visits per source over the window, largest first; sources with none are left out. */
  bySource: { source: PageVisitSource; visits: number }[];
  /** One entry per day of the window, oldest first, zeros included. */
  daily: { day: string; visits: number }[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Sums the stored rows into what the screen and the team read. `today` is the last day of the window (UTC). */
export function summarizePageVisits(rows: readonly PageVisitDay[], today: Date, windowDays = PAGE_VISIT_WINDOW_DAYS): PageVisitSummary {
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) days.push(isoDay(new Date(today.getTime() - i * 86_400_000)));
  const first7 = days[days.length - 7]!;
  const perDay = new Map(days.map((d) => [d, 0]));
  const perSource = new Map<PageVisitSource, number>();
  let last7 = 0;
  let total = 0;
  for (const r of rows) {
    if (!perDay.has(r.day)) continue;
    perDay.set(r.day, perDay.get(r.day)! + r.visits);
    perSource.set(r.source, (perSource.get(r.source) ?? 0) + r.visits);
    total += r.visits;
    if (r.day >= first7) last7 += r.visits;
  }
  const bySource = [...perSource].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([source, visits]) => ({ source, visits }));
  return { estimate: true, windowDays, last7, total, bySource, daily: days.map((day) => ({ day, visits: perDay.get(day)! })) };
}

/** The day `windowDays - 1` days before `today`, the first one a summary reads ("YYYY-MM-DD"). */
export const pageVisitWindowStart = (today: Date, windowDays = PAGE_VISIT_WINDOW_DAYS): string => isoDay(new Date(today.getTime() - (windowDays - 1) * 86_400_000));

/** One line for the team's brief: real counts only (the table holds nothing else), labeled an estimate. */
export function pageVisitsLine(s: PageVisitSummary): string {
  const head = "Public page visits (Estimate, counted by Foundmill; a visit alone is not an outside result)";
  if (!s.total) return `${head}: none in the last ${s.windowDays} days.`;
  const sources = s.bySource.map((x) => `${PAGE_VISIT_SOURCE_LABELS[x.source]} ${x.visits}`).join(", ");
  return `${head}: ${s.last7} in the last 7 days, ${s.total} in the last ${s.windowDays} days; by source: ${sources}.`;
}
