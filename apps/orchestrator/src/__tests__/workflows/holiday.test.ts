/**
 * holiday with mocked activities and a fake clock: cycles run on the cadence (time skipped), the Chief of Staff
 * decides between cycles, and the holiday ends on a wake event (signal), on the until date (fake clock) or on stop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, HolidayCheck, LoadedHoliday } from "../../activities";
import { FakeClock } from "../../clock";
import { HOLIDAY_CYCLES_PER_RUN, MAX_HOLIDAY_CYCLES } from "../../holiday-contract";
import { holiday, stopSignal, wakeSignal } from "../../workflows";
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
}

function mockActivities(clock: FakeClock, untilAt: string | null): { acts: Partial<Activities>; calls: Calls } {
  const calls: Calls = { checks: 0, decides: 0, cycles: 0, end: null };
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
    async holidayAutoDecide() {
      calls.decides += 1;
      return { decided: 1, queuedGated: 0, inboxItemIds: [] };
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
  it("runs cycles on the cadence and ends on the wake signal with the While-you-were-away report", async () => {
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

  it("a vacation that has run its safety limit of cycles ends as cycle_cap and says so", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const m = mockActivities(clock, null);
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId: `holiday:${H}-cap`, taskQueue, args: [{ businessId: B, holidayId: H, cyclesRun: MAX_HOLIDAY_CYCLES - 1 }] }));
    expect(result.reason).toBe("cycle_cap");
    expect(result.cyclesRun).toBe(MAX_HOLIDAY_CYCLES);
    expect(m.calls.cycles).toBe(1);
    expect(m.calls.end).toMatchObject({ reason: "cycle_cap", cyclesRun: MAX_HOLIDAY_CYCLES });
  });

  it("continues as new after a run of cycles and keeps the count, so a long vacation keeps a short history (audit SOAK-10)", async () => {
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
});
