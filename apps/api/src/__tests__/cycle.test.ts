import { repos } from "@foundmill/db";
import { FIRST_CYCLE_SESSION_CAP_MINOR } from "@foundmill/config";
import { createWireDb, type WireDb } from "@foundmill/db/testing/wire";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCaller } from "../router";
import { failureOf, untilWords } from "../services/cycle";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

/** A hard stop: the one kind of note that holds Continue since Nov 7, 2026 (0071), like "credits used up". */
async function blockingItem(hz: ApiHarness, subject: string) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "warning",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "Top up to keep working.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: null,
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("business.continue without an orchestrator (BUILD §9.4 in-process round of work step)", () => {
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
    // Without an orchestrator the press stays one step (Nov 7, 2026): no run starts, nothing keeps going on its own.
    expect(result.run).toBeNull();
    expect(result.status.run).toBeNull();
    expect((await repos.events.list(hz.db, hz.A.businessId, { type: ["cycle.run_started", "cycle.run_ended"] })).items).toHaveLength(0);
    // The press answers honestly (first-time founder report, Nov 8, 2026): no agent worked, here is the note that stood in.
    expect(result.summary).toMatchObject({ kind: "orchestrator_unreachable", headline: "The team cannot run right now: the orchestrator is not reachable", orchestrator: false });
    expect(result.summary.detail).toContain(result.item!.subject);
    // business.get says so before the press too (a disabled Temporal is an unreachable orchestrator).
    expect((await owner.business.get({ businessId: hz.A.businessId })).orchestrator).toEqual({ reachable: false });

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
    await owner.inbox.archive({ businessId: hz.A.businessId, itemId: item.id });
    expect((await owner.cycle.continueState({ businessId: hz.A.businessId })).kind).toBe("idle");
  });

  it("pauseCycle without a running round of work says so; viewers cannot press Continue", async () => {
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

  it("starts a run on the business's autopilot workflow (signal-with-start) with the deterministic round of work number, then pauses and resumes the round of work the orchestrator reports", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const result = await owner.business.continue({ businessId });
    expect(result.action).toBe("started");
    expect(result.mode).toBe("temporal");
    expect(result.workflow?.queued).toBe(true);
    expect(result.item).toBeNull();
    expect(result.continueState).toEqual({ kind: "processing", run: true });
    // The sentence names the cycle and what it has to build, and says the run keeps going.
    expect(result.summary).toMatchObject({ kind: expect.stringMatching(/^(started|nothing_ready)$/), orchestrator: true });
    expect(result.summary.headline).toMatch(/^Cycle 1 started: (\d+ tasks? ready to build|nothing is ready to build yet)$/);
    expect(result.summary.detail).toContain("New rounds of work start on their own");
    // Once connected, business.get reports the orchestrator reachable.
    expect((await owner.business.get({ businessId })).orchestrator).toEqual({ reachable: true });
    // Continue runs until done (Nov 7, 2026): the workflow starts cycle 1 and the rounds after it; the API starts no cycle itself.
    expect(temporal.starts.filter((x) => x.type === "businessCycle")).toEqual([]);
    expect(temporal.signalStarts).toEqual([{ type: "autopilot", workflowId: `autopilot:${businessId}`, args: [{ businessId }], signal: "continueRun", signalArgs: [{ runId: result.run!.id, cycleNumber: 1, by: hz.A.ownerId, cycleInput: { budgetCapMinor: FIRST_CYCLE_SESSION_CAP_MINOR, maxConcurrent: 1 } }] }]);
    const runStarted = (await repos.events.list(hz.db, businessId, { type: "cycle.run_started" })).items;
    expect(runStarted.map((e) => e.payload)).toEqual([{ runId: result.run!.id, firstCycleNumber: 1 }]);
    expect((await repos.audit.list(hz.db, businessId, { action: "business.continue" })).items[0]!.details).toMatchObject({ cycleNumber: 1, runId: result.run!.id, workflowId: `cycle:${businessId}:1` });
    // The queued status the press returns without reading it again is the one cycle.status reads now.
    expect(result.status).toMatchObject({ running: true, queued: true, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, trigger: "continue", mode: "temporal", nextCycleNumber: 2, run: { id: result.run!.id, rounds: 0 } });
    expect(await owner.cycle.status({ businessId })).toEqual(result.status);

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

    // A second press while running starts nothing more: the run is open already.
    const again = await owner.business.continue({ businessId });
    expect(again.action).toBe("already_running");
    expect(again.run).toBeNull();
    expect(temporal.signalStarts).toHaveLength(1);

    // Pause pauses the round and ends the run: the workflow is told, and the end is written at once.
    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused.paused).toBe(true);
    expect(paused.runEnded).toBe(true);
    expect(paused.pausedTasks).toBe(1);
    expect(paused.workflow?.queued).toBe(true);
    expect(temporal.signals).toContainEqual({ workflowId: `autopilot:${businessId}`, signal: "continueRunEnd", args: [{ reason: "paused", runId: result.run!.id, by: hz.A.ownerId }] });
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "pause" });
    expect(paused.status.paused).toBe(true);
    expect(paused.status.run).toBeNull();
    expect((await repos.events.list(hz.db, businessId, { type: "cycle.run_ended" })).items.map((e) => e.payload)).toEqual([{ runId: result.run!.id, reason: "paused", rounds: 0, cost: { amountMinor: 0, currency: "USD" }, maxCyclesPerDay: null }]);
    expect((await repos.tasks.get(hz.db, businessId, hz.A.taskId)).status).toBe("paused");
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");

    // Continue resumes the cycle and starts a new run that picks up after it (no cycle number reserved).
    const resumed = await owner.business.continue({ businessId });
    expect(resumed.action).toBe("resumed");
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId: `cycle:${businessId}:1`, signal: "resume" });
    expect(resumed.status.paused).toBe(false);
    expect(resumed.run).not.toBeNull();
    expect(resumed.run!.id).not.toBe(result.run!.id);
    expect(resumed.continueState).toEqual({ kind: "processing", run: true });
    expect(temporal.signalStarts.at(-1)).toMatchObject({ workflowId: `autopilot:${businessId}`, signal: "continueRun", signalArgs: [{ runId: resumed.run!.id, cycleNumber: null }] });
    expect((await repos.tasks.get(hz.db, businessId, hz.A.taskId)).status).toBe("running");

    // The orchestrator completes the cycle: status returns to idle with the outcome.
    await repos.events.write(hz.db, businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: 1, workflowId: `cycle:${businessId}:1`, outcome: "time_box", tasksDispatched: 1, tasksCompleted: 0, tasksBlocked: 0, agentHours: 4, cost: { amountMinor: 120, currency: "EUR" }, inboxItemIds: [], durationMs: 1000 } });
    await repos.tasks.setStatus(hz.db, businessId, hz.A.taskId, "paused", { force: true });
    const done = await owner.cycle.status({ businessId });
    expect(done).toMatchObject({ running: false, completedCount: 1, lastOutcome: "time_box", nextCycleNumber: 2, run: { id: resumed.run!.id, rounds: 1 } });
    // Between rounds the run keeps Continue on processing (Pause), until the workflow ends it.
    expect(await owner.cycle.continueState({ businessId })).toEqual({ kind: "processing", run: true });
    await repos.events.write(hz.db, businessId, { type: "cycle.run_ended", actor: { kind: "system", id: "orchestrator" }, idempotencyKey: `cycle.run_ended:${resumed.run!.id}`, payload: { runId: resumed.run!.id, reason: "done", rounds: 1, cost: { amountMinor: 120, currency: "EUR" } } });
    expect((await owner.cycle.status({ businessId })).run).toBeNull();
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
  });

  it("round 1 of a project on its own key starts as before, with no first-round cap (WP-09 T11)", async () => {
    const { businessId } = hz.B;
    await repos.businesses.update(hz.db, businessId, { modelBilling: "byok" });
    const result = await hz.caller({ userId: hz.B.ownerId }).business.continue({ businessId });
    expect(result.action).toBe("started");
    const press = temporal.signalStarts.find((x) => x.workflowId === `autopilot:${businessId}`)!;
    expect(press.signalArgs).toEqual([{ runId: result.run!.id, cycleNumber: 1, by: hz.B.ownerId }]);
  });

  it("a pause pressed while the orchestrator is still planning is still the open round of work's once cycle.started lands (Nov 9, 2026)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const press = await owner.business.continue({ businessId });
    expect(press.action).toBe("started");
    const workflowId = `cycle:${businessId}:${press.status.cycleNumber}`;
    // The second tap lands three seconds after the first: the cycle is queued, nothing has started.
    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused.paused).toBe(true);
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId, signal: "pause" });
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
    // The orchestrator's planCycle finishes and startCycle writes cycle.started, after the pause row.
    const cycleId = crypto.randomUUID();
    await repos.events.write(hz.db, businessId, { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: press.status.cycleNumber, workflowId, trigger: "continue", timeBoxAgentHours: 4, plannedTaskIds: [], budget: null } });
    const status = await owner.cycle.status({ businessId });
    expect(status).toMatchObject({ running: true, queued: false, paused: true, cycleId, workflowId });
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
    // So Continue resumes it (before the fix: already_running, and the workflow held on the pause until its time box).
    const resumed = await owner.business.continue({ businessId });
    expect(resumed.action).toBe("resumed");
    expect(temporal.signals.at(-1)).toMatchObject({ workflowId, signal: "resume" });
    expect(resumed.status.paused).toBe(false);
    await repos.events.write(hz.db, businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber: press.status.cycleNumber, workflowId, outcome: "completed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, cost: { amountMinor: 0, currency: "USD" }, inboxItemIds: [], durationMs: 1000 } });
    await repos.events.write(hz.db, businessId, { type: "cycle.run_ended", actor: { kind: "system", id: "orchestrator" }, idempotencyKey: `cycle.run_ended:${resumed.run!.id}`, payload: { runId: resumed.run!.id, reason: "done", rounds: 1, cost: { amountMinor: 0, currency: "USD" } } });
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
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

describe("business.continue reads the round of work status once (audit realtime-bg F2)", () => {
  let hz: ApiHarness;
  let wire: WireDb;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "cycle3", temporalClient: temporal });
    wire = await createWireDb(hz.h.pg);
  }, 120_000);
  afterAll(async () => {
    await wire?.close();
    await hz?.close();
  });

  it("one wave of reads (the stop, the Continue state, the status) before the start; none after it", async () => {
    const { businessId } = hz.A;
    const owner = createCaller({ ...hz.deps, db: wire.db }, { userId: hz.A.ownerId, email: "owner@a.test" });
    wire.reset();
    const result = await owner.business.continue({ businessId });
    expect(result).toMatchObject({ action: "started", mode: "temporal", continueState: { kind: "processing" } });
    const statements = wire.statements();
    // The cycle events and the queue rows are read once each (until 2026-10-15: three times, one after another).
    expect(statements.filter((q) => /from "events" where/.test(q) && /order by/.test(q))).toHaveLength(1);
    expect(statements.filter((q) => /from "audit_log" where/.test(q) && /"audit_log"\."action" in/.test(q))).toHaveLength(2);
    // Until 2026-10-15: 28 on the wire; 18 until Nov 7, 2026, when the press began writing its run's start (`cycle.run_started`, in the audit row's transaction);
    // 20 until Nov 8, 2026, when the press began answering with what is ready to build and the product stage (three more statements, in the reconcile's wave).
    expect(wire.roundTrips(), statements.join("\n")).toBeLessThanOrEqual(23);
    expect(await hz.caller({ userId: hz.A.ownerId }).cycle.status({ businessId })).toEqual(result.status);
  });

  it("a second press answers already_running from the same single read", async () => {
    const { businessId } = hz.A;
    const owner = createCaller({ ...hz.deps, db: wire.db }, { userId: hz.A.ownerId, email: "owner@a.test" });
    wire.reset();
    const again = await owner.business.continue({ businessId });
    expect(again).toMatchObject({ action: "already_running", continueState: { kind: "processing" }, status: { running: true, queued: true, cycleNumber: 1 } });
    expect(wire.statements().filter((q) => /from "events" where/.test(q) && /order by/.test(q))).toHaveLength(1);
    expect(temporal.signalStarts.filter((x) => x.signal === "continueRun")).toHaveLength(1);
  });
});

describe("Continue runs until done (Nov 7, 2026): between rounds, Pause, Stop all agents and a lost workflow", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "cycle-run", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());
  afterEach(() => vi.useRealTimers());

  /** The orchestrator runs the press's cycle to its end: the run stays open, so the next round is the workflow's to start. */
  async function roundEnds(businessId: string, cycleNumber: number) {
    const cycleId = crypto.randomUUID();
    const workflowId = `cycle:${businessId}:${cycleNumber}`;
    await repos.events.write(hz.db, businessId, { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber, workflowId, trigger: "continue", timeBoxAgentHours: 4, plannedTaskIds: [], budget: null } });
    await repos.events.write(hz.db, businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId, cycleNumber, workflowId, outcome: "completed", tasksDispatched: 1, tasksCompleted: 1, tasksBlocked: 0, agentHours: 1, cost: { amountMinor: 30, currency: "USD" }, inboxItemIds: [], durationMs: 1000 } });
  }

  it("between rounds Continue stays on processing; Pause there ends the run (no round of work to pause) and Continue starts a new run", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const press = await owner.business.continue({ businessId });
    await roundEnds(businessId, 1);
    const between = await owner.cycle.status({ businessId });
    expect(between).toMatchObject({ running: false, run: { id: press.run!.id, rounds: 1 } });
    expect(await owner.cycle.continueState({ businessId })).toEqual({ kind: "processing", run: true });

    const paused = await owner.business.pauseCycle({ businessId });
    expect(paused).toMatchObject({ paused: false, runEnded: true, pausedTasks: 0 });
    expect(paused.status.run).toBeNull();
    expect(temporal.signals.at(-1)).toEqual({ workflowId: `autopilot:${businessId}`, signal: "continueRunEnd", args: [{ reason: "paused", runId: press.run!.id, by: hz.A.ownerId }] });
    const ended = (await repos.events.list(hz.db, businessId, { type: "cycle.run_ended" })).items;
    expect(ended.map((e) => e.payload)).toEqual([{ runId: press.run!.id, reason: "paused", rounds: 1, cost: { amountMinor: 30, currency: "USD" }, maxCyclesPerDay: null }]);
    expect((await repos.audit.list(hz.db, businessId, { action: "cycle.run_end" })).items[0]!.details).toMatchObject({ runId: press.run!.id, reason: "paused", rounds: 1 });
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
    // A second Pause has nothing left to end.
    expect(await owner.business.pauseCycle({ businessId })).toMatchObject({ paused: false, runEnded: false, reason: "no round of work is running" });

    const again = await owner.business.continue({ businessId });
    expect(again.action).toBe("started");
    expect(again.run!.id).not.toBe(press.run!.id);
    expect(temporal.signalStarts.at(-1)).toMatchObject({ signal: "continueRun", signalArgs: [{ runId: again.run!.id, cycleNumber: 2 }] });
    // Every later round starts as before: only round 1 carries the first-round cap (WP-09 T11).
    expect(temporal.signalStarts.at(-1)!.signalArgs[0]).not.toHaveProperty("cycleInput");
    await roundEnds(businessId, 2);
  });

  it("a run whose workflow is gone ends lost, so Continue is not stuck on processing between rounds", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const open = await owner.cycle.status({ businessId });
    expect(open.run).not.toBeNull();
    // Still running: nothing changes, however old the run is.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 120_000 });
    expect((await owner.cycle.status({ businessId })).run?.id).toBe(open.run!.id);
    vi.useRealTimers();
    temporal.statuses.set(`autopilot:${businessId}`, "TERMINATED");
    // Two minutes on (and past the 30-second throttle): old enough to be asked about.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 180_000 });
    const after = await owner.cycle.status({ businessId });
    expect(after.run).toBeNull();
    expect((await owner.cycle.continueState({ businessId })).kind).toBe("idle");
    const lost = (await repos.events.list(hz.db, businessId, { type: "cycle.run_ended" })).items.find((e) => (e.payload as { runId: string }).runId === open.run!.id);
    expect(lost?.payload).toMatchObject({ reason: "lost", rounds: 1 });
    expect(lost?.actor).toEqual({ kind: "system", id: "api-cycle-reconciler" });
  });

  it("Stop all agents reaches the run's workflow even with Autopilot off, and ends the run as stopped", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const { businessId } = hz.B;
    expect((await repos.businesses.get(hz.db, businessId)).autopilotEnabled).toBe(false);
    const press = await owner.business.continue({ businessId });
    expect(press.run).not.toBeNull();
    temporal.signals.length = 0;
    await owner.business.stopAllAgents({ businessId });
    expect(temporal.signals).toContainEqual(expect.objectContaining({ workflowId: `autopilot:${businessId}`, signal: "stop" }));
    const ended = (await repos.events.list(hz.db, businessId, { type: "cycle.run_ended" })).items;
    expect(ended.map((e) => e.payload)).toEqual([expect.objectContaining({ runId: press.run!.id, reason: "stopped" })]);
    expect((await owner.cycle.status({ businessId })).run).toBeNull();
    // The other business's run is untouched.
    expect((await repos.events.list(hz.db, hz.A.businessId, { type: "cycle.run_ended" })).items.every((e) => (e.payload as { runId: string }).runId !== press.run!.id)).toBe(true);
  });
});

describe("cycle.status lastFailure (Home's blocker banner)", () => {
  it("carries the failed round of work's kind and message, and general words for a round of work recorded before the field existed", () => {
    const at = new Date("2026-11-01T10:00:00Z");
    expect(failureOf({ kind: "billing", message: "The model account is out of credit." }, at)).toEqual({ kind: "billing", message: "The model account is out of credit.", at: at.toISOString() });
    expect(failureOf({ kind: "credential", message: "No key." }, at)!.kind).toBe("credential");
    expect(failureOf(null, at)).toMatchObject({ kind: "error", at: at.toISOString() });
    expect(failureOf({ kind: "weird", message: "x" }, at)!.kind).toBe("error");
    expect(failureOf(null, at)!.message).not.toMatch(/orchestrator|workflow|activity/i);
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
