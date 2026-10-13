import type { Money } from "./types";

const DIGITS = new Map<string, number>();
/**
 * Decimal places of a currency's minor unit (ISO 4217): 2 for USD, EUR and GBP, 0 for JPY, KRW, XOF, UGX and the rest of
 * the zero-decimal currencies, 3 for KWD, BHD, OMR, JOD and TND. Read from the runtime's currency data, not a list kept
 * here, so a currency a payment webhook brings is never off by a factor of 10 or 100. An unknown code counts as 2.
 */
export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  const known = DIGITS.get(code);
  if (known !== undefined) return known;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* not a currency code: two places */
  }
  DIGITS.set(code, digits);
  return digits;
}
export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** minorUnitDigits(currency);
}
/** Whole minor units for an amount in major units, rounded to the currency's last place. */
export function majorToMinor(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** minorUnitDigits(currency));
}
const COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Compact figures ("€16K", "€41M") are built here rather than with Intl's `notation: "compact"`, whose
 * suffix case differs between ICU builds ("€16K" on one Node, "€16k" on another) and would make the same
 * number render differently on a laptop, in CI and in production. Rounds to a whole unit like
 * `maximumFractionDigits: 0`, promoting 1000K to 1M.
 */
function formatCompactMoney(major: number, currency: string, locale: string): string {
  const abs = Math.abs(major);
  const standard = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const [unit, suffix] = COMPACT_UNITS[i]!;
    if (abs < unit) continue;
    let value = Math.round(abs / unit);
    let sfx = suffix;
    if (value >= 1000 && i > 0) {
      value = Math.round(abs / COMPACT_UNITS[i - 1]![0]);
      sfx = COMPACT_UNITS[i - 1]![1];
    }
    const parts = standard.formatToParts(value);
    const text = parts.map((p) => (p.type === "integer" || p.type === "group" || p.type === "currency" || p.type === "literal" ? p.value : "")).join("");
    const withSuffix = text.replace(/(\d)(?!.*\d)/, `$1${sfx}`);
    return major < 0 ? `-${withSuffix}` : withSuffix;
  }
  return standard.format(major);
}

/** The product reads in US English: grouping and the sign follow en-US, the symbol is the currency's own ("£", "€", "$"). */
export const MONEY_LOCALE = "en-US";

export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const major = minorToMajor(m.amountMinor, m.currency);
  const locale = opts.locale ?? MONEY_LOCALE;
  if (opts.compact && Math.abs(major) >= 10_000) return formatCompactMoney(major, m.currency, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: m.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: opts.compact ? 0 : minorUnitDigits(m.currency),
  }).format(major);
}
/** Money in a named currency: there is no default one (a business amount is in the business's own, `businesses.currency`). */
export const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });
