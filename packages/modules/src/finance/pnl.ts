/**
 * Zod-free finance helpers (months, the chart of accounts and P&L section totals): pure arithmetic that screens outside
 * Finance (the Inbox status strip) can import without pulling in vesting and its schemas. metrics.ts re-exports all of
 * it, so "@foundmill/modules/finance/metrics" keeps working everywhere.
 */
import { NON_OPERATING_CATEGORY_KEYS } from "@foundmill/shared/constants";
import { usSpelling } from "@foundmill/shared/us-spelling";
import type { CategoryTotal } from "./types";

/* ------------------------------------------------------------------------------------------------------------------ */
/* Months                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

/** YYYY-MM of a date (UTC). */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** First instant (UTC) of the month `offset` months away from `d`'s month. */
export function monthStart(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

/** YYYY-MM shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + n, 1)));
}

/** The last `n` full months before `now`'s month, oldest first. */
export function trailingMonths(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i -= 1) out.push(monthKey(monthStart(now, -i)));
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Chart of accounts                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------ */

export type PnlSection = "revenue" | "cogs" | "opex" | "financing" | "tax" | "other";

export const PNL_SECTION_LABELS: Record<PnlSection, string> = {
  revenue: "Revenue",
  cogs: "Cost of sales",
  opex: "Operating expenses",
  financing: "Financing",
  tax: "Taxes",
  other: "Other",
};

/** The standard chart of accounts Haiku categorises bank transactions into (BUILD §11.8). Keys are lower-case. */
export const CHART_OF_ACCOUNTS: readonly { category: string; section: PnlSection; aliases: readonly string[] }[] = [
  { category: "Revenue", section: "revenue", aliases: ["revenue", "sales", "subscriptions", "subscription revenue", "income", "stripe payout", "payouts"] },
  { category: "Refunds", section: "revenue", aliases: ["refunds", "refund", "chargebacks"] },
  // us-english-allow: aliases match category keys as stored, so the British "fulfilment" key keeps matching.
  { category: "Cost of sales", section: "cogs", aliases: ["cost of sales", "cogs", "cost of goods", "cost of goods sold", "materials", "manufacturing", "fulfilment", "fulfillment", "shipping", "shipping and fulfilment", "stock purchases", "inventory"] },
  { category: "Hosting", section: "cogs", aliases: ["hosting", "infrastructure", "cloud", "aws", "servers"] },
  { category: "Payment fees", section: "cogs", aliases: ["payment fees", "stripe fees", "processing fees", "transaction fees"] },
  { category: "Payroll", section: "opex", aliases: ["payroll", "salaries", "salary", "wages", "staff", "employer contributions", "salaries and contractors"] },
  { category: "Contractors", section: "opex", aliases: ["contractors", "freelancers", "consultants"] },
  { category: "Software", section: "opex", aliases: ["software", "saas", "tools", "subscriptions software", "ai usage", "anthropic", "model usage", "software and hosting"] },
  { category: "Marketing", section: "opex", aliases: ["marketing", "advertising", "ads", "paid media", "google ads", "meta ads", "campaigns", "marketing and advertising"] },
  { category: "Office", section: "opex", aliases: ["office", "rent", "coworking", "utilities", "rent and facilities", "facilities"] },
  { category: "Travel", section: "opex", aliases: ["travel", "transport", "hotels", "flights", "travel and meals", "meals"] },
  { category: "Professional services", section: "opex", aliases: ["professional services", "professional fees", "legal", "legal fees", "accounting", "legal and accounting", "audit"] },
  { category: "Insurance", section: "opex", aliases: ["insurance"] },
  { category: "Bank charges", section: "opex", aliases: ["bank charges", "bank fees", "fx fees", "bank fees and interest", "interest"] },
  { category: "Other operating", section: "opex", aliases: ["other operating", "other", "misc", "miscellaneous", "equipment", "hardware"] },
  // Financing and Transfers file exactly the keys net burn leaves out (packages/db `netBurn`), so the P&L and the burn
  // tiles agree on what a raise is.
  { category: "Financing", section: "financing", aliases: NON_OPERATING_CATEGORY_KEYS.financing },
  { category: "Taxes", section: "tax", aliases: ["taxes", "tax", "vat", "corporation tax", "income tax", "payroll tax", "taxes and government"] },
  { category: "Transfers", section: "other", aliases: NON_OPERATING_CATEGORY_KEYS.transfers },
];

export const PNL_CATEGORY_OPTIONS: readonly string[] = CHART_OF_ACCOUNTS.map((c) => c.category);

const aliasIndex = new Map<string, (typeof CHART_OF_ACCOUNTS)[number]>();
for (const c of CHART_OF_ACCOUNTS) {
  aliasIndex.set(c.category.toLowerCase(), c);
  for (const a of c.aliases) aliasIndex.set(a, c);
}

/** "cost_of_goods" / "Cost-of-goods" / " COST OF GOODS " → "cost of goods": the categoriser and the seeds store snake_case keys. */
export function categoryKey(category: string): string {
  return category.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const UNCATEGORISED_KEYS = new Set(["uncategorised", "uncategorized", "unknown", "none"]);

/** True for a missing category or one the categoriser stored as "uncategorised". */
export function isUncategorised(category: string | null | undefined): boolean {
  return !category || !category.trim() || UNCATEGORISED_KEYS.has(categoryKey(category));
}

/** The chart-of-accounts entry a free-text category maps to (null for an unknown or missing category). */
export function chartEntry(category: string | null | undefined): (typeof CHART_OF_ACCOUNTS)[number] | null {
  if (isUncategorised(category)) return null;
  const key = categoryKey(category!);
  return aliasIndex.get(key) ?? null;
}

/** A stored key in plain words for display: "gross_profit" → "Gross profit", "costOfSales" → "Cost of sales". */
export function plainWords(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return usSpelling(words.charAt(0).toUpperCase() + words.slice(1));
}

/** The category's display name: its chart-of-accounts line, else the stored key in plain words ("rnd_materials" → "Rnd materials"). */
export function categoryLabel(category: string | null | undefined): string {
  if (isUncategorised(category)) return "Uncategorized";
  const entry = chartEntry(category);
  if (entry) return entry.category;
  return plainWords(categoryKey(category!));
}

export function sectionOf(category: string | null | undefined): PnlSection | "uncategorised" {
  if (isUncategorised(category)) return "uncategorised";
  return chartEntry(category)?.section ?? "opex";
}

/** Signed cash effect of a category total: revenue sections count inflows, cost sections count outflows. */
export function categoryNet(t: CategoryTotal): number {
  return t.inflowMinor - t.outflowMinor;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* P&L section totals                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface PnlTotals {
  revenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginPct: number | null;
  opexMinor: number;
  operatingResultMinor: number;
  financingMinor: number;
  taxMinor: number;
  otherMinor: number;
  uncategorisedMinor: number;
  netMinor: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Section totals from category totals (operating result excludes financing, tax, transfers and uncategorised). */
export function pnlTotals(categories: readonly CategoryTotal[]): PnlTotals {
  const by: Record<PnlSection | "uncategorised", number> = { revenue: 0, cogs: 0, opex: 0, financing: 0, tax: 0, other: 0, uncategorised: 0 };
  for (const c of categories) by[sectionOf(c.category)] += categoryNet(c);
  const grossProfitMinor = by.revenue + by.cogs;
  const operatingResultMinor = grossProfitMinor + by.opex;
  return {
    revenueMinor: by.revenue,
    cogsMinor: by.cogs,
    grossProfitMinor,
    grossMarginPct: by.revenue > 0 ? round2((grossProfitMinor / by.revenue) * 100) : null,
    opexMinor: by.opex,
    operatingResultMinor,
    financingMinor: by.financing,
    taxMinor: by.tax,
    otherMinor: by.other,
    uncategorisedMinor: by.uncategorised,
    netMinor: operatingResultMinor + by.financing + by.tax + by.other + by.uncategorised,
  };
}
