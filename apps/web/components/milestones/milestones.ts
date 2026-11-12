/**
 * Milestones (the product word for the trophy cabinet, CLAUDE.md vocabulary; BUILD §11.4 "Trophy cabinet"): the
 * definitions from `@foundmill/journey` (the two early ones, "Page live" and "First follower", then the eight of
 * customers and revenue) matched to stored milestones, plus the timeline of every other milestone (releases,
 * decisions, incorporation, funding, launch). Pure and unit-tested; the screen feeds it `journey.ribbon`.
 *
 * A reached milestone can be shown on the project's public page (migration 0087; docs/NETWORK.md F2, F3): `pageStateOf`
 * says where each one stands, from the row's `visibility` and whether the page is live.
 */
import type { DateFormatPrefs, TrophyCard, TrophyPageState } from "@foundmill/dugout";
import { TROPHIES, eventTrophyDescription, formatThreshold, isTrophyKey, thresholdFor, type TrophyDefinition } from "@foundmill/journey";
import { monthlyRevenueWords, type MilestoneKind } from "@foundmill/shared";
import { formatDate, formatNumber } from "@/lib/format";

export interface MilestoneRowLike {
  id: string;
  kind: MilestoneKind | string;
  label: string;
  achievedAt: Date | string;
  ref?: Record<string, unknown> | null;
  visibility?: string;
  /** Present on journey-package records; the DB row keeps it in `ref.trophyKey`. */
  trophyKey?: string | null;
}

/**
 * A trophy's line under its name. A revenue trophy is Finance's monthly figure, named as Finance names it (DECISIONS
 * 2026-11-11): "Monthly recurring revenue (MRR) reaches £10K: …" when revenue recurs, "Average monthly revenue …"
 * when the business's customers buy once (`recurring === false`).
 */
export function describeTrophy(t: TrophyDefinition, currency: string, recurring?: boolean | null): string {
  if (t.metric === "event") return eventTrophyDescription(t) ?? "";
  if (t.metric === "customers") return t.threshold === 1 ? "The first paying customer." : `${formatNumber(t.threshold)} paying customers.`;
  if (t.metric === "mrrMinor") return monthlyRevenueTrophyWords(t, currency, recurring);
  return "A signed contract above the enterprise threshold.";
}

/** "Average monthly revenue reaches £10K: the last 3 full months' revenue ÷ 3, as on Finance (Estimate)." */
export function monthlyRevenueTrophyWords(t: Pick<TrophyDefinition, "threshold" | "thresholdMajor">, currency: string, recurring?: boolean | null): string {
  return `${monthlyRevenueWords(recurring).label} reaches ${formatThreshold(thresholdFor(t, currency), currency)}: the last 3 full months' revenue ÷ 3, as on Finance (Estimate).`;
}

/**
 * The count the customer milestones are reached at, beside them: "1,073 paying customers so far" (journey.ribbon
 * `customers.total`, the one server figure; DECISIONS 2026-11-10), so "1,000th customer" and the count read as one fact.
 */
export function customersSoFarWords(total: number | null | undefined): string | undefined {
  if (total === null || total === undefined) return undefined;
  if (total === 0) return "No paying customers yet";
  return `${formatNumber(total)} paying ${total === 1 ? "customer" : "customers"} so far`;
}

export function trophyKeyOf(m: MilestoneRowLike): string | null {
  if (typeof m.trophyKey === "string") return m.trophyKey;
  const ref = m.ref ?? {};
  return typeof ref.trophyKey === "string" ? ref.trophyKey : null;
}

const SHAREABLE_VISIBILITY = new Set(["public", "connections", "community"]);

/** What the screen knows of the project's public page: whether it is live now. Null when it cannot be shown on (a sample business, a reader with no view of the page). */
export interface MilestonePageFacts {
  live: boolean;
}

/**
 * Where a reached milestone stands on the project's public page, or null when it cannot be shown: only a milestone the
 * platform recorded under its key (`ref.trophyKey`) can. Shown and the page live: "shown". Shown before and the page
 * not live: "waiting" (it can still be hidden). Not shown: "hidden" while the page is live (it can be shown), nothing
 * otherwise, since showing depends only on the page being published.
 */
export function pageStateOf(m: MilestoneRowLike | undefined, page: MilestonePageFacts | null | undefined): TrophyPageState | null {
  if (!m || !page) return null;
  const key = typeof m.ref?.trophyKey === "string" ? m.ref.trophyKey : null;
  if (!key || !isTrophyKey(key)) return null;
  if (m.visibility === "public") return page.live ? "shown" : "waiting";
  return page.live ? "hidden" : null;
}

/** One card per trophy definition; won ones carry the date, the amount and (with permission) the customer. */
export function trophyCards(milestones: readonly MilestoneRowLike[] | undefined, currency: string, live: boolean, recurring?: boolean | null, page?: MilestonePageFacts | null): TrophyCard[] {
  return TROPHIES.map((t) => {
    const label = t.label(currency, recurring);
    const won = (milestones ?? []).find((m) => trophyKeyOf(m) === t.key || (m.kind === t.kind && (m.label === label || m.label === t.label(currency))));
    const ref = (won?.ref ?? {}) as Record<string, unknown>;
    const permission = ref.permission === true || ref.shareCustomer === true;
    return {
      key: t.key,
      label,
      description: describeTrophy(t, currency, recurring),
      achievedAt: won ? (typeof won.achievedAt === "string" ? won.achievedAt : won.achievedAt.toISOString()) : null,
      customerName: won && permission && typeof ref.customerName === "string" ? ref.customerName : null,
      amountMinor: typeof ref.amountMinor === "number" ? ref.amountMinor : null,
      currency,
      shareable: live && !!won && SHAREABLE_VISIBILITY.has(won.visibility ?? "private"),
      estimate: !!won && ref.estimate === true,
      page: pageStateOf(won, page),
    };
  });
}

/** The stored milestone behind a trophy key, when won. */
export function milestoneForTrophy(key: string, milestones: readonly MilestoneRowLike[] | undefined, currency: string): MilestoneRowLike | undefined {
  const def = TROPHIES.find((t) => t.key === key);
  if (!def) return undefined;
  const label = def.label(currency);
  return (milestones ?? []).find((m) => trophyKeyOf(m) === key || (m.kind === def.kind && m.label === label));
}

export const TIMELINE_KIND_WORD: Record<string, string> = {
  customer: "Customer",
  revenue: "Revenue",
  release: "Release",
  decision: "Decision",
  incorporation: "Incorporation",
  funding: "Funding",
  launch: "Launch",
  trophy: "Milestone",
};

/** Everything that is not a cabinet trophy, newest first, for the Timeline under the cabinet. */
export function otherMilestones(milestones: readonly MilestoneRowLike[] | undefined): MilestoneRowLike[] {
  return (milestones ?? [])
    .filter((m) => trophyKeyOf(m) === null && m.kind !== "trophy")
    .slice()
    .sort((a, b) => Date.parse(String(b.achievedAt)) - Date.parse(String(a.achievedAt)));
}

/** The replay a won trophy opens: a journey or conversion id recorded in its ref. */
export function replayRefOf(m: MilestoneRowLike | undefined): { journeyId?: string; conversionId?: string } | null {
  const ref = m?.ref ?? {};
  const journeyId = typeof ref.journeyId === "string" ? ref.journeyId : undefined;
  const conversionId = typeof ref.conversionId === "string" ? ref.conversionId : undefined;
  return journeyId || conversionId ? { journeyId, conversionId } : null;
}

/**
 * The text of a shareable milestone card (LIVE, BUILD §11.4): the customer is anonymised unless permission is recorded.
 * The date reads in the founder's own format (`prefs`), like the card they are looking at.
 */
export function shareText(card: TrophyCard, businessName: string, prefs?: DateFormatPrefs | null): string {
  const when = card.achievedAt ? formatDate(card.achievedAt, prefs) : "";
  const who = card.customerName ? ` with ${card.customerName}` : "";
  return `${businessName} · ${card.label}${who}${when ? ` · ${when}` : ""}`;
}
