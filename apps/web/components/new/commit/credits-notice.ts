/**
 * What Commit says before Take charge when this month's team budget is already used up (the owner's one included
 * budget, shared by all their projects; `founder.businesses.allowance`): the new project starts resting until the
 * founder adds their own key or next month's budget arrives. Pure.
 */
import { formatMoney } from "@/lib/format";

export interface PoolView {
  /** What the owner's plan includes each month, in USD cents. */
  monthlyMinor: number;
  /** What is left of it this month, shared by all their projects. */
  remainingMinor: number;
  /** When next month's budget opens (the first of the month, UTC). */
  nextGrantAt: Date | string;
}

/** The notice, or null while the new project shares a budget that still has something in it. */
export function creditsNoticeOf(pool: PoolView | null | undefined, formatDay: (d: Date | string) => string): string | null {
  if (!pool || pool.monthlyMinor <= 0 || pool.remainingMinor > 0) return null;
  const amount = formatMoney({ amountMinor: pool.monthlyMinor, currency: "USD" });
  return `This month's team budget (${amount}) is already used by your other projects, so this one starts resting. Add your own Anthropic key in Settings › Keys to run it now, or wait for next month's budget on ${formatDay(pool.nextGrantAt)}.`;
}
