/**
 * The Autopilot decision (pure): every guard rail of the brief, the schedule, and the chip the founder reads.
 */
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_DEFAULT_SETTINGS,
  AUTOPILOT_LIMITS,
  autopilotView,
  CONTINUE_RUN_END_REASONS,
  CONTINUE_RUN_LIMITS,
  continueRunEndedMessage,
  decideAutopilot,
  decideRun,
  effectiveSpendCeiling,
  idleStreak,
  isIdleCycle,
  nextDailyAt,
  plannedCycleAt,
  utcDayStart,
  type AutopilotCycleSummary,
  type AutopilotFacts,
  overnightUtcHour,
  autopilotCycleBudgetMinor,
  OVERNIGHT_SHIFT,
  isHourlyScheduledCadence,
} from "./autopilot";

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13, 10, 0, 0); // Oct 13, 2026 10:00 UTC
const productive: AutopilotCycleSummary = { outcome: "completed", tasksDispatched: 3, tasksCompleted: 3 };
const empty: AutopilotCycleSummary = { outcome: "completed", tasksDispatched: 0, tasksCompleted: 0 };
const failed: AutopilotCycleSummary = { outcome: "failed", tasksDispatched: 1, tasksCompleted: 0 };

function facts(patch: Partial<AutopilotFacts> = {}): AutopilotFacts {
  return {
    now: NOW,
    enabled: true,
    pausedReason: null,
    since: NOW - 10 * H,
    settings: { ...AUTOPILOT_DEFAULT_SETTINGS },
    archived: false,
    stopReason: null,
    creditsRemainingMinor: 5_000,
    vacation: false,
    blockingItems: 0,
    cycleOpen: false,
    lastCycleStartedAt: NOW - 6 * H,
    lastCycleEndedAt: NOW - 5 * H,
    cyclesToday: 1,
    spentTodayMinor: 100,
    recentCycles: [productive],
    ...patch,
  };
}

describe("the schedule", () => {
  it("as soon as the last cycle ends: due at the end, but never within 15 minutes of the last start", () => {
    const s = { cadence: "after_cycle" as const, dailyHour: 9 };
    expect(plannedCycleAt(s, { startedAt: NOW - 3 * H, endedAt: NOW - 2 * H }, NOW - 10 * H)).toBe(NOW - 2 * H);
    // A cycle that started and ended within a minute still leaves 15 minutes before the next start.
    const start = NOW - 60_000;
    expect(plannedCycleAt(s, { startedAt: start, endedAt: start + 30_000 }, NOW - 10 * H)).toBe(start + AUTOPILOT_LIMITS.minIntervalMs);
  });

  it("every 1, 4 and 12 hours count from the end of the last cycle", () => {
    const last = { startedAt: NOW - 3 * H, endedAt: NOW - 2 * H };
    expect(plannedCycleAt({ cadence: "every_1h", dailyHour: 9 }, last, 0)).toBe(NOW - 1 * H);
    expect(plannedCycleAt({ cadence: "every_4h", dailyHour: 9 }, last, 0)).toBe(NOW + 2 * H);
    expect(plannedCycleAt({ cadence: "every_12h", dailyHour: 9 }, last, 0)).toBe(NOW + 10 * H);
  });

  it("every third day runs at the chosen hour: the next one first, then two days after the next one (WP-09 T12)", () => {
    const s = { cadence: "every_3_days" as const, dailyHour: 2 };
    expect(plannedCycleAt(s, { startedAt: null, endedAt: null }, NOW)).toBe(Date.UTC(2026, 9, 14, 2, 0));
    // A night that ran Oct 14 at 2 AM: the next is Oct 17.
    expect(plannedCycleAt(s, { startedAt: Date.UTC(2026, 9, 14, 2, 0), endedAt: Date.UTC(2026, 9, 14, 2, 30) }, 0)).toBe(Date.UTC(2026, 9, 17, 2, 0));
    expect(isHourlyScheduledCadence("every_3_days")).toBe(true);
    expect(isHourlyScheduledCadence("every_12h")).toBe(false);
  });

  it("with no cycle yet the first one is due as soon as Autopilot was turned on", () => {
    expect(plannedCycleAt({ cadence: "every_12h", dailyHour: 9 }, { startedAt: null, endedAt: null }, NOW - H)).toBe(NOW - H);
  });

  it("daily runs at the chosen UTC hour, today if it is still ahead, otherwise tomorrow", () => {
    expect(nextDailyAt(Date.UTC(2026, 9, 13, 8, 0), 9)).toBe(Date.UTC(2026, 9, 13, 9, 0));
    expect(nextDailyAt(Date.UTC(2026, 9, 13, 9, 0), 9)).toBe(Date.UTC(2026, 9, 14, 9, 0));
    expect(nextDailyAt(Date.UTC(2026, 9, 13, 23, 59), 0)).toBe(Date.UTC(2026, 9, 14, 0, 0));
    const s = { cadence: "daily" as const, dailyHour: 9 };
    expect(plannedCycleAt(s, { startedAt: NOW - 25 * H, endedAt: NOW - 24 * H }, 0)).toBe(Date.UTC(2026, 9, 13, 9, 0));
    expect(plannedCycleAt(s, { startedAt: null, endedAt: null }, NOW)).toBe(Date.UTC(2026, 9, 14, 9, 0));
  });

  it("utcDayStart is midnight UTC", () => {
    expect(utcDayStart(NOW)).toBe(Date.UTC(2026, 9, 13));
  });
});

describe("failed and empty cycles", () => {
  it("classifies cycles", () => {
    expect(isIdleCycle(productive)).toBe(false);
    expect(isIdleCycle(empty)).toBe(true);
    expect(isIdleCycle(failed)).toBe(true);
    expect(isIdleCycle({ outcome: "waiting", tasksDispatched: 2, tasksCompleted: 0 })).toBe(true);
    // Work still running at the time box is progress; a stopped cycle is the stop's business.
    expect(isIdleCycle({ outcome: "time_box", tasksDispatched: 2, tasksCompleted: 0 })).toBe(false);
    expect(isIdleCycle({ outcome: "stopped", tasksDispatched: 0, tasksCompleted: 0 })).toBe(false);
  });

  it("counts consecutive idle cycles from the newest, skipping stopped ones", () => {
    expect(idleStreak([empty, failed, productive, empty])).toBe(2);
    expect(idleStreak([productive, empty])).toBe(0);
    expect(idleStreak([empty, { outcome: "stopped", tasksDispatched: 0, tasksCompleted: 0 }, failed])).toBe(2);
  });
});

describe("decideAutopilot: guard rails always win", () => {
  it("off when it is not turned on", () => {
    expect(decideAutopilot(facts({ enabled: false }))).toEqual({ action: "off" });
  });

  it("an archived business ends it", () => {
    expect(decideAutopilot(facts({ archived: true })).action).toBe("end");
  });

  it("a paused Autopilot stays paused with its reason, whatever else is true", () => {
    const d = decideAutopilot(facts({ pausedReason: "kill_switch", stopReason: null }));
    expect(d).toMatchObject({ action: "paused", reason: "kill_switch" });
  });

  it("the business stop flag pauses it, for each reason, and never starts a cycle", () => {
    for (const stopReason of ["kill_switch", "key_revoked", "credits_exhausted"] as const) {
      const d = decideAutopilot(facts({ stopReason, lastCycleEndedAt: NOW - 100 * H }));
      expect(d).toMatchObject({ action: "pause", reason: stopReason });
    }
  });

  it("used-up credits (402) pause it even before the stop flag is written", () => {
    expect(decideAutopilot(facts({ creditsRemainingMinor: 0 }))).toMatchObject({ action: "pause", reason: "credits_exhausted" });
    expect(decideAutopilot(facts({ creditsRemainingMinor: -5 }))).toMatchObject({ action: "pause", reason: "credits_exhausted" });
  });

  it("a business on its own key has no credits to run out of", () => {
    expect(decideAutopilot(facts({ creditsRemainingMinor: null, lastCycleEndedAt: NOW - 100 * H })).action).toBe("start");
  });

  it("N failed or empty cycles in a row pause it; one fewer does not", () => {
    expect(decideAutopilot(facts({ recentCycles: [empty, failed, empty] }))).toMatchObject({ action: "pause", reason: "idle_cycles" });
    expect(decideAutopilot(facts({ recentCycles: [empty, failed, productive], lastCycleEndedAt: NOW - 100 * H })).action).toBe("start");
    expect(decideAutopilot(facts({ settings: { ...AUTOPILOT_DEFAULT_SETTINGS, maxIdleCycles: 1 }, recentCycles: [failed] }))).toMatchObject({ action: "pause", reason: "idle_cycles" });
  });

  it("failures that wrote no cycle count toward the streak", () => {
    expect(decideAutopilot(facts({ recentCycles: [empty], unrecordedFailures: 2 }))).toMatchObject({ action: "pause", reason: "idle_cycles" });
  });

  it("the guard-rail pauses outrank a vacation, an Inbox item and the schedule", () => {
    const d = decideAutopilot(facts({ stopReason: "kill_switch", vacation: true, blockingItems: 3, cycleOpen: true }));
    expect(d).toMatchObject({ action: "pause", reason: "kill_switch" });
  });
});

describe("decideAutopilot: it waits, it never decides for the founder", () => {
  const due = { lastCycleStartedAt: NOW - 100 * H, lastCycleEndedAt: NOW - 99 * H };

  it("paid entry without the entry plan: no cycle starts on its own (WP-09 T16)", () => {
    expect(decideAutopilot(facts({ ...due, entryPlanOpen: false }))).toMatchObject({ action: "wait", why: "entry_plan", until: null });
    expect(decideAutopilot(facts({ ...due, entryPlanOpen: true })).action).toBe(decideAutopilot(facts(due)).action);
  });

  it("a vacation in progress: the vacation loop owns the cycles", () => {
    expect(decideAutopilot(facts({ ...due, vacation: true }))).toMatchObject({ action: "wait", why: "vacation" });
  });

  it("never two cycles at once", () => {
    expect(decideAutopilot(facts({ ...due, cycleOpen: true }))).toMatchObject({ action: "wait", why: "cycle_running" });
  });

  it("an Inbox item that blocks Continue: Needs your answer, with the planned time kept", () => {
    const d = decideAutopilot(facts({ ...due, blockingItems: 2 }));
    expect(d).toMatchObject({ action: "wait", why: "inbox" });
    expect(autopilotView(d)).toMatchObject({ state: "waiting", label: "Needs your answer" });
    expect(autopilotView(d).detail).toBe("2 notes in the Inbox need your answer. Autopilot never answers them for you.");
    expect(autopilotView(decideAutopilot(facts({ ...due, blockingItems: 1 }))).detail).toBe("1 note in the Inbox needs your answer. Autopilot never answers it for you.");
    // One word for "needs you" everywhere a founder reads it (UX plan §5.5): never "Waiting for you".
    expect(autopilotView(d).label).not.toMatch(/Waiting for you/);
  });

  it("the day's cycle cap waits until tomorrow (UTC)", () => {
    const d = decideAutopilot(facts({ ...due, cyclesToday: 6 }));
    expect(d).toMatchObject({ action: "wait", why: "daily_cycles", until: Date.UTC(2026, 9, 14) });
    expect(decideAutopilot(facts({ ...due, cyclesToday: 5 })).action).toBe("start");
    expect(decideAutopilot(facts({ ...due, settings: { ...AUTOPILOT_DEFAULT_SETTINGS, maxCyclesPerDay: 1 }, cyclesToday: 1 }))).toMatchObject({ why: "daily_cycles" });
  });

  it("the day's spend ceiling waits until tomorrow, and never exceeds the credits", () => {
    const settings = { ...AUTOPILOT_DEFAULT_SETTINGS, spendCeilingMinor: 500 };
    expect(decideAutopilot(facts({ ...due, settings, spentTodayMinor: 500 }))).toMatchObject({ action: "wait", why: "daily_spend" });
    expect(decideAutopilot(facts({ ...due, settings, spentTodayMinor: 499 })).action).toBe("start");
    // A ceiling above what the credits can pay is capped at the credits: 300 spent + 100 left = 400.
    expect(effectiveSpendCeiling({ spendCeilingMinor: 10_000 }, 300, 100)).toBe(400);
    expect(effectiveSpendCeiling({ spendCeilingMinor: null }, 300, 100)).toBe(400);
    expect(effectiveSpendCeiling({ spendCeilingMinor: null }, 300, null)).toBeNull();
    expect(effectiveSpendCeiling({ spendCeilingMinor: 50 }, 0, null)).toBe(50);
  });

  it("a business on its own key with no ceiling has no spend limit", () => {
    expect(decideAutopilot(facts({ ...due, creditsRemainingMinor: null, spentTodayMinor: 9_999_999 })).action).toBe("start");
  });

  it("not yet due: waits for the planned time", () => {
    const d = decideAutopilot(facts()); // every 4h, last ended 5h ago... due; make it recent
    expect(d.action).toBe("start");
    const soon = decideAutopilot(facts({ lastCycleStartedAt: NOW - 2 * H, lastCycleEndedAt: NOW - H }));
    expect(soon).toMatchObject({ action: "wait", why: "schedule", nextAt: NOW + 3 * H, until: NOW + 3 * H });
    expect(autopilotView(soon)).toMatchObject({ state: "on", label: "On", nextAt: NOW + 3 * H });
  });

  it("starts when everything is clear and the time has come", () => {
    expect(decideAutopilot(facts({ ...due }))).toMatchObject({ action: "start" });
  });
});

describe("autopilotView: the chip", () => {
  it("shows Off, On, Needs your answer and Paused with the reason", () => {
    expect(autopilotView({ action: "off" })).toMatchObject({ state: "off", label: "Off" });
    expect(autopilotView(decideAutopilot(facts({ stopReason: "kill_switch" })))).toMatchObject({ state: "paused", label: "Paused: agents stopped" });
    expect(autopilotView(decideAutopilot(facts({ creditsRemainingMinor: 0 })))).toMatchObject({ state: "paused", label: "Paused: credits used up" });
    expect(autopilotView(decideAutopilot(facts({ recentCycles: [empty, empty, empty] })))).toMatchObject({ state: "paused", label: "Paused: nothing got done" });
    expect(autopilotView(decideAutopilot(facts({ pausedReason: "key_revoked" }))).detail).toMatch(/Store a key/);
    expect(autopilotView(decideAutopilot(facts({ vacation: true, lastCycleEndedAt: NOW - 100 * H })))).toMatchObject({ state: "waiting", label: "Waiting: on vacation" });
  });
});

describe("decideRun: Continue runs until done (Nov 7, 2026)", () => {
  const run = { id: "run-1", startedAt: NOW - 2 * H, rounds: 1, lastRound: productive };
  const live = (patch: Partial<AutopilotFacts> = {}) => facts({ run, lastCycleStartedAt: NOW - 1 * H, lastCycleEndedAt: NOW - 30 * 60_000, ...patch });

  it("is null without a run, so the schedule decides alone", () => {
    expect(decideRun(facts())).toBeNull();
    expect(decideRun(facts({ run: null }))).toBeNull();
  });

  it("starts the next round when the last one got work done, with no 15-minute floor, even with Autopilot off", () => {
    expect(decideRun(live())).toEqual({ action: "start" });
    // Two minutes after the last start: Autopilot's own schedule would still wait out its 15 minutes.
    const soon = live({ enabled: false, lastCycleStartedAt: NOW - 2 * 60_000, lastCycleEndedAt: NOW - 60_000 });
    expect(decideRun(soon)).toEqual({ action: "start" });
    expect(decideAutopilot({ ...soon, enabled: true, settings: { ...soon.settings, cadence: "after_cycle" } })).toMatchObject({ action: "wait", why: "schedule" });
  });

  it("starts the first round as soon as nothing is open (no round finished yet)", () => {
    expect(decideRun(live({ run: { ...run, rounds: 0, lastRound: null } }))).toEqual({ action: "start" });
  });

  it("keeps a 1-minute gap between rounds", () => {
    const start = NOW - 20_000;
    expect(decideRun(live({ lastCycleStartedAt: start, lastCycleEndedAt: NOW - 5_000 }))).toEqual({ action: "wait", why: "gap", until: start + CONTINUE_RUN_LIMITS.minGapMs });
  });

  it("waits while another cycle is open", () => {
    expect(decideRun(live({ cycleOpen: true }))).toEqual({ action: "wait", why: "cycle_running", until: null });
  });

  it("ends done when the last round did nothing: empty, failed, or only waiting on the founder", () => {
    expect(decideRun(live({ run: { ...run, lastRound: empty } }))).toEqual({ action: "end", reason: "done" });
    expect(decideRun(live({ run: { ...run, lastRound: failed } }))).toEqual({ action: "end", reason: "done" });
    expect(decideRun(live({ run: { ...run, lastRound: { outcome: "waiting", tasksDispatched: 2, tasksCompleted: 0 } } }))).toEqual({ action: "end", reason: "done" });
    // A round that finished something while others wait on a decision is progress: the run goes on.
    expect(decideRun(live({ run: { ...run, lastRound: { outcome: "waiting", tasksDispatched: 2, tasksCompleted: 1 } } }))).toEqual({ action: "start" });
    // A round that failed before writing a cycle ends it too, so a failing start cannot loop.
    expect(decideRun(live({ run: { ...run, rounds: 0, lastRound: null, unrecordedFailures: 1 } }))).toEqual({ action: "end", reason: "done" });
  });

  it("decisions waiting in Needs you do not hold a run (0071): only a hard stop counts as blocking", () => {
    // `blockingItems` counts only hard stops (credits used up, a revoked key); open decisions never reach it.
    expect(decideRun(live({ blockingItems: 0 }))).toEqual({ action: "start" });
    expect(decideRun(live({ blockingItems: 1 }))).toEqual({ action: "end", reason: "hard_stop" });
  });

  it("a hard stop ends it: the stop flag, used-up credits", () => {
    for (const stopReason of ["kill_switch", "key_revoked", "credits_exhausted"] as const) expect(decideRun(live({ stopReason }))).toEqual({ action: "end", reason: "hard_stop" });
    expect(decideRun(live({ creditsRemainingMinor: 0 }))).toEqual({ action: "end", reason: "hard_stop" });
    // A hard stop outranks a running cycle: the run ends at once, the cycle's own stop is the cycle's.
    expect(decideRun(live({ stopReason: "kill_switch", cycleOpen: true }))).toEqual({ action: "end", reason: "hard_stop" });
  });

  it("a stopped last round ends it as stopped", () => {
    expect(decideRun(live({ run: { ...run, lastRound: { outcome: "stopped", tasksDispatched: 1, tasksCompleted: 0 } } }))).toEqual({ action: "end", reason: "stopped" });
  });

  it("paid entry without the entry plan ends it as a hard stop (WP-09 T16)", () => {
    expect(decideRun(live({ entryPlanOpen: false }))).toEqual({ action: "end", reason: "hard_stop" });
  });

  it("a vacation and an archived business end it", () => {
    expect(decideRun(live({ vacation: true }))).toEqual({ action: "end", reason: "vacation" });
    expect(decideRun(live({ archived: true, vacation: true }))).toEqual({ action: "end", reason: "archived" });
  });

  it("the day's cycle cap and spend ceiling end it (one set of limits with Autopilot)", () => {
    expect(decideRun(live({ cyclesToday: AUTOPILOT_DEFAULT_SETTINGS.maxCyclesPerDay }))).toEqual({ action: "end", reason: "daily_cycles" });
    expect(decideRun(live({ cyclesToday: AUTOPILOT_DEFAULT_SETTINGS.maxCyclesPerDay - 1 }))).toEqual({ action: "start" });
    expect(decideRun(live({ settings: { ...AUTOPILOT_DEFAULT_SETTINGS, spendCeilingMinor: 100 }, spentTodayMinor: 100 }))).toEqual({ action: "end", reason: "daily_spend" });
    // With no ceiling set the credits left are the ceiling; on the founder's own key there is none.
    expect(decideRun(live({ creditsRemainingMinor: null, spentTodayMinor: 1_000_000 }))).toEqual({ action: "start" });
  });

  it("the end words: plain, with the day's limit, and nothing for an end the founder caused", () => {
    expect(continueRunEndedMessage("done")).toMatchObject({ title: "The team has done all it can for now", description: "Anything waiting for you is in the Inbox's Needs you tab." });
    expect(continueRunEndedMessage("daily_cycles", 6)!.title).toBe("Today's limit of 6 cycles is reached");
    expect(continueRunEndedMessage("daily_cycles", 1)!.title).toBe("Today's limit of 1 cycle is reached");
    expect(continueRunEndedMessage("daily_cycles")!.title).toBe("Today's cycle limit is reached");
    expect(continueRunEndedMessage("daily_spend")!.title).toBe("Today's spend ceiling is reached (Estimate)");
    for (const reason of ["paused", "stopped", "archived"] as const) expect(continueRunEndedMessage(reason)).toBeNull();
    for (const reason of CONTINUE_RUN_END_REASONS) {
      const m = continueRunEndedMessage(reason);
      if (m) expect(`${m.title} ${m.description}`).not.toMatch(/workflow|run_|autopilot:/i);
    }
  });

  it("the Off chip says Continue keeps the team working", () => {
    expect(autopilotView({ action: "off" }).detail).toBe("Continue keeps the team working until nothing is left. Turn Autopilot on to start work on a schedule.");
  });
});

describe("overnightUtcHour", () => {
  it("finds the UTC hour that is 2 AM in the founder's zone", () => {
    const now = new Date("2026-11-11T15:00:00Z");
    expect(overnightUtcHour("America/New_York", now)).toBe(7);
    expect(overnightUtcHour("Europe/London", now)).toBe(2);
    expect(overnightUtcHour("Asia/Tokyo", now)).toBe(17);
    expect(overnightUtcHour(null, now)).toBe(2);
    expect(overnightUtcHour("Not/AZone", now)).toBe(2);
  });
});

describe("Autopilot's own limits (founder, 2026-11-12: split from Continue's)", () => {
  const own = (ownMaxCyclesPerDay: number | null, ownSpendCeilingMinor: number | null) => ({ ...AUTOPILOT_DEFAULT_SETTINGS, cadence: "after_cycle" as const, ownMaxCyclesPerDay, ownSpendCeilingMinor });
  it("waits once Autopilot's own cycles reach its own daily limit, whatever Continue did", () => {
    expect(decideAutopilot(facts({ settings: own(1, null), ownCyclesToday: 1, cyclesToday: 1 }))).toMatchObject({ action: "wait", why: "daily_cycles" });
    // Continue's cycles count toward the shared cap only: three presses today leave Autopilot's own night untouched.
    expect(decideAutopilot(facts({ settings: own(1, null), ownCyclesToday: 0, cyclesToday: 3 })).action).toBe("start");
  });
  it("waits once its own spend is reached, and gives its cycle the rest as a budget", () => {
    expect(decideAutopilot(facts({ settings: own(null, 15), ownSpentTodayMinor: 15 }))).toMatchObject({ action: "wait", why: "daily_spend" });
    expect(autopilotCycleBudgetMinor({ settings: own(null, 15), ownSpentTodayMinor: 4 })).toBe(11);
    expect(autopilotCycleBudgetMinor({ settings: own(null, null), ownSpentTodayMinor: 4 })).toBeNull();
  });
  it("leaves a Continue run to the shared limits only", () => {
    const run = { id: "r", startedAt: NOW - H, rounds: 1, lastRound: productive };
    expect(decideRun(facts({ settings: own(1, 1), ownCyclesToday: 1, ownSpentTodayMinor: 50, lastCycleStartedAt: NOW - H, run }))).toEqual({ action: "start" });
  });
  it("is the overnight shift's cap: one cycle a night with a budget of 15 cents", () => {
    // Founder, Nov 16, 2026 (WP-09 D7 option B, then $0.45): one round every third night, three nights' cap.
    expect(OVERNIGHT_SHIFT).toMatchObject({ ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 45, cadence: "every_3_days" });
  });
});
