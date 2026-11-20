/**
 * autopilot versioning (Continue runs until done, Nov 7, 2026). The run signals, the press's own cycle and the run's
 * rounds sit behind `patched(CONTINUE_RUN_PATCH)`: an Autopilot that was running when this deploys must replay its
 * recorded rounds on the new code instead of failing its workflow task with a non-determinism error.
 *
 * Fixtures (`fixtures/legacy-autopilot-*.json`): histories of the workflow as it was at daf80a21, recorded on the
 * time-skipping test server with stub activities: one that started two cycles, was refreshed and then stopped, and one
 * asleep before its first cycle (the state a deploy finds it in). Delete them once no Autopilot started on the old code
 * can still be running.
 */
import { readFileSync } from "node:fs";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOPILOT_DEFAULT_SETTINGS, decideAutopilot, decideRun, type AutopilotFacts } from "@foundmill/shared";
import type { Activities, AutopilotEvaluation } from "../../activities";
import { WORKFLOWS_PATH } from "../../index";
import { autopilot, continueRunSignal } from "../../workflows";
import { createTemporalRig, type TemporalRig } from "./temporal";

const LEGACY = ["legacy-autopilot-ran", "legacy-autopilot-asleep"] as const;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
type HistoryLike = { events?: { eventType?: string | number; activityTaskScheduledEventAttributes?: { activityType?: { name?: string } | null } | null; markerRecordedEventAttributes?: { markerName?: string } | null; startChildWorkflowExecutionInitiatedEventAttributes?: unknown }[] | null };
const scheduled = (history: unknown): string[] => ((history as HistoryLike).events ?? []).flatMap((e) => (e.activityTaskScheduledEventAttributes?.activityType?.name ? [e.activityTaskScheduledEventAttributes.activityType.name] : []));
const childStarts = (history: unknown): number => ((history as HistoryLike).events ?? []).filter((e) => e.startChildWorkflowExecutionInitiatedEventAttributes).length;
const markers = (history: unknown): number => ((history as HistoryLike).events ?? []).filter((e) => e.markerRecordedEventAttributes).length;

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 120_000);
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("autopilot: histories from before Continue ran until done", () => {
  it("the fixtures are the old loop: looks, two rounds of work, a stop; and no patch marker", () => {
    const ran = fixture("legacy-autopilot-ran");
    expect(scheduled(ran).filter((a) => a === "autopilotCycleStarted")).toHaveLength(2);
    expect(scheduled(ran).at(-1)).toBe("autopilotPause");
    expect(childStarts(ran)).toBe(2);
    expect(markers(ran)).toBe(0);
    expect(scheduled(fixture("legacy-autopilot-asleep"))).toEqual(["autopilotEvaluate"]);
  });

  for (const name of LEGACY) {
    it(`${name} replays on the current code without a non-determinism error`, async () => {
      await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: name }, fixture(name))).resolves.toBeUndefined();
    }, 120_000);
  }
});

describe("autopilot: a run on the new code", () => {
  it("records the patch marker, runs its rounds, and its history replays", async () => {
    let cycles = 0;
    let open = false;
    const recent: { outcome: "completed"; tasksDispatched: number; tasksCompleted: number }[] = [];
    const facts = (run: AutopilotFacts["run"]): AutopilotFacts => ({ now: Date.UTC(2026, 10, 7, 12), enabled: false, pausedReason: null, since: 0, settings: AUTOPILOT_DEFAULT_SETTINGS, archived: false, stopReason: null, creditsRemainingMinor: null, vacation: false, blockingItems: 0, cycleOpen: open, lastCycleStartedAt: null, lastCycleEndedAt: null, cyclesToday: cycles, spentTodayMinor: 0, recentCycles: recent, run });
    const acts: Partial<Activities> = {
      async autopilotEvaluate(input): Promise<AutopilotEvaluation> {
        const f = facts(input.run ? { id: input.run.id, startedAt: input.run.startedAt, rounds: recent.length, lastRound: recent[0] ?? null } : null);
        const r = decideRun(f);
        return { decision: decideAutopilot(f), waitMs: 0, cadence: "every_4h", maxIdleCycles: 3, cyclesToday: cycles, run: r ? { decision: r, waitMs: 1_000 } : null };
      },
      autopilotRunEnded: async () => ({ recorded: true, rounds: recent.length }),
      autopilotCycleStarted: async () => ({ eventId: id(900) }),
      autopilotCycleFailed: async () => ({ recorded: false }),
      autopilotPause: async () => ({ paused: true }),
      nextCycleNumber: async () => ({ cycleNumber: cycles + 1 }),
      loadBrief: async () => ({ businessId: B, businessName: "Ledgerly", businessMode: "assisted", archetype: null, currency: "USD", glossary: {}, holidayActive: false, departments: [], agents: [], chiefOfStaffId: id(1), openTasks: [], pendingApprovals: 0, blockingInboxItems: 0, budgetRemainingMinor: null, creditsCurrency: "USD", maxAgents: 2, capacity: "mock", text: "", approxTokens: 0, builtAt: new Date().toISOString() }),
      planCycle: async () => ({ summary: "plan", timeBoxHours: 1, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 }),
      async startCycle() {
        cycles += 1;
        open = true;
        return { cycleId: id(100 + cycles), eventId: id(200 + cycles) };
      },
      narrateCycle: async () => ({ inboxItemIds: [], viaComposer: false }),
      async completeCycle() {
        open = false;
        // The first round gets work done, the second finds nothing: the run ends done.
        recent.unshift(cycles === 1 ? { outcome: "completed", tasksDispatched: 1, tasksCompleted: 1 } : { outcome: "completed", tasksDispatched: 0, tasksCompleted: 0 });
        return { eventId: id(300) };
      },
    };
    const workflowId = `autopilot:${B}:replay-run`;
    const result = await rig.run(acts, async (client, taskQueue) => {
      const handle = await client.workflow.signalWithStart(autopilot, { workflowId, taskQueue, args: [{ businessId: B }], signal: continueRunSignal, signalArgs: [{ runId: id(77), cycleNumber: 1 }] });
      return handle.result();
    });
    expect(result.outcome).toBe("run_ended");
    expect(cycles).toBe(2);
    const history = await rig.client.workflow.getHandle(workflowId).fetchHistory();
    expect(markers(history)).toBeGreaterThanOrEqual(1);
    expect(scheduled(history)).toContain("autopilotRunEnded");
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: "continue-run" }, history)).resolves.toBeUndefined();
  }, 120_000);
});
