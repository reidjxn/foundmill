/**
 * Milestones from real events (BUILD §11.4 trophy cabinet; audit JM-03, GTM-03, VGTM-X1).
 *
 * The trophy definitions and their crossing rule are `@foundmill/journey`'s (`TROPHIES`, `detectTrophies`), the same the
 * demo generator uses. The counters:
 * - customers: first payments (0034 `first_payment`); a renewal or a repeat order is revenue, not a customer;
 * - enterprise contracts: first payments at or above `ENTERPRISE_CONTRACT_MIN_MINOR`;
 * - monthly revenue (the `mrr_*` trophies): Finance's monthly figure, one fact from one function (DECISIONS
 *   2026-11-11): the P&L revenue of the last 3 full calendar months ÷ 3 (`monthlyRevenueWindow`,
 *   `monthlyRevenueFromCategories` in @foundmill/shared, over `repos.finance.categoryTotals`, the sums `finance.pnl`
 *   returns), in the money Finance shows it in. It moves only when a month ends (or a past month's transactions
 *   arrive), so a revenue trophy is reached on the first day of the month whose window first passes its threshold. It
 *   is an Estimate (`ref.estimate`) and is named "MRR" only when the business's revenue recurs, "monthly revenue"
 *   otherwise (`revenueIsRecurring`, as Finance names its tile).
 *
 * `awardMilestonesForConversion` runs where a payment arrives (ingest, in the delivery's transaction) and again in the
 * journey build: the customer and enterprise trophies. `catchUpMilestones` (the nightly sweep) replays every payment in
 * order for those and replays the months for the revenue trophies (`awardRevenueMilestones`), so a milestone a writer
 * missed is still awarded with the moment it was reached. Every award goes through `repos.journeys.awardMilestone`:
 * each trophy at most once per business, whoever writes first. Rows awarded before 2026-11-11 under the old
 * trailing-30-day-payments rule (`ref.basis: "trailing_30_day_revenue"`) are never rewritten: the definition applies to
 * trophies reached from now on.
 */
import { detectTrophies, ENTERPRISE_CONTRACT_MIN_MINOR, TROPHIES, type Milestone as TrophyMilestone, type TrophyCounters, type TrophyKey } from "@foundmill/journey";
import { MONTHLY_REVENUE_MONTHS, monthlyRevenueFromCategories, monthlyRevenueMinor, monthlyRevenueWindow, revenueIsRecurring } from "@foundmill/shared";
import { pnlTotals } from "@foundmill/shared/pnl";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { Milestone } from "./schema";

/** What a revenue milestone's `ref` says about its figure (with `value`, the monthly figure that reached it). */
export const MONTHLY_REVENUE_REF = { estimate: true, basis: "last_3_full_months_revenue_div_3", months: MONTHLY_REVENUE_MONTHS } as const;

interface PaymentRow {
  id: string;
  entityId: string | null;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  firstPayment: boolean;
}

const isEnterprise = (p: Pick<PaymentRow, "amountMinor" | "firstPayment">) => p.firstPayment && p.amountMinor >= ENTERPRISE_CONTRACT_MIN_MINOR;
const REVENUE_TROPHIES = TROPHIES.filter((t) => t.metric === "mrrMinor");

/** Stores what `detectTrophies` found; returns the rows this call inserted (a trophy another writer won is skipped). */
async function store(db: Executor, businessId: string, found: readonly TrophyMilestone[], visibility?: Milestone["visibility"]): Promise<Milestone[]> {
  const inserted: Milestone[] = [];
  for (const m of found) {
    if (!m.trophyKey) continue;
    const ref = { ...(m.ref ?? {}), trophyKey: m.trophyKey };
    const row = await repos.journeys.awardMilestone(db, businessId, { kind: m.kind, label: m.label, achievedAt: m.achievedAt, ref, visibility: visibility ?? m.visibility });
    if (row) inserted.push(row);
  }
  return inserted;
}

/** What a payment adds to the counters, and the ref every milestone it crosses carries (the win the card replays). */
function paymentRef(p: PaymentRow): Record<string, unknown> {
  return { conversionId: p.id, entityId: p.entityId, amountMinor: p.amountMinor, currency: p.currency };
}

/** Payments never move the revenue counter: it is Finance's monthly figure (`awardRevenueMilestones`). */
const NO_REVENUE = 0;

/**
 * The trophies one payment crossed (first customer, 10th customer, the first enterprise contract), awarded with the
 * payment's time and ids. Any other conversion kind awards nothing. Idempotent.
 */
export async function awardMilestonesForConversion(db: Executor, businessId: string, conversionId: string): Promise<Milestone[]> {
  const c = await repos.journeys.getConversion(db, businessId, conversionId);
  if (c.kind !== "payment") return [];
  const payment: PaymentRow = { id: c.id, entityId: c.entityId, amountMinor: Number(c.amountMinor), currency: c.currency, occurredAt: new Date(c.occurredAt), firstPayment: c.firstPayment };
  const counted = await repos.journeys.paymentCountersBefore(db, businessId, { conversionId: c.id, occurredAt: payment.occurredAt, enterpriseMinMinor: ENTERPRISE_CONTRACT_MIN_MINOR });
  const before: TrophyCounters = { customers: counted.customers, enterpriseContracts: counted.enterpriseContracts, mrrMinor: NO_REVENUE };
  const after: TrophyCounters = {
    customers: before.customers + (payment.firstPayment ? 1 : 0),
    enterpriseContracts: before.enterpriseContracts + (isEnterprise(payment) ? 1 : 0),
    mrrMinor: NO_REVENUE,
  };
  const awarded = (await repos.journeys.awardedTrophyKeys(db, businessId)) as TrophyKey[];
  const found = detectTrophies({ before, after, at: payment.occurredAt, currency: payment.currency, awarded, businessId, ref: paymentRef(payment) });
  return store(db, businessId, found);
}

/** The money Finance shows its figures in: the first bank currency (`finance.overview` `cash.currency`), else the business's. */
async function financeCurrency(db: Executor, businessId: string, fallback: string): Promise<string> {
  const cash = await repos.finance.cashPosition(db, businessId);
  return cash.byCurrency[0]?.currency ?? fallback;
}

/**
 * Finance's monthly figure at `at`: the P&L revenue of the last 3 full months before `at`'s month ÷ 3, from the same
 * category totals `finance.pnl` returns for that range (Finance › Overview's MRR or "Average monthly revenue").
 */
export async function monthlyRevenueAt(db: Executor, businessId: string, at: Date = new Date()): Promise<number> {
  const w = monthlyRevenueWindow(at);
  return monthlyRevenueFromCategories(await repos.finance.categoryTotals(db, businessId, { from: w.from, to: w.to }));
}

const monthKeyOf = (d: Date): string => d.toISOString().slice(0, 7);
const monthStartOf = (key: string): Date => new Date(`${key}-01T00:00:00.000Z`);
const nextMonth = (key: string): string => {
  const d = monthStartOf(key);
  return monthKeyOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
};

/**
 * The revenue trophies the business's monthly figure has reached by `until` (default now) and it does not hold, each
 * awarded on the first day of the month whose window first passed its threshold (the day Finance first showed it),
 * with `ref` { value, threshold, estimate, basis, months, recurring }. Idempotent; the nightly sweep's step and the
 * demo seed's.
 */
export async function awardRevenueMilestones(db: Executor, businessId: string, options: { until?: Date; visibility?: Milestone["visibility"]; ref?: Record<string, unknown> } = {}): Promise<Milestone[]> {
  const until = options.until ?? new Date();
  const held = new Set((await repos.journeys.awardedTrophyKeys(db, businessId)) as TrophyKey[]);
  if (REVENUE_TROPHIES.every((t) => held.has(t.key))) return [];
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const currency = await financeCurrency(db, businessId, business.currency);
  const recurring = revenueIsRecurring(business.archetype);
  // One query: every full month's category totals before `until`'s month; the figure at each month start is its
  // window's revenue (the P&L revenue section, as `pnlTotals` adds it) ÷ 3.
  const rows = await repos.finance.monthlyCategoryTotals(db, businessId, { to: monthlyRevenueWindow(until).to });
  if (!rows.length) return [];
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
  const revenueOf = (key: string): number => pnlTotals(byMonth.get(key) ?? []).revenueMinor;

  const found: TrophyMilestone[] = [];
  const last = monthKeyOf(until);
  let previous = 0;
  for (let key = nextMonth(rows[0]!.month); key <= last; key = nextMonth(key)) {
    const at = monthStartOf(key);
    const w = monthlyRevenueWindow(at);
    const figure = monthlyRevenueMinor(w.months.reduce((sum, m) => sum + revenueOf(m), 0));
    const crossed = detectTrophies({
      before: { customers: 0, enterpriseContracts: 0, mrrMinor: previous },
      after: { customers: 0, enterpriseContracts: 0, mrrMinor: figure },
      at,
      currency,
      recurring,
      awarded: held,
      businessId,
      ref: { ...MONTHLY_REVENUE_REF, recurring, amountMinor: figure, currency, ...(options.ref ?? {}) },
    }).filter((m) => m.trophyKey?.startsWith("mrr_"));
    for (const m of crossed) {
      held.add(m.trophyKey!);
      found.push(m);
    }
    previous = figure;
  }
  return store(db, businessId, found, options.visibility);
}

/**
 * Replays every payment up to `until` (default now) in order and awards each customer or enterprise trophy the business
 * reached but does not hold, at the payment that reached it; then the revenue trophies from the months
 * (`awardRevenueMilestones`). The nightly sweep's step; idempotent.
 */
export async function catchUpMilestones(db: Executor, businessId: string, options: { until?: Date } = {}): Promise<Milestone[]> {
  const until = options.until ?? new Date();
  const awarded = new Set((await repos.journeys.awardedTrophyKeys(db, businessId)) as TrophyKey[]);
  if (awarded.size >= TROPHIES.length) return [];
  const found: TrophyMilestone[] = [];
  if (TROPHIES.some((t) => t.metric !== "mrrMinor" && !awarded.has(t.key))) {
    const payments: PaymentRow[] = (await repos.journeys.paymentsUntil(db, businessId, until)).map((r) => ({ id: r.id, entityId: r.entityId, amountMinor: Number(r.amountMinor), currency: r.currency, occurredAt: new Date(r.occurredAt), firstPayment: r.firstPayment }));
    let customers = 0;
    let enterpriseContracts = 0;
    for (const p of payments) {
      const before: TrophyCounters = { customers, enterpriseContracts, mrrMinor: NO_REVENUE };
      if (p.firstPayment) customers += 1;
      if (isEnterprise(p)) enterpriseContracts += 1;
      const after: TrophyCounters = { customers, enterpriseContracts, mrrMinor: NO_REVENUE };
      for (const m of detectTrophies({ before, after, at: p.occurredAt, currency: p.currency, awarded, businessId, ref: paymentRef(p) })) {
        awarded.add(m.trophyKey!);
        found.push(m);
      }
    }
  }
  const inserted = await store(db, businessId, found);
  return [...inserted, ...(await awardRevenueMilestones(db, businessId, { until }))];
}
