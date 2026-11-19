/**
 * holiday with mocked activities and a fake clock: cycles run on the cadence (time skipped), the Chief of Staff
 * decides between cycles and every decision's plan runs through planExecution, and the holiday ends on a wake event
 * (signal), on the until date (fake clock) or on stop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, HolidayCheck, HolidayDecisions, LoadedHoliday, PlanActionResult, PlanActionView } from "../../activities";
import { describeAway } from "../../activities/holiday";
import { FakeClock } from "../../clock";
import { HOLIDAY_CYCLES_PER_RUN, MAX_HOLIDAY_CYCLES } from "../../holiday-contract";
import { holiday, holidayStopReason, stopSignal, wakeSignal } from "../../workflows";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const H = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Calls {
  checks: number;
  decides: number;
  cycles: number;
  end: Record<string, unknown> | null;
  /** planExecution's calls: the actions it ran, by plan. */
  executed: { planId: string; actionId: string; workflowId: string }[];
}

/** The plans `holidayAutoDecide` hands back, pass by pass (the last entry repeats); none by default. */
function mockActivities(clock: FakeClock, untilAt: string | null, passes: string[][] = [[]]): { acts: Partial<Activities>; calls: Calls } {
  const calls: Calls = { checks: 0, decides: 0, cycles: 0, end: null, executed: [] };
  // Each decided plan has two actions; planExecution marks them done, so a plan that ran has nothing left to run.
  const actions = new Map<string, PlanActionView[]>();
  const actionsOf = (planId: string) => {
    if (!actions.has(planId)) actions.set(planId, [1, 2].map((n) => ({ id: `${planId}-a${n}`, type: "create_task", params: { title: `Step ${n}` }, agentId: null, policyOutcome: "allow", status: "pending" })));
    return actions.get(planId)!;
  };
  const loaded: LoadedHoliday = { holidayId: H, untilAt, untilCondition: null, authority: ["spend_above_threshold", "publish_content"], budgetCeilingMinor: null, currency: "EUR", wakeEvents: ["credential.expiring"], startedAt: clock.now().toISOString(), cadenceAgentHours: 4, chiefOfStaffId: id(1) };
  const acts: Partial<Activities> = {
    async loadHoliday() {
      return loaded;
    },
    async nextCycleNumber() {
      return { cycleNumber: calls.cycles + 1 };
    },
    async holidayCheck(): Promise<HolidayCheck> {
      calls.checks += 1;
      const now = clock.now();
      const until = untilAt && new Date(untilAt).getTime() <= now.getTime();
      return { shouldEnd: Boolean(until), reason: until ? "until_reached" : null, wakeEventType: null, wakeEventId: null, spentMinor: 0, now: now.toISOString() };
    },
    async holidayAutoDecide(): Promise<HolidayDecisions> {
      const planIds = passes[Math.min(calls.decides, passes.length - 1)]!;
      calls.decides += 1;
      return { decided: planIds.length, queuedGated: 0, inboxItemIds: [], planIds, waiting: [] };
    },
    // the planExecution children
    async loadPlan(input) {
      return { planId: input.planId, status: "executing", businessMode: "automated", actions: actionsOf(input.planId).map((a) => ({ ...a })) };
    },
    async executePlanAction(input): Promise<PlanActionResult> {
      const action = actionsOf(input.planId).find((a) => a.id === input.actionId)!;
      if (action.status !== "pending") return { actionId: action.id, status: "skipped", outcome: "allow", approvalId: null, result: null, spawn: [] };
      action.status = "done";
      calls.executed.push({ planId: input.planId, actionId: input.actionId, workflowId: input.workflowId });
      return { actionId: action.id, status: "done", outcome: "allow", approvalId: null, result: { taskId: id(700) }, spawn: [] };
    },
    async finishPlan(input) {
      return { status: actionsOf(input.planId).every((a) => a.status === "done") ? "done" : "executing", progress: 1 };
    },
    async endHoliday(input) {
      calls.end = input as unknown as Record<string, unknown>;
      return { reportInboxItemId: id(5), eventId: id(6), cyclesRun: input.cyclesRun, decisionsMade: calls.decides, customersWon: 0, spentMinor: 0, gatedItemsQueued: 0 };
    },
    // the businessCycle child
    async loadBrief() {
      return { businessId: B, businessName: "Ledgerly", businessMode: "automated", archetype: null, currency: "EUR", glossary: {}, holidayActive: true, departments: [], agents: [], chiefOfStaffId: id(1), openTasks: [], pendingApprovals: 0, blockingInboxItems: 0, budgetRemainingMinor: null, creditsCurrency: "USD", maxAgents: 2, capacity: "mock", text: "", approxTokens: 0, builtAt: clock.now().toISOString() };
    },
    async planCycle() {
      return { summary: "nothing to do", timeBoxHours: 4, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 };
    },
    async startCycle() {
      calls.cycles += 1;
      // Each cycle costs the business four agent-hours of clock time in the simulation.
      await clock.advance(4 * 60 * 60 * 1000);
      return { cycleId: id(100 + calls.cycles), eventId: id(200 + calls.cycles) };
    },
    async narrateCycle() {
      return { inboxItemIds: [], viaComposer: false };
    },
    async completeCycle() {
      return { eventId: id(300) };
    },
  };
  return { acts, calls };
}

describe("holiday workflow", () => {
  it("runs rounds of work on the cadence and ends on the wake signal with the While-you-were-away report", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(holiday, { workflowId: `holiday:${H}`, taskQueue, args: [{ businessId: B, holidayId: H }] });
      // Time only skips automatically while a result is awaited; skip the cadence by hand between cycles.
      for (let i = 0; i < 400 && m.calls.cycles < 1; i++) await new Promise((r) => setTimeout(r, 25));
      await rig.env.sleep("5 hours");
      for (let i = 0; i < 400 && m.calls.cycles < 2; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(wakeSignal, { eventType: "credential.expiring", eventId: id(9), reason: "Stripe credential expired" });
      return handle.result();
    });
    expect(result.reason).toBe("wake_event");
    expect(result.wakeEventType).toBe("credential.expiring");
    expect(result.cyclesRun).toBeGreaterThanOrEqual(2);
    expect(result.reportInboxItemId).toBe(id(5));
    expect(m.calls.decides).toBeGreaterThanOrEqual(result.cyclesRun * 2);
    expect(m.calls.end).toMatchObject({ reason: "wake_event", wakeEventType: "credential.expiring" });
  });

  it("ends when the fake clock reaches the until date", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    // Three cycles of four hours pass the 10-hour mark.
    const m = mockActivities(clock, "2026-10-05T18:00:00.000Z");
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId: `holiday:${H}-until`, taskQueue, args: [{ businessId: B, holidayId: H }] }));
    expect(result.reason).toBe("until_reached");
    expect(result.cyclesRun).toBe(3);
    expect(clock.now().toISOString()).toBe("2026-10-05T20:00:00.000Z");
  });

  it("runs every decision the Chief of Staff takes: each plan starts planExecution as plan:<id>, once", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    // Pass 1 decides P1; pass 2 decides P2 and hands P1 back as well (still executing, or its start was lost): P1's
    // actions do not run twice. Later passes decide nothing.
    const P1 = id(41);
    const P2 = id(42);
    const m = mockActivities(clock, "2026-10-05T14:00:00.000Z", [[P1], [P1, P2], []]);
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId: `holiday:${H}-runs`, taskQueue, args: [{ businessId: B, holidayId: H }] }));
    expect(result.reason).toBe("until_reached");
    expect(m.calls.decides).toBeGreaterThanOrEqual(3);
    // The children run after the holiday has ended (abandoned on close): wait for their actions.
    for (let i = 0; i < 400 && m.calls.executed.length < 4; i++) await new Promise((r) => setTimeout(r, 25));
    expect(m.calls.executed.map((e) => e.actionId).sort()).toEqual([`${P1}-a1`, `${P1}-a2`, `${P2}-a1`, `${P2}-a2`]);
    expect(new Set(m.calls.executed.map((e) => e.workflowId))).toEqual(new Set([`plan:${P1}`, `plan:${P2}`]));
  });


  it("the founder coming back ends it as founder_returned, not as the kill switch (audit O-40)", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(holiday, { workflowId: `holiday:${H}-back`, taskQueue, args: [{ businessId: B, holidayId: H }] });
      for (let i = 0; i < 400 && m.calls.cycles < 1; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(stopSignal, { reason: "founder_returned", by: "founder" });
      return handle.result();
    });
    expect(result.reason).toBe("founder_returned");
    expect(m.calls.end).toMatchObject({ reason: "founder_returned" });
  });

  it("a vacation that has run its safety limit of rounds of work ends as cycle_cap and says so", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId: `holiday:${H}-cap`, taskQueue, args: [{ businessId: B, holidayId: H, cyclesRun: MAX_HOLIDAY_CYCLES - 1 }] }));
    expect(result.reason).toBe("cycle_cap");
    expect(result.cyclesRun).toBe(MAX_HOLIDAY_CYCLES);
    expect(m.calls.cycles).toBe(1);
    expect(m.calls.end).toMatchObject({ reason: "cycle_cap", cyclesRun: MAX_HOLIDAY_CYCLES });
  });

  it("continues as new after a run of rounds of work and keeps the count, so a long vacation keeps a short history (audit SOAK-10)", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const total = HOLIDAY_CYCLES_PER_RUN + 2;
    const base = m.acts.holidayCheck!;
    m.acts.holidayCheck = async (input) => {
      const check = await base(input);
      return m.calls.cycles >= total ? { ...check, shouldEnd: true, reason: "until_reached" as const } : check;
    };
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId: `holiday:${H}-long`, taskQueue, args: [{ businessId: B, holidayId: H }] }));
    expect(result.reason).toBe("until_reached");
    expect(result.cyclesRun).toBe(total);
    expect(m.calls.end).toMatchObject({ cyclesRun: total });
  }, 120_000);

  it("the kill switch (stop) ends it as kill_switch", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(holiday, { workflowId: `holiday:${H}-stop`, taskQueue, args: [{ businessId: B, holidayId: H }] });
      for (let i = 0; i < 400 && m.calls.cycles < 1; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(stopSignal, { reason: "kill_switch", by: "founder" });
      return handle.result();
    });
    expect(result.reason).toBe("kill_switch");
  });

  it("Come back (stop with founder_returned) ends it as founder_returned, and the report says so (audit OL-07, DB-15a, EX-3)", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(holiday, { workflowId: `holiday:${H}-back`, taskQueue, args: [{ businessId: B, holidayId: H }] });
      for (let i = 0; i < 400 && m.calls.cycles < 1; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(stopSignal, { reason: "founder_returned", by: "founder" });
      return handle.result();
    });
    expect(result.reason).toBe("founder_returned");
    expect(m.calls.end).toMatchObject({ reason: "founder_returned" });
  });
});

describe("holidayStopReason and describeAway", () => {
  it("maps the stop signal's reason: founder_returned stays, anything else is the kill switch", () => {
    expect(holidayStopReason("founder_returned")).toBe("founder_returned");
    expect(holidayStopReason("kill_switch")).toBe("kill_switch");
    expect(holidayStopReason("agents_stopped")).toBe("kill_switch");
    expect(holidayStopReason(undefined)).toBe("kill_switch");
  });

  it("says minutes and hours for a short vacation instead of rounding it up to a day", () => {
    expect(describeAway(5_000)).toBe("1 minute");
    expect(describeAway(2 * 60_000)).toBe("2 minutes");
    expect(describeAway(59 * 60_000 + 50_000)).toBe("59 minutes");
    expect(describeAway(3 * 3_600_000)).toBe("3 hours");
    expect(describeAway(23 * 3_600_000 + 50 * 60_000)).toBe("23 hours");
    expect(describeAway(86_400_000)).toBe("1 day");
    expect(describeAway(4.4 * 86_400_000)).toBe("4 days");
  });
});
