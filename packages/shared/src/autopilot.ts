/**
 * Autopilot (0055): a business that starts its own cycles. Pure vocabulary and decision logic, shared by the API (the
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

export const AUTOPILOT_CADENCES = ["after_cycle", "every_1h", "every_4h", "every_12h", "daily", "every_3_days"] as const;
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
  every_3_days: { label: "Every third day", summary: "Once every three days at the hour you choose (UTC).", intervalMs: null },
};

/** A cadence that runs at the founder's chosen hour (`dailyHour`): daily, or every third day (WP-09 T12). */
export const isHourlyScheduledCadence = (cadence: AutopilotCadence): boolean => cadence === "daily" || cadence === "every_3_days";

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
  /**
   * Autopilot's own limits (founder, 2026-11-12: "split the limits"), apart from the shared daily ones above, which also
   * bound Continue: how many cycles Autopilot itself may start a UTC day, and what those cycles may spend (USD cents, an
   * Estimate). They count only the cycles Autopilot starts on its schedule, never a press of Continue or the rounds of
   * its run. Null: no limit of its own. The spend ceiling is also the budget the cycle is given, so it holds while the
   * cycle runs, not only at its start.
   */
  ownMaxCyclesPerDay: number | null;
  ownSpendCeilingMinor: number | null;
}

export const AUTOPILOT_DEFAULT_SETTINGS: AutopilotSettings = {
  cadence: AUTOPILOT_LIMITS.defaultCadence,
  dailyHour: AUTOPILOT_LIMITS.dailyHour.default,
  maxCyclesPerDay: AUTOPILOT_LIMITS.maxCyclesPerDay.default,
  spendCeilingMinor: null,
  maxIdleCycles: AUTOPILOT_LIMITS.maxIdleCycles.default,
  ownMaxCyclesPerDay: null,
  ownSpendCeilingMinor: null,
};

/** Why Autopilot is holding off for now (it stays on). */
export const AUTOPILOT_WAIT_REASONS = ["vacation", "cycle_running", "inbox", "daily_cycles", "daily_spend", "schedule", "entry_plan"] as const;
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
  // Every third day: the chosen hour, two days after the next one once a cycle has run (the first is the next one).
  else if (settings.cadence === "every_3_days") at = nextDailyAt(basis, settings.dailyHour) + (last.endedAt === null ? 0 : 2 * DAY_MS);
  else if (last.endedAt === null) at = since;
  else at = basis + (AUTOPILOT_CADENCE_INFO[settings.cadence].intervalMs ?? 0);
  if (last.startedAt !== null) at = Math.max(at, last.startedAt + AUTOPILOT_LIMITS.minIntervalMs);
  return at;
}

/** Everything the decision reads, gathered by `loadAutopilotFacts` (packages/db) with a clock reading. */
export interface AutopilotFacts {
  now: number;
  /**
   * Paid entry (WP-09 T16): false while sign-up is paid and no owner holds the entry plan, so no cycle starts on its
   * own and a run ends. Absent or true: open (the switch is off, or the plan is paid).
   */
  entryPlanOpen?: boolean;
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
  /**
   * Cycles started today (UTC) that count toward the daily cap: Autopilot's and the founder's Continue presses with the
   * rounds a press runs (triggers `autopilot` and `continue`; one set of limits since Nov 7, 2026). A vacation's cycles
   * and wake-ups do not count.
   */
  cyclesToday: number;
  /** Model spend today in USD cents (an Estimate). */
  spentTodayMinor: number;
  /** Cycles Autopilot itself started today (UTC): its schedule's, not a Continue run's rounds. Absent: 0. */
  ownCyclesToday?: number;
  /** What those cycles cost today, USD cents (an Estimate). Absent: 0. */
  ownSpentTodayMinor?: number;
  /** Finished cycles since `since`, newest first (plus failures that wrote no cycle: `unrecordedFailures`). */
  recentCycles: readonly AutopilotCycleSummary[];
  unrecordedFailures?: number;
  /** The run one press of Continue started, while it lasts (`decideRun`); null or absent: no run. */
  run?: ContinueRunFacts | null;
}

/**
 * Continue runs until done (founder, Nov 7, 2026): one press starts a run, and the `autopilot:<businessId>` workflow
 * starts round after round (cycle after cycle) until the run ends. The run is derived from the event log
 * (`cycle.run_started` / `cycle.run_ended`), never stored on the business row.
 */
export const CONTINUE_RUN_END_REASONS = ["done", "hard_stop", "paused", "stopped", "vacation", "daily_cycles", "daily_spend", "archived", "lost"] as const;
export type ContinueRunEndReason = (typeof CONTINUE_RUN_END_REASONS)[number];

/** The sentence a press that started a run adds (Nov 7, 2026): new cycles keep starting on their own. */
export const RUN_UNTIL_DONE = "New cycles start on their own until nothing is left to do, or until you pause.";

export const CONTINUE_RUN_LIMITS = {
  /** No two rounds of a run start closer than this (stops a hot loop of empty rounds); no 15-minute floor. */
  minGapMs: 60 * 1000,
  /** How often a run looks again while another cycle is open. */
  pollMs: 60 * 1000,
  /** A run with no end recorded this long after its start is a lost one, like a stale cycle. */
  staleMs: 36 * HOUR_MS,
} as const;

export interface ContinueRunFacts {
  id: string;
  /** Epoch ms. */
  startedAt: number;
  /** Rounds of this run that finished (cycles completed at or after `startedAt`). */
  rounds: number;
  /** The newest finished round of this run; null before the first one ends. */
  lastRound: AutopilotCycleSummary | null;
  /** Rounds of this run that failed before writing a cycle (the workflow counts them). */
  unrecordedFailures?: number;
}

export type ContinueRunDecision =
  | { action: "end"; reason: ContinueRunEndReason }
  /** `cycle_running`: another cycle is open (the run's own first round included); `gap`: the 1-minute gap between rounds. */
  | { action: "wait"; why: "cycle_running" | "gap"; until: number | null }
  | { action: "start" };

/**
 * What a run does now, pure; null when there is no run. Called before `decideAutopilot` (whether or not Autopilot is
 * on), and once a run ends the scheduled decision applies again unchanged. Order: the business is archived; a hard stop
 * (the stop flag, used-up credits, an Inbox item that blocks Continue); a vacation; another cycle still running; the
 * last round did nothing (decisions waiting in Needs you never hold a run: a round that only waited on them is idle,
 * rule 0071); the day's cycle cap and spend ceiling (the same limits as Autopilot's); the 1-minute gap; then start.
 */
export function decideRun(f: AutopilotFacts): ContinueRunDecision | null {
  const run = f.run;
  if (!run) return null;
  if (f.archived) return { action: "end", reason: "archived" };
  if (f.stopReason || (f.creditsRemainingMinor !== null && f.creditsRemainingMinor <= 0) || f.blockingItems > 0 || f.entryPlanOpen === false) return { action: "end", reason: "hard_stop" };
  if (f.vacation) return { action: "end", reason: "vacation" };
  if (f.cycleOpen) return { action: "wait", why: "cycle_running", until: null };
  if (run.lastRound?.outcome === "stopped") return { action: "end", reason: "stopped" };
  if ((run.lastRound && isIdleCycle(run.lastRound)) || (run.unrecordedFailures ?? 0) > 0) return { action: "end", reason: "done" };
  if (f.cyclesToday >= f.settings.maxCyclesPerDay) return { action: "end", reason: "daily_cycles" };
  const ceiling = effectiveSpendCeiling(f.settings, f.spentTodayMinor, f.creditsRemainingMinor);
  if (ceiling !== null && f.spentTodayMinor >= ceiling) return { action: "end", reason: "daily_spend" };
  const gapUntil = f.lastCycleStartedAt === null ? null : f.lastCycleStartedAt + CONTINUE_RUN_LIMITS.minGapMs;
  if (gapUntil !== null && gapUntil > f.now) return { action: "wait", why: "gap", until: gapUntil };
  return { action: "start" };
}

/**
 * What the founder reads when a run ends on its own (a toast in the shell; the daily limits also leave a note in the
 * Inbox). Null for the ends the founder caused or already hears about elsewhere: Pause, Stop all agents, an archived
 * business. The same words for every member watching the business.
 */
export function continueRunEndedMessage(reason: ContinueRunEndReason, maxCyclesPerDay?: number | null): { title: string; description: string; tone: "info" | "good" | "warn" } | null {
  switch (reason) {
    case "done":
      return { title: "The team has done all it can for now", description: "Anything waiting for you is in the Inbox's Needs you tab.", tone: "good" };
    case "daily_cycles":
      return { title: typeof maxCyclesPerDay === "number" ? `Today's limit of ${maxCyclesPerDay} cycle${maxCyclesPerDay === 1 ? "" : "s"} is reached` : "Today's cycle limit is reached", description: "No more cycles start on their own today. Raise the limit in Settings › What the team can do, or press Continue for one more.", tone: "warn" };
    case "daily_spend":
      return { title: "Today's spend ceiling is reached (Estimate)", description: "No more cycles start on their own today. Raise the ceiling in Settings › What the team can do, or press Continue for one more.", tone: "warn" };
    case "hard_stop":
      return { title: "The team stopped working", description: "Something needs you before the team can carry on. Open Needs you.", tone: "warn" };
    case "vacation":
      return { title: "You are on vacation", description: "The Chief of Staff runs the cycles until you come back.", tone: "info" };
    case "lost":
      return { title: "New cycles stopped starting", description: "Press Continue to keep the team working.", tone: "warn" };
    case "paused":
    case "stopped":
    case "archived":
      return null;
  }
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

/**
 * The chip's word while a note holds Continue: the one "needs you" family the product uses (UX plan §5.5, "answer").
 * Shown by the Home chip, Settings › What the team can do and the department cards.
 */
export const AUTOPILOT_NEEDS_ANSWER_LABEL = "Needs your answer";

/** Why Autopilot waits on the founder, in plain words: "2 notes in the Inbox need your answer. Autopilot never answers them for you." */
export function inboxWaitNote(blockingItems: number): string {
  const one = blockingItems === 1;
  return `${one ? "1 note" : `${blockingItems} notes`} in the Inbox need${one ? "s" : ""} your answer. Autopilot never answers ${one ? "it" : "them"} for you.`;
}

/** How much Autopilot may spend today (USD cents, an Estimate): the ceiling, never more than the credits there are. */
export function effectiveSpendCeiling(settings: Pick<AutopilotSettings, "spendCeilingMinor">, spentTodayMinor: number, creditsRemainingMinor: number | null): number | null {
  const credits = creditsRemainingMinor === null ? null : spentTodayMinor + Math.max(0, creditsRemainingMinor);
  if (settings.spendCeilingMinor === null) return credits;
  return credits === null ? settings.spendCeilingMinor : Math.min(settings.spendCeilingMinor, credits);
}

/**
 * The budget a cycle Autopilot starts on its own is given (USD cents, an Estimate): what is left of its own spend
 * ceiling today. Null: no ceiling of its own (the cycle has the credits, as any cycle does).
 */
export function autopilotCycleBudgetMinor(f: Pick<AutopilotFacts, "settings" | "ownSpentTodayMinor">): number | null {
  const ceiling = f.settings.ownSpendCeilingMinor;
  if (ceiling === null || ceiling === undefined) return null;
  return Math.max(0, ceiling - (f.ownSpentTodayMinor ?? 0));
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
  if (f.entryPlanOpen === false) return { action: "wait", why: "entry_plan", note: "The team starts working once you subscribe in Settings › Billing.", nextAt: null, until: null };
  if (f.vacation) return { action: "wait", why: "vacation", note: "You are on vacation; the Chief of Staff runs the cycles until you come back.", nextAt: null, until: null };
  if (f.cycleOpen) return { action: "wait", why: "cycle_running", note: "A cycle is running; the next one is planned when it ends.", nextAt: null, until: null };
  if (f.blockingItems > 0) return { action: "wait", why: "inbox", note: inboxWaitNote(f.blockingItems), nextAt, until: null };
  if (f.cyclesToday >= f.settings.maxCyclesPerDay) return { action: "wait", why: "daily_cycles", note: `Today's limit of ${f.settings.maxCyclesPerDay} cycle${f.settings.maxCyclesPerDay === 1 ? "" : "s"} is reached; Autopilot continues tomorrow (UTC).`, nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  const ceiling = effectiveSpendCeiling(f.settings, f.spentTodayMinor, f.creditsRemainingMinor);
  if (ceiling !== null && f.spentTodayMinor >= ceiling) return { action: "wait", why: "daily_spend", note: "Today's spend ceiling is reached (Estimate); Autopilot continues tomorrow (UTC).", nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  // Autopilot's own limits: only the cycles it starts itself count (a press of Continue never uses them up).
  const own = f.settings.ownMaxCyclesPerDay;
  if (own !== null && own !== undefined && (f.ownCyclesToday ?? 0) >= own) return { action: "wait", why: "daily_cycles", note: `Autopilot's own limit of ${own} cycle${own === 1 ? "" : "s"} a day is reached; it continues tomorrow (UTC). Continue still works.`, nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  if (autopilotCycleBudgetMinor(f) === 0) return { action: "wait", why: "daily_spend", note: "Autopilot's own spend for today is reached (Estimate); it continues tomorrow (UTC). Continue still works.", nextAt: Math.max(nextAt, tomorrow), until: tomorrow };
  if (nextAt > f.now) return { action: "wait", why: "schedule", note: "The next cycle is planned.", nextAt, until: nextAt };
  return { action: "start", nextAt };
}

/** What the founder sees on Home and in Settings. */
export type AutopilotState = "off" | "on" | "waiting" | "paused";

export interface AutopilotView {
  state: AutopilotState;
  /** The chip text: On, Needs your answer, Paused: reason, Off. */
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
      return { state: "off", label: "Off", detail: "Continue keeps the team working until nothing is left. Turn Autopilot on to start work on a schedule.", nextAt: null };
    case "end":
      return { state: "off", label: "Off", detail: d.note, nextAt: null };
    case "paused":
    case "pause":
      return { state: "paused", label: `Paused: ${PAUSE_SHORT[d.reason]}`, detail: d.note, nextAt: null };
    case "wait":
      if (d.why === "inbox") return { state: "waiting", label: AUTOPILOT_NEEDS_ANSWER_LABEL, detail: d.note, nextAt: d.nextAt };
      if (d.why === "vacation") return { state: "waiting", label: "Waiting: on vacation", detail: d.note, nextAt: null };
      if (d.why === "daily_cycles") return { state: "waiting", label: "Waiting: daily limit reached", detail: d.note, nextAt: d.nextAt };
      if (d.why === "daily_spend") return { state: "waiting", label: "Waiting: spend ceiling reached", detail: d.note, nextAt: d.nextAt };
      return { state: "on", label: "On", detail: d.why === "cycle_running" ? d.note : "Autopilot is running the business.", nextAt: d.nextAt };
    case "start":
      return { state: "on", label: "On", detail: "A cycle is about to start.", nextAt: d.nextAt };
  }
}

/**
 * The overnight shift (retention plan, founder 2026-11-11; off when Commit opens since 2026-11-17, founder's answer A4,
 * WP-14 T11): when the founder turns it on, Commit turns Autopilot on at about 2 AM in the founder's time zone. Every
 * third night (founder, Nov 16, 2026, WP-09 D7 option B): one round of work with a budget of $0.45, three nights' worth
 * (founder, Nov 16: enough to finish one session; an Estimate, about $4.50 a month, inside the free tier's $5). Autopilot's own limits
 * (one cycle a day, its own spend ceiling, which is also that cycle's budget), apart from Continue's (founder, 2026-11-12); every Autopilot guard rail still holds (used-up credits,
 * failed or empty nights in a row, a hard stop, a vacation) and it never answers a note. Settings › What the team can do
 * changes or turns it off.
 */
export const OVERNIGHT_SHIFT = { localHour: 2, cadence: "every_3_days" as AutopilotCadence, ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 45 } as const;

/** The UTC hour that is `localHour` in `timeZone` on the day of `now` (UTC when the zone is unknown). */
export function overnightUtcHour(timeZone: string | null | undefined, now: Date = new Date(), localHour: number = OVERNIGHT_SHIFT.localHour): number {
  if (!timeZone) return localHour;
  try {
    // The zone's wall clock read back as if it were UTC: the difference is the zone's offset at that moment.
    const wall = new Date(now.toLocaleString("en-US", { timeZone }) + " UTC");
    const offsetHours = Math.round((wall.getTime() - Math.floor(now.getTime() / 60_000) * 60_000) / 3_600_000);
    if (!Number.isFinite(offsetHours)) return localHour;
    return (((localHour - offsetHours) % 24) + 24) % 24;
  } catch {
    return localHour;
  }
}
