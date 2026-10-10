/**
 * Runway in words when there is no figure (finance.overview returns no months), one wording for every screen that
 * shows it: Home's status strip and Finance card, the Inbox note's metric strip and Finance › Overview. Cash-flow
 * positive reads "No limit" (good news, never a dash or "None yet", which read as "no runway"); without a bank or with
 * too little history it reads "Not known yet" with the reason underneath.
 */
export interface RunwayFinanceInput {
  cash: { amountMinor?: number; accounts?: number };
  burn: { netBurnMinor: number };
  runway: { months: number | null };
}

export type RunwayState = "positive" | "no_bank" | "short_history";

export const RUNWAY_WORDS: Record<RunwayState, { value: string; caption: string }> = {
  positive: { value: "No limit", caption: "Cash-flow positive, so no limit yet" },
  no_bank: { value: "Not known yet", caption: "Connect a bank to estimate it" },
  short_history: { value: "Not known yet", caption: "Needs three months of bank history" },
};

/** Why there is no runway figure; null when there is one (or no finance data at all). */
export function runwayState(finance: RunwayFinanceInput | null | undefined): RunwayState | null {
  if (!finance || finance.runway.months !== null) return null;
  if (finance.cash.accounts === 0) return "no_bank";
  return finance.burn.netBurnMinor <= 0 ? "positive" : "short_history";
}

/** The words for a missing runway figure, or null when the figure exists. */
export function runwayWords(finance: RunwayFinanceInput | null | undefined): { value: string; caption: string } | null {
  const state = runwayState(finance);
  return state ? RUNWAY_WORDS[state] : null;
}
