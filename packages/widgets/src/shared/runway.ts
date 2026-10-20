/**
 * Runway in words when there is no figure (finance.overview returns no months, or a figure that is not a runway), one
 * wording for every screen that shows it: the top bar's chip, Home's status strip and Finance card, the Inbox note's
 * metric strip and Finance › Overview. Cash-flow positive reads "No limit" (good news, never a dash or "None yet",
 * which read as "no runway"); without a bank or with too little history it reads "Not known yet" with the reason
 * underneath; a bank balance below zero reads "Cash is below zero" with the Estimate tag, never "No limit"
 * (docs/UX_AUDIT_AND_PLAN.md §7.7, B8).
 */
export interface RunwayFinanceInput {
  cash: { amountMinor?: number; accounts?: number };
  burn: { netBurnMinor: number };
  runway: { months: number | null };
}

export type RunwayState = "positive" | "no_bank" | "short_history" | "negative";

export interface RunwayWording {
  /** The figure's stand-in: "No limit", "Not known yet", "Cash is below zero". */
  value: string;
  /** The reason, under the tile and in the chip's tooltip. */
  caption: string;
  /** The short reason the chip carries inline at the widest top-bar step ("Not known yet · connect a bank"). */
  brief?: string;
  /** The words describe a worked-out state (a modeled balance), so the chip keeps its dashed "Estimate" tag. */
  estimate?: boolean;
}

export const RUNWAY_WORDS: Record<RunwayState, RunwayWording> = {
  positive: { value: "No limit", caption: "Cash-flow positive, so no limit yet" },
  no_bank: { value: "Not known yet", caption: "Connect a bank to estimate it", brief: "connect a bank" },
  short_history: { value: "Not known yet", caption: "Needs three months of bank history", brief: "needs 3 months of history" },
  negative: { value: "Cash is below zero", caption: "The bank balance is negative, so there is no runway to count", estimate: true },
};

/**
 * Why there is no runway figure; null when there is one (or no finance data at all). A balance below zero has no
 * runway whatever the months say (the API divides a negative balance by the burn and gets a negative figure, or none
 * at all when the burn is zero, which used to read "No limit").
 */
export function runwayState(finance: RunwayFinanceInput | null | undefined): RunwayState | null {
  if (!finance) return null;
  // `accounts` is the count of connected accounts; an input that leaves it out (a note's metric strip) is read as
  // having a balance, as before. Only an explicit zero is "no bank".
  const noBank = finance.cash.accounts === 0;
  if (!noBank && (finance.cash.amountMinor ?? 0) < 0) return "negative";
  if (finance.runway.months !== null) return null;
  if (noBank) return "no_bank";
  return finance.burn.netBurnMinor <= 0 ? "positive" : "short_history";
}

/** The words for a missing runway figure, or null when the figure exists. */
export function runwayWords(finance: RunwayFinanceInput | null | undefined): RunwayWording | null {
  const state = runwayState(finance);
  return state ? RUNWAY_WORDS[state] : null;
}

/** The months to show as a figure: the API's months, or null when the words stand in for them (a balance below zero). */
export function runwayFigure(finance: RunwayFinanceInput | null | undefined): number | null {
  if (!finance) return null;
  return runwayState(finance) === null ? finance.runway.months : null;
}
