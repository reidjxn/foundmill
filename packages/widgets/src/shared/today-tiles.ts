/**
 * The status tiles Today and the status strip share (WP-10 T13): cash, runway, customers this week and the unavailable
 * tile (the week's spend tiles left with WP-14 T4: Today carries no cost figure). Moved out of
 * widgets/status-strip.tsx so Today imports them without the widgets barrel, whose last line registers every widget. No
 * JSX and no React: a plain module.
 */
import { formatNumber, type MetricTileProps } from "@foundmill/dugout";
import { NOT_KNOWN_YET } from "./cash";
import { RUNWAY_WORDS, runwayFigure, runwayWords } from "./runway";
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
  const months = runwayFigure(finance);
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

/** A tile whose query failed: what happened instead of a figure (shared/errors.ts). */
export function unavailableTile(label: string, error: Error, section: string, onClick: () => void, termId?: string): StatusTile {
  const words = unavailableWords(error, section);
  return { label, termId, value: words.value, caption: words.caption, onClick };
}
