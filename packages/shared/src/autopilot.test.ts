/**
 * The Autopilot decision (pure): every guard rail of the brief, the schedule, and the chip the founder reads.
 */
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_DEFAULT_SETTINGS,
  AUTOPILOT_LIMITS,
  autopilotView,
  decideAutopilot,
  effectiveSpendCeiling,
  idleStreak,
  isIdleCycle,
  nextDailyAt,
  plannedCycleAt,
  utcDayStart,
  type AutopilotCycleSummary,
  type AutopilotFacts,
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
