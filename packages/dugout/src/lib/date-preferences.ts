/**
 * The date and time patterns behind each format a signed-in person can choose (founder, 2026-10-11: "a preferences
 * option for every signed-in user to choose date formats"). The product reads US dates and 12-hour times by default;
 * a person may switch to day-first or ISO dates and to a 24-hour clock. This file is the only place the opt-in patterns
 * are spelled (the US English guard allows them inside the marked block below and nowhere else); the table of every
 * pattern is in docs/DECISIONS.md.
 *
 * Pure and server-safe (no hooks): format.ts applies it, and the design system's DateFormatProvider passes the current
 * person's choice down so `useFormatters()` can bind it.
 */
import {
  DATE_FORMAT_PREFERENCES,
  DEFAULT_DATE_FORMAT_PREFS,
  TIME_FORMAT_PREFERENCES,
  type DateFormatPreference,
  type DateFormatPrefs,
  type TimeFormatPreference,
} from "@foundmill/shared/constants";

export { DATE_FORMAT_PREFERENCES, DEFAULT_DATE_FORMAT_PREFS, TIME_FORMAT_PREFERENCES };
export type { DateFormatPreference, DateFormatPrefs, TimeFormatPreference };

/** The date-only forms every screen uses (see DATE_FORMATS in format.ts for the US pattern of each). */
export type DatePartKey = "date" | "dayMonth" | "weekdayDayMonth" | "weekdayDate" | "longDate" | "monthYear";
/** The time-only forms. */
export type TimePartKey = "time" | "timeSeconds";
/** Every named form: dates, times, and a date with its time. */
export type DateFormatKey = DatePartKey | TimePartKey | "dateTime" | "dayMonthTime";

// us-english-date-preferences: begin (the opt-in patterns a person chooses in Settings › Preferences; US stays the default)
const DATE_PATTERNS: Record<DateFormatPreference, Record<DatePartKey, string>> = {
  us: {
    date: "MMM d, yyyy",
    dayMonth: "MMM d",
    weekdayDayMonth: "EEE, MMM d",
    weekdayDate: "EEE, MMM d, yyyy",
    longDate: "EEEE, MMMM d, yyyy",
    monthYear: "MMM yyyy",
  },
  day_first: {
    date: "d MMM yyyy",
    dayMonth: "d MMM",
    weekdayDayMonth: "EEE d MMM",
    weekdayDate: "EEE d MMM yyyy",
    longDate: "EEEE d MMMM yyyy",
    monthYear: "MMM yyyy",
  },
  iso: {
    date: "yyyy-MM-dd",
    dayMonth: "MM-dd",
    weekdayDayMonth: "EEE MM-dd",
    weekdayDate: "EEE yyyy-MM-dd",
    longDate: "EEEE yyyy-MM-dd",
    monthYear: "yyyy-MM",
  },
};

const TIME_PATTERNS: Record<TimeFormatPreference, Record<TimePartKey, string>> = {
  "12h": { time: "h:mm a", timeSeconds: "h:mm:ss a" },
  "24h": { time: "HH:mm", timeSeconds: "HH:mm:ss" },
};
// us-english-date-preferences: end

/** Between a date and its time: "Oct 7, 2026, 3:45 PM", "7 Oct 2026, 15:45", "2026-10-07 15:45". */
const DATE_TIME_SEPARATOR: Record<DateFormatPreference, string> = { us: ", ", day_first: ", ", iso: " " };

const DATE_KEYS = new Set<string>(Object.keys(DATE_PATTERNS.us));
const TIME_KEYS = new Set<string>(Object.keys(TIME_PATTERNS["12h"]));

export function isDateFormatKey(value: unknown): value is DateFormatKey {
  return typeof value === "string" && (DATE_KEYS.has(value) || TIME_KEYS.has(value) || value === "dateTime" || value === "dayMonthTime");
}

/**
 * A person's choice from anything (a cookie, an API answer, a prop): each field that is not a known format falls back
 * to the default, so a stale or hand-edited value can never break a page.
 */
export function normalizeDateFormatPrefs(value: unknown): DateFormatPrefs {
  if (!value || typeof value !== "object") return DEFAULT_DATE_FORMAT_PREFS;
  const { date, time } = value as { date?: unknown; time?: unknown };
  const d = (DATE_FORMAT_PREFERENCES as readonly unknown[]).includes(date) ? (date as DateFormatPreference) : DEFAULT_DATE_FORMAT_PREFS.date;
  const t = (TIME_FORMAT_PREFERENCES as readonly unknown[]).includes(time) ? (time as TimeFormatPreference) : DEFAULT_DATE_FORMAT_PREFS.time;
  return d === DEFAULT_DATE_FORMAT_PREFS.date && t === DEFAULT_DATE_FORMAT_PREFS.time ? DEFAULT_DATE_FORMAT_PREFS : { date: d, time: t };
}

export function sameDateFormatPrefs(a: DateFormatPrefs, b: DateFormatPrefs): boolean {
  return a.date === b.date && a.time === b.time;
}

/** The date-fns pattern of a named form under a person's choice (US and 12-hour when none is given). */
export function datePatternFor(key: DateFormatKey, prefs?: DateFormatPrefs | null): string {
  const p = normalizeDateFormatPrefs(prefs);
  const dates = DATE_PATTERNS[p.date];
  const times = TIME_PATTERNS[p.time];
  switch (key) {
    case "time":
    case "timeSeconds":
      return times[key];
    case "dateTime":
      return `${dates.date}${DATE_TIME_SEPARATOR[p.date]}${times.time}`;
    case "dayMonthTime":
      return `${dates.dayMonth}${DATE_TIME_SEPARATOR[p.date]}${times.time}`;
    default:
      return dates[key];
  }
}

/** Every US pattern back to its name, so `formatDate(d, DATE_FORMATS.dayMonth, prefs)` follows the person's choice. */
const KEY_BY_US_PATTERN: ReadonlyMap<string, DateFormatKey> = new Map(
  (["date", "dayMonth", "weekdayDayMonth", "weekdayDate", "longDate", "monthYear", "time", "timeSeconds", "dateTime", "dayMonthTime"] as const).map((k) => [datePatternFor(k), k]),
);

/** The name of a form given by its name or by its US pattern; undefined for any other (literal) pattern. */
export function dateFormatKeyOf(pattern: string): DateFormatKey | undefined {
  return isDateFormatKey(pattern) ? pattern : KEY_BY_US_PATTERN.get(pattern);
}

/** What each choice is called in Settings › Preferences and the command palette. */
export const DATE_FORMAT_LABELS: Record<DateFormatPreference, string> = { us: "US", day_first: "Day first", iso: "ISO 8601" };
export const TIME_FORMAT_LABELS: Record<TimeFormatPreference, string> = { "12h": "12-hour", "24h": "24-hour" };

