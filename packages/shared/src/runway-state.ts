/**
 * Why there is no runway figure (one rule for every screen and both clients): "positive" when the business earns more
 * than it spends, "no_bank" without a connected account, "short_history" with too little bank history, "negative" when
 * the balance is below zero; null when there is a figure (or no finance data at all). Pure, so the api's area sentences
 * (`business.areas.words`) and the web's tiles (@foundmill/widgets/shared/runway) read the same state from the same
 * `finance.overview` figures.
 */
export interface RunwayFinanceInput {
  cash: { amountMinor?: number; accounts?: number };
  burn: { netBurnMinor: number; grossBurnMinor?: number };
  runway: { months: number | null };
}

export type RunwayState = "positive" | "no_bank" | "short_history" | "negative";

/**
 * A balance below zero has no runway whatever the months say (the API divides a negative balance by the burn and gets a
 * negative figure, or none at all when the burn is zero, which used to read as good news).
 */
export function runwayState(finance: RunwayFinanceInput | null | undefined): RunwayState | null {
  if (!finance) return null;
  // `accounts` is the count of connected accounts; an input that leaves it out (a note's metric strip) is read as
  // having a balance, as before. Only an explicit zero is "no bank".
  const noBank = finance.cash.accounts === 0;
  if (!noBank && (finance.cash.amountMinor ?? 0) < 0) return "negative";
  if (finance.runway.months !== null) return null;
  if (noBank) return "no_bank";
  // No money moved at all in the trailing months (a quiet or stale account) is not good news: it is too little history.
  const quiet = finance.burn.netBurnMinor === 0 && finance.burn.grossBurnMinor === 0;
  return finance.burn.netBurnMinor <= 0 && !quiet ? "positive" : "short_history";
}
