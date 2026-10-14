/**
 * planExecution and playbook steps that change an agent's model (FU-T2-2): the plan step queues the same retest Agent
 * profile › Model does and starts it as a child workflow, so the retest of a draft copy on the new model ends awaiting
 * the founder's decision; a retest the change superseded is told to stop.
 */
import { repos } from "@foundmill/db";
import { MODEL_KEYS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, PlanActionResult } from "../../activities";
import { createPlanActivities } from "../../activities/plan";
import { createTrainingActivities } from "../../activities/training";
import { approvalWait, planExecution, playbook } from "../../workflows";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "../harness";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
let t: OrchestratorTestHarness;
beforeAll(async () => {
  [rig, t] = await Promise.all([createTemporalRig(), setupOrchestratorHarness({ prefix: "planwf" })]);
}, 180_000);
afterAll(async () => {
  await Promise.all([rig?.teardown(), t?.close()]);
});

const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPROVAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function until<T>(read: () => Promise<T | null | false>, what: string, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("planExecution with a set_agent_model step", () => {
  it("queues the retest of a draft copy on the new model and starts it, which ends awaiting the founder's decision", async () => {
    const worker = await repos.agents.get(t.db, t.businessId, t.workerId);
    const liveId = worker.currentVersionId!;
    const target = MODEL_KEYS.find((m) => m !== worker.modelKey)!;
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "option", actions: [{ type: "set_agent_model", params: { agent_id: t.workerId, model_key: target, apply_scope: "agent" } }] });
    const acts: Partial<Activities> = { ...createPlanActivities(t.deps), ...createTrainingActivities(t.deps) };

    const run = await rig.run(acts, async (client, taskQueue) => {
      const done = await client.workflow.execute(planExecution, { workflowId: wfId("plan"), taskQueue, args: [{ businessId: t.businessId, planId: plan.id }] });
      expect(done.status).toBe("done");
      const retests = (done.results[0]!.result as { retests: string[] }).retests;
      expect(retests).toHaveLength(1);
      // The retest is a child of the plan, started under the id the api uses.
      expect(done.spawned).toEqual([`training:${retests[0]}`]);
      // The abandoned child carries on after the plan has finished: wait for it inside the worker's lifetime.
      return until(async () => {
        const r = await repos.training.get(t.db, t.businessId, retests[0]!);
        return r.status === "awaiting_decision" ? r : false;
      }, "the retest to reach a decision");
    });

    expect(run.coachSummaryMd).toMatch(/^Retest on (Opus|Sonnet|Haiku) after the model change from (Opus|Sonnet|Haiku): /);
    // The model changed at once; the live version is the same row until the founder promotes the copy.
    expect(await repos.agents.get(t.db, t.businessId, t.workerId)).toMatchObject({ modelKey: target, currentVersionId: liveId });
    expect(await repos.agents.getVersion(t.db, t.businessId, run.toVersionId!)).toMatchObject({ state: "draft", modelKey: target, createdByKind: "system" });
  });

  it("stops the workflows of retests the change superseded, and ignores one that is not running", async () => {
    const standIn = "training:44444444-4444-4444-8444-444444444444";
    const acts: Partial<Activities> = {
      async loadApproval() {
        return { approvalId: APPROVAL, outcome: null, agentId: null, planActionId: null, createdAt: "2026-10-05T08:00:00.000Z" };
      },
      async loadPlan(input) {
        return { planId: input.planId, status: "executing", businessMode: "automated", actions: [{ id: "a1", type: "set_agent_model", params: {}, agentId: null, policyOutcome: "allow", status: "pending" }] };
      },
      async executePlanAction(): Promise<PlanActionResult> {
        return { actionId: "a1", status: "done", outcome: "allow", approvalId: null, result: {}, spawn: [], stop: [standIn, "training:not-running"] };
      },
      async finishPlan() {
        return { status: "done", progress: 1 };
      },
    };
    const outcome = await rig.run(acts, async (client, taskQueue) => {
      // A workflow that withdraws on `stop`, standing in for a superseded retest that is still running.
      const running = await client.workflow.start(approvalWait, { workflowId: standIn, taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL }] });
      const plan = await client.workflow.execute(planExecution, { workflowId: wfId("plan"), taskQueue, args: [{ businessId: BUSINESS, planId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] });
      return { plan, stopped: await running.result() };
    });
    expect(outcome.plan.status).toBe("done");
    expect(outcome.stopped.outcome).toBe("withdrawn");
  });

  it("a playbook step that changes the model stops superseded retests the same way", async () => {
    const standIn = "training:55555555-5555-4555-8555-555555555555";
    const acts: Partial<Activities> = {
      async loadApproval() {
        return { approvalId: APPROVAL, outcome: null, agentId: null, planActionId: null, createdAt: "2026-10-05T08:00:00.000Z" };
      },
      async loadPlaybook(input) {
        return { playbookId: input.playbookId, enabled: true, steps: [{ type: "set_agent_model", params: {} }], approvals: [], firstRun: false, stop: {}, departmentId: null };
      },
      async playbookShouldStop() {
        return { stop: false, reason: null };
      },
      async playbookStepToPlan() {
        return { planId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", actionIds: ["a1"] };
      },
      async executePlanAction(): Promise<PlanActionResult> {
        return { actionId: "a1", status: "done", outcome: "allow", approvalId: null, result: {}, spawn: [], stop: [standIn] };
      },
      async finishPlan() {
        return { status: "done", progress: 1 };
      },
      async markPlaybookRun() {},
    };
    const outcome = await rig.run(acts, async (client, taskQueue) => {
      const running = await client.workflow.start(approvalWait, { workflowId: standIn, taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL }] });
      const ran = await client.workflow.execute(playbook, { workflowId: wfId("playbook"), taskQueue, args: [{ businessId: BUSINESS, playbookId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", event: null }] });
      return { ran, stopped: await running.result() };
    });
    expect(outcome.ran.stepsRun).toBe(1);
    expect(outcome.stopped.outcome).toBe("withdrawn");
  });
});
