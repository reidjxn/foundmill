/**
 * What Commit says before Take charge when this month's included credits already went to the founder's other
 * businesses (the per-founder monthly pool, SEC2 S6; `founder.businesses.allowance`): the new business starts with its
 * team paused until the founder adds their own key or next month's credits arrive. Pure.
 */
import { formatMoney } from "@/lib/format";

export interface PoolView {
  /** How many of the founder's businesses the plan's included credits cover each month (null: every one). */
  places: number | null;
  /** How many places this month's grants already took. */
  taken: number;
  /** When next month's credits are granted (the first of the month, UTC). */
  nextGrantAt: Date | string;
  /** What a new business would be granted, in USD cents. */
  amountMinor: number;
}

/** The notice, or null when the new business gets its included credits. */
export function creditsNoticeOf(pool: PoolView | null | undefined, formatDay: (d: Date | string) => string): string | null {
  if (!pool || pool.places === null || pool.taken < pool.places || pool.amountMinor <= 0) return null;
  const amount = formatMoney({ amountMinor: pool.amountMinor, currency: "USD" });
  const others = pool.places === 1 ? "another business" : `${pool.places} other businesses`;
  // plain-allow: shown on Commit, which defines "credits" with a Term (the autopilot hint).
  return `This month's included credits (${amount}) already went to ${others} you took charge of, so this one starts with its team paused. Add your own Anthropic key in Settings › Keys to run it now, or wait for next month's credits on ${formatDay(pool.nextGrantAt)}.`;
}
