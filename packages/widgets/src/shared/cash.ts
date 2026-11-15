/**
 * A month of `finance.overview`'s bank totals read as revenue (cash basis): operating inflows only. A raise, a director
 * loan or a transfer from savings is cash in, not income (BUILD §11.8), so Home's revenue tiles and the Inbox strip
 * never show it as revenue. Older responses without the operating split fall back to every inflow.
 */
export function monthRevenueMinor(m: { inflowMinor: number; operatingInflowMinor?: number }): number {
  return m.operatingInflowMinor ?? m.inflowMinor;
}

/**
 * Revenue this month, the one figure every tile reads (Home's status strip, Revenue and customers): the month's
 * operating inflows; 0 when a bank or revenue history exists and nothing came in yet this month; null (not known yet)
 * when there is neither, never a dash (Nov 7, 2026: one number per fact, no placeholder answers).
 */
export function revenueThisMonthMinor(
  finance: { cash: { accounts: number }; revenue: { monthly: { month: string; inflowMinor: number; operatingInflowMinor?: number }[] } } | null | undefined,
  month: string,
): number | null {
  if (!finance) return null;
  const row = finance.revenue.monthly.find((m) => m.month === month);
  if (row) return monthRevenueMinor(row);
  return finance.cash.accounts > 0 || finance.revenue.monthly.length > 0 ? 0 : null;
}

/** A money figure with nothing to count yet: what it waits for, never a dash (the runway's "no bank" words). */
export const NOT_KNOWN_YET = { value: "Not known yet", caption: "Not enough data yet: connect your bank" } as const;
