import { addDays, dailySeries, lastDays, sumInRange } from "./time";
import type { RibbonResponse } from "./types";

/**
 * First payments in the last 7 days against the 7 before: the server's own figures (`ribbon.customers`, the one field
 * every screen reads) when they are for the same day, else the ribbon's business-wide rows; the spark is the rows'.
 */
export function customersThisWeek(ribbon: RibbonResponse | undefined, today: string): { week: number; previous: number; spark: number[] } | null {
  if (!ribbon) return null;
  const rows = ribbon.rows.filter((r) => r.departmentId === null);
  const server = ribbon.customers && ribbon.customers.today === today ? ribbon.customers : null;
  return {
    week: server ? server.thisWeek : sumInRange(rows, addDays(today, -6), today, (r) => r.payments),
    previous: server ? server.previousWeek : sumInRange(rows, addDays(today, -13), addDays(today, -7), (r) => r.payments),
    spark: dailySeries(rows, lastDays(14, today), (r) => r.payments),
  };
}
