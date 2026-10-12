/**
 * holiday versioning (audit O-16). Starting each decision's plan added child workflow starts after `holidayAutoDecide`;
 * a vacation running when that deploys must replay its recorded passes on the new code instead of failing its workflow
 * task with a non-determinism error. No patch marker guards it: the starts follow the activity's answer, and the old
 * activity's recorded answers carry no `planIds`, so a recorded pass starts nothing on replay.
 *
 * Fixtures (`fixtures/legacy-holiday-*.json`): histories of the workflow as it was at e9b9917, recorded on the
 * time-skipping test server with stub activities: one vacation that ran to its until date, and one asleep between passes
 * (the state a deploy finds it in). Delete them once no vacation started on the old code can still be running.
 */
import { readFileSync } from "node:fs";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, HolidayCheck, HolidayDecisions, LoadedHoliday } from "../../activities";
import { FakeClock } from "../../clock";
import { WORKFLOWS_PATH } from "../../index";
import { holiday } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

const LEGACY = ["legacy-holiday-until", "legacy-holiday-away"] as const;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
type HistoryLike = { events?: { activityTaskScheduledEventAttributes?: { activityType?: { name?: string } | null } | null; startChildWorkflowExecutionInitiatedEventAttributes?: unknown }[] | null };
/** The activities a history schedules, in order. */
const scheduled = (history: unknown): string[] => ((history as HistoryLike).events ?? []).flatMap((e) => (e.activityTaskScheduledEventAttributes?.activityType?.name ? [e.activityTaskScheduledEventAttributes.activityType.name] : []));
const childStarts = (history: unknown): number => ((history as HistoryLike).events ?? []).filter((e) => e.startChildWorkflowExecutionInitiatedEventAttributes).length;

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 120_000);
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const H = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("holiday: histories from before decisions ran as plans", () => {
  it("the fixtures are the old loop: decide, cycle, decide, and no plan started", () => {
    expect(scheduled(fixture("legacy-holiday-until")).filter((a) => a === "holidayAutoDecide").length).toBeGreaterThanOrEqual(2);
    expect(scheduled(fixture("legacy-holiday-away")).slice(0, 3)).toEqual(["loadHoliday", "holidayCheck", "holidayAutoDecide"]);
    // The businessCycle children are the only children; no planExecution was ever started.
    expect(childStarts(fixture("legacy-holiday-until"))).toBe(2);
  });

  for (const name of LEGACY) {
    it(`${name} replays on the current code without a non-determinism error`, async () => {
      await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: name }, fixture(name))).resolves.toBeUndefined();
    }, 120_000);
  }
});

describe("holiday: new vacations", () => {
  it("start the decided plans as plan:<id>, and their histories replay", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const loaded: LoadedHoliday = { holidayId: H, untilAt: "2026-10-05T10:00:00.000Z", untilCondition: null, authority: ["publish_content"], budgetCeilingMinor: null, currency: "USD", wakeEvents: [], startedAt: clock.now().toISOString(), cadenceAgentHours: 4, chiefOfStaffId: id(1) };
    let decides = 0;
    const plan = id(77);
    const acts: Partial<Activities> = {
      loadHoliday: async () => loaded,
      nextCycleNumber: async () => ({ cycleNumber: 1 }),
      async holidayCheck(): Promise<HolidayCheck> {
        const now = clock.now();
        const until = now.getTime() >= Date.parse(loaded.untilAt!);
        return { shouldEnd: until, reason: until ? "until_reached" : null, wakeEventType: null, wakeEventId: null, spentMinor: 0, now: now.toISOString() };
      },
      holidayAutoDecide: async (): Promise<HolidayDecisions> => ({ decided: 1, queuedGated: 0, inboxItemIds: [id(30)], planIds: decides++ === 0 ? [plan] : [], waiting: [] }),
      endHoliday: async (input) => ({ reportInboxItemId: id(5), eventId: id(6), cyclesRun: input.cyclesRun, decisionsMade: 1, customersWon: 0, spentMinor: 0, gatedItemsQueued: 0 }),
      loadBrief: async () => ({ businessId: B, businessName: "Ledgerly", businessMode: "automated", archetype: null, currency: "USD", glossary: {}, holidayActive: true, departments: [], agents: [], chiefOfStaffId: id(1), openTasks: [], pendingApprovals: 0, blockingInboxItems: 0, budgetRemainingMinor: null, creditsCurrency: "USD", maxAgents: 2, capacity: "mock", text: "", approxTokens: 0, builtAt: clock.now().toISOString() }),
      planCycle: async () => ({ summary: "nothing to do", timeBoxHours: 4, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 }),
      async startCycle() {
        await clock.advance(4 * 60 * 60 * 1000);
        return { cycleId: id(101), eventId: id(201) };
      },
      narrateCycle: async () => ({ inboxItemIds: [], viaComposer: false }),
      completeCycle: async () => ({ eventId: id(300) }),
      loadPlan: async () => ({ planId: plan, status: "executing", businessMode: "automated", actions: [] }),
      finishPlan: async () => ({ status: "done", progress: 1 }),
    };
    const workflowId = wfId("holiday");
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(holiday, { workflowId, taskQueue, args: [{ businessId: B, holidayId: H }] }));
    expect(result.reason).toBe("until_reached");

    const history = await rig.client.workflow.getHandle(workflowId).fetchHistory();
    const started = (history.events ?? []).flatMap((e) => (e.startChildWorkflowExecutionInitiatedEventAttributes ? [e.startChildWorkflowExecutionInitiatedEventAttributes] : []));
    expect(started.map((s) => [s.workflowType?.name, s.workflowId])).toContainEqual(["planExecution", `plan:${plan}`]);
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: "runs-decisions" }, history)).resolves.toBeUndefined();
  }, 120_000);
});
