/**
 * The status tiles Today and the status strip share (WP-10 T13): cash, runway, customers this week, the week's spend and
 * the unavailable tile. Moved out of widgets/status-strip.tsx so Today imports them without the widgets barrel, whose
 * last line registers every widget. No JSX and no React: a plain module.
 */
import { formatNumber, type MetricTileProps } from "@foundmill/dugout";
import { NOT_KNOWN_YET } from "./cash";
import { RUNWAY_WORDS, runwayWords } from "./runway";
import { unavailableWords } from "./errors";
import { customersThisWeek } from "./customers";
import type { FinanceOverview, RibbonResponse } from "./types";


/** The runway caption in words (UX plan B9); the formula stays in the provenance tooltip. */
export const RUNWAY_CAPTION = "Months of cash left at today's spending";

/**
 * A tile of the strip: a MetricTile, plus the id of the definition its label is wrapped in (`Term`, UX plan §7.8:
 * "Runway", "Revenue this month"). The plain-words line under the figure (`PlainFigure`) comes from `metricId` (the
 * definitions map) or `plain` (tiles without a term); guidance off shows the figure alone.
 */
export type StatusTile = MetricTileProps & { termId?: string };

/** The plain-words line under the tiles that have no definition of their own (UX plan §7.8). */
export const PLAIN_LINES = {
  cash: "What is in the bank right now.",
  revenue: "What customers paid you this month.",
  customers: "People who paid you for the first time in the last 7 days.",
} as const;

/**
 * The runway tile. With a burn model it is the figure in months with its Estimate chip and a caption in words ("Months
 * of cash left at today's spending", or the warning when it is short); without one it says why in the shared runway
 * words (shared/runway.ts: "Not running out" when cash-flow positive, "Not known yet" otherwise) with the reason underneath,
 * and no Estimate chip: nothing has been estimated yet. The formula ("Cash ÷ net burn") is the provenance tooltip.
 */
export function runwayTile(finance: FinanceOverview | undefined, loading: boolean, onClick: () => void): StatusTile {
  const months = finance?.runway.months ?? null;
  const provenance = finance ? { source: "Cash ÷ net burn (net burn: monthly spending minus income, trailing 3 months)", note: finance.burn.definition } : undefined;
  if (months === null) {
    const words = runwayWords(finance);
    return { label: "Runway", termId: "runway", metricId: "runway", value: loading ? null : (words?.value ?? RUNWAY_WORDS.no_bank.value), loading, caption: words?.caption, provenance, onClick };
  }
  return {
    label: "Runway",
    termId: "runway",
    metricId: "runway",
    value: formatNumber(months, { maxDigits: 1 }),
    unit: "mo",
    estimate: "estimate",
    loading,
    caption: months < 3 ? "Under 3 months of cash left" : months < 9 ? "Under 9 months of cash left" : RUNWAY_CAPTION,
    provenance,
    onClick,
  };
}

/** The Cash tile: the bank balance in the business's currency, or why there is none. */
export function cashTile(finance: FinanceOverview | undefined, loading: boolean, currency: string, onClick: () => void): StatusTile {
  const c = finance?.cash.currency ?? currency;
  return {
    label: "Cash",
    plain: PLAIN_LINES.cash,
    // No bank connected: the balance is not known, never a zero (WP-02 T6).
    value: finance ? (finance.cash.accounts ? { amountMinor: finance.cash.amountMinor, currency: c } : NOT_KNOWN_YET.value) : null,
    loading,
    caption: finance ? (finance.cash.accounts ? `In the bank · ${finance.cash.accounts} account${finance.cash.accounts === 1 ? "" : "s"}` : "No bank connected") : undefined,
    provenance: { source: "Bank balances", asOf: finance?.cash.asOf ?? undefined },
    onClick,
  };
}

/** The Customers this week tile: first payments in the last 7 days, with the change against the week before. */
export function customersWeekTile(ribbon: RibbonResponse | undefined, loading: boolean, today: string, onClick: () => void): StatusTile {
  const c = customersThisWeek(ribbon, today);
  return { label: "Customers this week", plain: PLAIN_LINES.customers, value: c ? c.week : null, format: "integer", loading, caption: "Paying customers, last 7 days", delta: c ? { value: c.week - c.previous, label: "vs last week" } : undefined, spark: c?.spark, provenance: { source: "Payments (first payments count as customers)" }, onClick };
}

/**
 * The week's spend as Today reads it (`today.get`): AI usage in US dollars, channel spend in the business's own
 * currency, and channel spend kept in any other currency listed apart.
 */
export interface WeekSpend {
  aiUsage: { amountMinor: number; currency: string };
  channel: { amountMinor: number; currency: string; otherCurrencies: readonly { currency: string; amountMinor: number }[] };
}

export const SPEND_WORDS = {
  combined: "Spent this week",
  ai: "AI usage this week",
  channel: "Channel spend this week",
} as const;

/**
 * The spend tiles (founder, 2026-11-07: two figures, never summed across currencies), each an Estimate. A business in
 * US dollars with every channel in dollars gets one "Spent this week" tile (AI usage plus channel spend, one currency);
 * otherwise "AI usage this week" in USD, and "Channel spend this week" in the business's currency when there was any.
 */
export function spendWeekTiles(spend: WeekSpend | undefined | null, loading: boolean, onClick: () => void): StatusTile[] {
  const provenance = { source: "AI usage as the team's work is metered (US dollars); channel spend from each channel's daily figures; last 7 days" };
  if (!spend) return [{ label: SPEND_WORDS.ai, value: loading ? null : "Not known yet", loading, caption: loading ? undefined : "No usage read yet", provenance, onClick }];
  const otherNote = spend.channel.otherCurrencies.length ? ` · plus spend in ${spend.channel.otherCurrencies.map((o) => o.currency).join(", ")}, not added` : "";
  const oneCurrency = spend.aiUsage.currency === spend.channel.currency && spend.channel.otherCurrencies.length === 0;
  if (oneCurrency) {
    return [{ label: SPEND_WORDS.combined, value: { amountMinor: spend.aiUsage.amountMinor + spend.channel.amountMinor, currency: spend.aiUsage.currency }, estimate: "estimate", loading, caption: "AI usage and channels, last 7 days", provenance, onClick }];
  }
  const tiles: StatusTile[] = [{ label: SPEND_WORDS.ai, value: { amountMinor: spend.aiUsage.amountMinor, currency: spend.aiUsage.currency }, estimate: "estimate", loading, caption: `The team's AI cost, last 7 days (${spend.aiUsage.currency})`, provenance, onClick }];
  if (spend.channel.amountMinor > 0 || spend.channel.otherCurrencies.length > 0) {
    tiles.push({ label: SPEND_WORDS.channel, value: { amountMinor: spend.channel.amountMinor, currency: spend.channel.currency }, estimate: "estimate", loading, caption: `Ads and channels, last 7 days${otherNote}`, provenance, onClick });
  }
  return tiles;
}

/** A tile whose query failed: what happened instead of a figure (shared/errors.ts). */
export function unavailableTile(label: string, error: Error, section: string, onClick: () => void, termId?: string): StatusTile {
  const words = unavailableWords(error, section);
  return { label, termId, value: words.value, caption: words.caption, onClick };
}
