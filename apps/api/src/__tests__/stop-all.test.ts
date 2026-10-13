import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("business.stopAllAgents (kill switch, BUILD §14)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "stopall" });
  }, 120_000);
  afterAll(() => hz.close());

  it("without Temporal: pauses every agent and running task, audits, emits health events and reports queued:false", async () => {
    const { businessId, ownerId, agentId, agent2Id, taskId } = hz.A;
    await repos.agents.setStatus(hz.db, businessId, agentId, "healthy");
    await repos.agents.setStatus(hz.db, businessId, agent2Id, "healthy");
    await repos.tasks.setStatus(hz.db, businessId, taskId, "running", { force: true });
    await repos.agents.createSession(hz.db, businessId, { agentId: agent2Id, taskId, modelKey: "sonnet" });

    const result = await hz.caller({ userId: ownerId }).business.stopAllAgents({ businessId });
    expect(result.pausedAgents).toBeGreaterThanOrEqual(2);
    expect(result.pausedTasks).toBe(1);
    expect(result.workflows.queued).toBe(false);
    expect(result.workflows.reason).toMatch(/temporal/i);
    expect(result.workflows.failed.length).toBeGreaterThanOrEqual(1);
    expect(result.elapsedMs).toBeLessThan(LIMITS.killSwitchSeconds * 1000);

    const agents = await repos.agents.list(hz.db, businessId, { limit: 100 });
    expect(agents.items.every((a) => a.status === "paused")).toBe(true);
    expect((await repos.tasks.get(hz.db, businessId, taskId)).status).toBe("paused");
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.stop_all_agents" });
    expect(audit.items).toHaveLength(1);
    expect((audit.items[0]!.details as { temporalQueued: boolean }).temporalQueued).toBe(false);
    const events = await repos.events.list(hz.db, businessId, { type: "agent.health_changed" });
    expect(events.items.length).toBeGreaterThanOrEqual(2);
    expect(events.items.every((e) => (e.payload as { to: string }).to === "paused")).toBe(true);

    // B is untouched.
    const other = await repos.agents.list(hz.db, hz.B.businessId, { limit: 100 });
    expect(other.items.some((a) => a.status !== "paused")).toBe(true);
  });

  it("only owners and admins may pull the kill switch", async () => {
    await expect(hz.caller({ userId: hz.A.memberId }).business.stopAllAgents({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).business.stopAllAgents({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a failure while listing the workflows to signal neither hides nor undoes the stop: it is reported and audited (SEC3)", async () => {
    const { businessId, ownerId } = hz.B;
    const list = vi.spyOn(repos.plans, "list").mockRejectedValueOnce(new Error("connection reset"));
    try {
      const result = await hz.caller({ userId: ownerId }).business.stopAllAgents({ businessId });
      expect(result.pausedAgents).toBeGreaterThanOrEqual(1);
      expect(result.workflows).toMatchObject({ queued: false, signalled: [], reason: expect.stringMatching(/^workflows not signaled: connection reset/) });
    } finally {
      list.mockRestore();
    }
    expect(await repos.businesses.stopState(hz.db, businessId)).toMatchObject({ stopped: true, reason: "kill_switch" });
    const audit = (await repos.audit.list(hz.db, businessId, { action: "business.stop_all_agents" })).items;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ temporalQueued: false, temporalReason: expect.stringMatching(/connection reset/), lateSessions: 0 });
  });
});

describe("business.stopAllAgents with Temporal reachable", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "stopall2", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("signals every running workflow of the business (sessions by their computed id, the running cycle, every enabled engine, holiday) with `stop`", async () => {
    const { businessId, ownerId, agent2Id, taskId, channelId } = hz.A;
    const session = await repos.agents.createSession(hz.db, businessId, { agentId: agent2Id, taskId, modelKey: "sonnet" });
    // A row written before 0023 by a cycle: the placeholder is never trusted, the id is computed.
    await hz.h.db.execute(sql`update agent_sessions set workflow_id = 'session:pending' where id = ${session.id}::uuid`);
    // An enabled channel whose engine start was never recorded is reached by its deterministic id all the same.
    const other = await repos.channels.upsert(hz.db, businessId, { channelKey: "seo", line: "defence", enabled: true });
    await repos.channels.setEngineWorkflow(hz.db, businessId, channelId, `engine:${channelId}`);
    const holiday = await repos.holidays.start(hz.db, businessId, { untilAt: new Date(Date.now() + 86_400_000), authority: {}, startedBy: ownerId });
    // A cycle the orchestrator is running (cycle.started without cycle.completed).
    await repos.events.write(hz.db, businessId, { type: "cycle.started", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId: crypto.randomUUID(), cycleNumber: 3, workflowId: `cycle:${businessId}:3`, trigger: "continue", timeBoxAgentHours: 4, plannedTaskIds: [taskId], budget: null } });

    const result = await hz.caller({ userId: ownerId }).business.stopAllAgents({ businessId, reason: "test" });
    expect(result.workflows.queued).toBe(true);
    expect(result.workflows.failed).toEqual([]);
    // The fixture already carries one open session (hz.A.sessionId) with no workflow id → deterministic `session:{id}`.
    const ids = temporal.signals.map((s) => s.workflowId).sort();
    expect(ids).toEqual([`engine:${channelId}`, `engine:${other.id}`, `holiday:${holiday.id}`, `session:${session.id}`, `session:${hz.A.sessionId}`, `cycle:${businessId}:3`].sort());
    expect(ids).not.toContain("session:pending");
    expect(temporal.signals.every((s) => s.signal === "stop")).toBe(true);
    // The stop is recorded on the business: nothing starts work until an owner or admin resumes.
    expect(await repos.businesses.stopState(hz.db, businessId)).toMatchObject({ stopped: true, reason: "kill_switch" });
  });
});

describe("business.stopAllAgents writes the stop before it signals (SEC3)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  /** What the business's stop flag said when each signal went out. */
  const atSignal: { workflowId: string; stopped: boolean }[] = [];
  let lateSessionId: string | null = null;
  const record = temporal.workflow.getHandle;
  temporal.workflow.getHandle = (workflowId) => ({
    async signal(signal, ...args) {
      atSignal.push({ workflowId, stopped: await repos.businesses.agentsStopped(hz.db, hz.A.businessId) });
      // A dispatch that read the flag just before it was written opens its session while the signals go out.
      if (lateSessionId === null) {
        lateSessionId = "opening";
        lateSessionId = (await repos.agents.createSession(hz.db, hz.A.businessId, { agentId: hz.A.agentId, taskId: hz.A.task2Id, modelKey: "sonnet" })).id;
      }
      await record(workflowId).signal(signal, ...args);
    },
  });
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "stopall3", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("the flag is set before the first signal, training runs in flight are canceled and signalled, and a session opened meanwhile is signalled too", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const draft = await repos.agents.createVersion(hz.db, businessId, agentId, { state: "draft" });
    const queued = await repos.training.create(hz.db, businessId, { agentId, toVersionId: draft.id, status: "queued" });
    const running = await repos.training.create(hz.db, businessId, { agentId, toVersionId: draft.id, status: "running" });
    const decided = await repos.training.create(hz.db, businessId, { agentId, toVersionId: draft.id, status: "awaiting_decision" });

    const result = await hz.caller({ userId: ownerId }).business.stopAllAgents({ businessId });
    expect(atSignal.length).toBeGreaterThan(0);
    expect(atSignal.every((s) => s.stopped)).toBe(true);
    expect(result.cancelledTraining).toBe(2);
    expect(result.workflows).toMatchObject({ queued: true, failed: [] });

    const ids = temporal.signals.map((s) => s.workflowId);
    expect(ids).toEqual(expect.arrayContaining([`training:${queued.id}`, `training:${running.id}`, `session:${hz.A.sessionId}`, `session:${lateSessionId}`]));
    expect(ids).not.toContain(`training:${decided.id}`);
    expect(result.workflows.signalled).toContain(`session:${lateSessionId}`);
    for (const run of [queued, running]) expect(await repos.training.get(hz.db, businessId, run.id)).toMatchObject({ status: "cancelled", coachSummaryMd: expect.stringMatching(/^Training canceled: Stop all agents/) });
    expect((await repos.training.get(hz.db, businessId, decided.id)).status).toBe("awaiting_decision");

    const audit = (await repos.audit.list(hz.db, businessId, { action: "business.stop_all_agents" })).items[0]!;
    expect(audit.details).toMatchObject({ cancelledTraining: 2, lateSessions: 1, temporalQueued: true });
  });
});
