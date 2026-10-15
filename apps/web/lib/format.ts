/**
 * Small formatting helpers for settings copy (money and dates follow DESIGN §10: numbers carry units).
 *
 * The product reads in US English: numbers are grouped the en-US way, dates read "Oct 7, 2026" and times "3:45 PM".
 * Money keeps each business's own currency with its narrow symbol ("£1,240.00" for a GBP business).
 *
 * Dates and times are printed in UTC (DISPLAY_TIME_ZONE), never in the process's own zone: the server renders in UTC
 * and the browser hydrates in the visitor's zone, so a local-time format would print different characters on each side
 * (a hydration mismatch) and differ between a laptop and CI. A time carries "UTC" so nobody reads it as local.
 *
 * Every date helper takes the signed-in person's date format as an optional last argument (Settings › Preferences;
 * read it with `useDateFormat()` from @foundmill/dugout): "7 Oct 2026" or "2026-10-07", "15:45 UTC". Without it they
 * read US and 12-hour. The patterns are the design system's (lib/date-preferences.ts), so these and `useFormatters()`
 * always agree.
 */
import { format as dfFormat } from "date-fns";
import { dateFormatKeyOf, datePatternFor, normalizeDateFormatPrefs, type DateFormatKey, type DateFormatPrefs } from "@foundmill/dugout/lib/date-preferences";
import type { Money } from "@foundmill/shared";
import { usSpelling } from "@foundmill/shared/us-spelling";

export const DISPLAY_LOCALE = "en-US";
export const DISPLAY_TIME_ZONE = "UTC";
/** Model costs read in the pricing currency (USD); business money reads in the business's own (`useBusinessCurrency`). */
export { MODEL_COST_CURRENCY } from "@foundmill/shared/constants";

type DateValue = Date | string | number | null | undefined;

function toDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A Date whose own fields read as UTC, so date-fns prints the UTC wall clock in any process and any browser (date-fns
 * builds every intermediate date with the input's constructor, so the reading holds through the whole format).
 */
class UtcWallClock extends Date {
  override getFullYear() {
    return this.getUTCFullYear();
  }
  override getMonth() {
    return this.getUTCMonth();
  }
  override getDate() {
    return this.getUTCDate();
  }
  override getDay() {
    return this.getUTCDay();
  }
  override getHours() {
    return this.getUTCHours();
  }
  override getMinutes() {
    return this.getUTCMinutes();
  }
  override getSeconds() {
    return this.getUTCSeconds();
  }
  override getMilliseconds() {
    return this.getUTCMilliseconds();
  }
  override getTimezoneOffset() {
    return 0;
  }
}

/** A named form (or a literal pattern) printed in UTC under the person's choice. */
function utc(d: Date, pattern: DateFormatKey | string, prefs: DateFormatPrefs | null | undefined): string {
  const key = dateFormatKeyOf(pattern);
  return dfFormat(new UtcWallClock(d.getTime()), key ? datePatternFor(key, prefs) : pattern);
}

/** "GBP" → "British Pound" for a currency select (the code sits on its own chip before the name). */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames([DISPLAY_LOCALE], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
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

/** "Oct 7, 2026" ("7 Oct 2026", "2026-10-07" by choice). */
export function formatDate(value: DateValue, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  return d ? utc(d, "date", prefs) : "—";
}

/** "Oct 7": the year is implied (this year, or a list of one year); "7 Oct", "10-07" by choice. */
export function formatDayMonth(value: DateValue, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  return d ? utc(d, "dayMonth", prefs) : "—";
}

/** "Oct 2026", or "October 2026" with `long`; ISO reads "2026-10" either way. */
export function formatMonthYear(value: DateValue, opts: { long?: boolean } = {}, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  if (!d) return "—";
  if (opts.long && normalizeDateFormatPrefs(prefs).date !== "iso") return utc(d, "MMMM yyyy", prefs);
  return utc(d, "monthYear", prefs);
}

/** "Oct 7, 3:45 PM UTC" (the year is implied; times are UTC, see the note at the top); "7 Oct, 15:45 UTC" by choice. */
export function formatDateTime(value: DateValue, prefs?: DateFormatPrefs | null): string {
  const d = toDate(value);
  return d ? `${utc(d, "dayMonthTime", prefs)} UTC` : "—";
}

/** "1 business", "3 businesses": a count with its noun, never "1 businesses" (pass the plural when it is irregular). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

const WORDS: Record<string, string> = { api: "API", oauth: "OAuth", mrr: "MRR", arr: "ARR", b2b: "B2B", b2c: "B2C", saas: "SaaS", dtc: "DTC", eu: "EU", uk: "UK", us: "US", ai: "AI", ip: "IP", vat: "VAT", gdpr: "GDPR", id: "ID", url: "URL", seo: "SEO", cpa: "CPA", crm: "CRM" };

/**
 * A stored identifier in plain words: "private_limited_company" → "Private limited company", "api_key" → "API key".
 * Keys keep their spelling; the words read US English ("organisation" → "Organization").
 */
export function plainWords(key: string | null | undefined): string {
  if (!key) return "";
  return usSpelling(
    key
      .split(/[_\s-]+/)
      .filter(Boolean)
      // Own keys only: "constructor" or "toString" in a stored key must not find Object.prototype's members.
      .map((w, i) => (Object.hasOwn(WORDS, w.toLowerCase()) ? WORDS[w.toLowerCase()] : undefined) ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
      .join(" "),
  );
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
