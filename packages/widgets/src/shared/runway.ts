/**
 * Runway in words when there is no figure (finance.overview returns no months, or a figure that is not a runway), one
 * wording for every screen that shows it: the top bar's chip, Home's status strip and Finance card, the Inbox note's
 * metric strip and Finance › Overview and Runway. Cash-flow positive reads "Not running out" with "You earn more than you
 * spend" (good news in the founder's words: "No limit" read like a setting, Nov 7, 2026); without a bank or with too
 * little history it reads "Not known yet" with what would fill it; a bank balance below zero reads "Cash is below zero"
 * with the Estimate tag, never "Not running out" (docs/UX_AUDIT_AND_PLAN.md §7.7, B8).
 */
import { runwayState, type RunwayFinanceInput, type RunwayState } from "@foundmill/shared";

export { runwayState, type RunwayFinanceInput, type RunwayState };

export interface RunwayWording {
  /** The figure's stand-in: "Not running out", "Not known yet", "Cash is below zero". */
  value: string;
  /** The reason, under the tile and in the chip's tooltip. */
  caption: string;
  /** The short reason the chip carries inline at the widest top-bar step ("Not known yet · connect a bank"). */
  brief?: string;
  /** The words describe a worked-out state (a modeled balance), so the chip keeps its dashed "Estimate" tag. */
  estimate?: boolean;
}

export const RUNWAY_WORDS: Record<RunwayState, RunwayWording> = {
  positive: { value: "Not running out", caption: "You earn more than you spend" },
  no_bank: { value: "Not known yet", caption: "Not enough data yet: connect your bank", brief: "connect a bank" },
  short_history: { value: "Not known yet", caption: "Not enough data yet: needs three months of bank history", brief: "needs 3 months of history" },
  negative: { value: "Cash is below zero", caption: "The bank balance is negative, so there is no runway to count", estimate: true },
};

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
