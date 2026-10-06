import type { Money } from "./types";
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "ISK", "VND"]);
export function minorToMajor(amountMinor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amountMinor : amountMinor / 100;
}
export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const major = minorToMajor(m.amountMinor, m.currency);
  return new Intl.NumberFormat(opts.locale ?? "en-GB", {
    style: "currency", currency: m.currency, maximumFractionDigits: opts.compact ? 0 : 2,
    notation: opts.compact && Math.abs(major) >= 10_000 ? "compact" : "standard",
  }).format(major);
}
export const money = (amountMinor: number, currency = "EUR"): Money => ({ amountMinor, currency });
