/** Small formatting helpers for settings copy (money and dates follow DESIGN §10: numbers carry units). */
import type { Money } from "@foundmill/shared";

export function formatMoney(money: Money | { amountMinor: number; currency: string } | null | undefined, locale = "en-GB"): string {
  if (!money) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(money.amountMinor / 100);
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

/** "1 business", "3 businesses": a count with its noun, never "1 businesses" (pass the plural when it is irregular). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
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
