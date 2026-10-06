/**
 * `journey_daily` helpers. `aggregateDaily` mirrors the materialised view in migration 0007: UTC day buckets;
 * agent sessions → agent_hours + spend by the agent's department; done tasks → tasks_done by department;
 * channel spend → spend on the business-wide row; conversions → signups / activations / payments / revenue
 * on the business-wide row; decisions → decisions on the business-wide row.
 */
import { addDaysKey, dayKeyUtc, eachDayKey, hoursBetween, toDate } from "./time";
import { JourneyDailyRow, type Conversion, type DayKey } from "./types";

export interface DailySessionLike {
  startedAt: string | Date;
  endedAt: string | Date | null;
  costMinor: number;
  departmentId: string | null;
}
export interface DailyTaskLike {
  endedAt: string | Date | null;
  status: string;
  departmentId: string | null;
}
export interface DailyChannelSpendLike {
  day: DayKey;
  spendMinor: number;
}
export interface DailyDecisionLike {
  decidedAt: string | Date;
}

export interface AggregateDailyInput {
  businessId?: string;
  conversions?: readonly Pick<Conversion, "kind" | "amountMinor" | "occurredAt">[];
  sessions?: readonly DailySessionLike[];
  tasks?: readonly DailyTaskLike[];
  channelSpend?: readonly DailyChannelSpendLike[];
  decisions?: readonly DailyDecisionLike[];
}

export function emptyDailyRow(day: DayKey, departmentId: string | null, businessId?: string): JourneyDailyRow {
  const row: JourneyDailyRow = { day, departmentId, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 };
  if (businessId) row.businessId = businessId;
  return row;
}

const rowKey = (day: DayKey, departmentId: string | null): string => `${day}|${departmentId ?? ""}`;

export function aggregateDaily(input: AggregateDailyInput): JourneyDailyRow[] {
  const rows = new Map<string, JourneyDailyRow>();
  const get = (day: DayKey, departmentId: string | null) => {
    const k = rowKey(day, departmentId);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = emptyDailyRow(day, departmentId, input.businessId)));
    return r;
  };
  for (const s of input.sessions ?? []) {
    const r = get(dayKeyUtc(s.startedAt), s.departmentId);
    r.agentHours += s.endedAt ? Math.max(0, hoursBetween(s.startedAt, s.endedAt)) : 0;
    r.spendMinor += Math.max(0, Math.round(s.costMinor));
  }
  for (const t of input.tasks ?? []) {
    if (t.status !== "done" || !t.endedAt) continue;
    get(dayKeyUtc(t.endedAt), t.departmentId).tasksDone += 1;
  }
  for (const m of input.channelSpend ?? []) get(m.day, null).spendMinor += Math.max(0, Math.round(m.spendMinor));
  for (const c of input.conversions ?? []) {
    const r = get(dayKeyUtc(c.occurredAt), null);
    if (c.kind === "signup") r.signups += 1;
    else if (c.kind === "activation") r.activations += 1;
    else {
      r.payments += 1;
      r.revenueMinor += Math.max(0, Math.round(c.amountMinor));
    }
  }
  for (const d of input.decisions ?? []) get(dayKeyUtc(toDate(d.decidedAt)), null).decisions += 1;
  return sortDaily([...rows.values()].map((r) => JourneyDailyRow.parse({ ...r, agentHours: Math.round(r.agentHours * 1000) / 1000 })));
}

export function sortDaily(rows: readonly JourneyDailyRow[]): JourneyDailyRow[] {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day) || (a.departmentId ?? "").localeCompare(b.departmentId ?? ""));
}

/** Sum rows that share day + department (e.g. after concatenating sources). */
export function mergeDaily(rows: readonly JourneyDailyRow[]): JourneyDailyRow[] {
  const out = new Map<string, JourneyDailyRow>();
  for (const r of rows) {
    const k = rowKey(r.day, r.departmentId);
    const cur = out.get(k);
    if (!cur) out.set(k, { ...r });
    else addInto(cur, r);
  }
  return sortDaily([...out.values()]);
}

/** One row per day summed across departments (departmentId null): the revenue line and status strip. */
export function rollupDaily(rows: readonly JourneyDailyRow[]): JourneyDailyRow[] {
  const out = new Map<string, JourneyDailyRow>();
  for (const r of rows) {
    const cur = out.get(r.day);
    if (!cur) out.set(r.day, { ...r, departmentId: null });
    else addInto(cur, r);
  }
  return sortDaily([...out.values()]);
}

/** Dense series: every day in [from, to] × every department id (plus the business-wide row when `includeBusinessRow`). */
export function fillDays(rows: readonly JourneyDailyRow[], opts: { from: DayKey; to: DayKey; departmentIds: readonly string[]; includeBusinessRow?: boolean }): JourneyDailyRow[] {
  const existing = new Map(rows.map((r) => [rowKey(r.day, r.departmentId), r] as const));
  const out: JourneyDailyRow[] = [];
  const businessId = rows[0]?.businessId;
  const depts: (string | null)[] = [...opts.departmentIds];
  if (opts.includeBusinessRow ?? true) depts.push(null);
  for (const day of eachDayKey(opts.from, opts.to)) {
    for (const d of depts) out.push(existing.get(rowKey(day, d)) ?? emptyDailyRow(day, d, businessId));
  }
  // Keep rows for departments not in the list too.
  for (const r of rows) if (!depts.includes(r.departmentId) && r.day >= opts.from && r.day <= opts.to) out.push(r);
  return sortDaily(out);
}

export interface DailyTotals {
  days: number;
  agentHours: number;
  tasksDone: number;
  spendMinor: number;
  revenueMinor: number;
  signups: number;
  activations: number;
  payments: number;
  decisions: number;
}

export function sumDaily(rows: readonly JourneyDailyRow[]): DailyTotals {
  const days = new Set<string>();
  const t: DailyTotals = { days: 0, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 };
  for (const r of rows) {
    days.add(r.day);
    t.agentHours += r.agentHours;
    t.tasksDone += r.tasksDone;
    t.spendMinor += r.spendMinor;
    t.revenueMinor += r.revenueMinor;
    t.signups += r.signups;
    t.activations += r.activations;
    t.payments += r.payments;
    t.decisions += r.decisions;
  }
  t.days = days.size;
  t.agentHours = Math.round(t.agentHours * 1000) / 1000;
  return t;
}

/** Trailing window sum ending on `day` (inclusive) over `days` days, from business-wide rows. */
export function trailingSum(rows: readonly JourneyDailyRow[], day: DayKey, days: number, field: keyof DailyTotals & keyof JourneyDailyRow): number {
  const from = addDaysKey(day, -(days - 1));
  let total = 0;
  for (const r of rows) if (r.day >= from && r.day <= day) total += r[field] as number;
  return total;
}

function addInto(target: JourneyDailyRow, r: JourneyDailyRow): void {
  target.agentHours = Math.round((target.agentHours + r.agentHours) * 1000) / 1000;
  target.tasksDone += r.tasksDone;
  target.spendMinor += r.spendMinor;
  target.revenueMinor += r.revenueMinor;
  target.signups += r.signups;
  target.activations += r.activations;
  target.payments += r.payments;
  target.decisions += r.decisions;
}
