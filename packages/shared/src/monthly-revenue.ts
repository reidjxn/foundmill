/**
 * One definition of monthly revenue (one number per fact, DECISIONS 2026-11-11): Finance › Overview's monthly figure,
 * its Runway seeds, the Inbox status strip and the revenue milestones are all the P&L revenue of the last 3 full
 * calendar months (UTC, never the current partial month) ÷ 3, counted when the cash moves, an Estimate. Revenue is
 * `pnlTotals(categories).revenueMinor` (@foundmill/shared/pnl, the chart of accounts' revenue section, refunds netted),
 * added up in the business's money as Finance adds it.
 *
 * Its name follows Finance: "MRR" (monthly recurring revenue) only when the business's revenue recurs
 * (`revenueIsRecurring`, or before an archetype is chosen); otherwise "monthly revenue" ("Average monthly revenue" on
 * the Finance tile), since nothing a one-off seller earns recurs.
 */
import { pnlTotals, type PnlCategoryTotal } from "./pnl";

/** The full months the monthly figure averages. */
export const MONTHLY_REVENUE_MONTHS = 3;

/** The last `months` full calendar months (UTC) before `at`'s month: [from, to), and their keys oldest first. */
export function monthlyRevenueWindow(at: Date, months: number = MONTHLY_REVENUE_MONTHS): { from: Date; to: Date; months: string[] } {
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, 1));
  const keys = Array.from({ length: months }, (_, i) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  return { from, to, months: keys };
}

/** The monthly figure from the window's revenue: its total ÷ the months, rounded to the minor unit. */
export function monthlyRevenueMinor(windowRevenueMinor: number, months: number = MONTHLY_REVENUE_MONTHS): number {
  return Math.round(windowRevenueMinor / months);
}

/** The monthly figure from the window's P&L category totals (`finance.pnl` over `monthlyRevenueWindow`). */
export function monthlyRevenueFromCategories(categories: readonly PnlCategoryTotal[], months: number = MONTHLY_REVENUE_MONTHS): number {
  return monthlyRevenueMinor(pnlTotals(categories).revenueMinor, months);
}

export interface MonthlyRevenueWords {
  /** The figure's name in a sentence or a milestone: "MRR" or "monthly revenue". */
  name: string;
  /** The Finance tile's label: "Monthly recurring revenue (MRR)" or "Average monthly revenue". */
  label: string;
  /** What it is, then how it is worked out (after the semicolon). */
  definition: string;
}

/** How the monthly figure is named for a business whose revenue recurs (`true`, or `null` before an archetype) or not. */
export function monthlyRevenueWords(recurring: boolean | null | undefined): MonthlyRevenueWords {
  if (recurring === false) {
    return { name: "monthly revenue", label: "Average monthly revenue", definition: "What customers paid you in a typical month of the last 3; the 3-month revenue ÷ 3. Your customers buy once, so none of it is recurring." };
  }
  return { name: "MRR", label: "Monthly recurring revenue (MRR)", definition: "What you earn from customers in a typical month; average monthly revenue over the trailing 3 months, counted when the cash moves." };
}
