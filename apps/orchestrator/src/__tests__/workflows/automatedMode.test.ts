/**
 * automatedMode with mocked activities: a business in Automated mode keeps pressing Continue by itself. The Chief of Staff
 * answers what blocks it between cycles, the loop holds while a vacation runs or the team is stopped, and it ends when
 * the mode changes (audit SOAK-01, #75).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, AutomatedModeCheck } from "../../activities";
import { automatedMode, stopSignal } from "../../workflows";
import { AUTOMATED_MODE_CHAINED_CYCLES } from "../../workflows/automatedMode";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Calls {
  checks: number;
  decides: number;
  cycles: number[];
  cycleTriggers: string[];
}

function mockActivities(opts: { active?: (checks: number, cycles: number) => AutomatedModeCheck; decided?: (n: number) => number } = {}): { acts: Partial<Activities>; calls: Calls } {
  const calls: Calls = { checks: 0, decides: 0, cycles: [], cycleTriggers: [] };
  const acts: Partial<Activities> = {
    async loadAutomatedMode() {
      return { chiefOfStaffId: id(1), authority: ["publish_content", "spend_above_threshold"], cadenceAgentHours: 4 };
    },
    async automatedModeCheck() {
      calls.checks += 1;
      return opts.active ? opts.active(calls.checks, calls.cycles.length) : { active: true, hold: null, reason: "" };
    },
    async automatedModeAutoDecide() {
      calls.decides += 1;
      return { decided: opts.decided ? opts.decided(calls.decides) : 0, queuedGated: 0, inboxItemIds: [], planIds: [], waiting: [] };
    },
    async automatedModeNextCycleNumber() {
      return { cycleNumber: calls.cycles.length + 1 };
    },
    // the businessCycle child
    async loadBrief() {
      return { businessId: B, businessName: "Ledgerly", businessMode: "automated", archetype: null, currency: "USD", glossary: {}, holidayActive: false, departments: [], agents: [], chiefOfStaffId: id(1), openTasks: [], pendingApprovals: 0, blockingInboxItems: 0, budgetRemainingMinor: null, creditsCurrency: "USD", maxAgents: 2, capacity: "mock", text: "", approxTokens: 0, builtAt: "2026-10-05T08:00:00.000Z" };
    },
    async planCycle() {
      return { summary: "nothing to do", timeBoxHours: 4, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus" as const, warning: null, costMinor: 0 };
    },
    async startCycle(input) {
      calls.cycles.push(input.cycleNumber);
      calls.cycleTriggers.push(input.trigger);
      return { cycleId: input.cycleId ?? id(100 + calls.cycles.length), eventId: id(200 + calls.cycles.length) };
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

describe("automated mode workflow", () => {
  it("runs a round of work on each tick with the schedule trigger, and ends with the mode", async () => {
    // Active for the first three checks (three ticks), then the founder switches the mode.
    const m = mockActivities({ active: (checks) => (checks <= 3 ? { active: true, hold: null, reason: "" } : { active: false, hold: null, reason: "mode_changed" }) });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(automatedMode, { workflowId: `automated:${B}`, taskQueue, args: [{ businessId: B }] }));
    expect(result).toEqual({ cyclesRun: 3, reason: "mode_changed" });
    expect(m.calls.cycles).toEqual([1, 2, 3]);
    expect(new Set(m.calls.cycleTriggers)).toEqual(new Set(["schedule"]));
    // Answers what blocks Continue before the tick's cycle and after it.
    expect(m.calls.decides).toBe(6);
  });

  it("runs the next round of work straight away while the decisions it raised keep unblocking work, up to a few times", async () => {
    const m = mockActivities({ decided: () => 1, active: (checks) => (checks <= 1 ? { active: true, hold: null, reason: "" } : { active: false, hold: null, reason: "archived" }) });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(automatedMode, { workflowId: `automated:${B}-chain`, taskQueue, args: [{ businessId: B }] }));
    expect(result.reason).toBe("archived");
    expect(m.calls.cycles).toHaveLength(AUTOMATED_MODE_CHAINED_CYCLES);
  });

  it("starts nothing while a vacation runs or the team is stopped, and carries on after", async () => {
    const m = mockActivities({
      active: (checks) => {
        if (checks === 1) return { active: true, hold: "vacation", reason: "a vacation is running" };
        if (checks === 2) return { active: true, hold: "stopped", reason: "the team is stopped" };
        if (checks === 3) return { active: true, hold: null, reason: "" };
        return { active: false, hold: null, reason: "mode_changed" };
      },
    });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(automatedMode, { workflowId: `automated:${B}-hold`, taskQueue, args: [{ businessId: B }] }));
    expect(result.cyclesRun).toBe(1);
    expect(m.calls.cycles).toEqual([1]);
  });

  it("the stop signal ends it between ticks", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(automatedMode, { workflowId: `automated:${B}-stop`, taskQueue, args: [{ businessId: B }] });
      for (let i = 0; i < 400 && m.calls.cycles.length < 1; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(stopSignal, { reason: "mode_changed", by: "founder" });
      return handle.result();
    });
    expect(result.reason).toBe("stopped");
    expect(result.cyclesRun).toBeGreaterThanOrEqual(1);
  });
});
