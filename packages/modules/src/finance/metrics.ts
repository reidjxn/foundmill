/**
 * Pure finance arithmetic for the module screens (BUILD §11.8): metric definitions, the management P&L tree over the
 * standard chart of accounts, burn/runway helpers, the driver-based forecast, vesting, round modelling with SAFE
 * conversion and the two share-register exports. No React, no I/O; every function is deterministic so the
 * AC-11.8.1 / AC-11.8.4 fixtures can assert to the minor unit.
 */
import { formatDate, formatMoney } from "@foundmill/dugout/lib/format";
import type { DateFormatPrefs } from "@foundmill/dugout/lib/date-preferences";
import { projectForecast, type ForecastProjection } from "@foundmill/shared/forecast";
import { readVesting } from "@foundmill/shared/vesting";
import type { CapTableEntryRow, CapTableSummary, CategoryTotal, ForecastDrivers, ForecastPoint, ForecastScenario, MonthlyTotal, SecurityRow } from "./types";
import { categoryLabel, categoryNet, plainWords, pnlTotals, sectionOf, PNL_SECTION_LABELS, type PnlSection } from "./pnl";

export * from "./pnl";

/* ------------------------------------------------------------------------------------------------------------------ */
/* Months                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

/** "2026-09" → "Sep 2026" ("2026-09" for a person who reads ISO dates: pass their `prefs`). */
export function formatMonth(month: string, prefs?: DateFormatPrefs | null): string {
  return formatDate(`${month.slice(0, 7)}-01`, "monthYear", prefs);
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

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/**
 * The ten tiles' labels and hover definitions (BUILD §11.8; UX plan §7.14, C6): every abbreviation is spelled out on
 * first use, every definition says what the number means in plain words, then the formula after a semicolon. `term`
 * is the definitions map's id for the label (a `Term`) and the tile's plain line (`PlainFigure` reads `TERMS[term].short`
 * while guidance is on); a metric the map does not define (cash, revenue) keeps `plainLine` for its line instead.
 */
export const METRIC_DEFINITIONS: Record<MetricKey, { label: string; definition: string; term?: string }> = {
  cash: { label: "Cash in bank", definition: "What is in every connected bank account today, added up in your currency; the latest balances, converted at the latest ECB rate." },
  grossBurn: { label: "Gross burn (spending per month)", definition: "What the business spends in a typical month; operating outflows, trailing 3-month average.", term: "gross_burn" },
  netBurn: { label: "Net burn (spending beyond income)", definition: "How much more you spend than you earn in a typical month; operating outflows minus operating inflows, trailing 3-month average, financing excluded.", term: "net_burn" },
  runway: { label: "Runway", definition: "How many months your cash lasts at today's spending; cash ÷ net burn, plus the Base forecast's own runway.", term: "runway" },
  revenue: { label: "Revenue", definition: "What customers paid you in the last 3 months; from the ledger when one is connected, otherwise Stripe, Shopify and bank inflows, counted when the cash moves." },
  mrr: { label: "Monthly recurring revenue (MRR)", definition: "What you earn from customers in a typical month; average monthly revenue over the trailing 3 months, counted when the cash moves.", term: "mrr" },
  arr: { label: "Annual recurring revenue (ARR)", definition: "What a year of today's monthly revenue adds up to; MRR × 12.", term: "arr" },
  grossMargin: { label: "Gross margin", definition: "The share of revenue left after the direct cost of what you sell; (revenue − cost of sales) ÷ revenue, trailing 3 months.", term: "gross_margin" },
  acquisitionCost: { label: "Cost to win a customer", definition: "What it costs, on average, to win one new customer; channel spend ÷ new customers, blended across channels (per channel in the tooltip).", term: "acquisition_cost" },
  payback: { label: "Payback (months to earn back a customer's cost)", definition: "How many months a new customer takes to earn back what it cost to win them; cost to win a customer ÷ monthly gross profit per customer.", term: "payback" },
};

/** The plain-words half of a definition (before the formula's semicolon), as a tile's line under its figure. */
export function plainLine(key: MetricKey): string {
  const text = METRIC_DEFINITIONS[key].definition;
  const i = text.indexOf(";");
  return i < 0 ? text : `${text.slice(0, i).trim()}.`;
}

/**
 * The P&L's source label in plain words: the API's "Management P&L, unaudited, cash basis" reads "Management view,
 * unaudited, cash basis: counted when the cash moves"; any other label (a ledger's own) passes through.
 */
// plain-allow: the API's label, matched here and never shown (pnlLabelWords swaps it for PNL_CASH_BASIS_WORDS).
export const PNL_CASH_BASIS_LABEL = "Management P&L, unaudited, cash basis";
export const PNL_CASH_BASIS_WORDS = "Management view, unaudited, cash basis: counted when the cash moves";
export function pnlLabelWords(label: string | null | undefined): string {
  if (!label) return PNL_CASH_BASIS_WORDS;
  return label.trim() === PNL_CASH_BASIS_LABEL ? PNL_CASH_BASIS_WORDS : label;
}

export interface FinanceSummaryInput {
  /** Cash in bank, minor units. */
  cashMinor: number;
  /** Connected bank accounts; none means the figures are not known. */
  accounts: number;
  /** Net burn, minor units: positive when burning, negative when cash-flow positive. */
  netBurnMinor: number;
  /** Runway in months, null when it cannot be measured yet. */
  runwayMonths: number | null;
  currency: string;
}

/**
 * Money as a sentence says it: "£72K", "£9K", "£1.5M", "£950" (whole thousands, one decimal from a million up), with the
 * narrow symbol of the business's currency; the shared compact formatter keeps "£9,000" under ten thousand.
 */
export function sentenceMoney(amountMinor: number, currency: string): string {
  const major = Math.abs(amountMinor) / 100;
  try {
    const compact = major >= 1000;
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: compact ? "compact" : "standard", maximumFractionDigits: major >= 1_000_000 ? 1 : 0 }).format(major);
  } catch {
    return formatMoney({ amountMinor: Math.abs(Math.round(amountMinor)), currency }, { compact: true });
  }
}

/** "about 8 months" / "about 1 month" / "under a month". */
export function runwayPhrase(months: number): string {
  if (months < 1) return "under a month";
  const n = Math.round(months);
  return `about ${n} month${n === 1 ? "" : "s"}`;
}

/**
 * One plain sentence above the Finance tiles, composed from the same data (UX plan §7.14, C6): "You have £72K in the
 * bank and spend £9K more than you earn each month, so cash lasts about 8 months (Estimate)." With no bank it says so;
 * cash-flow positive and break-even businesses get their own sentence.
 */
export function financeSummarySentence(input: FinanceSummaryInput): string {
  if (input.accounts <= 0) return "No bank is connected yet, so how much cash you have and how long it lasts are not known.";
  const money = (minor: number) => sentenceMoney(minor, input.currency);
  // A balance below zero has no runway to count (the tile reads "Cash is below zero"): say so, never "you have €2.5K".
  if (input.cashMinor < 0) return `Your bank balance is ${money(input.cashMinor)} below zero, so there is no runway to count (Estimate).`;
  const cash = `You have ${money(input.cashMinor)} in the bank`;
  if (input.netBurnMinor > 0) {
    const burn = `spend ${money(input.netBurnMinor)} more than you earn each month`;
    if (input.runwayMonths === null || !Number.isFinite(input.runwayMonths)) return `${cash} and ${burn}; how long it lasts is not known yet (Estimate).`;
    return `${cash} and ${burn}, so cash lasts ${runwayPhrase(input.runwayMonths)} (Estimate).`;
  }
  if (input.netBurnMinor < 0) return `${cash} and earn ${money(input.netBurnMinor)} more than you spend each month, so cash is growing (Estimate).`;
  return `${cash} and spend about what you earn each month, so cash holds steady (Estimate).`;
}

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
    // `monthlyOutflowMinor` is the key forecasts were seeded with before the contract was settled.
    monthlyCostsMinor: Math.round(num(d.monthlyCostsMinor, num(d.monthlyOutflowMinor, fallback.monthlyCostsMinor))),
    costGrowthPct: num(d.costGrowthPct, fallback.costGrowthPct),
    horizonMonths: Math.max(1, Math.min(60, Math.round(num(d.horizonMonths, fallback.horizonMonths)))),
    runway_months: typeof d.runway_months === "number" ? d.runway_months : null,
  };
}

// The projection is shared with the seeds and the api (packages/shared/src/forecast.ts), so a stored series and the
// screens' projection of the same drivers are one computation.
export { projectForecast, type ForecastProjection };

/**
 * A stored forecast version as every screen draws it: its drivers projected over its own months (the Overview's
 * dashed Base line and the Runway tab are one computation). A version written without the driver contract (an older
 * agent or import) is drawn from its stored series. Null without a version.
 */
export function storedProjection(row: { drivers?: unknown; series?: readonly unknown[] | null } | null | undefined, fallback: ForecastDrivers, thisMonth: string): ForecastProjection | null {
  if (!row) return null;
  const raw = (row.drivers && typeof row.drivers === "object" ? row.drivers : {}) as Record<string, unknown>;
  if (typeof raw.startingCashMinor !== "number") {
    const series = readSeries(row.series ?? null);
    const firstBelow = series.find((p) => p.cashMinor < 0);
    return { series, runwayMonths: typeof raw.runway_months === "number" ? raw.runway_months : null, zeroMonth: firstBelow?.month ?? null };
  }
  return projectForecast(readDrivers(raw, fallback), forecastStartMonth(row, thisMonth));
}

/**
 * The month a forecast version starts: its stored series' first month (a saved version keeps the months it was
 * projected over), else `fallback` (this month, for drivers that were never saved).
 */
export function forecastStartMonth(row: { series?: readonly unknown[] | null } | null | undefined, fallback: string): string {
  return readSeries(row?.series ?? null)[0]?.month ?? fallback;
}

/** "5% growth, costs up 1% a month" from the drivers themselves (never a fixed description of the defaults). */
export function driversHint(d: ForecastDrivers): string {
  const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
  const revenue = d.revenueGrowthPct === 0 ? "flat revenue" : d.revenueGrowthPct > 0 ? `revenue up ${pct(d.revenueGrowthPct)}` : `revenue down ${pct(-d.revenueGrowthPct)}`;
  const costs = d.costGrowthPct === 0 ? "flat costs" : d.costGrowthPct > 0 ? `costs up ${pct(d.costGrowthPct)}` : `costs down ${pct(-d.costGrowthPct)}`;
  return `${revenue} and ${costs} a month, over ${d.horizonMonths} month${d.horizonMonths === 1 ? "" : "s"}`;
}

/**
 * What a scenario's runway is, in words the founder can act on:
 * - `unknown`: there is nothing to project from yet (no bank, too little history, nothing saved or typed), so the
 *   shared "Not known yet" wording and its reason, the same as Home's status strip;
 * - `months`: cash runs out within the horizon;
 * - `no_limit`: cash-flow positive every projected month;
 * - `beyond`: burning, but cash lasts past the horizon.
 */
export type ScenarioRunway =
  | { kind: "unknown"; value: string; caption: string }
  | { kind: "months"; months: number }
  | { kind: "no_limit" }
  | { kind: "beyond"; horizonMonths: number };

export function scenarioRunway(projection: ForecastProjection, drivers: ForecastDrivers, unknown: { value: string; caption: string } | null): ScenarioRunway {
  if (unknown) return { kind: "unknown", ...unknown };
  if (projection.runwayMonths !== null) return { kind: "months", months: projection.runwayMonths };
  if (drivers.startingCashMinor === 0 && drivers.monthlyRevenueMinor === 0 && drivers.monthlyCostsMinor === 0) return { kind: "unknown", value: "Not known yet", caption: "Enter cash, revenue and costs to project it" };
  if (projection.series.every((p) => p.netMinor >= 0)) return { kind: "no_limit" };
  return { kind: "beyond", horizonMonths: drivers.horizonMonths };
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
  /** Null when neither the schedule nor the issuance says when vesting started. */
  vestedPct: number | null;
  vestedQuantity: number | null;
  text: string;
}

const qty = (q: number | string | null | undefined): number => (q === null || q === undefined ? 0 : Number(q));

/**
 * Vesting state at `asOf` from the `{ months, cliffMonths, startDate }` schedule a cap-table entry carries (the shared
 * `VestingSchedule`; older rows' `{ schedule: "4y", startsAt }` are read too). Monthly vesting after the cliff, counted
 * from the schedule's start or else the entry's issue date; a schedule with no start at all is never shown as vested.
 * Null for an entry without vesting (fully vested at issue).
 */
export function vestingSummary(vesting: Record<string, unknown> | null | undefined, quantity: number | string, asOf: Date, issuedAt?: string | null): VestingSummary | null {
  const terms = readVesting(vesting, issuedAt);
  if (!terms) return null;
  const { months: totalMonths, cliffMonths, startDate } = terms;
  const q = qty(quantity);
  let vestedPct: number | null = null;
  if (startDate) {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const elapsed = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth()) - (asOf.getUTCDate() < start.getUTCDate() ? 1 : 0);
    vestedPct = elapsed < cliffMonths ? 0 : Math.max(0, Math.min(100, Math.round((Math.min(elapsed, totalMonths) / totalMonths) * 1000) / 10));
  }
  const years = totalMonths % 12 === 0 ? `${totalMonths / 12}y` : `${totalMonths}m`;
  const cliff = cliffMonths ? ` / ${cliffMonths % 12 === 0 ? `${cliffMonths / 12}y` : `${cliffMonths}m`} cliff` : "";
  const state = vestedPct === null ? "start date unknown" : `${vestedPct}% vested`;
  return { totalMonths, cliffMonths, startDate, vestedPct, vestedQuantity: vestedPct === null ? null : Math.round((q * vestedPct) / 100), text: `${years}${cliff} · ${state}` };
}

/** The currency a position's price and principal are in: its share class's, which every price is denominated in. */
export function entryCurrency(entry: Pick<CapTableEntryRow, "currency">, security: Pick<SecurityRow, "currency"> | undefined): string {
  return security?.currency || entry.currency;
}

const HOLDER_KIND_WORDS: Record<string, string> = { person: "Person", organisation: "Organization", team_member: "Team member", agent: "Agent" };

/** A holder's entity kind in words ("organisation" → "Organization"), never the stored enum. */
export function holderKindWord(kind: string): string {
  return HOLDER_KIND_WORDS[kind] ?? plainWords(kind);
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
 * 1. post-money SAFEs convert at principal ÷ cap of the pre-round capitalization (shares = pct × existing ÷ (1 − Σpct));
 * 2. discount-only SAFEs and notes convert at price × (1 − discount), and a capped SAFE takes whichever of cap or
 *    discount gives more shares;
 * 3. the option pool is topped up so the unallocated pool is `poolTargetPct` of the post-money fully diluted shares;
 * 4. the round price is pre-money ÷ pre-round fully diluted, where pre-round fully diluted is everything before the
 *    new money: existing shares and options, the unallocated pool, every SAFE's conversion shares and the top-up;
 * 5. new shares = investment ÷ price.
 * The price, the discount conversions and the top-up depend on each other, so they are solved together (each step is
 * linear in the pre-round total once every capped SAFE's cap-or-discount choice is fixed, and those choices only move
 * from cap to discount as the total grows). The new investor therefore holds exactly investment ÷ post-money, the
 * post-money is price × post-round fully diluted, and the pool lands on its target. Shares are whole: conversions and
 * new shares round down, the top-up to the nearest share.
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

  // 1. capped SAFEs (post-money method): fixed share counts, whatever the round's price.
  const safes = convertibles.map((e) => ({ e, terms: safeTerms(e, securities.get(e.securityId)) })).filter((x): x is { e: CapTableEntryRow; terms: SafeTerms } => !!x.terms);
  const capPct = safes.map(({ terms }) => (terms.valuationCapMinor && terms.valuationCapMinor > 0 ? terms.principalMinor / terms.valuationCapMinor : 0));
  const sumPct = capPct.reduce((a, b) => a + b, 0);
  const denom = Math.max(1e-9, 1 - sumPct);
  const capShares = capPct.map((p) => (p > 0 ? Math.floor((p * preRoundBase) / denom) : 0));

  // 2–4. price, discount conversions and the pool top-up, solved together.
  const k = 1 + input.investmentMinor / input.preMoneyMinor;
  const p = Math.max(0, Math.min(0.5, input.poolTargetPct / 100));
  const discountFactor = (t: SafeTerms) => 1 - Math.min(99, Math.max(0, t.discountPct)) / 100;
  const viaDiscount = safes.map((_, i) => !(capShares[i]! > 0));
  let preRoundFullyDiluted = preRoundBase;
  for (let round = 0; round <= safes.length; round += 1) {
    // Money that converts at the round price (Σ principal ÷ (1 − discount)), and the shares that do not depend on it.
    const discountMoney = safes.reduce((n, { terms }, i) => (viaDiscount[i] ? n + terms.principalMinor / discountFactor(terms) : n), 0);
    const fixedShares = preRoundBase + capShares.reduce((n, c, i) => (viaDiscount[i] ? n : n + c), 0);
    const share = discountMoney / input.preMoneyMinor; // discount shares per pre-round share
    const withoutTopUp = fixedShares / Math.max(1e-9, 1 - share);
    const needsTopUp = p > 0 && poolAvailable < p * k * withoutTopUp;
    preRoundFullyDiluted = needsTopUp ? (fixedShares - poolAvailable) / Math.max(1e-9, 1 - p * k - share) : withoutTopUp;
    const price = input.preMoneyMinor / preRoundFullyDiluted;
    let moved = false;
    safes.forEach(({ terms }, i) => {
      if (!viaDiscount[i] && terms.principalMinor / (price * discountFactor(terms)) > capShares[i]!) {
        viaDiscount[i] = true;
        moved = true;
      }
    });
    if (!moved) break;
  }

  const price = input.preMoneyMinor / preRoundFullyDiluted;
  const conversions: RoundModel["conversions"] = [];
  let safeShares = 0;
  safes.forEach(({ e, terms }, i) => {
    const shares = viaDiscount[i] ? Math.floor(terms.principalMinor / (price * discountFactor(terms))) : capShares[i]!;
    safeShares += shares;
    conversions.push({ entryId: e.id, holder: e.holder.displayName, principalMinor: terms.principalMinor, method: !viaDiscount[i] ? "cap" : terms.discountPct > 0 ? "discount" : "price", conversionPriceMinor: shares > 0 ? r4(terms.principalMinor / shares) : 0, shares });
  });
  const topUp = Math.max(0, Math.round(preRoundFullyDiluted - preRoundBase - safeShares));
  const preRound = preRoundBase + safeShares + topUp;

  // 5. new money
  const newShares = Math.floor(input.investmentMinor / price);
  const postRoundFullyDiluted = preRound + newShares;

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
  safes.forEach(({ e, terms }, i) => {
    const conv = conversions[i]!;
    const h = safeByHolder.get(e.holderEntityId) ?? { name: e.holder.displayName, q: 0, principal: 0 };
    h.q += conv.shares;
    h.principal += terms.principalMinor;
    safeByHolder.set(e.holderEntityId, h);
  });
  for (const [id, h] of safeByHolder) rows.push({ id: `safe-${id}`, name: `${h.name} (converted)`, kind: "safe", beforeQuantity: 0, beforePct: 0, afterQuantity: h.q, afterPct: pct2(h.q, postRoundFullyDiluted) });
  rows.push({ id: "pool", name: "Option pool (unallocated)", kind: "pool", beforeQuantity: poolAvailable, beforePct: pct2(poolAvailable, preTotal), afterQuantity: poolAvailable + topUp, afterPct: pct2(poolAvailable + topUp, postRoundFullyDiluted) });
  rows.push({ id: "investor", name: input.newClass ?? "New investors", kind: "investor", beforeQuantity: 0, beforePct: 0, afterQuantity: newShares, afterPct: pct2(newShares, postRoundFullyDiluted) });
  rows.sort((a, b) => b.afterQuantity - a.afterQuantity);

  return {
    // plain-allow: a provenance tag typed as the literal "Estimate" (RoundModel), never rendered as text.
    label: "Estimate",
    postMoneyMinor: input.preMoneyMinor + input.investmentMinor,
    pricePerShareMinor: r4(price),
    newShares,
    safeShares,
    poolTopUpShares: topUp,
    preRoundFullyDiluted: preRound,
    postRoundFullyDiluted,
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

/**
 * Delaware stock ledger (DGCL §219 style): one row per issuance with certificate number, class, holder, shares,
 * consideration. Prices are in each share class's currency; the holder's kind is in words.
 */
export function delawareLedgerRows(entries: readonly CapTableEntryRow[], asOf: Date, securities: readonly SecurityRow[] = []): (string | number)[][] {
  const byId = new Map(securities.map((s) => [s.id, s]));
  const header = ["Certificate No.", "Date of issue", "Stockholder", "Stockholder kind", "Class / series", "Kind", "Number of shares", "Price per share", "Consideration paid", "Vesting", "Status"];
  const rows = [...entries]
    .filter((e) => e.security.kind !== "safe" && e.security.kind !== "note")
    .sort((a, b) => (a.issuedAt ?? "").localeCompare(b.issuedAt ?? "") || a.holder.displayName.localeCompare(b.holder.displayName))
    .map((e, i) => {
      const q = qty(e.quantity);
      const v = vestingSummary(e.vesting, q, asOf, e.issuedAt);
      const currency = entryCurrency(e, byId.get(e.securityId));
      return [`C-${String(i + 1).padStart(4, "0")}`, e.issuedAt ?? "", e.holder.displayName, holderKindWord(e.holder.kind), e.security.class, e.security.kind, q, fmtMajor(e.priceMinor, currency), fmtMajor(e.priceMinor === null ? null : Math.round(e.priceMinor * q), currency), v ? v.text : "Fully vested", e.archivedAt ? "Canceled" : "Outstanding"];
    });
  return [header, ...rows];
}

/** Swedish aktiebok (ABL 5 kap.): share numbers in sequence per class, holder, date entered, class and notes. */
export function aktiebokRows(entries: readonly CapTableEntryRow[], securities: readonly SecurityRow[] = []): (string | number)[][] {
  const byId = new Map(securities.map((s) => [s.id, s]));
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
      return [from, to, q, e.security.class, e.holder.displayName, e.holder.kind === "organisation" ? "Juridisk person" : "Fysisk person", e.issuedAt ?? "", fmtMajor(e.priceMinor, entryCurrency(e, byId.get(e.securityId))), e.vesting ? "Förbehåll: intjäning" : ""];
    });
  return [header, ...rows];
}
