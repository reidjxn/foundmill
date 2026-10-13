/**
 * Plan executor on PGlite: hard gates never execute (AC-11.3.5), deny is recorded, ask opens an approval and waits,
 * allow runs the typed handler. Also the pure policy evaluation per action type and business mode.
 */
import { repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { PLAN_ACTION_TYPES } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlanActivities, evaluateAction, HARD_GATE_ACTIONS } from "../activities/plan";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let acts: ReturnType<typeof createPlanActivities>;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "plan" });
  acts = createPlanActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

const business = (mode: "augmented" | "assisted" | "automated") => ({ id: "11111111-1111-1111-1111-111111111111", businessMode: mode }) as const;

describe("evaluateAction (pure)", () => {
  it("request_human_action is the only hard gate and is flagged in every mode", () => {
    expect([...HARD_GATE_ACTIONS]).toEqual(["request_human_action"]);
    for (const mode of ["augmented", "assisted", "automated"] as const) {
      const v = evaluateAction({ type: "request_human_action", params: { request: "pay the supplier invoice" }, agentId: null }, { business: business(mode), agents: [], holidayActive: false });
      expect(v.hardGate).toBe(true);
    }
  });
  it("internal actions are allowed without a policy round-trip; external ones ask in augmented mode", () => {
    for (const type of PLAN_ACTION_TYPES) {
      const v = evaluateAction({ type, params: { amount_minor: 5_000, channel: "paid_ads" }, agentId: null }, { business: business("augmented"), agents: [], holidayActive: false });
      if (type === "send_message" || type === "schedule_meeting" || type === "set_budget" || type === "approve_spend") expect(v.outcome).toBe("ask");
      else if (type === "train_agent") expect(["allow", "ask"]).toContain(v.outcome);
      else expect(v.outcome).toBe("allow");
    }
  });
  it("assisted mode allows a spend under the approval threshold and asks above it", () => {
    const under = evaluateAction({ type: "set_budget", params: { amount_minor: 1_000, channel: "paid_ads" }, agentId: null }, { business: business("assisted"), agents: [], holidayActive: false });
    const over = evaluateAction({ type: "set_budget", params: { amount_minor: 900_000, channel: "paid_ads" }, agentId: null }, { business: business("assisted"), agents: [], holidayActive: false });
    expect(under.outcome).toBe("allow");
    expect(over.outcome).toBe("ask");
  });
});

describe("executePlanAction on PGlite", () => {
  it("hard gate: creates a founder task + inbox item and never executes the request", async () => {
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", summaryMd: "pay the supplier", actions: [{ type: "request_human_action", params: { request: "pay the supplier invoice of €1,200", instructions: "Pay from the business account; the team cannot move money." }, agentId: t.chiefId }] });
    const action = plan.actions[0]!;
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: action.id, workflowId: "plan:test" });
    expect(result.status).toBe("done");
    expect(result.result).toMatchObject({ hardGate: true, executed: false });
    const taskId = (result.result as { taskId: string }).taskId;
    const task = await repos.tasks.get(t.db, t.businessId, taskId);
    expect(task.assigneeAgentId).toBeNull();
    expect(task.title).toMatch(/^Founder action:/);
    const item = await repos.inbox.get(t.db, t.businessId, (result.result as { inboxItemId: string }).inboxItemId);
    expect(item.type).toBe("warning");
    // No approval was created and nothing else happened: the plan is done with the gated action recorded.
    expect(await repos.approvals.forPlanAction(t.db, t.businessId, action.id)).toBeNull();
    const status = await repos.plans.status(t.db, t.businessId, plan.id);
    expect(status.counts.done).toBe(1);
    // Running it again is a no-op.
    const again = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: action.id, workflowId: "plan:test" });
    expect(again.status).toBe("done");
  });

  it("allow: create_task runs the handler, links the plan action and requests an agentSession child", async () => {
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "option", actions: [{ type: "create_task", params: { title: "Write the onboarding email", kind: "channel", channel: "email_automation", goal: "Three-step welcome sequence" }, agentId: t.workerId }] });
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(result.status).toBe("done");
    expect(result.outcome).toBe("allow");
    const task = await repos.tasks.get(t.db, t.businessId, (result.result as { taskId: string }).taskId);
    expect(task.kind).toBe("channel");
    expect(task.planActionId).toBe(plan.actions[0]!.id);
    expect(task.departmentId).toBeNull(); // the fixture's department is a product department, never matched by name
    expect(result.spawn).toHaveLength(1);
    expect(result.spawn[0]!.workflow).toBe("agentSession");
    expect(result.spawn[0]!.workflowId).toMatch(/^session:/);
    expect((await acts.finishPlan({ businessId: t.businessId, planId: plan.id })).status).toBe("done");
  });

  it("ask: in augmented mode an external action opens an approval and waits; approval then executes through the gateway", async () => {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "augmented");
    try {
      const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type: "send_message", params: { to: "cfo@example.com", subject: "Hello", body: "Hi" }, agentId: t.chiefId }] });
      const actionId = plan.actions[0]!.id;
      const first = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
      expect(first.status).toBe("awaiting_approval");
      expect(first.approvalId).toBeTruthy();
      const approval = await repos.approvals.get(t.db, t.businessId, first.approvalId!);
      expect(approval.planActionId).toBe(actionId);
      expect(approval.outcome).toBeNull();
      const requested = await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 5 });
      expect(requested.items.some((e) => (e.payload as { approvalId: string }).approvalId === first.approvalId)).toBe(true);
      // Same call again: still waiting, no second approval.
      const second = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
      expect(second.status).toBe("awaiting_approval");
      expect(second.approvalId).toBe(first.approvalId);
      // Founder approves → the handler sends through the gateway (offline stand-in records the call).
      await repos.approvals.resolve(t.db, t.businessId, first.approvalId!, { outcome: "approved", byKind: "user", byId: t.fixture.ownerId });
      const third = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test", approved: true, approvalId: first.approvalId });
      expect(third.status).toBe("done");
      // A real tool with its real arguments (gmail.send_message's Compose), and no invented session id on the token.
      const sent = t.gateway.calls.find((c) => c.connector === "gmail" && c.tool === "send_message");
      expect(sent?.args).toMatchObject({ to: ["cfo@example.com"], subject: "Hello", text: expect.stringMatching(/^Hi\n\nSent on behalf of .+ by its AI assistant\.$/) });
      expect(sent?.context).toMatchObject({ recipient: "cfo@example.com", planActionId: actionId });
      expect(t.gateway.minted.at(-1)).toMatchObject({ allowedTools: ["gmail:send_message"], sessionId: null });
    } finally {
      await repos.businesses.setBusinessMode(t.db, t.businessId, "assisted");
    }
  });

  it("rejected approval records the action as denied without executing", async () => {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "augmented");
    try {
      const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type: "schedule_meeting", params: { title: "Intro", attendees: ["x@example.com"] }, agentId: t.chiefId }] });
      const actionId = plan.actions[0]!.id;
      const callsBefore = t.gateway.calls.length;
      const first = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
      await repos.approvals.resolve(t.db, t.businessId, first.approvalId!, { outcome: "rejected", byKind: "user", byId: t.fixture.ownerId });
      const after = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
      expect(after.status).toBe("denied");
      expect(t.gateway.calls.length).toBe(callsBefore);
    } finally {
      await repos.businesses.setBusinessMode(t.db, t.businessId, "assisted");
    }
  });

  it("while the team is stopped a message or a meeting fails with the reason (no gateway call, no approval); a hire starts paused; internal actions still run", async () => {
    await stopBusinessAgents(t.db, t.businessId, { reason: "kill_switch" });
    try {
      const plan = await repos.plans.create(t.db, t.businessId, {
        origin: "free_text",
        actions: [
          { type: "send_message", params: { to: "cfo@example.com", subject: "Hello", body: "Hi" }, agentId: t.chiefId },
          { type: "schedule_meeting", params: { title: "Intro", attendees: ["x@example.com"] }, agentId: t.chiefId },
          { type: "hire_agent", params: { template_key: "docs_writer" } },
          { type: "update_roadmap", params: { title: "Written while stopped" } },
        ],
      });
      const [message, meeting, hire, roadmap] = plan.actions.map((a) => a.id);
      const calls = t.gateway.calls.length;
      const minted = t.gateway.minted.length;
      const approvals = (await repos.approvals.list(t.db, t.businessId, { limit: 200 })).items.length;
      for (const actionId of [message!, meeting!]) {
        const r = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
        expect(r).toMatchObject({ status: "failed", result: { error: expect.stringMatching(/agents are stopped/) } });
        expect((await repos.plans.getAction(t.db, t.businessId, actionId)).status).toBe("failed");
      }
      // An approved retry (the founder approved before the stop) is refused the same way.
      const approved = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: message!, workflowId: "plan:test", approved: true });
      expect(approved.status).toBe("failed");
      expect(t.gateway.calls.length).toBe(calls);
      expect(t.gateway.minted.length).toBe(minted);
      expect((await repos.approvals.list(t.db, t.businessId, { limit: 200 })).items.length).toBe(approvals);

      const hired = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: hire!, workflowId: "plan:test" });
      expect(hired.status).toBe("done");
      const agentId = (hired.result as { agentId: string }).agentId;
      expect(await repos.agents.get(t.db, t.businessId, agentId)).toMatchObject({ status: "paused", pausedReason: "kill_switch" });
      expect((await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: roadmap!, workflowId: "plan:test" })).status).toBe("done");
      await repos.agents.release(t.db, t.businessId, agentId);
    } finally {
      await resumeBusinessAgents(t.db, t.businessId);
    }
  });

  it("set_agent_model with apply scope 'type' updates exactly the agents of that type (AC-11.10.5)", async () => {
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "option", actions: [{ type: "set_agent_model", params: { agent_id: t.workerId, model_key: "opus", apply_scope: "type" } }] });
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(result.status).toBe("done");
    const updated = (result.result as { updated: string[] }).updated;
    expect(updated).toContain(t.workerId);
    expect(updated).not.toContain(t.chiefId);
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).modelKey).toBe("opus");
    expect((await repos.agents.get(t.db, t.businessId, t.chiefId)).modelKey).toBe("sonnet");
  });

  it("train_agent creates a draft version and a queued training run; the live version is untouched", async () => {
    const before = await repos.agents.get(t.db, t.businessId, t.workerId);
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "option", actions: [{ type: "train_agent", params: { agent_id: t.workerId, instructions: { tone: "Terse and testable." } } }] });
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(result.status).toBe("done");
    const { trainingRunId, draftVersionId } = result.result as { trainingRunId: string; draftVersionId: string };
    const draft = await repos.agents.getVersion(t.db, t.businessId, draftVersionId);
    expect(draft.state).toBe("draft");
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).currentVersionId).toBe(before.currentVersionId);
    expect((await repos.training.get(t.db, t.businessId, trainingRunId)).status).toBe("queued");
    expect(result.spawn[0]).toMatchObject({ workflow: "trainingRun", workflowId: `training:${trainingRunId}` });
  });
});
