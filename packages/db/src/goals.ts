/**
 * Where a goal stands (founder, 2026-11-07), from the same counters the rest of the product shows:
 * - paying_customers: every first payment (the Milestones counter: a renewal or a repeat order is revenue, not a customer);
 * - signups: every signup conversion;
 * - revenue_month: this calendar month's operating inflow (the Finance P&L's figure, `repos.finance.monthlyTotals`);
 * - custom: nothing to count (no progress bar).
 *
 * `achieveGoalIfReached` runs where a payment or a signup arrives (ingest, in the delivery's transaction) and in the api's
 * `goal.ensure`: the active goal reached is marked achieved and the Chief of Staff posts "Goal reached: …". The caller
 * writes `goal.achieved` and `inbox.item_created` through the outbox (the event schemas live in @foundmill/events).
 */
import { dayKeyIn, goalReachedBody, goalReachedSubject, type GoalMetricKind } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { Goal, InboxItem } from "./schema";

export interface GoalCounters {
  payingCustomers: number;
  signups: number;
  /** Operating inflow of the current calendar month (UTC), minor units in the business's currency. */
  revenueMonthMinor: number;
}

/** The counters a goal reads, in three small aggregate queries. */
export async function goalCounters(db: Executor, businessId: string, now: Date = new Date()): Promise<GoalCounters> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [conversions, months] = await Promise.all([repos.journeys.countConversions(db, businessId), repos.finance.monthlyTotals(db, businessId, { from: monthStart })]);
  const month = now.toISOString().slice(0, 7);
  return { payingCustomers: conversions.payment ?? 0, signups: conversions.signup ?? 0, revenueMonthMinor: months.find((m) => m.month === month)?.operatingInflowMinor ?? 0 };
}

/** The counter of a goal's kind (null for custom). */
export function counterFor(kind: GoalMetricKind, counters: GoalCounters): number | null {
  switch (kind) {
    case "paying_customers":
      return counters.payingCustomers;
    case "signups":
      return counters.signups;
    case "revenue_month":
      return counters.revenueMonthMinor;
    case "custom":
      return null;
  }
}

export interface GoalProgress {
  current: number | null;
  target: number | null;
  /** True once the counter reached the target (never for custom). */
  reached: boolean;
}

export async function goalProgress(db: Executor, businessId: string, goal: Pick<Goal, "metricKind" | "targetValue">, now: Date = new Date()): Promise<GoalProgress> {
  const current = counterFor(goal.metricKind, await goalCounters(db, businessId, now));
  return { current, target: goal.targetValue, reached: current !== null && goal.targetValue !== null && current >= goal.targetValue };
}

/**
 * The active goal reached: marked achieved with the value it reached, and the Chief of Staff's milestone note
 * "Goal reached: 10 paying customers". Null when there is no active goal, it is custom, or it is not reached yet.
 * Idempotent: the update is conditional on the goal still being active.
 */
export async function achieveGoalIfReached(db: Executor, businessId: string, options: { now?: Date } = {}): Promise<{ goal: Goal; item: InboxItem | null; fromAgentId: string | null } | null> {
  const now = options.now ?? new Date();
  const { active } = await repos.goals.current(db, businessId);
  if (!active || active.metricKind === "custom") return null;
  const progress = await goalProgress(db, businessId, active, now);
  if (!progress.reached) return null;
  const goal = await repos.goals.achieve(db, businessId, active.id, { value: progress.current, at: now });
  if (!goal) return null;
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const today = dayKeyIn(now, business.timeZone);
  const from = (goal.proposedByAgentId ? await repos.agents.get(db, businessId, goal.proposedByAgentId).catch(() => null) : null) ?? (await repos.agents.chiefOfStaff(db, businessId));
  const item = from
    ? await repos.inbox.createItem(db, businessId, {
        type: "milestone",
        from_agent_id: from.id,
        subject: goalReachedSubject({ kind: goal.metricKind, target: goal.targetValue, currency: goal.currency, text: goal.sentence }),
        body_md: goalReachedBody({ sentence: goal.sentence, reachedOn: today, dueOn: goal.dueOn, today }),
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: null,
        blocks_continue: false,
        source_event_ids: [],
        entity_ids: [],
      })
    : null;
  return { goal, item, fromAgentId: from?.id ?? null };
}
