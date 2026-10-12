/**
 * Current metrics for the Composer's inputs and status strip (BUILD §11.3 "status strip (≤ 4 live metrics with
 * provenance on hover)", §11.8 metric definitions). Every number is read from repositories; the model receives them as
 * `{ metric, value, source, label }` and may only repeat them. Derived values carry the label "Estimate".
 */
import { repos, type Executor } from "@foundmill/db";
import { LIMITS } from "@foundmill/config";
import { CHANNEL_META, type ChannelKey, type TaskStatus } from "@foundmill/shared";

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (now: Date, n: number): Date => new Date(now.getTime() - n * DAY_MS);

export interface ChannelCpaWindow {
  channelId: string;
  channelKey: ChannelKey;
  label: string;
  /** Spend ÷ customers over the window, minor units; null without customers. Label "Estimate". */
  recentCpaMinor: number | null;
  previousCpaMinor: number | null;
  /** (recent − previous) / previous; null when either side is null or previous is 0. */
  changeRatio: number | null;
  recentSpendMinor: number;
  recentCustomers: number;
}

export interface RoadmapSlip {
  id: string;
  title: string;
  horizon: string;
  status: string;
  targetEnd: string;
  daysLate: number;
}

export interface MetricsSnapshot {
  asOf: string;
  currency: string;
  cashMinor: number | null;
  cashAccounts: number;
  /** Trailing 3-month net burn per month (positive = burning). Label "Estimate". */
  netBurnMonthlyMinor: number;
  grossBurnMonthlyMinor: number;
  /** cash ÷ net burn; null when there is no cash figure or the business is not burning. Label "Estimate". */
  runwayMonths: number | null;
  /** Warning thresholds the runway currently sits below (12, 9, 6, 3). */
  runwayBelow: number[];
  customersWeek: number;
  signupsWeek: number;
  activationsWeek: number;
  customers30d: number;
  signups30d: number;
  tasks: Record<TaskStatus, number>;
  channelsEnabled: number;
  channels: ChannelCpaWindow[];
  roadmapOpen: number;
  roadmapSlips: RoadmapSlip[];
}

/** cash ÷ net burn in months (one decimal); null when not burning or no cash figure. Label "Estimate". */
export function estimateRunwayMonths(cashMinor: number | null, netBurnMonthlyMinor: number): number | null {
  if (cashMinor === null || netBurnMonthlyMinor <= 0) return null;
  return Math.round((cashMinor / netBurnMonthlyMinor) * 10) / 10;
}

export function runwayThresholdsBelow(runwayMonths: number | null): number[] {
  if (runwayMonths === null) return [];
  return [...LIMITS.runwayWarnMonths, LIMITS.runwayBlockMonths].filter((t) => runwayMonths < t);
}

export function blocksForRunway(runwayMonths: number | null): boolean {
  return runwayMonths !== null && runwayMonths < LIMITS.runwayBlockMonths;
}

export async function loadMetricsSnapshot(db: Executor, businessId: string, now = new Date()): Promise<MetricsSnapshot> {
  const [business, cash, burn, week, month, tasks, enabledChannels, recent, previous, roadmap] = await Promise.all([
    repos.businesses.get(db, businessId),
    repos.finance.cashPosition(db, businessId),
    repos.finance.netBurn(db, businessId, { asOf: now }),
    repos.journeys.countConversions(db, businessId, { from: daysAgo(now, 7), to: now }),
    repos.journeys.countConversions(db, businessId, { from: daysAgo(now, 30), to: now }),
    repos.tasks.countByStatus(db, businessId),
    repos.channels.list(db, businessId, { enabled: true }),
    repos.channels.metricsSummary(db, businessId, { from: dayKey(daysAgo(now, 6)), to: dayKey(now) }),
    repos.channels.metricsSummary(db, businessId, { from: dayKey(daysAgo(now, 13)), to: dayKey(daysAgo(now, 7)) }),
    repos.product.listRoadmap(db, businessId),
  ]);

  // Cash: the first (alphabetical) currency with accounts, which for a single-currency club is its only one. Multi-currency
  // conversion at the ECB rate belongs to the Finance module; here we never add currencies together.
  const primary = cash.byCurrency[0] ?? null;
  // Before a bank is connected, the business's own currency (0025), never a fixed one.
  const currency = primary?.currency ?? business.currency;
  const cashMinor = primary ? primary.balanceMinor : null;
  const runwayMonths = estimateRunwayMonths(cashMinor, burn.netBurnMinor);

  const prevByKey = new Map(previous.channels.map((c) => [c.channelKey, c]));
  const channels: ChannelCpaWindow[] = recent.channels.map((c) => {
    const prev = prevByKey.get(c.channelKey);
    const previousCpaMinor = prev?.cpaMinor ?? null;
    const changeRatio = c.cpaMinor !== null && previousCpaMinor !== null && previousCpaMinor > 0 ? (c.cpaMinor - previousCpaMinor) / previousCpaMinor : null;
    return { channelId: c.channelId, channelKey: c.channelKey, label: CHANNEL_META[c.channelKey].label, recentCpaMinor: c.cpaMinor, previousCpaMinor, changeRatio, recentSpendMinor: c.spendMinor, recentCustomers: c.customers };
  });

  const today = dayKey(now);
  const roadmapSlips: RoadmapSlip[] = roadmap
    .filter((i) => i.targetEnd !== null && i.targetEnd < today && i.status !== "done" && i.status !== "cancelled")
    .map((i) => ({ id: i.id, title: i.title, horizon: i.horizon, status: i.status, targetEnd: i.targetEnd as string, daysLate: Math.floor((now.getTime() - new Date(`${i.targetEnd}T00:00:00Z`).getTime()) / DAY_MS) }));

  return {
    asOf: now.toISOString(),
    currency,
    cashMinor,
    cashAccounts: primary?.accounts ?? 0,
    netBurnMonthlyMinor: burn.netBurnMinor,
    grossBurnMonthlyMinor: burn.grossBurnMinor,
    runwayMonths,
    runwayBelow: runwayThresholdsBelow(runwayMonths),
    customersWeek: week.payment,
    signupsWeek: week.signup,
    activationsWeek: week.activation,
    customers30d: month.payment,
    signups30d: month.signup,
    tasks,
    channelsEnabled: enabledChannels.length,
    channels,
    roadmapOpen: roadmap.filter((i) => i.status !== "done").length,
    roadmapSlips,
  };
}

export interface StatusMetric {
  metric: string;
  value: string;
  source: string;
  label: "Estimate" | null;
}

/** The ≤ 4 live metrics offered for the status strip, each with provenance (a named query or table) and a label. */
export function statusMetrics(s: MetricsSnapshot): StatusMetric[] {
  const out: StatusMetric[] = [];
  if (s.cashMinor !== null) out.push({ metric: "cash", value: `${(s.cashMinor / 100).toFixed(2)} ${s.currency}`, source: "cash_position", label: "Estimate" });
  if (s.runwayMonths !== null) out.push({ metric: "runway", value: `${s.runwayMonths} months`, source: "cash_position", label: "Estimate" });
  out.push({ metric: "customers_week", value: String(s.customersWeek), source: "conversions_30d", label: null });
  out.push({ metric: "tasks_running", value: String(s.tasks.running), source: "tasks_by_status", label: null });
  if (out.length < 4) out.push({ metric: "signups_week", value: String(s.signupsWeek), source: "conversions_30d", label: null });
  return out.slice(0, 4);
}

/** The part of the snapshot whose change should invalidate pre-written insight/decision candidates. */
export function snapshotFingerprint(s: MetricsSnapshot): Record<string, unknown> {
  return {
    cash: s.cashMinor,
    burn: s.netBurnMonthlyMinor,
    runwayBelow: s.runwayBelow,
    customersWeek: s.customersWeek,
    signupsWeek: s.signupsWeek,
    customers30d: s.customers30d,
    tasks: s.tasks,
    channelsEnabled: s.channelsEnabled,
    channels: s.channels.map((c) => [c.channelKey, c.recentCpaMinor, c.previousCpaMinor]),
    roadmapSlips: s.roadmapSlips.map((r) => [r.id, r.status, r.targetEnd]),
    roadmapOpen: s.roadmapOpen,
  };
}
