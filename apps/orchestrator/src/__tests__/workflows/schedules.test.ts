/**
 * Schedule workflows with mocked activities on the time-skipping test server: a registered schedule names no
 * businesses, so the run lists them; the engine reconciler starts `engine:<channelId>` for every channel that has none
 * running, leaves a running one alone and records the ids; the business deletion sweep stops the business's workflows
 * before it purges, and skips a deletion canceled in the meantime.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, ChannelEngineState, ChannelStepResult } from "../../activities";
import { businessDeletionSweep, channelEngine, channelEngineReconcile, journeyDailyRefresh } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const empty: ChannelEngineState = { campaignId: null, approvalId: null, lastStep: null, weeksRun: 0, learnings: [] };

describe("schedules list the businesses they cover", () => {
  it("journeyDailyRefresh started by its schedule (no ids) covers every committed business, then catches up milestones", async () => {
    const seen: { step: string; businessIds: string[] }[] = [];
    const acts: Partial<Activities> = {
      async listScheduledBusinesses() {
        return { businessIds: [id(1), id(2)] };
      },
      async journeyDailyRefresh(input) {
        seen.push({ step: "refresh", businessIds: input.businessIds });
        return { businesses: input.businessIds.length, touched: 2, eventIds: [], notes: [] };
      },
      async milestonesCatchUp(input) {
        seen.push({ step: "milestones", businessIds: input.businessIds });
        return { businesses: input.businessIds.length, touched: 1, eventIds: [], notes: [`${id(1)}: First customer`] };
      },
    };
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(journeyDailyRefresh, { workflowId: wfId("schedule:journey-daily-refresh"), taskQueue, args: [{}] }));
    expect(seen).toEqual([
      { step: "refresh", businessIds: [id(1), id(2)] },
      { step: "milestones", businessIds: [id(1), id(2)] },
    ]);
    expect(result).toMatchObject({ businesses: 2, touched: 3, notes: [`${id(1)}: First customer`] });
  });
});

describe("channelEngineReconcile", () => {
  it("starts the engine of every channel on the board that has none running and records the ids", async () => {
    const recorded: { businessId: string; channelId: string; workflowId: string }[] = [];
    const stepped: string[] = [];
    const acts: Partial<Activities> = {
      async listEnginesToEnsure() {
        return { channels: [{ businessId: id(1), channelId: id(10), channelKey: "seo", engineWorkflowId: null }, { businessId: id(1), channelId: id(11), channelKey: "social", engineWorkflowId: `engine:${id(11)}` }] };
      },
      async recordEngineWorkflows(input) {
        recorded.push(...input.entries);
        return { updated: input.entries.length };
      },
      // The engine itself: stops at once (the channel reads as disabled), so the test server has nothing left running.
      async channelStep(input): Promise<ChannelStepResult> {
        stepped.push(input.channelId);
        return { step: input.step, state: input.state, awaitingApprovalId: null, stop: true, note: "stopping" };
      },
    };
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(channelEngineReconcile, { workflowId: wfId("schedule:channel-engine-reconcile"), taskQueue }));
    expect(result.started.sort()).toEqual([`engine:${id(10)}`, `engine:${id(11)}`].sort());
    expect(result.failed).toEqual([]);
    // Only the channel whose id was not recorded yet is written.
    expect(recorded).toEqual([{ businessId: id(1), channelId: id(10), workflowId: `engine:${id(10)}` }]);
  });

  it("leaves an engine that is already running alone", async () => {
    const recorded: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acts: Partial<Activities> = {
      async listEnginesToEnsure() {
        return { channels: [{ businessId: id(2), channelId: id(20), channelKey: "pr", engineWorkflowId: `engine:${id(20)}` }] };
      },
      async recordEngineWorkflows(input) {
        recorded.push(...input.entries.map((e) => e.workflowId));
        return { updated: 0 };
      },
      async channelStep(input): Promise<ChannelStepResult> {
        await held;
        return { step: input.step, state: input.state, awaitingApprovalId: null, stop: true, note: "stopping" };
      },
    };
    const result = await rig.run(acts, async (client, taskQueue) => {
      const running = await client.workflow.start(channelEngine, { workflowId: `engine:${id(20)}`, taskQueue, args: [{ businessId: id(2), channelId: id(20), channelKey: "pr", state: empty }] });
      const r = await client.workflow.execute(channelEngineReconcile, { workflowId: wfId("schedule:channel-engine-reconcile"), taskQueue });
      release();
      await running.result();
      return r;
    });
    expect(result).toMatchObject({ started: [], running: [`engine:${id(20)}`], failed: [] });
    expect(recorded).toEqual([]);
  });
});

describe("businessDeletionSweep", () => {
  it("purges each business whose deletion is due and reports one canceled in the meantime", async () => {
    const purged: string[] = [];
    const acts: Partial<Activities> = {
      async listDueBusinessDeletions() {
        return { due: [{ businessId: id(30), scheduledFor: "2026-10-01T00:00:00.000Z", workflowIds: [`engine:${id(31)}`] }, { businessId: id(40), scheduledFor: "2026-10-01T00:00:00.000Z", workflowIds: [] }] };
      },
      async purgeBusiness(input) {
        if (input.businessId === id(40)) return { purged: false, reason: "not due (canceled, or already deleted)" };
        purged.push(input.businessId);
        return { purged: true, reason: null };
      },
    };
    // The engine named for the first business does not exist: signaling it must not fail the sweep.
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(businessDeletionSweep, { workflowId: wfId("schedule:business-deletion-sweep"), taskQueue, args: [{}] }));
    expect(purged).toEqual([id(30)]);
    expect(result).toEqual({ due: 2, purged: [id(30)], skipped: [{ businessId: id(40), reason: "not due (canceled, or already deleted)" }] });
  });
});
