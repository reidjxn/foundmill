/**
 * One "due soon" window for filings and compliance dates (one number per fact, DECISIONS 2026-11-11): the Money area's
 * Company line, Company › Compliance (its "Due within 30 days" tile and each row's "Due soon" status) and the nightly
 * legal calendar roll (`repos.legal.rollFilingStatuses`, which moves a filing to `due`) all count the same days, so the
 * line and the tile can never disagree on the same business.
 *
 * 30 days: the window of the Compliance screen the founder acts on. How far ahead a list or an agent tool looks
 * (`legal.compliance.list`'s `days`, the gateway's `read_legal`) is a lookahead, not this count.
 */

import { daysBetweenDays } from "./goals";

/** A filing or compliance date is "due soon" when it falls within this many days from today (today included). */
export const FILINGS_DUE_SOON_DAYS = 30;

export type FilingWindow = "overdue" | "due" | "upcoming";

/** Where an open deadline `daysLeft` days away sits: past its date, due soon (inside the window), or later. */
export function filingWindow(daysLeft: number): FilingWindow {
  if (daysLeft < 0) return "overdue";
  return daysLeft <= FILINGS_DUE_SOON_DAYS ? "due" : "upcoming";
}

/**
 * Whole calendar days from the business's `today` ("2026-11-09") to a deadline's date (its UTC day: filings are dated,
 * not timed), so a date reads the same days left at any hour. Negative once it has passed.
 */
export function filingDaysLeft(dueAt: string | Date, today: string): number {
  const day = dueAt instanceof Date ? dueAt.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? dueAt : new Date(dueAt).toISOString().slice(0, 10);
  return daysBetweenDays(today, day);
}

/**
 * The window of one open deadline on the business's `today`. A filing whose stored status the nightly roll already
 * moved to `due` or `overdue` keeps it (the roll uses the same window); otherwise its date decides.
 */
export function deadlineWindow(dueAt: string | Date, today: string, storedStatus?: string | null): FilingWindow {
  if (storedStatus === "overdue" || storedStatus === "due") return storedStatus;
  return filingWindow(filingDaysLeft(dueAt, today));
}
