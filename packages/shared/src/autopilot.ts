/**
 * Autopilot (0041): a business that starts its own cycles. Pure vocabulary and decision logic, shared by the API (the
 * Settings and Home read), the orchestrator (the `autopilot` workflow's activity) and the web, so the chip the founder
 * reads and the workflow that acts can never disagree.
 *
 * Autopilot only decides WHEN the next cycle starts. The cycle itself is the same `businessCycle` Continue starts, so
 * every approval, hard gate, section wall and policy check applies as for a founder press, and nothing here approves,
 * decides or spends on its own. Guard rails always win over the schedule:
 *
 * - the business stop flag (Stop all agents, a revoked key, used-up credits) pauses it, and Resume does not turn it back on;
 * - used-up credits (the 402 / `credits_exhausted` case, also before the stop flag is written) pause it;
 * - N failed or empty cycles in a row pause it with a note in the Inbox;
 * - a vacation in progress, a running cycle, an Inbox item that blocks Continue, the day's cycle cap and the day's spend
 *   ceiling make it wait (it never decides for the founder);
 * - a cycle never starts less than 15 minutes after the previous autopilot start.
 *
 * Days are UTC days and the daily hour is a UTC hour: a business has no time zone of its own.
 */

export const AUTOPILOT_CADENCES = ["after_cycle", "every_1h", "every_4h", "every_12h", "daily"] as const;
export type AutopilotCadence = (typeof AUTOPILOT_CADENCES)[number];

/** Why Autopilot paused itself (`businesses.autopilot_paused_reason`); the founder turns it back on by hand. */
export const AUTOPILOT_PAUSE_REASONS = ["kill_switch", "key_revoked", "credits_exhausted", "idle_cycles"] as const;
export type AutopilotPauseReason = (typeof AUTOPILOT_PAUSE_REASONS)[number];

export const AUTOPILOT_LIMITS = {
  /** No two autopilot cycles start closer than this. */
  minIntervalMs: 15 * 60 * 1000,
  maxCyclesPerDay: { min: 1, max: 24, default: 6 },
  /** Failed or empty cycles in a row that pause Autopilot. */
  maxIdleCycles: { min: 1, max: 10, default: 3 },
  dailyHour: { min: 0, max: 23, default: 9 },
  defaultCadence: "every_4h" as AutopilotCadence,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const AUTOPILOT_CADENCE_INFO: Record<AutopilotCadence, { label: string; summary: string; intervalMs: number | null }> = {
  after_cycle: { label: "As soon as the last cycle ends", summary: "The next cycle starts right after the previous one finishes.", intervalMs: 0 },
  every_1h: { label: "Every hour", summary: "One hour after the last cycle ends.", intervalMs: HOUR_MS },
  every_4h: { label: "Every 4 hours", summary: "Four hours after the last cycle ends.", intervalMs: 4 * HOUR_MS },
  every_12h: { label: "Every 12 hours", summary: "Twelve hours after the last cycle ends.", intervalMs: 12 * HOUR_MS },
  daily: { label: "Daily", summary: "Once a day at the hour you choose (UTC).", intervalMs: null },
};

/** The founder's Autopilot choices (the `businesses.autopilot_*` columns). */
export interface AutopilotSettings {
  cadence: AutopilotCadence;
  /** 0 to 23, UTC; used by the daily cadence. */
  dailyHour: number;
  maxCyclesPerDay: number;
  /** USD cents of model spend per UTC day (an Estimate); null: the credits left. */
  spendCeilingMinor: number | null;
  /** Failed or empty cycles in a row that pause Autopilot. */
  maxIdleCycles: number;
}

export const AUTOPILOT_DEFAULT_SETTINGS: AutopilotSettings = {
  cadence: AUTOPILOT_LIMITS.defaultCadence,
  dailyHour: AUTOPILOT_LIMITS.dailyHour.default,
  maxCyclesPerDay: AUTOPILOT_LIMITS.maxCyclesPerDay.default,
  spendCeilingMinor: null,
  maxIdleCycles: AUTOPILOT_LIMITS.maxIdleCycles.default,
};

/** Why Autopilot is holding off for now (it stays on). */
export const AUTOPILOT_WAIT_REASONS = ["vacation", "cycle_running", "inbox", "daily_cycles", "daily_spend", "schedule"] as const;
export type AutopilotWaitReason = (typeof AUTOPILOT_WAIT_REASONS)[number];

/** One finished cycle, newest first in the lists below. */
export interface AutopilotCycleSummary {
  outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed";
  tasksDispatched: number;
  tasksCompleted: number;
}

/**
 * A cycle that did nothing for the business: it failed, dispatched nothing (empty), or only waited with nothing finished.
 * A stopped cycle is neither (the stop owns it); a cycle that hit its time box with work still running is progress.
 */
export function isIdleCycle(c: AutopilotCycleSummary): boolean {
  if (c.outcome === "stopped") return false;
  if (c.outcome === "failed") return true;
  if (c.tasksDispatched === 0) return true;
  return c.outcome === "waiting" && c.tasksCompleted === 0;
}

/** Consecutive idle cycles from the newest one back; stopped cycles are skipped, the first productive one ends the run. */
export function idleStreak(newestFirst: readonly AutopilotCycleSummary[]): number {
  let n = 0;
  for (const c of newestFirst) {
    if (c.outcome === "stopped") continue;
    if (!isIdleCycle(c)) break;
    n += 1;
  }
  return n;
}

/** Midnight UTC of the day `ms` falls in. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The first `hour`:00 UTC strictly after `ms`. */
export function nextDailyAt(ms: number, hour: number): number {
  const today = utcDayStart(ms) + hour * HOUR_MS;
  return today > ms ? today : today + DAY_MS;
}

/**
 * When the next cycle is due: the cadence counted from the last cycle's end (any cycle: a founder's press moves the
 * schedule on too), never less than 15 minutes after the last start. With no cycle yet the first one is due as soon as
 * Autopilot was turned on (daily: at its next hour).
 */
export function plannedCycleAt(settings: Pick<AutopilotSettings, "cadence" | "dailyHour">, last: { startedAt: number | null; endedAt: number | null }, since: number): number {
  const basis = last.endedAt ?? since;
  let at: number;
  if (settings.cadence === "daily") at = nextDailyAt(basis, settings.dailyHour);
  else if (last.endedAt === null) at = since;
  else at = basis + (AUTOPILOT_CADENCE_INFO[settings.cadence].intervalMs ?? 0);
  if (last.startedAt !== null) at = Math.max(at, last.startedAt + AUTOPILOT_LIMITS.minIntervalMs);
  return at;
}

/** Everything the decision reads, gathered by `loadAutopilotFacts` (packages/db) with a clock reading. */
export interface AutopilotFacts {
  now: number;
  /** Autopilot is turned on. */
  enabled: boolean;
  /** Set once Autopilot paused itself; cleared when the founder turns it on again. */
  pausedReason: AutopilotPauseReason | null;
  /** When it was last turned on (the idle streak counts from here), epoch ms. */
  since: number;
  settings: AutopilotSettings;
  archived: boolean;
  /** The business stop flag. */
  stopReason: "kill_switch" | "key_revoked" | "credits_exhausted" | null;
  /** Credits left this period in USD cents; null for a business on its own key. */
  creditsRemainingMinor: number | null;
  vacation: boolean;
  /** Inbox items that block Continue. */
  blockingItems: number;
  cycleOpen: boolean;
  lastCycleStartedAt: number | null;
  lastCycleEndedAt: number | null;
  /** Autopilot cycles started today (UTC). */
  cyclesToday: number;
  /** Model spend today in USD cents (an Estimate). */
  spentTodayMinor: number;
  /** Finished cycles since `since`, newest first (plus failures that wrote no cycle: `unrecordedFailures`). */
  recentCycles: readonly AutopilotCycleSummary[];
  unrecordedFailures?: number;
}

export type AutopilotDecision =
  | { action: "off" }
  /** The business is archived: the workflow ends without changing anything. */
  | { action: "end"; note: string }
  /** Autopilot paused itself earlier and stays paused until the founder turns it on. */
  | { action: "paused"; reason: AutopilotPauseReason; note: string }
  /** A guard rail just paused it: persist the pause (and tell the founder). */
  | { action: "pause"; reason: AutopilotPauseReason; note: string }
  | { action: "wait"; why: AutopilotWaitReason; note: string; nextAt: number | null; until: number | null }
  | { action: "start"; nextAt: number };

/** Plain words for a pause, shown wherever the founder sees the state. */
export function pauseNote(reason: AutopilotPauseReason, idleCycles: number = AUTOPILOT_LIMITS.maxIdleCycles.default): string {
  switch (reason) {
    case "kill_switch":
      return "Stop all agents was pressed, so Autopilot paused. Resume the agents, then turn Autopilot back on.";
    case "key_revoked":
      return "The Anthropic key was revoked and the team stopped, so Autopilot paused. Store a key, then turn Autopilot back on.";
    case "credits_exhausted":
      return "This month's credits are used up, so Autopilot paused. Top up in Settings › Billing, then turn Autopilot back on.";
    case "idle_cycles":
      return `The last ${idleCycles} cycle${idleCycles === 1 ? "" : "s"} failed or did nothing, so Autopilot paused. Read the note in the Inbox, then turn it back on.`;
  }
}

/** How much Autopilot may spend today (USD cents, an Estimate): the ceiling, never more than the credits there are. */
export function effectiveSpendCeiling(settings: Pick<AutopilotSettings, "spendCeilingMinor">, spentTodayMinor: number, creditsRemainingMinor: number | null): number | null {
  const credits = creditsRemainingMinor === null ? null : spentTodayMinor + Math.max(0, creditsRemainingMinor);
  if (settings.spendCeilingMinor === null) return credits;
  return credits === null ? settings.spendCeilingMinor : Math.min(settings.spendCeilingMinor, credits);
}

/**
 * The one decision, pure: what Autopilot does now. Order matters: what is off, paused or stopped first; then the
 * standing waits (vacation, a running cycle, the founder's decision, the day's limits); then the schedule.
 */
export function decideAutopilot(f: AutopilotFacts): AutopilotDecision {
  if (!f.enabled) return { action: "off" };
  if (f.archived) return { action: "end", note: "This business is archived, so Autopilot ended." };
  const idleMax = f.settings.maxIdleCycles;
  if (f.pausedReason) return { action: "paused", reason: f.pausedReason, note: pauseNote(f.pausedReason, idleMax) };
  if (f.stopReason) return { action: "pause", reason: f.stopReason, note: pauseNote(f.stopReason) };
  if (f.creditsRemainingMinor !== null && f.creditsRemainingMinor <= 0) return { action: "pause", reason: "credits_exhausted", note: pauseNote("credits_exhausted") };
  if (idleStreak(f.recentCycles) + (f.unrecordedFailures ?? 0) >= idleMax) return { action: "pause", reason: "idle_cycles", note: pauseNote("idle_cycles", idleMax) };

  const nextAt = plannedCycleAt(f.settings, { startedAt: f.lastCycleStartedAt, endedAt: f.lastCycleEndedAt }, f.since);
  const tomorrow = utcDayStart(f.now) + DAY_MS;
  if (f.vacation) return { action: "wait", why: "vacation", note: "You are on vacation; the Chief of Staff runs the cycles until you come back.", nextAt: null, until: null };
  if (f.cycleOpen) return { action: "wait", why: "cycle_running", note: "A cycle is running; the next one is planned when it ends.", nextAt: null, until: null };
  if (f.blockingItems > 0) return { action: "wait", why: "inbox", note: `Waiting for you: ${f.blockingItems} Inbox item${f.blockingItems === 1 ? "" : "s"} need${f.blockingItems === 1 ? "s" : ""} your decision. Autopilot never decides for you.`, nextAt, until: null };
  if (f.cyclesToday >= f.settings.maxCyclesPerDay) return { action: "wait", why: "daily_cycles", note: `Today's limit of ${f.settings.maxCyclesPerDay} cycle${f.settings.maxCyclesPerDay === 1 ? "" : "s"} is reached; Autopilot continues tomorrow (UTC).`, nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  const ceiling = effectiveSpendCeiling(f.settings, f.spentTodayMinor, f.creditsRemainingMinor);
  if (ceiling !== null && f.spentTodayMinor >= ceiling) return { action: "wait", why: "daily_spend", note: "Today's spend ceiling is reached (Estimate); Autopilot continues tomorrow (UTC).", nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  if (nextAt > f.now) return { action: "wait", why: "schedule", note: "The next cycle is planned.", nextAt, until: nextAt };
  return { action: "start", nextAt };
}

/** What the founder sees on Home and in Settings. */
export type AutopilotState = "off" | "on" | "waiting" | "paused";

export interface AutopilotView {
  state: AutopilotState;
  /** The chip text: On, Waiting for you, Paused: reason, Off. */
  label: string;
  /** One plain sentence under it. */
  detail: string;
  /** The next planned cycle (epoch ms), an Estimate; null when none is planned. */
  nextAt: number | null;
}

const PAUSE_SHORT: Record<AutopilotPauseReason, string> = {
  kill_switch: "agents stopped",
  key_revoked: "key revoked",
  credits_exhausted: "credits used up",
  idle_cycles: "nothing got done",
};

export function autopilotView(d: AutopilotDecision): AutopilotView {
  switch (d.action) {
    case "off":
      return { state: "off", label: "Off", detail: "Cycles start when you press Continue.", nextAt: null };
    case "end":
      return { state: "off", label: "Off", detail: d.note, nextAt: null };
    case "paused":
    case "pause":
      return { state: "paused", label: `Paused: ${PAUSE_SHORT[d.reason]}`, detail: d.note, nextAt: null };
    case "wait":
      if (d.why === "inbox") return { state: "waiting", label: "Waiting for you", detail: d.note, nextAt: d.nextAt };
      if (d.why === "vacation") return { state: "waiting", label: "Waiting: on vacation", detail: d.note, nextAt: null };
      if (d.why === "daily_cycles") return { state: "waiting", label: "Waiting: daily limit reached", detail: d.note, nextAt: d.nextAt };
      if (d.why === "daily_spend") return { state: "waiting", label: "Waiting: spend ceiling reached", detail: d.note, nextAt: d.nextAt };
      return { state: "on", label: "On", detail: d.why === "cycle_running" ? d.note : "Autopilot is running the business.", nextAt: d.nextAt };
    case "start":
      return { state: "on", label: "On", detail: "A cycle is about to start.", nextAt: d.nextAt };
  }
}
