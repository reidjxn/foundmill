/**
 * Autopilot's inputs (0055): everything `decideAutopilot` (@foundmill/shared) reads about a business, in one place so
 * the orchestrator's `autopilot` workflow and the API's Home/Settings read gather it the same way and cannot disagree.
 * Read-only; nothing here writes.
 */
import { utcDayStart, type AutopilotCycleSummary, type AutopilotFacts, type AutopilotPauseReason } from "@foundmill/shared";
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
  /** Autopilot-triggered cycles started at or after `dayStart`. */
  autopilotStartsToday: number;
  /** Cycles that finished at or after `since`, newest first. */
  finished: AutopilotCycleSummary[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Reads the `cycle.started` / `cycle.completed` log (newest first) the way Continue's `cycleStatus` does. */
export function summarizeCycleEvents(newestFirst: readonly CycleEventLike[], opts: { now: number; since: number; dayStart: number }): CycleSummary {
  const started = newestFirst.filter((e) => e.type === "cycle.started");
  const completed = newestFirst.filter((e) => e.type === "cycle.completed");
  const completedIds = new Set(completed.map((e) => rec(e.payload).cycleId));
  const latest = started[0] ?? null;
  const open = latest !== null && !completedIds.has(rec(latest.payload).cycleId) && opts.now - latest.occurredAt.getTime() < STALE_CYCLE_MS;
  const finished = completed
    .filter((e) => e.occurredAt.getTime() >= opts.since)
    .map((e): AutopilotCycleSummary => {
      const p = rec(e.payload);
      return { outcome: (p.outcome as AutopilotCycleSummary["outcome"]) ?? "failed", tasksDispatched: Number(p.tasksDispatched ?? 0), tasksCompleted: Number(p.tasksCompleted ?? 0) };
    });
  return {
    open,
    lastStartedAt: latest ? latest.occurredAt.getTime() : null,
    lastEndedAt: completed[0] ? completed[0].occurredAt.getTime() : null,
    autopilotStartsToday: started.filter((e) => e.occurredAt.getTime() >= opts.dayStart && rec(e.payload).trigger === "autopilot").length,
    finished,
  };
}

/**
 * The facts for one business at `now`. `business` is the row as read just now (the orchestrator re-reads it each
 * round). A business on its own key has no credits to run out of (`creditsRemainingMinor` null).
 */
export async function loadAutopilotFacts(db: Executor, business: Business, now: Date, extras: { unrecordedFailures?: number } = {}): Promise<AutopilotFacts> {
  const nowMs = now.getTime();
  const dayStart = utcDayStart(nowMs);
  const since = business.autopilotChangedAt ? business.autopilotChangedAt.getTime() : nowMs;
  const [holiday, blockingItems, cycleEvents, spent, credits] = await Promise.all([
    repos.holidays.current(db, business.id, now),
    repos.inbox.countBlocking(db, business.id),
    repos.events.list(db, business.id, { type: ["cycle.started", "cycle.completed"], limit: 200 }),
    repos.usage.totals(db, business.id, { from: new Date(dayStart) }),
    creditsState(db, business, periodOf(now)),
  ]);
  const cycles = summarizeCycleEvents(cycleEvents.items, { now: nowMs, since, dayStart });
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
    cyclesToday: cycles.autopilotStartsToday,
    // USD model and platform cost (`totals` keeps third-party currencies apart, and those never touch credits).
    spentTodayMinor: spent.costMinor,
    recentCycles: cycles.finished,
    unrecordedFailures: extras.unrecordedFailures ?? 0,
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
  };
}
