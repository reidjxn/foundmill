/**
 * Milestones (the product word for the trophy cabinet, CLAUDE.md vocabulary; BUILD §11.4 "Trophy cabinet"): the eight
 * trophies from `@foundmill/journey` matched to stored milestones, plus the timeline of every other milestone
 * (releases, decisions, incorporation, funding, launch). Pure and unit-tested; the screen feeds it `journey.ribbon`.
 */
import type { DateFormatPrefs, TrophyCard } from "@foundmill/dugout";
import { TROPHIES, type TrophyDefinition } from "@foundmill/journey";
import type { MilestoneKind } from "@foundmill/shared";
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

export function describeTrophy(t: TrophyDefinition, currency: string): string {
  if (t.metric === "customers") return t.threshold === 1 ? "The first paying customer." : `${formatNumber(t.threshold)} paying customers.`;
  if (t.metric === "mrrMinor") return `Monthly recurring revenue reaches ${t.label(currency).replace(/^First /, "").replace(/ MRR$/, "")}.`;
  return "A signed contract above the enterprise threshold.";
}

export function trophyKeyOf(m: MilestoneRowLike): string | null {
  if (typeof m.trophyKey === "string") return m.trophyKey;
  const ref = m.ref ?? {};
  return typeof ref.trophyKey === "string" ? ref.trophyKey : null;
}

const SHAREABLE_VISIBILITY = new Set(["public", "connections", "community"]);

/** One card per trophy definition; won ones carry the date, the amount and (with permission) the customer. */
export function trophyCards(milestones: readonly MilestoneRowLike[] | undefined, currency: string, live: boolean): TrophyCard[] {
  return TROPHIES.map((t) => {
    const label = t.label(currency);
    const won = (milestones ?? []).find((m) => trophyKeyOf(m) === t.key || (m.kind === t.kind && m.label === label));
    const ref = (won?.ref ?? {}) as Record<string, unknown>;
    const permission = ref.permission === true || ref.shareCustomer === true;
    return {
      key: t.key,
      label,
      description: describeTrophy(t, currency),
      achievedAt: won ? (typeof won.achievedAt === "string" ? won.achievedAt : won.achievedAt.toISOString()) : null,
      customerName: won && permission && typeof ref.customerName === "string" ? ref.customerName : null,
      amountMinor: typeof ref.amountMinor === "number" ? ref.amountMinor : null,
      currency,
      shareable: live && !!won && SHAREABLE_VISIBILITY.has(won.visibility ?? "private"),
      estimate: !!won && ref.estimate === true,
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
