/**
 * Test helpers for the person's date format (Settings › Preferences): the choices the screen tests render under, and a
 * scan for dates still printed the US way ("Oct 7", "3:45 PM") anywhere a person reads them (text, titles and
 * accessible names), so a screen that missed a call site fails its test.
 */
import type { DateFormatPrefs } from "@foundmill/dugout";

export const ISO_24H: DateFormatPrefs = { date: "iso", time: "24h" };
export const DAY_FIRST_24H: DateFormatPrefs = { date: "day_first", time: "24h" };

/** "Oct 7", "Oct 7, 2026", "Wed, Oct 7" (but not "Oct 2026", which every format but ISO shares). */
const US_DAY_MONTH = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?!\d)/g;
/** "3:45 PM", "12:00 AM". */
const TWELVE_HOUR = /\b\d{1,2}:\d{2}(?::\d{2})? ?[AP]M\b/g;

/** Every US-style date or 12-hour time under `root`, in its text and in its title and aria-label attributes. */
export function usDatesIn(root: Element): string[] {
  const texts = [root.textContent ?? ""];
  for (const el of Array.from(root.querySelectorAll("[title], [aria-label]"))) {
    const title = el.getAttribute("title");
    const label = el.getAttribute("aria-label");
    if (title) texts.push(title);
    if (label) texts.push(label);
  }
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(US_DAY_MONTH)) found.add(m[0]);
    for (const m of t.matchAll(TWELVE_HOUR)) found.add(m[0]);
  }
  return [...found];
}
