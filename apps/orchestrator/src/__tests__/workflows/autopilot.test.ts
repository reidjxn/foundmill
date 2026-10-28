/**
 * autopilot with mocked activities and a fake clock: the real `decideAutopilot` runs inside the mocked evaluate against
 * a small world (cycles, Inbox, credits, stop flag), and the real `businessCycle` runs as the child. It starts a cycle
 * once the interval has passed (trigger `autopilot`), waits while an Inbox item blocks and never decides it, pauses
 * after N empty cycles, and never starts while the team is stopped or the credits are used up.
 */
import type { Client, WorkflowHandleWithFirstExecutionRunId } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOPILOT_DEFAULT_SETTINGS, decideAutopilot, type AutopilotCycleSummary, type AutopilotSettings } from "@foundmill/shared";
import type { Activities, AutopilotEvaluation } from "../../activities";
import { FakeClock } from "../../clock";
import { AUTOPILOT_POLL_MS, AUTOPILOT_MAX_SLEEP_MS } from "../../activities/autopilot";
import { autopilot, autopilotRefreshSignal, businessCycle, stopSignal, type AutopilotInput, type AutopilotResult } from "../../workflows";
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
const H = 60 * 60 * 1000;
const START = "2026-10-13T08:00:00.000Z";

interface World {
  clock: FakeClock;
  settings: AutopilotSettings;
  blocking: number;
  stopReason: "kill_switch" | "key_revoked" | "credits_exhausted" | null;
  credits: number | null;
  /** Tasks the plan starts per cycle (0: an empty cycle). */
  tasksPerCycle: number;
  cycles: { number: number; trigger: string }[];
  recent: AutopilotCycleSummary[];
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  since: number;
  pausedReason: string | null;
  open: boolean;
  starts: number[];
  evaluations: number;
  pauses: string[];
  recorded: { cycleNumber: number; cyclesToday: number }[];
}

function world(patch: Partial<World> = {}): World {
  const clock = patch.clock ?? new FakeClock(START);
  return {
    clock,
    settings: { ...AUTOPILOT_DEFAULT_SETTINGS, cadence: "every_4h" },
    blocking: 0,
    stopReason: null,
    credits: 5_000,
    tasksPerCycle: 1,
    cycles: [],
    recent: [],
    lastStartedAt: null,
    lastEndedAt: clock.nowMs() - 1 * H,
    since: clock.nowMs() - 3 * H,
    pausedReason: null,
    open: false,
    starts: [],
    evaluations: 0,
    pauses: [],
    recorded: [],
    ...patch,
  };
}

function mocks(w: World): Partial<Activities> {
  return {
    async autopilotEvaluate(input): Promise<AutopilotEvaluation> {
      w.evaluations += 1;
      const decision = decideAutopilot({
        now: w.clock.nowMs(),
        enabled: true,
        pausedReason: w.pausedReason as never,
        since: w.since,
        settings: w.settings,
        archived: false,
        stopReason: w.stopReason,
        creditsRemainingMinor: w.credits,
        vacation: false,
        blockingItems: w.blocking,
        cycleOpen: w.open,
        lastCycleStartedAt: w.lastStartedAt,
        lastCycleEndedAt: w.lastEndedAt,
        cyclesToday: w.starts.filter((t) => t >= Date.UTC(2026, 9, 13)).length,
        spentTodayMinor: 0,
        recentCycles: w.recent,
        unrecordedFailures: input.unrecordedFailures,
      });
      let waitMs = 0;
      if (decision.action === "wait") {
        waitMs = Math.max(1_000, Math.min(AUTOPILOT_MAX_SLEEP_MS, decision.until !== null ? decision.until - w.clock.nowMs() : AUTOPILOT_POLL_MS));
        // The workflow sleeps this long (time is skipped), so the world's clock moves with it.
        await w.clock.advance(waitMs);
      }
      return { decision, waitMs, cadence: w.settings.cadence, maxIdleCycles: w.settings.maxIdleCycles, cyclesToday: 0 };
    },
    async autopilotPause(input) {
      w.pauses.push(input.reason);
      w.pausedReason = input.reason;
      return { paused: true };
    },
    async autopilotCycleStarted(input) {
      w.recorded.push({ cycleNumber: input.cycleNumber, cyclesToday: input.cyclesToday });
      return { eventId: id(900) };
    },
    async autopilotCycleFailed() {
      return { recorded: false };
    },
    async nextCycleNumber() {
      return { cycleNumber: w.cycles.length + 1 };
    },
    // The businessCycle child.
    async loadBrief() {
      return { businessId: B, businessName: "Ledgerly", businessMode: "assisted", archetype: null, currency: "USD", glossary: {}, holidayActive: false, departments: [], agents: [], chiefOfStaffId: id(1), openTasks: [], pendingApprovals: 0, blockingInboxItems: w.blocking, budgetRemainingMinor: null, creditsCurrency: "USD", maxAgents: 2, capacity: "mock", text: "", approxTokens: 0, builtAt: START };
    },
    async planCycle(input) {
      w.cycles.push({ number: input.cycleNumber, trigger: input.trigger });
      return { summary: "plan", timeBoxHours: 1, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 };
    },
    async startCycle() {
      w.open = true;
      w.lastStartedAt = w.clock.nowMs();
      w.starts.push(w.clock.nowMs());
      return { cycleId: id(100 + w.cycles.length), eventId: id(200 + w.cycles.length) };
    },
    async narrateCycle() {
      return { inboxItemIds: [], viaComposer: false };
    },
    async completeCycle(input) {
      // A cycle takes an hour of clock time; its tasks are dispatched and finished (or none, for an empty cycle).
      await w.clock.advance(H);
      w.open = false;
      w.lastEndedAt = w.clock.nowMs();
      const summary: AutopilotCycleSummary = { outcome: w.tasksPerCycle === 0 ? "completed" : "completed", tasksDispatched: w.tasksPerCycle, tasksCompleted: w.tasksPerCycle };
      w.recent.unshift(summary);
      void input;
      return { eventId: id(300) };
    },
  };
}

async function until(cond: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  if (!cond()) throw new Error("condition not reached in time");
}

/**
 * Starts the workflow and awaits its result right away (the time-skipping test server skips time only while a result is
 * awaited), then runs `script` against the live workflow.
 */
async function drive(client: Client, taskQueue: string, workflowId: string, script: (handle: WorkflowHandleWithFirstExecutionRunId<typeof autopilot>) => Promise<void>, args: AutopilotInput = { businessId: B }): Promise<AutopilotResult> {
  const handle = await client.workflow.start(autopilot, { workflowId, taskQueue, args: [args] });
  const result = handle.result();
  result.catch(() => undefined);
  await script(handle);
  return result;
}

describe("autopilot workflow", () => {
  it("waits for the interval, then starts a cycle through businessCycle with trigger autopilot, and again after the next interval", async () => {
    const w = world();
    const result = await rig.run(mocks(w), (client, taskQueue) =>
      drive(client, taskQueue, `autopilot:${B}:interval`, async (handle) => {
        await until(() => w.cycles.length >= 2);
        await handle.signal(stopSignal, { reason: "kill_switch", by: "test" });
      }),
    );
    expect(w.cycles.slice(0, 2)).toEqual([
      { number: 1, trigger: "autopilot" },
      { number: 2, trigger: "autopilot" },
    ]);
    // The first was due 3 hours after the last cycle ended (4 hours less the 1 hour already passed): never before.
    expect(w.starts[0]! - Date.parse(START)).toBeGreaterThanOrEqual(3 * H);
    // The second came 4 hours after the first one ended (1 hour cycle + 4 hours).
    expect(w.starts[1]! - w.starts[0]!).toBeGreaterThanOrEqual(5 * H);
    expect(w.recorded[0]).toMatchObject({ cycleNumber: 1, cyclesToday: 1 });
    expect(result.outcome).toBe("stopped");
    expect(w.pauses).toContain("kill_switch");
  });

  it("waits while an Inbox item blocks Continue and never decides it; starts after the founder has", async () => {
    const w = world({ blocking: 1, lastEndedAt: Date.parse(START) - 10 * H });
    const result = await rig.run(mocks(w), (client, taskQueue) =>
      drive(client, taskQueue, `autopilot:${B}:inbox`, async (handle) => {
        await until(() => w.evaluations >= 3);
        // Several looks (the poll interval runs out, time skipped), no cycle: it is waiting for the founder.
        expect(w.cycles).toHaveLength(0);
        // The founder decides; the refresh makes it look again at once.
        w.blocking = 0;
        await handle.signal(autopilotRefreshSignal, {});
        await until(() => w.cycles.length >= 1);
        await handle.signal(stopSignal, { reason: "kill_switch" });
      }),
    );
    expect(w.cycles[0]).toEqual({ number: 1, trigger: "autopilot" });
    expect(result.outcome).toBe("stopped");
  });

  it("pauses after N failed or empty cycles in a row and stops starting cycles", async () => {
    const w = world({ tasksPerCycle: 0, lastEndedAt: Date.parse(START) - 10 * H });
    const result = await rig.run(mocks(w), (client, taskQueue) => client.workflow.execute(autopilot, { workflowId: `autopilot:${B}:idle`, taskQueue, args: [{ businessId: B }] }));
    expect(result).toMatchObject({ outcome: "paused", pausedReason: "idle_cycles", cyclesStarted: 3 });
    expect(w.cycles).toHaveLength(3);
    expect(w.pauses).toEqual(["idle_cycles"]);
  });

  it("never starts while the team is stopped, whatever the reason", async () => {
    for (const stopReason of ["kill_switch", "key_revoked", "credits_exhausted"] as const) {
      const w = world({ stopReason, lastEndedAt: Date.parse(START) - 10 * H });
      const result = await rig.run(mocks(w), (client, taskQueue) => client.workflow.execute(autopilot, { workflowId: `autopilot:${B}:stopped-${stopReason}`, taskQueue, args: [{ businessId: B }] }));
      expect(result).toMatchObject({ outcome: "paused", pausedReason: stopReason, cyclesStarted: 0 });
      expect(w.cycles).toHaveLength(0);
    }
  });

  it("never starts when the credits are used up (402) even before the stop flag is written", async () => {
    const w = world({ credits: 0, lastEndedAt: Date.parse(START) - 10 * H });
    const result = await rig.run(mocks(w), (client, taskQueue) => client.workflow.execute(autopilot, { workflowId: `autopilot:${B}:credits`, taskQueue, args: [{ businessId: B }] }));
    expect(result).toMatchObject({ outcome: "paused", pausedReason: "credits_exhausted", cyclesStarted: 0 });
    expect(w.cycles).toHaveLength(0);
  });

  it("stops the cycle it is waiting on when Stop all agents signals it", async () => {
    const w = world({ lastEndedAt: Date.parse(START) - 10 * H });
    const result = await rig.run(
      { ...mocks(w), async startCycle() {
        w.open = true;
        w.starts.push(w.clock.nowMs());
        return { cycleId: id(1), eventId: id(2) };
      } },
      (client, taskQueue) =>
        drive(client, taskQueue, `autopilot:${B}:stopcycle`, async (handle) => {
          await until(() => w.cycles.length >= 1);
          await handle.signal(stopSignal, { reason: "kill_switch" });
        }),
    );
    expect(result.outcome).toBe("stopped");
    expect(w.pauses).toContain("kill_switch");
  });

  it("yields to a founder's Continue that took the same cycle number, then starts the next cycle", async () => {
    const w = world({ lastEndedAt: Date.parse(START) - 10 * H });
    // The founder's cycle 1 is still planning when Autopilot decides to start "cycle 1" as well.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let numberAsked = 0;
    let failures = 0;
    const base = mocks(w);
    const result = await rig.run(
      {
        ...base,
        async autopilotCycleFailed() {
          failures += 1;
          return { recorded: false };
        },
        async nextCycleNumber() {
          numberAsked += 1;
          return { cycleNumber: numberAsked === 1 ? 1 : w.cycles.length + 1 };
        },
        async planCycle(input: Parameters<NonNullable<Activities["planCycle"]>>[0]) {
          if (input.trigger === "continue") await gate;
          return base.planCycle!(input);
        },
      },
      async (client, taskQueue) => {
        await client.workflow.start(businessCycle, { workflowId: `cycle:${B}:1`, taskQueue, args: [{ businessId: B, cycleNumber: 1, trigger: "continue" }] });
        return drive(client, taskQueue, `autopilot:${B}:collision`, async (handle) => {
          await until(() => numberAsked >= 1);
          release();
          await until(() => w.cycles.length >= 2);
          await handle.signal(stopSignal, { reason: "kill_switch" });
        });
      },
    );
    expect(w.cycles.slice(0, 2)).toEqual([
      { number: 1, trigger: "continue" },
      { number: 2, trigger: "autopilot" },
    ]);
    // Only the cycle Autopilot really started is recorded and counted; the collision is neither a start nor a failure.
    expect(w.recorded).toEqual([{ cycleNumber: 2, cyclesToday: 1 }]);
    expect(failures).toBe(0);
    expect(result).toMatchObject({ outcome: "stopped", cyclesStarted: 1 });
  });

  it("continues as new after its rounds so the history stays small", async () => {
    // Blocked for its first two looks (one run of two rounds), then the team is stopped: the third look, in the next run
    // of the same workflow id, pauses it. The stop comes from the world, not a signal: with time skipped, a workflow that
    // only waits runs through its rounds and runs at full speed, and a signal racing that loop hung the test on a
    // loaded CI runner (main, Oct 27, 2026).
    const w = world({ blocking: 1 });
    const base = mocks(w);
    let firstRunId: string | undefined;
    let lastRunId: string | undefined;
    const result = await rig.run(
      {
        ...base,
        async autopilotEvaluate(input: Parameters<NonNullable<Activities["autopilotEvaluate"]>>[0]) {
          if (w.evaluations >= 2) w.stopReason = "kill_switch";
          return base.autopilotEvaluate!(input);
        },
      },
      async (client, taskQueue) => {
        const handle = await client.workflow.start(autopilot, { workflowId: `autopilot:${B}:rounds`, taskQueue, args: [{ businessId: B, maxRounds: 2 }] });
        firstRunId = handle.firstExecutionRunId;
        const outcome = await handle.result();
        lastRunId = (await client.workflow.getHandle(`autopilot:${B}:rounds`).describe()).runId;
        return outcome;
      },
    );
    expect(result).toMatchObject({ outcome: "paused", pausedReason: "kill_switch", cyclesStarted: 0 });
    expect(w.evaluations).toBe(3);
    expect(w.pauses).toEqual(["kill_switch"]);
    expect(lastRunId).toBeDefined();
    expect(lastRunId).not.toBe(firstRunId);
  });
});
