/**
 * Plan executor on PGlite: hard gates never execute (AC-11.3.5), deny is recorded, ask opens an approval and waits,
 * allow runs the typed handler. Also the pure policy evaluation per action type and business mode.
 */
import { repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { compilePlanRuleBased, quarterBounds } from "@foundmill/models";
import { PLAN_ACTION_TYPES } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlanActivities, evaluateAction, HARD_GATE_ACTIONS } from "../activities/plan";
import type { GatewayCallRequest, GatewayCallResponse } from "../gateway-client";
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

  it("a budget the plan gives without a currency is in the business's own; a training run is priced in USD (0025)", async () => {
    await repos.businesses.update(t.db, t.businessId, { currency: "GBP" });
    try {
      const plan = await repos.plans.create(t.db, t.businessId, {
        origin: "free_text",
        actions: [
          { type: "create_task", params: { title: "Draft the price page", kind: "ops", budget_minor: 4_000 }, agentId: t.workerId },
          { type: "train_agent", params: { agent_id: t.workerId } },
        ],
      });
      const task = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
      expect(await repos.tasks.get(t.db, t.businessId, (task.result as { taskId: string }).taskId)).toMatchObject({ budgetMinor: 4_000, currency: "GBP" });
      const training = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[1]!.id, workflowId: "plan:test" });
      expect((await repos.training.get(t.db, t.businessId, (training.result as { trainingRunId: string }).trainingRunId)).currency).toBe("USD");
    } finally {
      await repos.businesses.update(t.db, t.businessId, { currency: "USD" });
    }
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

  it("ask delegated to an agent in Team › Responsibilities: it approves as the approval opens and the action runs (TPD-04)", async () => {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "augmented");
    const departmentId = t.fixture.departmentId;
    const chief = await repos.agents.get(t.db, t.businessId, t.chiefId);
    await repos.agents.update(t.db, t.businessId, t.chiefId, { departmentIds: [departmentId] });
    await repos.departments.update(t.db, t.businessId, departmentId, { approvers: [{ decisionType: "message_customers", handler: { kind: "agent", id: t.workerId } }] });
    try {
      const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type: "send_message", params: { to: "ops@example.com", subject: "Status", body: "On track" }, agentId: t.chiefId }] });
      const actionId = plan.actions[0]!.id;
      const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test" });
      expect(result).toMatchObject({ status: "done", outcome: "ask" });
      expect(await repos.approvals.forPlanAction(t.db, t.businessId, actionId)).toMatchObject({ decisionType: "message_customers", handlerKind: "agent", handlerId: t.workerId, outcome: "approved", byKind: "agent", byId: t.workerId });
      const requested = await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 50 });
      expect(requested.items.some((e) => (e.payload as { planActionId?: string }).planActionId === actionId)).toBe(false);
      const resolved = await repos.events.list(t.db, t.businessId, { type: "approval.resolved", limit: 50 });
      expect(resolved.items.find((e) => (e.payload as { planActionId?: string }).planActionId === actionId)?.payload).toMatchObject({ outcome: "approved", resolvedBy: { kind: "agent", id: t.workerId } });
      // A retry after the approval was decided (the attempt stopped before running the action) runs it under that
      // approval and never opens a second one.
      const again = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type: "send_message", params: { to: "ops@example.com", subject: "Status", body: "Still on track" }, agentId: t.chiefId }] });
      const againId = again.actions[0]!.id;
      await repos.approvals.create(t.db, t.businessId, { planActionId: againId, agentId: t.chiefId, connectorKey: "platform", tool: "send_message", args: {}, reasons: ["augmented"] });
      expect(await acts.executePlanAction({ businessId: t.businessId, planId: again.id, actionId: againId, workflowId: "plan:test" })).toMatchObject({ status: "done", outcome: "ask" });
      expect((await repos.approvals.list(t.db, t.businessId, { limit: 100 })).items.filter((a) => a.planActionId === againId)).toHaveLength(1);
    } finally {
      await repos.departments.update(t.db, t.businessId, departmentId, { approvers: [] });
      await repos.agents.update(t.db, t.businessId, t.chiefId, { departmentIds: chief.departmentIds });
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
          { type: "update_roadmap", params: { title: "Written while stopped", create: true } },
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

  it("'Switch all agents to Haiku' as the rule compiler writes it moves every agent; one that reaches no agent fails (audit verify-api-services-x1)", async () => {
    const compiled = compilePlanRuleBased("Switch all agents to haiku");
    expect(compiled.actions[0]).toMatchObject({ type: "set_agent_model", params: { model_key: "haiku", apply_scope: "all" } });
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: compiled.actions.map((a) => ({ type: a.type, params: a.params, agentId: a.agent_id })) });
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(result.status).toBe("done");
    const agents = (await repos.agents.list(t.db, t.businessId, { limit: 50 })).items;
    expect((result.result as { updated: string[] }).updated.sort()).toEqual(agents.map((a) => a.id).sort());
    expect(agents.every((a) => a.modelKey === "haiku")).toBe(true);

    // A plan written before the names were shared (`scope`) reads the same; a lone agent action with no agent fails.
    const legacy = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type: "set_agent_model", params: { model_key: "sonnet", agent_id: null, scope: "all" } }, { type: "set_agent_model", params: { model_key: "opus", agent_id: null, apply_scope: "agent" } }] });
    const [all, nobody] = legacy.actions;
    expect((await acts.executePlanAction({ businessId: t.businessId, planId: legacy.id, actionId: all!.id, workflowId: "plan:test" })).status).toBe("done");
    expect((await repos.agents.list(t.db, t.businessId, { limit: 50 })).items.every((a) => a.modelKey === "sonnet")).toBe(true);
    const failed = await acts.executePlanAction({ businessId: t.businessId, planId: legacy.id, actionId: nobody!.id, workflowId: "plan:test" });
    expect(failed.status).toBe("failed");
    expect((await repos.plans.getAction(t.db, t.businessId, nobody!.id)).status).toBe("failed");
  });

  it("'push the retail portal milestone to next quarter' moves that item, keeps its other fields and creates nothing (audit VRB-X1)", async () => {
    const portal = await repos.product.upsertRoadmapItem(t.db, t.businessId, { title: "Retail portal", descriptionMd: "Stores order online.", horizon: "now", confidence: 4, ownerRef: { kind: "agent", id: t.workerId }, status: "planned" });
    await repos.product.upsertRoadmapItem(t.db, t.businessId, { title: "Partner program", horizon: "later" });
    const before = await repos.product.listRoadmap(t.db, t.businessId);
    // The rule compiler with the roadmap names the item; without it the orchestrator matches the words itself.
    const named = compilePlanRuleBased("push the retail portal milestone to next quarter", { roadmap: before });
    expect(named.actions[0]).toMatchObject({ type: "update_roadmap", params: { roadmap_item_id: portal.id } });
    const unnamed = compilePlanRuleBased("push the retail portal milestone to next quarter");
    for (const compiled of [named, unnamed]) {
      const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: compiled.actions.map((a) => ({ type: a.type, params: a.params, agentId: a.agent_id })) });
      const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
      expect(result.status).toBe("done");
      expect(result.result).toMatchObject({ roadmapItemId: portal.id });
    }
    const next = quarterBounds(t.clock.now(), 1);
    const after = await repos.product.getRoadmapItem(t.db, t.businessId, portal.id);
    expect(after).toMatchObject({ title: "Retail portal", descriptionMd: "Stores order online.", horizon: "next", targetStart: next.start, targetEnd: next.end, confidence: 4, ownerRef: { kind: "agent", id: t.workerId } });
    expect((await repos.product.listRoadmap(t.db, t.businessId)).length).toBe(before.length);

    // Nothing on the roadmap matches: the action fails and says so, and no placeholder item appears.
    const unknown = compilePlanRuleBased("push the warehouse robots milestone to later");
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: unknown.actions.map((a) => ({ type: a.type, params: a.params, agentId: a.agent_id })) });
    const result = await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(result.status).toBe("failed");
    expect((result.result as { error: string }).error).toMatch(/No roadmap item matches/);
    expect((await repos.product.listRoadmap(t.db, t.businessId)).length).toBe(before.length);
    expect((await acts.finishPlan({ businessId: t.businessId, planId: plan.id })).status).toBe("failed");
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

describe("send_message and schedule_meeting use the connectors' own tools (#125)", () => {
  type Respond = (req: GatewayCallRequest) => GatewayCallResponse;
  /** Script the gateway's answers for one test (the offline stand-in answers allow with no data). */
  async function withGateway(respond: Respond, fn: () => Promise<void>) {
    const original = t.gateway.call;
    t.gateway.call = async (_token, req) => {
      t.gateway.calls.push(req);
      return respond(req);
    };
    try {
      await fn();
    } finally {
      t.gateway.call = original;
    }
  }
  const run = async (type: "send_message" | "schedule_meeting", params: Record<string, unknown>, extra: { approved?: boolean; approvalId?: string } = {}) => {
    const plan = await repos.plans.create(t.db, t.businessId, { origin: "free_text", actions: [{ type, params, agentId: t.chiefId }] });
    const actionId = plan.actions[0]!.id;
    return { actionId, planId: plan.id, result: await acts.executePlanAction({ businessId: t.businessId, planId: plan.id, actionId, workflowId: "plan:test", ...extra }) };
  };
  beforeAll(async () => {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "automated");
  });
  afterAll(async () => {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "assisted");
  });

  it("a message to a CRM record named in the plan goes out as gmail.send_message to that record's address", async () => {
    const ada = await repos.entities.get(t.db, t.businessId, t.fixture.entityId);
    await withGateway(
      () => ({ outcome: "allow", result: { ok: true, data: { id: "msg_1", threadId: "t_1", to: [] } }, costMinor: 0 }),
      async () => {
        const { result } = await run("send_message", { recipient: ada.displayName, subject: "Your invoice", body: "Here it is." });
        expect(result.status).toBe("done");
        expect(t.gateway.calls.at(-1)).toEqual({ connector: "gmail", tool: "send_message", args: { to: [String((ada.identifiers as { email: string }).email)], subject: "Your invoice", text: expect.stringMatching(/^Here it is\.\n\nSent on behalf of .+ by its AI assistant\.$/) }, context: expect.objectContaining({ recipient: (ada.identifiers as { email: string }).email }) });
        expect(result.result).toMatchObject({ connector: "gmail", messageId: "msg_1" });
      },
    );
  });

  it("SendGrid sends from the account's verified sender with its own argument shape", async () => {
    await withGateway(
      (req) => (req.tool === "list_verified_senders" ? { outcome: "allow", result: { ok: true, data: { items: [{ id: 1, fromEmail: "hello@biz.example", fromName: "Biz", replyTo: null, verified: true, locked: false }] } } } : { outcome: "allow", result: { ok: true, data: { messageId: "sg_1" } } }),
      async () => {
        const { result } = await run("send_message", { to: "lead@example.com", subject: "Hi", body: "Hello there.", connector: "sendgrid" });
        expect(result.status).toBe("done");
        expect(t.gateway.calls.at(-1)).toMatchObject({ connector: "sendgrid", tool: "send_mail", args: { kind: "transactional", from: { email: "hello@biz.example", name: "Biz" }, to: [{ email: "lead@example.com" }], subject: "Hi", text: expect.stringMatching(/^Hello there\.\n\nSent on behalf of /) } });
      },
    );
  });

  it("a send the connector refuses fails the action with the connector's reason (never 'done')", async () => {
    await withGateway(
      () => ({ outcome: "allow", result: { ok: false, error: { code: "invalid_args", message: "gmail.send_message: to must be an email" } } }),
      async () => {
        const { result } = await run("send_message", { to: "x@example.com", body: "Hi" });
        expect(result.status).toBe("failed");
        expect((result.result as { error: string }).error).toMatch(/gmail\.send_message failed: gmail\.send_message: to must be an email/);
      },
    );
  });

  it("a recipient with no email on record fails clearly and calls nothing", async () => {
    const before = t.gateway.calls.length;
    const { result } = await run("send_message", { recipient: "Nobody We Know", body: "Hi" });
    expect(result.status).toBe("failed");
    expect((result.result as { error: string }).error).toMatch(/No email address on record for Nobody We Know/);
    expect(t.gateway.calls.length).toBe(before);
  });

  it("a message with only an intent becomes a task for the acting agent, who drafts it with its own tools", async () => {
    const before = t.gateway.calls.length;
    const { result, actionId } = await run("send_message", { to: "partner@example.com", intent: "Ask about a pilot", requires_disclosure: true });
    expect(result.status).toBe("done");
    expect(result.result).toMatchObject({ delegated: true, assigneeAgentId: t.chiefId });
    const task = await repos.tasks.get(t.db, t.businessId, (result.result as { taskId: string }).taskId);
    expect(task).toMatchObject({ planActionId: actionId, assigneeAgentId: t.chiefId });
    expect(task.goalMd).toContain("partner@example.com");
    expect(task.goalMd).toContain("AI agent");
    expect(t.gateway.calls.length).toBe(before);
  });

  it("schedule_meeting creates a calendar event with create_event's arguments; a rejected argument fails the action", async () => {
    await withGateway(
      () => ({ outcome: "allow", result: { ok: true, data: { id: "evt_1" } } }),
      async () => {
        const { result } = await run("schedule_meeting", { title: "Intro call", attendees: ["x@example.com"], start: "2026-10-20T15:00:00Z" });
        expect(result.status).toBe("done");
        expect(t.gateway.calls.at(-1)).toMatchObject({ connector: "google_calendar", tool: "create_event", args: { calendarId: "primary", summary: "Intro call", start: "2026-10-20T15:00:00.000Z", end: "2026-10-20T15:30:00.000Z", attendees: ["x@example.com"] } });
        expect(result.result).toMatchObject({ eventId: "evt_1" });
      },
    );
    await withGateway(
      () => ({ outcome: "allow", result: { ok: false, error: { code: "invalid_args", message: "google_calendar.create_event: invalid start" } } }),
      async () => {
        const { result } = await run("schedule_meeting", { title: "Intro call", attendees: ["x@example.com"], start: "2026-10-20T15:00:00Z" });
        expect(result.status).toBe("failed");
      },
    );
  });

  it("a meeting with no time becomes a task for the acting agent to find a slot", async () => {
    const { result } = await run("schedule_meeting", { with: "x@example.com", topic: "Pricing review", timeframe: "next week" });
    expect(result.status).toBe("done");
    expect(result.result).toMatchObject({ delegated: true });
  });

  it("the connector's own policy asking makes the action wait once; asking again after the approval fails it", async () => {
    let approvalId = "";
    await withGateway(
      () => ({ outcome: "ask", approvalId, reasons: ["new counterparty"] }),
      async () => {
        const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.chiefId, connectorKey: "gmail", tool: "send_message", args: {}, reasons: ["new counterparty"] });
        approvalId = approval.id;
        const first = await run("send_message", { to: "new@example.com", body: "Hello" });
        expect(first.result).toMatchObject({ status: "awaiting_approval", approvalId });
        expect((await repos.plans.getAction(t.db, t.businessId, first.actionId)).status).toBe("awaiting_approval");
        await repos.approvals.resolve(t.db, t.businessId, approvalId, { outcome: "approved", byKind: "user", byId: t.fixture.ownerId });
        const again = await acts.executePlanAction({ businessId: t.businessId, planId: first.planId, actionId: first.actionId, workflowId: "plan:test", approved: true, approvalId });
        expect(again.status).toBe("failed");
        expect((again.result as { error: string }).error).toMatch(/asked again/);
      },
    );
  });
});
