/**
 * Autopilot's inputs (0055): everything `decideAutopilot` (@foundmill/shared) reads about a business, in one place so
 * the orchestrator's `autopilot` workflow and the API's Home/Settings read gather it the same way and cannot disagree.
 * Read-only; nothing here writes.
 */
import { CONTINUE_RUN_LIMITS, utcDayStart, type AutopilotCycleSummary, type AutopilotFacts, type AutopilotPauseReason, type ContinueRunFacts } from "@foundmill/shared";
import { creditsState } from "./billing";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { autopilotSettingsOf } from "./repos/autopilot";
import { periodOf } from "./repos/usage";
import type { Business } from "./schema";

/** A cycle that started this long ago and never completed is a crashed one, not a running one. */
export const STALE_CYCLE_MS = 36 * 60 * 60 * 1000;

export interface CycleEventLike {
  type: string;
  payload: unknown;
  occurredAt: Date;
}

export interface CycleSummary {
  /** A cycle started and has not completed (and is not stale). */
  open: boolean;
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  /**
   * Cycles started at or after `dayStart` that count toward the daily cap: trigger `autopilot` (Autopilot's own and a
   * run's follow-on rounds) and `continue` (the founder's press, a run's first round). One set of limits since Nov 7, 2026.
   */
  cappedStartsToday: number;
  /** Cycles that finished at or after `since`, newest first. */
  finished: AutopilotCycleSummary[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The cycle triggers the daily cap counts: Autopilot's and Continue's (a vacation's cycles and wake-ups do not). */
export const CAPPED_TRIGGERS: ReadonlySet<string> = new Set(["autopilot", "continue"]);

const summaryOf = (payload: unknown): AutopilotCycleSummary => {
  const p = rec(payload);
  return { outcome: (p.outcome as AutopilotCycleSummary["outcome"]) ?? "failed", tasksDispatched: Number(p.tasksDispatched ?? 0), tasksCompleted: Number(p.tasksCompleted ?? 0) };
};

/** The run one press of Continue started that has not ended (`cycle.run_started` with no `cycle.run_ended` of its id). */
export interface OpenRun {
  runId: string;
  startedAt: number;
  firstCycleNumber: number | null;
}

/**
 * Reads the `cycle.run_started` / `cycle.run_ended` log (any order: the API writes the start after the workflow may
 * already have ended the run, so ends are matched by run id). Only the newest start can be open; one older than
 * `CONTINUE_RUN_LIMITS.staleMs` is a lost run, not an open one.
 */
export function openRunOf(events: readonly CycleEventLike[], now: number): OpenRun | null {
  const ended = new Set(events.filter((e) => e.type === "cycle.run_ended").map((e) => rec(e.payload).runId));
  const latest = events.filter((e) => e.type === "cycle.run_started").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!latest) return null;
  const p = rec(latest.payload);
  if (typeof p.runId !== "string" || ended.has(p.runId)) return null;
  if (now - latest.occurredAt.getTime() >= CONTINUE_RUN_LIMITS.staleMs) return null;
  return { runId: p.runId, startedAt: latest.occurredAt.getTime(), firstCycleNumber: typeof p.firstCycleNumber === "number" ? p.firstCycleNumber : null };
}

/** The rounds of a run started at `startedAt`: the cycles that completed since, newest first, with their model cost. */
export function runRoundsOf(newestFirst: readonly CycleEventLike[], startedAt: number): { rounds: number; lastRound: AutopilotCycleSummary | null; cost: { amountMinor: number; currency: string } } {
  const done = newestFirst.filter((e) => e.type === "cycle.completed" && e.occurredAt.getTime() >= startedAt);
  // Cycle costs are in the credits' currency; a cycle priced in another one (none today) is left out, never mixed in.
  const currency = String(rec(rec(done[0]?.payload).cost).currency ?? "USD");
  const amountMinor = done.reduce((sum, e) => {
    const cost = rec(rec(e.payload).cost);
    return cost.currency === currency ? sum + Number(cost.amountMinor ?? 0) : sum;
  }, 0);
  return { rounds: done.length, lastRound: done[0] ? summaryOf(done[0].payload) : null, cost: { amountMinor, currency } };
}

/** Reads the `cycle.started` / `cycle.completed` log (newest first) the way Continue's `cycleStatus` does. */
export function summarizeCycleEvents(newestFirst: readonly CycleEventLike[], opts: { now: number; since: number; dayStart: number }): CycleSummary {
  const started = newestFirst.filter((e) => e.type === "cycle.started");
  const completed = newestFirst.filter((e) => e.type === "cycle.completed");
  const completedIds = new Set(completed.map((e) => rec(e.payload).cycleId));
  const latest = started[0] ?? null;
  const open = latest !== null && !completedIds.has(rec(latest.payload).cycleId) && opts.now - latest.occurredAt.getTime() < STALE_CYCLE_MS;
  const finished = completed
    .filter((e) => e.occurredAt.getTime() >= opts.since)
    .map((e) => summaryOf(e.payload));
  return {
    open,
    lastStartedAt: latest ? latest.occurredAt.getTime() : null,
    lastEndedAt: completed[0] ? completed[0].occurredAt.getTime() : null,
    cappedStartsToday: started.filter((e) => e.occurredAt.getTime() >= opts.dayStart && CAPPED_TRIGGERS.has(String(rec(e.payload).trigger))).length,
    finished,
  };
}

/**
 * Autopilot's own cycles today (0084): the `autopilot.cycle_started` entries since `dayStart` that belong to no Continue
 * run (no `runId`), and what the cycles they started cost (`cycle.completed` of the same numbers, USD). Pure.
 */
export function ownAutopilotToday(events: readonly CycleEventLike[], dayStart: number): { cycles: number; spentMinor: number } {
  const numbers = new Set<number>();
  for (const e of events) {
    if (e.type !== "autopilot.cycle_started" || e.occurredAt.getTime() < dayStart) continue;
    const p = rec(e.payload);
    if (typeof p.runId === "string") continue;
    if (typeof p.cycleNumber === "number") numbers.add(p.cycleNumber);
  }
  let spentMinor = 0;
  for (const e of events) {
    if (e.type !== "cycle.completed") continue;
    const p = rec(e.payload);
    const cost = rec(p.cost);
    if (typeof p.cycleNumber === "number" && numbers.has(p.cycleNumber) && (cost.currency ?? "USD") === "USD") spentMinor += Number(cost.amountMinor ?? 0);
  }
  return { cycles: numbers.size, spentMinor };
}

/**
 * The facts for one business at `now`. `business` is the row as read just now (the orchestrator re-reads it each
 * round). A business on its own key has no credits to run out of (`creditsRemainingMinor` null).
 *
 * `extras.run`: the run the `autopilot` workflow holds (its id, when it began, the rounds that failed before writing a
 * cycle); its rounds are read from the cycles that completed since. Absent, the open run is read from the event log
 * (the API's view); null, no run.
 */
export async function loadAutopilotFacts(db: Executor, business: Business, now: Date, extras: { unrecordedFailures?: number; run?: { id: string; startedAt: number; unrecordedFailures?: number } | null } = {}): Promise<AutopilotFacts> {
  const nowMs = now.getTime();
  const dayStart = utcDayStart(nowMs);
  const since = business.autopilotChangedAt ? business.autopilotChangedAt.getTime() : nowMs;
  const [holiday, blockingItems, cycleEvents, spent, credits] = await Promise.all([
    repos.holidays.current(db, business.id, now),
    repos.inbox.countBlocking(db, business.id),
    repos.events.list(db, business.id, { type: ["cycle.started", "cycle.completed", "cycle.run_started", "cycle.run_ended", "autopilot.cycle_started"], limit: 200 }),
    repos.usage.totals(db, business.id, { from: new Date(dayStart) }),
    creditsState(db, business, periodOf(now)),
  ]);
  const cycles = summarizeCycleEvents(cycleEvents.items, { now: nowMs, since, dayStart });
  const own = ownAutopilotToday(cycleEvents.items, dayStart);
  const open = extras.run === undefined ? openRunOf(cycleEvents.items, nowMs) : null;
  const held: { id: string; startedAt: number; unrecordedFailures?: number } | null = extras.run !== undefined ? extras.run : open ? { id: open.runId, startedAt: open.startedAt } : null;
  let run: ContinueRunFacts | null = null;
  if (held) {
    const rounds = runRoundsOf(cycleEvents.items, held.startedAt);
    run = { id: held.id, startedAt: held.startedAt, rounds: rounds.rounds, lastRound: rounds.lastRound, unrecordedFailures: held.unrecordedFailures ?? 0 };
  }
  return {
    now: nowMs,
    enabled: business.autopilotEnabled,
    pausedReason: business.autopilotPausedReason,
    since,
    settings: autopilotSettingsOf(business),
    archived: business.archivedAt !== null,
    stopReason: business.agentsStoppedAt !== null ? (business.agentsStoppedReason ?? "kill_switch") : null,
    creditsRemainingMinor: credits ? credits.balanceMinor : null,
    vacation: holiday !== null,
    blockingItems,
    cycleOpen: cycles.open,
    lastCycleStartedAt: cycles.lastStartedAt,
    lastCycleEndedAt: cycles.lastEndedAt,
    cyclesToday: cycles.cappedStartsToday,
    // USD model and platform cost (`totals` keeps third-party currencies apart, and those never touch credits).
    spentTodayMinor: spent.costMinor,
    ownCyclesToday: own.cycles,
    ownSpentTodayMinor: own.spentMinor,
    recentCycles: cycles.finished,
    unrecordedFailures: extras.unrecordedFailures ?? 0,
    run,
  };
}

export type AutopilotChange = "turned_on" | "turned_off" | "settings_changed" | "paused";

/** The `autopilot.changed` payload (packages/events) for a business row; the spend ceiling is USD, an Estimate. */
export function autopilotChangedPayload(b: Business, change: AutopilotChange, pausedReason: AutopilotPauseReason | null) {
  return {
    change,
    pausedReason,
    cadence: b.autopilotCadence,
    dailyHour: b.autopilotDailyHour,
    maxCyclesPerDay: b.autopilotMaxCyclesPerDay,
    spendCeiling: b.autopilotSpendCeilingMinor === null ? null : { amountMinor: Number(b.autopilotSpendCeilingMinor), currency: "USD" },
    maxIdleCycles: b.autopilotMaxIdleCycles,
    ownMaxCyclesPerDay: b.autopilotOwnMaxCyclesPerDay ?? null,
    ownSpendCeiling: b.autopilotOwnSpendCeilingMinor === null || b.autopilotOwnSpendCeilingMinor === undefined ? null : { amountMinor: Number(b.autopilotOwnSpendCeilingMinor), currency: "USD" },
  };
}
