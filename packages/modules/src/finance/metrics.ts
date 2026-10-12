/**
 * Pure finance arithmetic for the module screens (BUILD §11.8): metric definitions, the management P&L tree over the
 * standard chart of accounts, burn/runway helpers, the driver-based forecast, vesting, round modelling with SAFE
 * conversion and the two share-register exports. No React, no I/O; every function is deterministic so the
 * AC-11.8.1 / AC-11.8.4 fixtures can assert to the minor unit.
 */
import { formatDate } from "@foundmill/dugout/lib/format";
import type { DateFormatPrefs } from "@foundmill/dugout/lib/date-preferences";
import { usSpelling } from "@foundmill/shared/us-spelling";
import type { CapTableEntryRow, CapTableSummary, CategoryTotal, ForecastDrivers, ForecastPoint, ForecastScenario, MonthlyTotal, SecurityRow } from "./types";

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

/** "2026-09" → "Sep 2026" ("2026-09" for a person who reads ISO dates: pass their `prefs`). */
export function formatMonth(month: string, prefs?: DateFormatPrefs | null): string {
  return formatDate(`${month.slice(0, 7)}-01`, "monthYear", prefs);
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
  { category: "Financing", section: "financing", aliases: ["financing", "investment", "equity", "safe", "loan", "loan repayment", "grant", "funding", "founder loan", "share capital"] },
  { category: "Taxes", section: "tax", aliases: ["taxes", "tax", "vat", "corporation tax", "income tax", "payroll tax", "taxes and government"] },
  { category: "Transfers", section: "other", aliases: ["transfers", "transfer", "internal transfer", "between accounts"] },
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
/* Management P&L                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------------ */

export type PnlRowKind = "header" | "line" | "subtotal" | "total";

export interface PnlRow {
  id: string;
  label: string;
  depth: number;
  kind: PnlRowKind;
  /** Signed amount in minor units (inflows positive). Headers have null. */
  amountMinor: number | null;
  count: number;
  /** Percent of total revenue (null when revenue is 0 or the row is a header). */
  pctOfRevenue: number | null;
  /** The transaction category behind a line (for "show transactions" and recategorise). */
  category?: string | null;
  section?: PnlSection | "uncategorised";
  /** Lines in the uncategorised bucket carry a warning. */
  warn?: boolean;
}

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

/** The indented management P&L (DESIGN §9 Finance): section headers, category lines, subtotals and totals. */
export function buildPnl(categories: readonly CategoryTotal[]): PnlRow[] {
  const totals = pnlTotals(categories);
  const pct = (amount: number | null): number | null => (amount === null || totals.revenueMinor <= 0 ? null : round2((amount / totals.revenueMinor) * 100));
  const rows: PnlRow[] = [];
  // Categories that name the same chart line ("cost_of_goods" and "Cost of sales") are one line, not two.
  const lines = (section: PnlSection | "uncategorised") => {
    const byLabel = new Map<string, CategoryTotal>();
    for (const c of categories) {
      if (sectionOf(c.category) !== section) continue;
      const label = categoryLabel(c.category);
      const prev = byLabel.get(label);
      byLabel.set(label, prev ? { ...prev, inflowMinor: prev.inflowMinor + c.inflowMinor, outflowMinor: prev.outflowMinor + c.outflowMinor, count: prev.count + c.count } : { ...c });
    }
    return [...byLabel.values()]
      .map((c) => ({ c, net: categoryNet(c) }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || categoryLabel(a.c.category).localeCompare(categoryLabel(b.c.category)));
  };
  const pushSection = (section: PnlSection, subtotalLabel: string, amount: number) => {
    const ls = lines(section);
    rows.push({ id: `h-${section}`, label: PNL_SECTION_LABELS[section], depth: 0, kind: "header", amountMinor: null, count: ls.reduce((n, l) => n + l.c.count, 0), pctOfRevenue: null, section });
    for (const { c, net } of ls) {
      rows.push({ id: `l-${section}-${c.category}`, label: categoryLabel(c.category), depth: 1, kind: "line", amountMinor: net, count: c.count, pctOfRevenue: pct(net), category: c.category, section });
    }
    rows.push({ id: `s-${section}`, label: subtotalLabel, depth: 0, kind: "subtotal", amountMinor: amount, count: ls.reduce((n, l) => n + l.c.count, 0), pctOfRevenue: pct(amount), section });
  };

  pushSection("revenue", "Total revenue", totals.revenueMinor);
  pushSection("cogs", "Total cost of sales", totals.cogsMinor);
  rows.push({ id: "t-gross", label: "Gross profit", depth: 0, kind: "total", amountMinor: totals.grossProfitMinor, count: 0, pctOfRevenue: totals.grossMarginPct });
  pushSection("opex", "Total operating expenses", totals.opexMinor);
  rows.push({ id: "t-operating", label: "Operating result", depth: 0, kind: "total", amountMinor: totals.operatingResultMinor, count: 0, pctOfRevenue: pct(totals.operatingResultMinor) });
  if (lines("financing").length) pushSection("financing", "Total financing", totals.financingMinor);
  if (lines("tax").length) pushSection("tax", "Total taxes", totals.taxMinor);
  if (lines("other").length) pushSection("other", "Total other", totals.otherMinor);
  const unc = lines("uncategorised");
  if (unc.length) {
    rows.push({ id: "h-uncategorised", label: "Uncategorized", depth: 0, kind: "header", amountMinor: null, count: unc.reduce((n, l) => n + l.c.count, 0), pctOfRevenue: null, section: "uncategorised", warn: true });
    for (const { c, net } of unc) rows.push({ id: "l-uncategorised", label: "Uncategorized transactions", depth: 1, kind: "line", amountMinor: net, count: c.count, pctOfRevenue: pct(net), category: null, section: "uncategorised", warn: true });
  }
  rows.push({ id: "t-net", label: "Net cash change", depth: 0, kind: "total", amountMinor: totals.netMinor, count: categories.reduce((n, c) => n + c.count, 0), pctOfRevenue: pct(totals.netMinor) });
  return rows;
}

/** Flatten a ledger snapshot's `pnl` JSON into indented rows (nested objects become headers, numbers become lines). */
export function ledgerPnlRows(pnl: Record<string, unknown>, depth = 0, prefix = ""): PnlRow[] {
  const rows: PnlRow[] = [];
  const lines = Array.isArray(pnl.lines) ? (pnl.lines as unknown[]) : null;
  if (lines) {
    for (const [i, raw] of lines.entries()) {
      if (!raw || typeof raw !== "object") continue;
      const l = raw as Record<string, unknown>;
      const kind = l.kind === "subtotal" || l.kind === "total" || l.kind === "header" ? (l.kind as PnlRowKind) : "line";
      rows.push({ id: `${prefix}${i}`, label: String(l.label ?? l.name ?? `Line ${i + 1}`), depth: typeof l.depth === "number" ? l.depth : depth, kind, amountMinor: typeof l.amountMinor === "number" ? l.amountMinor : null, count: 0, pctOfRevenue: null });
    }
    return rows;
  }
  for (const [key, value] of Object.entries(pnl)) {
    const id = `${prefix}${key}`;
    if (typeof value === "number") rows.push({ id, label: plainWords(key), depth, kind: depth === 0 ? "subtotal" : "line", amountMinor: value, count: 0, pctOfRevenue: null });
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      rows.push({ id, label: plainWords(key), depth, kind: "header", amountMinor: null, count: 0, pctOfRevenue: null });
      rows.push(...ledgerPnlRows(value as Record<string, unknown>, depth + 1, `${id}.`));
    }
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Overview metrics                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------------ */

export type MetricKey = "cash" | "grossBurn" | "netBurn" | "runway" | "revenue" | "mrr" | "arr" | "grossMargin" | "acquisitionCost" | "payback";

/** The hover-visible definitions of BUILD §11.8, word for word where the spec gives them. */
export const METRIC_DEFINITIONS: Record<MetricKey, { label: string; definition: string }> = {
  cash: { label: "Cash in bank", definition: "Sum of the latest balances of every connected account in the base currency at the latest ECB rate." },
  grossBurn: { label: "Gross burn", definition: "Operating outflows per month, trailing 3-month average." },
  netBurn: { label: "Net burn", definition: "Operating outflows minus operating inflows, trailing 3-month average, financing excluded." },
  runway: { label: "Runway", definition: "Cash divided by net burn, plus the forecast-based runway from the Base scenario." },
  revenue: { label: "Revenue", definition: "From the ledger when one is connected, otherwise Stripe/Shopify and bank inflows labeled cash basis. Trailing 3 months." },
  mrr: { label: "MRR", definition: "Monthly recurring revenue: average monthly revenue over the trailing 3 months, cash basis." },
  arr: { label: "ARR", definition: "Annual recurring revenue: MRR × 12." },
  grossMargin: { label: "Gross margin", definition: "(Revenue − cost of sales) ÷ revenue over the trailing 3 months." },
  acquisitionCost: { label: "Acquisition cost", definition: "Channel spend ÷ new customers, blended across channels (per channel in the tooltip)." },
  payback: { label: "Payback", definition: "Acquisition cost ÷ monthly gross profit per customer." },
};

/** Cash at the end of each month, walked back from today's balance through the monthly net totals (oldest first). */
export function cashHistory(cashNowMinor: number, monthly: readonly MonthlyTotal[], months: readonly string[]): number[] {
  const byMonth = new Map(monthly.map((m) => [m.month, m.netMinor]));
  const out: number[] = [];
  let cash = cashNowMinor;
  for (let i = months.length - 1; i >= 0; i -= 1) {
    out.unshift(cash);
    cash -= byMonth.get(months[i]!) ?? 0;
  }
  return out;
}

/** A month's operating outflows (gross burn): financing and transfers left out when the API reports them apart. */
export function operatingOutflow(m: MonthlyTotal): number {
  return m.operatingOutflowMinor ?? m.outflowMinor;
}

/** A month's operating inflows (cash-basis revenue): a raise, a loan or a transfer in is not income. */
export function operatingInflow(m: MonthlyTotal): number {
  return m.operatingInflowMinor ?? m.inflowMinor;
}

/** A month's net burn (operating outflows − operating inflows); positive means burning. */
export function operatingBurn(m: MonthlyTotal): number {
  return operatingOutflow(m) - operatingInflow(m);
}

export function monthlySeries(monthly: readonly MonthlyTotal[], months: readonly string[], pick: (m: MonthlyTotal) => number): number[] {
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  return months.map((k) => {
    const m = byMonth.get(k);
    return m ? pick(m) : 0;
  });
}

export const RUNWAY_WARN_MONTHS: readonly number[] = [12, 9, 6];
export const RUNWAY_BLOCK_MONTHS = 3;

/** Thresholds a runway sits under, largest first ([12, 9] for 7.5 months; [] when unknown). */
export function runwayWarnings(months: number | null | undefined): number[] {
  if (months === null || months === undefined || !Number.isFinite(months)) return [];
  return [...RUNWAY_WARN_MONTHS, RUNWAY_BLOCK_MONTHS].filter((t) => months < t);
}

export function runwayTone(months: number | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (months === null || months === undefined || !Number.isFinite(months)) return "neutral";
  if (months < RUNWAY_BLOCK_MONTHS) return "bad";
  if (months < RUNWAY_WARN_MONTHS[0]!) return "warn";
  return "good";
}

export function runwayWord(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "Runway unknown";
  if (months < RUNWAY_BLOCK_MONTHS) return `Runway under ${RUNWAY_BLOCK_MONTHS} months`;
  const crossed = runwayWarnings(months).at(-1);
  return crossed ? `Runway under ${crossed} months` : "Runway healthy";
}

export interface AcquisitionInput {
  spendMinor: number;
  customers: number;
}

/** Blended acquisition cost in minor units (null without customers). */
export function acquisitionCost(input: AcquisitionInput | null | undefined): number | null {
  if (!input || input.customers <= 0) return null;
  return Math.round(input.spendMinor / input.customers);
}

/**
 * Payback in months = acquisition cost ÷ monthly gross profit per customer, where gross profit per customer is
 * MRR × gross margin ÷ paying customers. Null when any input is missing.
 */
export function paybackMonths(cpaMinor: number | null, mrrMinor: number, grossMarginPct: number | null, customers: number): number | null {
  if (cpaMinor === null || grossMarginPct === null || customers <= 0 || mrrMinor <= 0) return null;
  const gpPerCustomer = (mrrMinor * (grossMarginPct / 100)) / customers;
  if (gpPerCustomer <= 0) return null;
  return Math.round((cpaMinor / gpPerCustomer) * 10) / 10;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Driver-based forecast                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

export const DEFAULT_HORIZON_MONTHS = 24;

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Read a forecast's `drivers` JSON into the typed contract, filling gaps with defaults. */
export function readDrivers(raw: Record<string, unknown> | null | undefined, fallback: ForecastDrivers): ForecastDrivers {
  const d = raw ?? {};
  return {
    startingCashMinor: Math.round(num(d.startingCashMinor, fallback.startingCashMinor)),
    monthlyRevenueMinor: Math.round(num(d.monthlyRevenueMinor, fallback.monthlyRevenueMinor)),
    revenueGrowthPct: num(d.revenueGrowthPct, fallback.revenueGrowthPct),
    monthlyCostsMinor: Math.round(num(d.monthlyCostsMinor, fallback.monthlyCostsMinor)),
    costGrowthPct: num(d.costGrowthPct, fallback.costGrowthPct),
    horizonMonths: Math.max(1, Math.min(60, Math.round(num(d.horizonMonths, fallback.horizonMonths)))),
    runway_months: typeof d.runway_months === "number" ? d.runway_months : null,
  };
}

export interface ForecastProjection {
  series: ForecastPoint[];
  /** Months until cash reaches zero (fraction of a month interpolated); null when it stays positive to the horizon. */
  runwayMonths: number | null;
  /** The month cash first goes negative. */
  zeroMonth: string | null;
}

/** Project cash month by month: revenue and costs compound by their growth rates; cash = previous cash + net. */
export function projectForecast(drivers: ForecastDrivers, startMonth: string): ForecastProjection {
  const series: ForecastPoint[] = [];
  let cash = drivers.startingCashMinor;
  let revenue = drivers.monthlyRevenueMinor;
  let costs = drivers.monthlyCostsMinor;
  let runwayMonths: number | null = null;
  let zeroMonth: string | null = null;
  for (let i = 0; i < drivers.horizonMonths; i += 1) {
    const month = addMonths(startMonth, i);
    const r = Math.round(revenue);
    const c = Math.round(costs);
    const net = r - c;
    const before = cash;
    cash = before + net;
    series.push({ month, revenueMinor: r, costsMinor: c, netMinor: net, cashMinor: cash });
    if (runwayMonths === null && cash < 0) {
      const fraction = net < 0 ? before / -net : 0;
      runwayMonths = Math.round((i + Math.max(0, Math.min(1, fraction))) * 10) / 10;
      zeroMonth = month;
    }
    revenue *= 1 + drivers.revenueGrowthPct / 100;
    costs *= 1 + drivers.costGrowthPct / 100;
  }
  if (drivers.startingCashMinor < 0) {
    runwayMonths = 0;
    zeroMonth = startMonth;
  }
  return { series, runwayMonths, zeroMonth };
}

export interface SeedInputs {
  cashMinor: number;
  mrrMinor: number;
  grossBurnMinor: number;
}

/** Default drivers per scenario, seeded from the current cash, MRR and gross burn (BUILD §11.8 "seeded from…"). */
export function seedDrivers(scenario: ForecastScenario, seed: SeedInputs): ForecastDrivers {
  const base: ForecastDrivers = {
    startingCashMinor: Math.round(seed.cashMinor),
    monthlyRevenueMinor: Math.round(Math.max(0, seed.mrrMinor)),
    revenueGrowthPct: 5,
    monthlyCostsMinor: Math.round(Math.max(0, seed.grossBurnMinor)),
    costGrowthPct: 1,
    horizonMonths: DEFAULT_HORIZON_MONTHS,
  };
  if (scenario === "upside") return { ...base, revenueGrowthPct: 10, costGrowthPct: 1 };
  if (scenario === "downside") return { ...base, revenueGrowthPct: 0, costGrowthPct: 2 };
  return base;
}

/** Series points of a stored forecast as typed points (tolerates the older `{ month, cashMinor }`-only shape). */
export function readSeries(raw: readonly unknown[] | null | undefined): ForecastPoint[] {
  if (!raw) return [];
  const out: ForecastPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const month = typeof o.month === "string" ? o.month : typeof o.day === "string" ? o.day.slice(0, 7) : null;
    if (!month) continue;
    const revenueMinor = num(o.revenueMinor, 0);
    const costsMinor = num(o.costsMinor, 0);
    out.push({ month, revenueMinor, costsMinor, netMinor: num(o.netMinor, revenueMinor - costsMinor), cashMinor: num(o.cashMinor, num(o.baseMinor, 0)) });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Wage bill                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

/** Tasks completed per €100 (or 100 minor units of any currency) of cost; null without cost. */
export function outputPerHundred(tasksDone: number, costMinor: number): number | null {
  if (costMinor <= 0) return null;
  return Math.round((tasksDone / (costMinor / 10_000)) * 100) / 100;
}

export function capUsedPct(costMinor: number, capMinor: number | null): number | null {
  if (capMinor === null || capMinor <= 0) return null;
  return Math.round((costMinor / capMinor) * 1000) / 10;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Cap table                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface VestingSummary {
  totalMonths: number;
  cliffMonths: number;
  startDate: string | null;
  vestedPct: number;
  vestedQuantity: number;
  text: string;
}

const qty = (q: number | string | null | undefined): number => (q === null || q === undefined ? 0 : Number(q));

/**
 * Vesting state at `asOf` from the `{ months, cliffMonths, startDate }` JSON a cap-table entry carries. Monthly vesting
 * after the cliff; fully vested without a schedule.
 */
export function vestingSummary(vesting: Record<string, unknown> | null | undefined, quantity: number | string, asOf: Date): VestingSummary | null {
  if (!vesting) return null;
  const totalMonths = Math.max(0, Math.round(num(vesting.months ?? vesting.totalMonths, 48)));
  const cliffMonths = Math.max(0, Math.round(num(vesting.cliffMonths ?? vesting.cliff, 12)));
  const startDate = typeof vesting.startDate === "string" ? vesting.startDate : typeof vesting.start === "string" ? vesting.start : null;
  const q = qty(quantity);
  let vestedPct = 100;
  if (startDate && totalMonths > 0) {
    const start = new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`);
    const elapsed = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth()) - (asOf.getUTCDate() < start.getUTCDate() ? 1 : 0);
    vestedPct = elapsed < cliffMonths ? 0 : Math.max(0, Math.min(100, Math.round((Math.min(elapsed, totalMonths) / totalMonths) * 1000) / 10));
  }
  const years = totalMonths % 12 === 0 ? `${totalMonths / 12}y` : `${totalMonths}m`;
  const cliff = cliffMonths ? ` / ${cliffMonths % 12 === 0 ? `${cliffMonths / 12}y` : `${cliffMonths}m`} cliff` : "";
  return { totalMonths, cliffMonths, startDate, vestedPct, vestedQuantity: Math.round((q * vestedPct) / 100), text: `${years}${cliff} · ${vestedPct}% vested` };
}

export interface SafeTerms {
  principalMinor: number;
  valuationCapMinor: number | null;
  discountPct: number;
  kind: "safe" | "note";
}

/** Read the terms of a convertible position: the entry's price × quantity is the principal unless the terms say so. */
export function safeTerms(entry: CapTableEntryRow, security: SecurityRow | undefined): SafeTerms | null {
  if (entry.security.kind !== "safe" && entry.security.kind !== "note") return null;
  const t = { ...(security?.terms ?? {}), ...((entry.vesting as Record<string, unknown> | null) ?? {}) };
  const principal = num(t.principalMinor, qty(entry.quantity) * (entry.priceMinor ?? 1));
  const cap = typeof t.valuationCapMinor === "number" ? t.valuationCapMinor : typeof t.postMoneyCapMinor === "number" ? t.postMoneyCapMinor : null;
  return { principalMinor: Math.round(principal), valuationCapMinor: cap, discountPct: num(t.discountPct, 0), kind: entry.security.kind };
}

export interface RoundInput {
  preMoneyMinor: number;
  investmentMinor: number;
  /** Target unallocated option pool as a percent of the post-money fully diluted shares. */
  poolTargetPct: number;
  /** Name of the new class (display only). */
  newClass?: string;
}

export interface ProFormaRow {
  id: string;
  name: string;
  kind: "holder" | "pool" | "safe" | "investor";
  beforeQuantity: number;
  beforePct: number;
  afterQuantity: number;
  afterPct: number;
}

export interface RoundModel {
  label: "Estimate";
  postMoneyMinor: number;
  /** Price per share in minor units (fractional allowed). */
  pricePerShareMinor: number;
  newShares: number;
  safeShares: number;
  poolTopUpShares: number;
  preRoundFullyDiluted: number;
  postRoundFullyDiluted: number;
  investorPct: number;
  rows: ProFormaRow[];
  conversions: { entryId: string; holder: string; principalMinor: number; method: "cap" | "discount" | "price"; conversionPriceMinor: number; shares: number }[];
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const pct2 = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 10_000) / 100 : 0);

/**
 * Pro forma for a priced round (BUILD §11.8 round modelling):
 * 1. post-money SAFEs convert first at principal ÷ cap of the pre-round capitalisation (shares = pct × existing ÷ (1 − Σpct));
 * 2. the option pool is topped up so the unallocated pool is `poolTargetPct` of the post-money fully diluted shares;
 * 3. the round price is pre-money ÷ (existing + SAFE shares + pool top-up); discount-only SAFEs and notes convert at
 *    price × (1 − discount) (a capped SAFE takes whichever of cap or discount gives more shares);
 * 4. new shares = investment ÷ price.
 */
export function modelRound(cap: { securities: readonly SecurityRow[]; entries: readonly CapTableEntryRow[]; summary: CapTableSummary }, input: RoundInput): RoundModel {
  const securities = new Map(cap.securities.map((s) => [s.id, s]));
  const equity = cap.entries.filter((e) => e.security.kind !== "safe" && e.security.kind !== "note");
  const convertibles = cap.entries.filter((e) => e.security.kind === "safe" || e.security.kind === "note");
  const existing = equity.reduce((n, e) => n + qty(e.quantity), 0);
  const poolSecurities = cap.securities.filter((s) => s.kind === "option");
  const poolIssued = equity.filter((e) => e.security.kind === "option").reduce((n, e) => n + qty(e.quantity), 0);
  const poolAuthorised = poolSecurities.reduce((n, s) => n + (s.authorisedQuantity === null ? 0 : Number(s.authorisedQuantity)), 0);
  const poolAvailable = Math.max(0, poolAuthorised - poolIssued);
  const preRoundBase = existing + poolAvailable;

  // 1. capped SAFEs (post-money method)
  const capped = convertibles.map((e) => ({ e, terms: safeTerms(e, securities.get(e.securityId)) })).filter((x): x is { e: CapTableEntryRow; terms: SafeTerms } => !!x.terms);
  const capPct = capped.map(({ terms }) => (terms.valuationCapMinor && terms.valuationCapMinor > 0 ? terms.principalMinor / terms.valuationCapMinor : 0));
  const sumPct = capPct.reduce((a, b) => a + b, 0);
  const denom = Math.max(1e-9, 1 - sumPct);
  const capShares = capPct.map((p) => (p > 0 ? r4((p * preRoundBase) / denom) : 0));
  const capSharesTotal = capShares.reduce((a, b) => a + b, 0);

  // 2. pool top-up so the unallocated pool is poolTargetPct of post-money FD
  const k = 1 + input.investmentMinor / input.preMoneyMinor;
  const p = Math.max(0, Math.min(0.5, input.poolTargetPct / 100));
  const pre = preRoundBase + capSharesTotal;
  const topUp = p > 0 ? Math.max(0, r4((p * k * pre - poolAvailable) / (1 - p * k))) : 0;

  // 3. price and discount conversions
  const preRoundFullyDiluted = pre + topUp;
  const price = input.preMoneyMinor / preRoundFullyDiluted;
  const conversions: RoundModel["conversions"] = [];
  let safeShares = 0;
  capped.forEach(({ e, terms }, i) => {
    const discountPrice = terms.discountPct > 0 ? price * (1 - terms.discountPct / 100) : price;
    const discountShares = r4(terms.principalMinor / discountPrice);
    const viaCap = capShares[i] ?? 0;
    const useCap = viaCap > discountShares;
    const shares = useCap ? viaCap : discountShares;
    safeShares += shares;
    conversions.push({ entryId: e.id, holder: e.holder.displayName, principalMinor: terms.principalMinor, method: useCap ? "cap" : terms.discountPct > 0 ? "discount" : "price", conversionPriceMinor: r4(terms.principalMinor / shares), shares });
  });

  // 4. new money
  const newShares = r4(input.investmentMinor / price);
  const postRoundFullyDiluted = preRoundBase + topUp + safeShares + newShares;

  const rows: ProFormaRow[] = [];
  const before = new Map<string, { name: string; q: number }>();
  for (const e of equity) {
    const h = before.get(e.holderEntityId) ?? { name: e.holder.displayName, q: 0 };
    h.q += qty(e.quantity);
    before.set(e.holderEntityId, h);
  }
  const preTotal = preRoundBase;
  for (const [id, h] of before) rows.push({ id, name: h.name, kind: "holder", beforeQuantity: h.q, beforePct: pct2(h.q, preTotal), afterQuantity: h.q, afterPct: pct2(h.q, postRoundFullyDiluted) });
  const safeByHolder = new Map<string, { name: string; q: number; principal: number }>();
  capped.forEach(({ e, terms }, i) => {
    const conv = conversions[i]!;
    const h = safeByHolder.get(e.holderEntityId) ?? { name: e.holder.displayName, q: 0, principal: 0 };
    h.q += conv.shares;
    h.principal += terms.principalMinor;
    safeByHolder.set(e.holderEntityId, h);
  });
  for (const [id, h] of safeByHolder) rows.push({ id: `safe-${id}`, name: `${h.name} (converted)`, kind: "safe", beforeQuantity: 0, beforePct: 0, afterQuantity: h.q, afterPct: pct2(h.q, postRoundFullyDiluted) });
  rows.push({ id: "pool", name: "Option pool (unallocated)", kind: "pool", beforeQuantity: poolAvailable, beforePct: pct2(poolAvailable, preTotal), afterQuantity: r4(poolAvailable + topUp), afterPct: pct2(poolAvailable + topUp, postRoundFullyDiluted) });
  rows.push({ id: "investor", name: input.newClass ?? "New investors", kind: "investor", beforeQuantity: 0, beforePct: 0, afterQuantity: newShares, afterPct: pct2(newShares, postRoundFullyDiluted) });
  rows.sort((a, b) => b.afterQuantity - a.afterQuantity);

  return {
    label: "Estimate",
    postMoneyMinor: input.preMoneyMinor + input.investmentMinor,
    pricePerShareMinor: r4(price),
    newShares,
    safeShares: r4(safeShares),
    poolTopUpShares: topUp,
    preRoundFullyDiluted: r4(preRoundFullyDiluted),
    postRoundFullyDiluted: r4(postRoundFullyDiluted),
    investorPct: pct2(newShares, postRoundFullyDiluted),
    rows,
    conversions,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Share registers                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------------ */

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

const fmtMajor = (minor: number | null, currency: string) => (minor === null ? "" : `${(minor / 100).toFixed(2)} ${currency}`);

/** Delaware stock ledger (DGCL §219 style): one row per issuance with certificate number, class, holder, shares, consideration. */
export function delawareLedgerRows(entries: readonly CapTableEntryRow[], asOf: Date): (string | number)[][] {
  const header = ["Certificate No.", "Date of issue", "Stockholder", "Stockholder kind", "Class / series", "Kind", "Number of shares", "Price per share", "Consideration paid", "Vesting", "Status"];
  const rows = [...entries]
    .filter((e) => e.security.kind !== "safe" && e.security.kind !== "note")
    .sort((a, b) => (a.issuedAt ?? "").localeCompare(b.issuedAt ?? "") || a.holder.displayName.localeCompare(b.holder.displayName))
    .map((e, i) => {
      const q = qty(e.quantity);
      const v = vestingSummary(e.vesting, q, asOf);
      return [`C-${String(i + 1).padStart(4, "0")}`, e.issuedAt ?? "", e.holder.displayName, e.holder.kind, e.security.class, e.security.kind, q, fmtMajor(e.priceMinor, e.currency), fmtMajor(e.priceMinor === null ? null : Math.round(e.priceMinor * q), e.currency), v ? v.text : "Fully vested", e.archivedAt ? "Canceled" : "Outstanding"];
    });
  return [header, ...rows];
}

/** Swedish aktiebok (ABL 5 kap.): share numbers in sequence per class, holder, date entered, class and notes. */
export function aktiebokRows(entries: readonly CapTableEntryRow[]): (string | number)[][] {
  const header = ["Aktienummer (från)", "Aktienummer (till)", "Antal aktier", "Aktieslag", "Aktieägare", "Ägartyp", "Införd i aktieboken", "Teckningskurs", "Anteckningar"];
  let next = 1;
  const rows = [...entries]
    .filter((e) => e.security.kind === "common" || e.security.kind === "preferred")
    .sort((a, b) => a.security.class.localeCompare(b.security.class) || (a.issuedAt ?? "").localeCompare(b.issuedAt ?? ""))
    .map((e) => {
      const q = Math.round(qty(e.quantity));
      const from = next;
      const to = next + q - 1;
      next = to + 1;
      return [from, to, q, e.security.class, e.holder.displayName, e.holder.kind === "organisation" ? "Juridisk person" : "Fysisk person", e.issuedAt ?? "", fmtMajor(e.priceMinor, e.currency), e.vesting ? "Förbehåll: intjäning" : ""];
    });
  return [header, ...rows];
}
