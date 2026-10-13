import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { untilWords } from "../services/cycle";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

async function blockingItem(hz: ApiHarness, subject: string) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "Pick one.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: "a", label: "Option A", recommended: true, consequence: "A happens.", cost_minor: 0, reversible: true },
        { id: "b", label: "Option B", recommended: false, consequence: "B happens.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("business.continue without an orchestrator (BUILD §9.4 in-process cycle step)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "cycle" });
  }, 120_000);
  afterAll(() => hz.close());

  it("cycle.status is idle before the first press", async () => {
    const status = await hz.caller({ userId: hz.A.ownerId }).cycle.status({ businessId: hz.A.businessId });
    expect(status).toMatchObject({ running: false, paused: false, cycleId: null, completedCount: 0, nextCycleNumber: 1, mode: null });
    const cs = await hz.caller({ userId: hz.A.ownerId }).cycle.continueState({ businessId: hz.A.businessId });
    expect(cs.kind).toBe("idle");
  });

  it("one press runs one in-process step: cycle.started, one new Inbox item, cycle.completed, audit; Continue returns to idle", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const inboxBefore = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    const result = await owner.business.continue({ businessId: hz.A.businessId });
    expect(result.action).toBe("started");
    expect(result.mode).toBe("local");
    expect(result.workflow?.queued).toBe(false);
    expect(result.item?.businessId).toBe(hz.A.businessId);
    expect(result.status.running).toBe(false);
    expect(result.status.completedCount).toBe(1);
    expect(result.status.nextCycleNumber).toBe(2);
    expect(result.status.lastOutcome).toBe("completed");
    // The narrated item may itself be a Board decision (blocks Continue) or an update (idle).
    expect(result.continueState.kind).toBe(result.item!.blocksContinue ? "blocked" : "idle");

    const inboxAfter = await owner.inbox.list({ businessId: hz.A.businessId, limit: 200 });
    expect(inboxAfter.items.length).toBe(inboxBefore.items.length + 1);
    const started = await repos.events.list(hz.db, hz.A.businessId, { type: "cycle.started" });
    const completed = await repos.events.list(hz.db, hz.A.businessId, { type: "cycle.completed" });
    expect(started.items).toHaveLength(1);
    expect(completed.items).toHaveLength(1);
    const payload = completed.items[0]!.payload as { cycleNumber: number; workflowId: string; inboxItemIds: string[]; outcome: string };
    expect(payload.cycleNumber).toBe(1);
    expect(payload.workflowId).toBe(`cycle:${hz.A.businessId}:1`);
    expect(payload.inboxItemIds).toEqual([result.item!.id]);
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "business.continue" });
    expect(audit.items).toHaveLength(1);
    expect((audit.items[0]!.details as { mode: string }).mode).toBe("local");

    const history = await owner.cycle.history({ businessId: hz.A.businessId });
    expect(history.cycles).toHaveLength(1);
    expect(history.cycles[0]).toMatchObject({ cycleNumber: 1, outcome: "completed", inboxItemIds: [result.item!.id] });
    // The other business saw nothing.
    expect((await repos.events.list(hz.db, hz.B.businessId, { type: "cycle.started" })).items).toHaveLength(0);
  });

  it("refuses while red items block Continue (AC-11.3.3) and reports the blocked state", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    // Clear whatever the first cycle step left blocking, then add one known blocker.
    const open = await owner.inbox.list({ businessId: hz.A.businessId, blocking: true, state: ["unread", "read"], limit: 50 });
    // A blocking decision is answered, never archived away (audit RUI-14); a blocking note with nothing to choose is archived.
    for (const i of open.items) {
      const options = (i.decision as { options?: { id: string }[] } | null)?.options ?? [];
      if (options.length > 0) await owner.inbox.decide({ businessId: hz.A.businessId, itemId: i.id, chosenOption: options[0]!.id });
      else await owner.inbox.archive({ businessId: hz.A.businessId, itemId: i.id });
    }
    const item = await blockingItem(hz, "Blocking decision");
    const cs = await owner.cycle.continueState({ businessId: hz.A.businessId });
    expect(cs).toMatchObject({ kind: "blocked", count: 1 });
    await expect(owner.business.continue({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "CONFLICT" });
    await owner.inbox.decide({ businessId: hz.A.businessId, itemId: item.id, chosenOption: "a" });
    expect((await owner.cycle.continueState({ businessId: hz.A.businessId })).kind).toBe("idle");
  });

  it("pauseCycle without a running cycle says so; viewers cannot press Continue", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const paused = await owner.business.pauseCycle({ businessId: hz.A.businessId });
    expect(paused.paused).toBe(false);
    expect(paused.reason).toMatch(/no cycle/);
    await expect(hz.caller({ userId: hz.A.viewerId }).business.continue({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).cycle.status({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("business.continue / pauseCycle with Temporal reachable", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "cycle2", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("starts businessCycle with the deterministic id, then pauses and resumes the cycle the orchestrator reports", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const result = await owner.business.continue({ businessId });
    expect(result.action).toBe("started");
    expect(result.mode).toBe("temporal");
    expect(result.workflow?.queued).toBe(true);
    expect(result.item).toBeNull();
    expect(result.continueState.kind).toBe("processing");
    expect(temporal.starts).toEqual([{ type: "businessCycle", workflowId: `cycle:${businessId}:1`, args: [{ businessId, cycleNumber: 1, trigger: "continue" }] }]);

    // The orchestrator's startCycle activity writes cycle.started and opens a session on a running task.
    const cycleId = crypto.randomUUID();
    await repos.events.write(hz.db, businessId, { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, trigger: "continue", timeBoxAgentHours: 4, plannedTaskIds: [hz.A.taskId], budget: null } });
    await repos.tasks.reassign(hz.db, businessId, hz.A.taskId, hz.A.agent2Id);
    await repos.tasks.setStatus(hz.db, businessId, hz.A.taskId, "running", { force: true });

    const running = await owner.cycle.status({ businessId });
    expect(running).toMatchObject({ running: true, paused: false, cycleId, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, mode: "temporal" });
    expect(running.activeTaskIds).toEqual([hz.A.taskId]);
    expect(running.activeAgentIds).toEqual([hz.A.agent2Id]);
    expect(running.activeDepartmentIds.length).toBeGreaterThan(0);

    // A second press while running does not start another workflow.
    const again = await owner.business.continue({ businessId });
    expect(again.action).toBe("already_running");
    expect(temporal.starts).toHaveLength(1);

    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused.paused).toBe(true);
    expect(paused.pausedTasks).toBe(1);
    expect(paused.workflow?.queued).toBe(true);
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "pause" });
    expect(paused.status.paused).toBe(true);
    expect((await repos.tasks.get(hz.db, businessId, hz.A.taskId)).status).toBe("paused");
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");

    const resumed = await owner.business.continue({ businessId });
    expect(resumed.action).toBe("resumed");
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "resume" });
    expect(resumed.status.paused).toBe(false);
    expect((await repos.tasks.get(hz.db, businessId, hz.A.taskId)).status).toBe("running");

    // The orchestrator completes the cycle: status returns to idle with the outcome.
    await repos.events.write(hz.db, businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, outcome: "time_box", tasksDispatched: 1, tasksCompleted: 0, tasksBlocked: 0, agentHours: 4, cost: { amountMinor: 120, currency: "EUR" }, inboxItemIds: [], durationMs: 1000 } });
    await repos.tasks.setStatus(hz.db, businessId, hz.A.taskId, "paused", { force: true });
    const done = await owner.cycle.status({ businessId });
    expect(done).toMatchObject({ running: false, completedCount: 1, lastOutcome: "time_box", nextCycleNumber: 2 });
  });

  it("Continue starts a plan an earlier decision could not hand to the orchestrator (audit api-services-15)", async () => {
    const { businessId } = hz.A;
    // A plan left behind: executing, an action still pending, no workflow id (its planExecution start never reached Temporal).
    const plan = await repos.plans.create(hz.db, businessId, { origin: "free_text", summaryMd: "Hire a growth agent.", status: "executing", actions: [{ type: "hire_agent", params: { role: "growth" }, status: "pending" }] });
    // A playbook step's plan is the orchestrator's own (no planExecution workflow runs it): never started from here.
    const playbookStep = await repos.plans.create(hz.db, businessId, { origin: "playbook", summaryMd: "Playbook step: create_task", status: "executing", actions: [{ type: "create_task", params: { title: "Step" }, status: "pending" }] });
    expect((await repos.plans.awaitingDispatch(hz.db, businessId)).map((p) => p.id)).toEqual([plan.id]);
    await hz.caller({ userId: hz.A.ownerId }).business.continue({ businessId });
    expect(temporal.starts).toContainEqual({ type: "planExecution", workflowId: `plan:${plan.id}`, args: [{ businessId, planId: plan.id }] });
    expect((await repos.plans.get(hz.db, businessId, plan.id)).workflowId).toBe(`plan:${plan.id}`);
    expect(temporal.starts.map((x) => x.workflowId)).not.toContain(`plan:${playbookStep.id}`);
    expect(await repos.plans.awaitingDispatch(hz.db, businessId)).toEqual([]);
  });
});

describe("untilWords (audit VOL-X2)", () => {
  it("reads after the bar's own 'until': no 'until until I return'", () => {
    expect(untilWords(undefined)).toBe("you return");
    expect(untilWords("until I return")).toBe("you return");
    expect(untilWords("you return")).toBe("you return");
    expect(untilWords("until the launch ships")).toBe("the launch ships");
    expect(untilWords("MRR hits 10k")).toBe("MRR hits 10k");
  });
});
