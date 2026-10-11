/**
 * Small formatting helpers for settings copy (money and dates follow DESIGN §10: numbers carry units).
 *
 * The product reads in US English: numbers are grouped the en-US way, dates read "Oct 7, 2026" and times "3:45 PM".
 * Money keeps each business's own currency with its narrow symbol ("£1,240.00" for a GBP business).
 *
 * Dates and times are printed in UTC (DISPLAY_TIME_ZONE), never in the process's own zone: the server renders in UTC
 * and the browser hydrates in the visitor's zone, so a local-time format would print different characters on each side
 * (a hydration mismatch) and differ between a laptop and CI. A time carries "UTC" so nobody reads it as local.
 */
import type { Money } from "@foundmill/shared";

export const DISPLAY_LOCALE = "en-US";
export const DISPLAY_TIME_ZONE = "UTC";

type DateValue = Date | string | number | null | undefined;

function toDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ICU versions differ on the space before AM/PM (U+202F in some): one plain space everywhere, so server and browser agree. */
function plainSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

function dateFormat(options: Intl.DateTimeFormatOptions, locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, ...options });
}

export function formatMoney(money: Money | { amountMinor: number; currency: string } | null | undefined, locale = DISPLAY_LOCALE): string {
  if (!money) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(money.amountMinor / 100);
  } catch {
    return `${(money.amountMinor / 100).toFixed(2)} ${money.currency}`;
  }
}

/** "12,480", "1,234.5": a number grouped the en-US way (options pass through to Intl.NumberFormat). */
export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(DISPLAY_LOCALE, options).format(n);
}

/** "Oct 7, 2026" */
export function formatDate(value: DateValue, locale = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return dateFormat({ month: "short", day: "numeric", year: "numeric" }, locale).format(d);
}

/** "Oct 7": the year is implied (this year, or a list of one year). */
export function formatDayMonth(value: DateValue, locale = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return dateFormat({ month: "short", day: "numeric" }, locale).format(d);
}

/** "Oct 2026", or "October 2026" with `long`. */
export function formatMonthYear(value: DateValue, opts: { long?: boolean } = {}, locale = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return dateFormat({ month: opts.long ? "long" : "short", year: "numeric" }, locale).format(d);
}

/** "Oct 7, 3:45 PM UTC" (the year is implied; times are UTC, see the note at the top). */
export function formatDateTime(value: DateValue, locale = DISPLAY_LOCALE): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${plainSpaces(dateFormat({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }, locale).format(d))} UTC`;
}

/** "1 business", "3 businesses": a count with its noun, never "1 businesses" (pass the plural when it is irregular). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

const WORDS: Record<string, string> = { api: "API", oauth: "OAuth", mrr: "MRR", arr: "ARR", b2b: "B2B", b2c: "B2C", saas: "SaaS", dtc: "DTC", eu: "EU", uk: "UK", us: "US", ai: "AI", ip: "IP", vat: "VAT", gdpr: "GDPR", id: "ID", url: "URL", seo: "SEO", cpa: "CPA", crm: "CRM" };

/** A stored identifier in plain words: "private_limited_company" → "Private limited company", "api_key" → "API key". */
export function plainWords(key: string | null | undefined): string {
  if (!key) return "";
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w, i) => WORDS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

/** What the six modules are called on screen (departments are labels over modules; these name the capability). */
export const MODULE_WORDS: Record<string, string> = {
  product: "Product",
  development: "Development",
  distribution: "Distribution",
  finance: "Finance",
  team: "Team",
  legal: "Legal",
};

/** "product, development" → "Product and development"; none → "Custom screens only". */
export function moduleList(keys: readonly string[]): string {
  const words = keys.map((k) => MODULE_WORDS[k] ?? plainWords(k));
  if (words.length === 0) return "Custom screens only";
  const lower = words.map((w, i) => (i === 0 ? w : w.toLowerCase()));
  return lower.length === 1 ? lower[0]! : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}
