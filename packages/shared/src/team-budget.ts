/**
 * The team budget in outcomes (WP-14 T3; founder's brief of Nov 17, 2026, A7 and A11): how many more real outcomes what
 * is left of the month's budget is enough for, at this month's pace. An outcome is the north star's (`realOutcomes`,
 * ./morning-brief): the page live, an email sent, a follower, a reply, a payment. Simulated results never count.
 *
 * Both figures are Estimates and are shown as such. With no outcome yet, or nothing spent, there is no pace to read:
 * the answer is null and the screen shows the dollar balance alone. No number is ever made up.
 */
export interface TeamBudgetEstimate {
  /** Real outcomes so far this month. */
  outcomes: number;
  /** What the budget paid for each outcome so far, in US cents (an Estimate). */
  costPerOutcomeMinor: number;
  /** How many more outcomes what is left is enough for at that cost (an Estimate; 0 when less than one). */
  enoughFor: number;
}

export function teamBudgetEstimate(input: { balanceMinor: number; spentMinor: number; outcomes: number }): TeamBudgetEstimate | null {
  if (!(input.outcomes > 0) || !(input.spentMinor > 0)) return null;
  const costPerOutcomeMinor = Math.max(1, Math.round(input.spentMinor / input.outcomes));
  return { outcomes: Math.floor(input.outcomes), costPerOutcomeMinor, enoughFor: Math.max(0, Math.floor(Math.max(0, input.balanceMinor) / costPerOutcomeMinor)) };
}
