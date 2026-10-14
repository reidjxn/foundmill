/**
 * A month of `finance.overview`'s bank totals read as revenue (cash basis): operating inflows only. A raise, a director
 * loan or a transfer from savings is cash in, not income (BUILD §11.8), so Home's revenue tiles and the Inbox strip
 * never show it as revenue. Older responses without the operating split fall back to every inflow.
 */
export function monthRevenueMinor(m: { inflowMinor: number; operatingInflowMinor?: number }): number {
  return m.operatingInflowMinor ?? m.inflowMinor;
}
