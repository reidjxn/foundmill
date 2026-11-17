/**
 * A rating a first-timer can read (WP-10 T9; a3b §3.2, s1 §3.11): never a bare number. The band word always, "of 20"
 * wherever the figure shows, and one line saying what the rating is from. Server-safe.
 */
import { RATING_MAX, ratingBandLabel } from "./rating";

/**
 * Founder decision 5 (Nov 16, 2026): with Builder view off a rating shows its figure too, "14 of 20 · Good", not only
 * the band word. Turning this off draws the band word alone again.
 */
export const RATING_SHOWS_FIGURE_WITHOUT_BUILDER = true;

/** "14 of 20 · Good" with the figure, "Good" without. */
export function ratingText(value: number, opts: { figure: boolean }): string {
  const band = ratingBandLabel(value);
  return opts.figure ? `${Math.round(value)} of ${RATING_MAX} · ${band}` : band;
}

/** What a rating is from: the estimate an agent starts on, practice tests (on an ISO date), or real work. */
export type RatingSource = { kind: "starting" } | { kind: "tested"; on: string } | { kind: "work"; tasks: number };

/**
 * "Starting estimate. Not tested yet." | "From practice tests on Nov 14." | "From 12 tasks of real work." The date goes
 * through the caller's formatter (the person's date format; "Nov 14" in US form).
 */
export function ratingSourceLine(s: RatingSource, formatDay: (iso: string) => string): string {
  switch (s.kind) {
    case "starting":
      return "Starting estimate. Not tested yet.";
    case "tested":
      return `From practice tests on ${formatDay(s.on)}.`;
    case "work":
      return `From ${s.tasks} ${s.tasks === 1 ? "task" : "tasks"} of real work.`;
  }
}
