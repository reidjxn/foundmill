import type { Money } from "./types";
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "ISK", "VND"]);
export function minorToMajor(amountMinor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amountMinor : amountMinor / 100;
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
  const standard = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
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

export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const major = minorToMajor(m.amountMinor, m.currency);
  const locale = opts.locale ?? "en-GB";
  if (opts.compact && Math.abs(major) >= 10_000) return formatCompactMoney(major, m.currency, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: m.currency, maximumFractionDigits: opts.compact ? 0 : 2,
  }).format(major);
}
export const money = (amountMinor: number, currency = "EUR"): Money => ({ amountMinor, currency });
