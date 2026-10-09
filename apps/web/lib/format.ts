/** Small formatting helpers for settings copy (money and dates follow DESIGN §10: numbers carry units). */
import type { Money } from "@foundmill/shared";

export function formatMoney(money: Money | { amountMinor: number; currency: string } | null | undefined, locale = "en-GB"): string {
  if (!money) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency, maximumFractionDigits: 2 }).format(money.amountMinor / 100);
  } catch {
    return `${(money.amountMinor / 100).toFixed(2)} ${money.currency}`;
  }
}

export function formatDate(value: Date | string | null | undefined, locale = "en-GB"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, locale = "en-GB"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}
