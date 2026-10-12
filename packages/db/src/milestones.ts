/**
 * Milestones from real events (BUILD §11.4 trophy cabinet; audit JM-03, GTM-03, VGTM-X1).
 *
 * The trophy definitions and their crossing rule are `@foundmill/journey`'s (`TROPHIES`, `detectTrophies`), the same the
 * demo generator uses. The counters come from the business's own payments:
 * - customers: first payments (0034 `first_payment`); a renewal or a repeat order is revenue, not a customer;
 * - enterprise contracts: first payments at or above `ENTERPRISE_CONTRACT_MIN_MINOR`;
 * - MRR: revenue over the trailing 30 days in the currency of the payment being counted (an Estimate: subscriptions are
 *   not modeled, so the milestone's `ref` says `estimate: true` with its basis).
 *
 * `awardMilestonesForConversion` runs where a payment arrives (ingest, in the delivery's transaction) and again in the
 * journey build; `catchUpMilestones` replays every payment in order for the nightly sweep, so a milestone a writer missed
 * (a failed build, a payment recorded before this existed) is still awarded with the moment it was reached. Every award
 * goes through `repos.journeys.awardMilestone`: each trophy at most once per business, whoever writes first.
 */
import { detectTrophies, ENTERPRISE_CONTRACT_MIN_MINOR, TROPHIES, type Milestone as TrophyMilestone, type TrophyCounters, type TrophyKey } from "@foundmill/journey";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { Milestone } from "./schema";

const DAY_MS = 86_400_000;
/** The MRR counter's window. */
export const MRR_WINDOW_DAYS = 30;
const MRR_REF = { estimate: true, basis: "trailing_30_day_revenue" } as const;

interface PaymentRow {
  id: string;
  entityId: string | null;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  firstPayment: boolean;
}

const isEnterprise = (p: Pick<PaymentRow, "amountMinor" | "firstPayment">) => p.firstPayment && p.amountMinor >= ENTERPRISE_CONTRACT_MIN_MINOR;

/** Stores what `detectTrophies` found; returns the rows this call inserted (a trophy another writer won is skipped). */
async function store(db: Executor, businessId: string, found: readonly TrophyMilestone[]): Promise<Milestone[]> {
  const inserted: Milestone[] = [];
  for (const m of found) {
    if (!m.trophyKey) continue;
    const ref = { ...(m.ref ?? {}), trophyKey: m.trophyKey, ...(m.ref?.metric === "mrrMinor" ? MRR_REF : {}) };
    const row = await repos.journeys.awardMilestone(db, businessId, { kind: m.kind, label: m.label, achievedAt: m.achievedAt, ref, visibility: m.visibility });
    if (row) inserted.push(row);
  }
  return inserted;
}

/** What a payment adds to the counters, and the ref every milestone it crosses carries (the win the card replays). */
function paymentRef(p: PaymentRow): Record<string, unknown> {
  return { conversionId: p.id, entityId: p.entityId, amountMinor: p.amountMinor, currency: p.currency };
}

/**
 * The trophies one payment crossed (first customer, 10th customer, an MRR line, the first enterprise contract), awarded
 * with the payment's time and ids. Any other conversion kind awards nothing. Idempotent.
 */
export async function awardMilestonesForConversion(db: Executor, businessId: string, conversionId: string): Promise<Milestone[]> {
  const c = await repos.journeys.getConversion(db, businessId, conversionId);
  if (c.kind !== "payment") return [];
  const payment: PaymentRow = { id: c.id, entityId: c.entityId, amountMinor: Number(c.amountMinor), currency: c.currency, occurredAt: new Date(c.occurredAt), firstPayment: c.firstPayment };
  const counted = await repos.journeys.paymentCountersBefore(db, businessId, {
    conversionId: c.id,
    occurredAt: payment.occurredAt,
    currency: payment.currency,
    mrrSince: new Date(payment.occurredAt.getTime() - MRR_WINDOW_DAYS * DAY_MS),
    enterpriseMinMinor: ENTERPRISE_CONTRACT_MIN_MINOR,
  });
  const before: TrophyCounters = { customers: counted.customers, enterpriseContracts: counted.enterpriseContracts, mrrMinor: counted.revenueMinor };
  const after: TrophyCounters = {
    customers: before.customers + (payment.firstPayment ? 1 : 0),
    enterpriseContracts: before.enterpriseContracts + (isEnterprise(payment) ? 1 : 0),
    mrrMinor: before.mrrMinor + payment.amountMinor,
  };
  const awarded = (await repos.journeys.awardedTrophyKeys(db, businessId)) as TrophyKey[];
  const found = detectTrophies({ before, after, at: payment.occurredAt, currency: payment.currency, awarded, businessId, ref: paymentRef(payment) });
  return store(db, businessId, found);
}

/**
 * Replays every payment up to `until` (default now) in order and awards each trophy the business reached but does not
 * hold, at the payment that reached it. The nightly sweep's step; idempotent.
 */
export async function catchUpMilestones(db: Executor, businessId: string, options: { until?: Date } = {}): Promise<Milestone[]> {
  const until = options.until ?? new Date();
  const awarded = new Set((await repos.journeys.awardedTrophyKeys(db, businessId)) as TrophyKey[]);
  if (awarded.size >= TROPHIES.length) return [];
  const payments: PaymentRow[] = (await repos.journeys.paymentsUntil(db, businessId, until)).map((r) => ({ id: r.id, entityId: r.entityId, amountMinor: Number(r.amountMinor), currency: r.currency, occurredAt: new Date(r.occurredAt), firstPayment: r.firstPayment }));

  const found: TrophyMilestone[] = [];
  let customers = 0;
  let enterpriseContracts = 0;
  // Trailing-30-day revenue per currency, kept with a sliding window over the ordered payments.
  const windows = new Map<string, { start: number; sum: number; rows: PaymentRow[] }>();
  for (const p of payments) {
    const w = windows.get(p.currency) ?? { start: 0, sum: 0, rows: [] };
    windows.set(p.currency, w);
    w.rows.push(p);
    w.sum += p.amountMinor;
    const lowerBound = p.occurredAt.getTime() - MRR_WINDOW_DAYS * DAY_MS;
    while (w.start < w.rows.length && w.rows[w.start]!.occurredAt.getTime() <= lowerBound) {
      w.sum -= w.rows[w.start]!.amountMinor;
      w.start += 1;
    }
    const before: TrophyCounters = { customers, enterpriseContracts, mrrMinor: w.sum - p.amountMinor };
    if (p.firstPayment) customers += 1;
    if (isEnterprise(p)) enterpriseContracts += 1;
    const after: TrophyCounters = { customers, enterpriseContracts, mrrMinor: w.sum };
    for (const m of detectTrophies({ before, after, at: p.occurredAt, currency: p.currency, awarded, businessId, ref: paymentRef(p) })) {
      awarded.add(m.trophyKey!);
      found.push(m);
    }
  }
  return store(db, businessId, found);
}
