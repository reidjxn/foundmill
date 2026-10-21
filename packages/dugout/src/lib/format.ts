/**
 * Formatting helpers. The product reads in US English: numbers and money default to en-US (matching
 * @foundmill/shared), dates read "Oct 7, 2026" and times "3:45 PM" (DATE_FORMATS below). Money keeps each business's own
 * currency with its narrow symbol. Everything is pure; pass `now` where time is involved so tests and stories are
 * deterministic.
 *
 * A signed-in person may choose day-first or ISO dates and a 24-hour clock (Settings › Preferences). Every date helper
 * takes that choice as an optional last argument (`prefs`) and reads US and 12-hour without it; in a component, use
 * `useFormatters()` (DateFormatProvider) instead, which binds the current person's choice. Relative times ("3 min ago")
 * and numbers never change with it.
 */
import { formatMoney as sharedFormatMoney, type Money } from "@foundmill/shared";
import { format as dfFormat, isValid } from "date-fns";
import { datePatternFor, dateFormatKeyOf, normalizeDateFormatPrefs, type DateFormatKey, type DateFormatPrefs } from "./date-preferences";

export const DEFAULT_LOCALE = "en-US";

/**
 * The date and time patterns (date-fns tokens) every screen uses, so a person reads one convention everywhere. Pass one
 * (or its name: `"dayMonth"`) to `formatDate` instead of spelling a pattern at the call site. These are the US forms;
 * with a person's `prefs` each one becomes its day-first or ISO and 24-hour equivalent (lib/date-preferences.ts).
 */
export const DATE_FORMATS = {
  /** "Oct 7, 2026" */
  date: "MMM d, yyyy",
  /** "Oct 7": the year is implied (this year, or a column of one year). */
  dayMonth: "MMM d",
  /** "Wed, Oct 7" */
  weekdayDayMonth: "EEE, MMM d",
  /** "Wed, Oct 7, 2026" */
  weekdayDate: "EEE, MMM d, yyyy",
  /** "Wednesday, October 7, 2026" */
  longDate: "EEEE, MMMM d, yyyy",
  /** "Oct 2026" */
  monthYear: "MMM yyyy",
  /** "3:45 PM" */
  time: "h:mm a",
  /** "3:45:09 PM" */
  timeSeconds: "h:mm:ss a",
  /** "Oct 7, 2026, 3:45 PM" */
  dateTime: "MMM d, yyyy, h:mm a",
  /** "Oct 7, 3:45 PM": the year is implied. */
  dayMonthTime: "MMM d, h:mm a",
} as const;

type DateInput = Date | string | number;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date-only string ("2026-10-07", a calendar day such as a Journey day) is that day wherever the reader is, so it is
 * read as local midnight; `new Date("2026-10-07")` would be UTC midnight, the day before west of Greenwich.
 */
function toDate(d: DateInput): Date {
  if (d instanceof Date) return d;
  if (typeof d === "string") {
    const m = DAY_KEY_RE.exec(d);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(d);
}

/** The pattern to print: a named form (or its US pattern) under the person's choice; any other pattern unchanged. */
function patternFor(pattern: unknown, prefs: DateFormatPrefs | null | undefined): string {
  if (typeof pattern !== "string" || pattern === "") return datePatternFor("date", prefs);
  const key = dateFormatKeyOf(pattern);
  return key ? datePatternFor(key, prefs) : pattern;
}

/** Integer or decimal with grouping. `digits` fixes the fraction digits; otherwise up to 2. */
export function formatNumber(n: number, opts: { digits?: number; maxDigits?: number; locale?: string; signed?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const f = new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: opts.digits,
    maximumFractionDigits: opts.digits ?? opts.maxDigits ?? 2,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  });
  return f.format(n);
}

/** 1.2K, 3.4M, 12B — one decimal under 100 of a unit, none above. */
export function formatCompact(n: number, opts: { locale?: string; signed?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return formatNumber(n, { maxDigits: 0, signed: opts.signed, locale: opts.locale });
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const v = n / div;
      const digits = Math.abs(v) < 100 ? 1 : 0;
      const s = formatNumber(v, { maxDigits: digits, signed: opts.signed, locale: opts.locale });
      return `${s}${suffix}`;
    }
  }
  return formatNumber(n, { maxDigits: 0 });
}

/** Percent from a ratio (0.125 → "12.5%") or from a percentage when `ofHundred` is set. */
export function formatPercent(value: number, opts: { digits?: number; ofHundred?: boolean; signed?: boolean; locale?: string } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const ratio = opts.ofHundred ? value / 100 : value;
  return new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    style: "percent",
    minimumFractionDigits: opts.digits ?? 0,
    maximumFractionDigits: opts.digits ?? 1,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  }).format(ratio);
}

/** Money from minor units via @foundmill/shared. */
export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  return sharedFormatMoney(m, opts);
}

/** Signed money delta: "+€1,200.00" / "−€300.00". */
export function formatMoneyDelta(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const s = sharedFormatMoney({ ...m, amountMinor: Math.abs(m.amountMinor) }, opts);
  if (m.amountMinor > 0) return `+${s}`;
  if (m.amountMinor < 0) return `−${s}`;
  return s;
}

/**
 * date-fns `format` with Dugout defaults: "Oct 5, 2026". Prefer a `DATE_FORMATS` pattern or its name (`"dayMonth"`)
 * over a literal one: those follow the person's choice when `prefs` is given ("5 Oct 2026", "2026-10-05"); a literal
 * pattern ("yyyy", "EEE") prints as written.
 */
export function formatDate(d: DateInput, pattern: DateFormatKey | (string & {}) = "date", prefs?: DateFormatPrefs | null): string {
  const date = toDate(d);
  return isValid(date) ? dfFormat(date, patternFor(pattern, prefs)) : "—";
}

/** "Oct 5, 2026, 2:05 PM" ("5 Oct 2026, 14:05", "2026-10-05 14:05" by choice). */
export function formatDateTime(d: DateInput, prefs?: DateFormatPrefs | null): string {
  return formatDate(d, "dateTime", prefs);
}

/** "2:05 PM" ("14:05" on a 24-hour clock). */
export function formatTime(d: DateInput, prefs?: DateFormatPrefs | null): string {
  return formatDate(d, "time", prefs);
}

/** "Oct 5": the year is implied ("5 Oct", "10-05" by choice). */
export function formatDateShort(d: DateInput, prefs?: DateFormatPrefs | null): string {
  return formatDate(d, "dayMonth", prefs);
}

/**
 * "Oct 5" when the date falls in the current year (the year is implied), "Oct 5, 2027" otherwise, so a deadline next
 * year or a version from last year never reads as this year's ("5 Oct" / "5 Oct 2027", "10-05" / "2027-10-05").
 */
export function formatDateSmart(d: DateInput, now: DateInput = new Date(), prefs?: DateFormatPrefs | null): string {
  const date = toDate(d);
  if (!isValid(date)) return "—";
  const today = toDate(now);
  return formatDate(date, isValid(today) && today.getFullYear() === date.getFullYear() ? "dayMonth" : "date", prefs);
}

/** "Oct 2026" ("2026-10" in ISO). */
export function formatMonthYear(d: DateInput, prefs?: DateFormatPrefs | null): string {
  return formatDate(d, "monthYear", prefs);
}

/**
 * An hour of the day on a 24-cell axis. 12-hour: 0 → "12 AM", 9 → "9 AM", 12 → "12 PM", 15 → "3 PM"; 24-hour:
 * "00:00", "09:00", "12:00", "15:00".
 */
export function formatHourOfDay(hour: number, prefs?: DateFormatPrefs | null): string {
  if (!Number.isFinite(hour)) return "—";
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (normalizeDateFormatPrefs(prefs).time === "24h") return `${String(h).padStart(2, "0")}:00`;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A date with its year apart, for a slot that drops the year first when space runs out (the top bar): `lead` and
 * `tail` hold the year with its separator, `core` the rest. "Oct 7" + ", 2026"; day first "7 Oct" + " 2026"; ISO
 * "2026-" + "10-07".
 */
export interface DateYearParts {
  lead: string;
  core: string;
  tail: string;
}

export function formatDateYearParts(d: DateInput, prefs?: DateFormatPrefs | null): DateYearParts {
  const date = toDate(d);
  if (!isValid(date)) return { lead: "", core: "—", tail: "" };
  const p = normalizeDateFormatPrefs(prefs);
  const year = dfFormat(date, "yyyy");
  const core = dfFormat(date, datePatternFor("dayMonth", p));
  if (p.date === "iso") return { lead: `${year}-`, core, tail: "" };
  return { lead: "", core, tail: p.date === "us" ? `, ${year}` : ` ${year}` };
}

/**
 * A date range with an en dash. US: "Oct 7 – 21" within a month, "Oct 28 – Nov 3" within a year, "Dec 28, 2026 –
 * Jan 4, 2027" across years, and a single date when both ends fall on the same day; `withYear` adds the shared year
 * ("Oct 7 – 21, 2026"), and a range across years always carries both. Day first: "7 – 21 Oct", "28 Oct – 3 Nov",
 * "28 Dec 2026 – 4 Jan 2027", "7 – 21 Oct 2026". ISO keeps both ends whole: "10-07 – 10-21", "2026-10-07 – 2026-10-21".
 */
export function formatDateRange(start: DateInput, end: DateInput, opts: { withYear?: boolean; prefs?: DateFormatPrefs | null } = {}): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!isValid(a) || !isValid(b)) return "—";
  const p = normalizeDateFormatPrefs(opts.prefs);
  const fmt = (d: Date, key: DateFormatKey) => dfFormat(d, datePatternFor(key, p));
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameDay = sameYear && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const short: DateFormatKey = opts.withYear || !sameYear ? "date" : "dayMonth";
  if (sameDay) return fmt(a, short);
  if (p.date === "iso" || !sameYear) return `${fmt(a, short)} – ${fmt(b, short)}`;
  const sameMonth = a.getMonth() === b.getMonth();
  if (p.date === "day_first") {
    const year = opts.withYear ? ` ${dfFormat(a, "yyyy")}` : "";
    return sameMonth ? `${dfFormat(a, "d")} – ${fmt(b, "dayMonth")}${year}` : `${fmt(a, "dayMonth")} – ${fmt(b, "dayMonth")}${year}`;
  }
  const year = opts.withYear ? `, ${dfFormat(a, "yyyy")}` : "";
  return sameMonth ? `${fmt(a, "dayMonth")} – ${dfFormat(b, "d")}${year}` : `${fmt(a, "dayMonth")} – ${fmt(b, "dayMonth")}${year}`;
}

/** Every date helper bound to one person's choice: what `useFormatters()` returns, and what a server component builds. */
export interface DateFormatters {
  prefs: DateFormatPrefs;
  /** "Oct 7, 2026"; pass a form's name or US pattern for another form ("dayMonth", DATE_FORMATS.weekdayDate). */
  formatDate(d: DateInput, pattern?: DateFormatKey | (string & {})): string;
  /** "Oct 7" */
  formatDateShort(d: DateInput): string;
  /** "Oct 7" this year, "Oct 7, 2027" in any other (see formatDateSmart). */
  formatDateSmart(d: DateInput, now?: DateInput): string;
  /** "Oct 2026" */
  formatMonthYear(d: DateInput): string;
  /** "3:45 PM" */
  formatTime(d: DateInput): string;
  /** "Oct 7, 2026, 3:45 PM" */
  formatDateTime(d: DateInput): string;
  /** "Oct 7 – 21" (see formatDateRange) */
  formatRange(start: DateInput, end: DateInput, opts?: { withYear?: boolean }): string;
  /** "3 PM" / "15:00" */
  formatHourOfDay(hour: number): string;
  /** The date with its year apart (the top bar). */
  formatDateYearParts(d: DateInput): DateYearParts;
}

/** Binds every date helper to `prefs` (US and 12-hour when none is given). Safe to pass to `Array.map`. */
export function bindFormatters(prefs?: DateFormatPrefs | null): DateFormatters {
  const p = normalizeDateFormatPrefs(prefs);
  return {
    prefs: p,
    formatDate: (d, pattern) => formatDate(d, typeof pattern === "string" ? pattern : "date", p),
    formatDateShort: (d) => formatDate(d, "dayMonth", p),
    formatDateSmart: (d, now) => formatDateSmart(d, now, p),
    formatMonthYear: (d) => formatDate(d, "monthYear", p),
    formatTime: (d) => formatDate(d, "time", p),
    formatDateTime: (d) => formatDate(d, "dateTime", p),
    formatRange: (start, end, opts) => formatDateRange(start, end, { withYear: opts?.withYear, prefs: p }),
    formatHourOfDay: (hour) => formatHourOfDay(hour, p),
    formatDateYearParts: (d) => formatDateYearParts(d, p),
  };
}

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * Relative times keep the words they always had ("3 min ago", "in 2 hr", "4 days ago"): the founder's switch to US
 * English left them unchanged. CLDR's US data abbreviates differently ("3 min. ago" in short style, "4d ago" in narrow),
 * so relative time alone reads from the British CLDR data, whose words are the same plain English in both countries.
 */
// us-english-allow: relative-time wording only (no spelling or date format comes from this locale).
const RELATIVE_TIME_LOCALE = "en-GB";

/**
 * Relative time, short and plain: "just now", "3 min ago", "in 2 hr", "yesterday", "4 days ago".
 * Pass `now` for deterministic output.
 */
export function formatRelative(d: DateInput, now: DateInput = new Date(), opts: { locale?: string; style?: "long" | "short" | "narrow" } = {}): string {
  const date = toDate(d);
  const ref = toDate(now);
  if (!isValid(date) || !isValid(ref)) return "—";
  const diffSec = Math.round((date.getTime() - ref.getTime()) / 1000);
  if (Math.abs(diffSec) < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(opts.locale ?? RELATIVE_TIME_LOCALE, { numeric: "auto", style: opts.style ?? "short" });
  for (const [unit, secs] of REL_UNITS) {
    if (Math.abs(diffSec) >= secs || unit === "minute") {
      const value = Math.round(diffSec / secs);
      return rtf.format(value, unit);
    }
  }
  return "just now";
}

/** Duration from milliseconds: "42s", "3m 12s", "1h 04m", "2d 3h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Token counts: "12.4K tokens" (compact). */
export function formatTokens(n: number): string {
  // plain-allow: a formatter, not a screen; the screen that prints the count defines Tokens (a Term or a column `term`).
  return `${formatCompact(n)} tokens`;
}

/** Delta with an arrow and a sign so colour is never the only signal: "▲ 12.5%", "▼ 3", "— 0". */
export function formatDelta(value: number, opts: { percent?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "—";
  const body = opts.percent ? formatPercent(Math.abs(value), { digits: opts.digits ?? 1 }) : formatNumber(Math.abs(value), { maxDigits: opts.digits ?? 1 });
  return `${arrow} ${body}`;
}

/** Ordinal: 1st, 2nd, 3rd, 11th. */
export function formatOrdinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const mod100 = v % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : (["th", "st", "nd", "rd"][v % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * Up to two initials from a display name: "Ada Lovelace" → "AL", "ledgerly" → "LE". Punctuation and symbols are not
 * letters: "Patch & Co." → "PC", "(Re)Fill" → "RE", "“Quoted” name" → "QN".
 */
export function initials(name: string, max = 2): string {
  const parts = name
    .trim()
    .split(/[\s\-_.]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return (parts[0] as string).slice(0, max).toUpperCase();
  return parts
    .slice(0, max)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase();
}

/** Truncate with an ellipsis at a grapheme-safe boundary. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/** File sizes, 1024-based: "812 B", "3.4 KB", "34 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)} ${units[u]}`;
}

/**
 * The display copy of an amount typed into a MoneyInput while the field is not focused: grouped with the locale's
 * separators ("60000" → "60,000", "1250000000.5" → "1,250,000,000.5"), with the shorthand callers already parse
 * expanded ("25k" → "25,000", "1.2m" → "1,200,000"). Anything else (empty, "about 5k", "12/3") comes back unchanged, so
 * the field never invents a number. The caller's value stays the raw text; this is presentation only.
 */
export function formatMoneyInput(raw: string, locale: string = DEFAULT_LOCALE): string {
  const compact = raw.trim().replace(/[,\s']/g, ""); // \s covers the no-break and narrow no-break spaces some locales group with
  const m = /^([+-]?)(\d+)(?:\.(\d+))?([kmb])?$/i.exec(compact);
  if (!m) return raw;
  const [, sign, int, frac, unit] = m;
  const mult = unit ? { k: 1e3, m: 1e6, b: 1e9 }[unit.toLowerCase() as "k" | "m" | "b"] : 1;
  const n = Number(`${sign}${int}${frac ? `.${frac}` : ""}`) * mult;
  if (!Number.isFinite(n)) return raw;
  const digits = unit ? (Number.isInteger(n) ? 0 : 2) : (frac?.length ?? 0);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/**
 * The narrow symbol for an ISO 4217 code in a locale ("GBP" → "£", "USD" → "$", "SEK" → "kr"), or undefined when the
 * locale has no symbol other than the code itself (so a field never shows "CHF" twice) or the code is unknown.
 */
export function currencySymbol(code: string | undefined, locale: string = DEFAULT_LOCALE): string | undefined {
  if (!code || !/^[A-Za-z]{3}$/.test(code)) return undefined;
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency: code.toUpperCase(), currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    if (!part || part.toUpperCase() === code.toUpperCase()) return undefined;
    return part;
  } catch {
    return undefined;
  }
}
