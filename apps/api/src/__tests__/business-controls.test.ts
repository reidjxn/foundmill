/**
 * The team-wide stop and the way back (audit fixes O-01, O-09, VO-X1, BILL-03, api-services-02/14, MLSL-29, SECX-2,
 * RA-01, RA-05): signals reach sessions by their real id, nothing a member does undoes Stop all agents, only an owner or
 * admin resumes, a new key or a top-up lifts the stop it caused (never the kill switch), and a task start is claimed once.
 */
import { repos, stopBusinessAgents } from "@foundmill/db";
import { MODEL_KEYS } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const KEY = "sk-ant-api03-test-key-0123456789abcdef";

describe("Stop all agents cannot be undone by a member; resume is an owner's or admin's", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "controls", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  const A = () => hz.A.businessId;
  const owner = () => hz.caller({ userId: hz.A.ownerId });
  const member = () => hz.caller({ userId: hz.A.memberId });
  let n = 0;
  const readyTask = async (assignee: string | null = hz.A.agent2Id) => {
    n += 1;
    return repos.tasks.create(hz.db, A(), { kind: "ops", title: `Controls task ${n}`, status: "ready", assigneeAgentId: assignee });
  };

  beforeEach(async () => {
    await owner().business.resumeAgents({ businessId: A() }).catch(() => undefined);
    const open = await repos.agents.listSessions(hz.db, A(), { openOnly: true, limit: 100 });
    for (const s of open.items) await repos.agents.endSession(hz.db, A(), s.id, { outcome: "done" });
    await repos.agents.setStatus(hz.db, A(), hz.A.agent2Id, "idle");
    temporal.starts.length = 0;
    temporal.signals.length = 0;
  });

  it("while stopped a member's start, stop, channel toggle, Continue, vacation or training run neither starts work nor wakes an agent", async () => {
    const task = await readyTask();
    await owner().business.stopAllAgents({ businessId: A() });
    expect((await repos.agents.get(hz.db, A(), hz.A.agent2Id)).status).toBe("paused");

    await expect(member().dev.tasks.start({ businessId: A(), taskId: task.id })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Agents are stopped/) });
    expect((await repos.agents.listSessions(hz.db, A(), { taskId: task.id, limit: 5 })).items).toHaveLength(0);
    expect((await repos.agents.get(hz.db, A(), hz.A.agent2Id)).status).toBe("paused");

    // Stop is a safety action: it never sets a paused agent back to idle.
    await member().dev.tasks.stop({ businessId: A(), taskId: task.id });
    expect((await repos.agents.get(hz.db, A(), hz.A.agent2Id)).status).toBe("paused");

    await expect(member().distribution.channels.enable({ businessId: A(), channelKey: "seo" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner().business.continue({ businessId: A() })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/next cycle/) });
    // Resuming a cycle would set the tasks the stop paused back to running.
    await expect(member().business.resumeCycle({ businessId: A() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repos.tasks.get(hz.db, A(), task.id)).status).not.toBe("running");
    await expect(owner().business.startHoliday({ businessId: A(), until: { kind: "return" } })).rejects.toMatchObject({ code: "CONFLICT" });
    const draft = await repos.agents.createVersion(hz.db, A(), hz.A.agentId, { state: "draft" });
    await expect(member().agent.training.run({ businessId: A(), agentId: hz.A.agentId, versionId: draft.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // Campaigns the stop paused stay paused: no member sets one live before the agents resume (a new campaign is only ever a draft).
    expect((await repos.campaigns.get(hz.db, A(), hz.A.campaignId)).status).toBe("paused");
    await expect(member().distribution.campaigns.setStatus({ businessId: A(), campaignId: hz.A.campaignId, status: "live" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/live campaign cannot start/) });
    expect((await repos.campaigns.get(hz.db, A(), hz.A.campaignId)).status).toBe("paused");
    // Pausing, ending or drafting stays allowed.
    const drafted = await member().distribution.campaigns.create({ businessId: A(), channelId: hz.A.channelId, name: "Drafted while stopped" });
    expect((await member().distribution.campaigns.setStatus({ businessId: A(), campaignId: drafted.id, status: "ended" })).status).toBe("ended");
    expect(temporal.starts).toEqual([]);
  });

  it("while stopped a model change applies but its retest waits, queued, until Resume agents starts it; a hire starts paused and comes back with the others", async () => {
    await owner().business.stopAllAgents({ businessId: A() });
    const agent = await repos.agents.get(hz.db, A(), hz.A.agentId);
    const target = MODEL_KEYS.find((m) => m !== agent.modelKey)!;
    const set = await member().agent.model.set({ businessId: A(), agentId: agent.id, modelKey: target });
    expect(set).toMatchObject({ updated: [agent.id], retestsWaitForResume: true });
    expect(set.retests).toHaveLength(1);
    const runId = set.retests[0]!.runId;
    expect(set.retests[0]!.workflow).toMatchObject({ queued: false, workflowId: `training:${runId}`, reason: expect.stringMatching(/resume/) });
    expect((await repos.agents.get(hz.db, A(), agent.id)).modelKey).toBe(target);
    expect(await repos.training.get(hz.db, A(), runId)).toMatchObject({ status: "queued" });

    const hired = await member().team.agents.hire({ businessId: A(), templateKey: "docs_writer", departmentId: hz.A.departmentId });
    expect(hired).toMatchObject({ status: "paused", pausedReason: "kill_switch" });
    expect(temporal.starts).toEqual([]);

    const res = await owner().business.resumeAgents({ businessId: A() });
    expect(res.training).toEqual([{ queued: true, workflowId: `training:${runId}` }]);
    expect(temporal.starts.filter((s) => s.type === "trainingRun")).toEqual([{ type: "trainingRun", workflowId: `training:${runId}`, args: [{ businessId: A(), trainingRunId: runId }] }]);
    expect((await repos.agents.get(hz.db, A(), hired.id)).status).toBe("idle");

    // Running again: the next model change (to a third model: a change back to the live version's own model queues no
    // retest) starts its retest at once, and withdraws the earlier one.
    temporal.starts.length = 0;
    const third = MODEL_KEYS.find((m) => m !== agent.modelKey && m !== target)!;
    const back = await member().agent.model.set({ businessId: A(), agentId: agent.id, modelKey: third });
    expect(back.retestsWaitForResume).toBe(false);
    expect(temporal.starts.map((s) => s.type)).toEqual(["trainingRun"]);
    await repos.training.cancelActive(hz.db, A(), { coachSummaryMd: "test cleanup" });
    await repos.agents.release(hz.db, A(), hired.id);
  });

  it("only an owner or admin resumes: agents back to idle, the flag cleared, health events and the audit written, engines restarted", async () => {
    const channel = await repos.channels.upsert(hz.db, A(), { channelKey: "pr", line: "wings", enabled: true });
    await repos.channels.setEngineWorkflow(hz.db, A(), channel.id, `engine:${channel.id}`);
    await owner().business.stopAllAgents({ businessId: A() });
    await expect(member().business.resumeAgents({ businessId: A() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).business.resumeAgents({ businessId: A() })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const before = (await repos.events.list(hz.db, A(), { type: "agent.health_changed", limit: 200 })).items.length;
    const auditsBefore = (await repos.audit.list(hz.db, A(), { action: "business.resume_agents" })).items.length;
    const res = await hz.caller({ userId: hz.A.adminId }).business.resumeAgents({ businessId: A() });
    expect(res).toMatchObject({ resumed: true, reason: "kill_switch" });
    expect(res.resumedAgents).toBeGreaterThanOrEqual(2);
    expect(res.engines.map((e) => e.workflowId)).toContain(`engine:${channel.id}`);
    expect(temporal.starts.filter((s) => s.type === "channelEngine").map((s) => s.workflowId)).toContain(`engine:${channel.id}`);
    // Every channel on the board runs its engine again, also one whose start was never recorded (audit GTM-01).
    expect(res.engines.map((e) => e.workflowId)).toContain(`engine:${hz.A.channelId}`);
    expect((await repos.channels.get(hz.db, A(), hz.A.channelId)).engineWorkflowId).toBe(`engine:${hz.A.channelId}`);
    expect(await repos.businesses.stopState(hz.db, A())).toMatchObject({ stopped: false });
    const agents = await repos.agents.list(hz.db, A(), { limit: 50 });
    expect(agents.items.every((a) => a.status !== "paused")).toBe(true);
    const after = (await repos.events.list(hz.db, A(), { type: "agent.health_changed", limit: 200 })).items;
    expect(after.length - before).toBe(res.resumedAgents);
    expect(after.some((e) => (e.payload as { to: string; from: string }).from === "paused" && (e.payload as { to: string }).to === "idle")).toBe(true);
    const audits = (await repos.audit.list(hz.db, A(), { action: "business.resume_agents" })).items;
    expect(audits).toHaveLength(auditsBefore + 1);
    expect(audits[0]).toMatchObject({ actorId: hz.A.adminId, details: { reason: "kill_switch" } });
    // A task starts again.
    const task = await readyTask();
    const started = await member().dev.tasks.start({ businessId: A(), taskId: task.id });
    expect(started.workflow.workflowId).toBe(`session:${started.session.id}`);
  });

  it("a member's Pause, Nudge and Stop reach a session opened by a cycle before 0023 (stored placeholder): the id is computed", async () => {
    const task = await readyTask();
    await repos.tasks.setStatus(hz.db, A(), task.id, "running", { force: true });
    const session = await repos.agents.createSession(hz.db, A(), { agentId: hz.A.agent2Id, taskId: task.id });
    await hz.h.db.execute(sql`update agent_sessions set workflow_id = 'session:pending' where id = ${session.id}::uuid`);
    await member().dev.tasks.pause({ businessId: A(), taskId: task.id });
    await member().dev.tasks.shout({ businessId: A(), taskId: task.id, preset: "Simplify" });
    await member().dev.tasks.stop({ businessId: A(), taskId: task.id });
    expect(temporal.signals.map((s) => [s.workflowId, s.signal])).toEqual([
      [`session:${session.id}`, "pause"],
      [`session:${session.id}`, "shout"],
      [`session:${session.id}`, "stop"],
    ]);
  });
});

describe("dev.tasks.start guards (RA-05, api-services-14)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "taskstart", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());
  const A = () => hz.A.businessId;
  let n = 0;
  const task = async (status: "ready" | "done" | "review" = "ready", assignee: string | null = hz.A.agent2Id) => {
    n += 1;
    return repos.tasks.create(hz.db, A(), { kind: "ops", title: `Start guard ${n}`, status, assigneeAgentId: assignee });
  };
  const start = (taskId: string) => hz.caller({ userId: hz.A.memberId }).dev.tasks.start({ businessId: A(), taskId });

  it("two starts at once open one session", async () => {
    const t = await task();
    const results = await Promise.allSettled([start(t.id), start(t.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect((await repos.agents.listSessions(hz.db, A(), { taskId: t.id, limit: 5 })).items).toHaveLength(1);
    // A third press while it runs is refused too.
    await expect(start(t.id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already running/) });
  });

  it("a start the orchestrator does not take leaves nothing open: the task is given back and the next press starts it", async () => {
    const t = await task();
    const startWorkflow = temporal.workflow.start;
    temporal.workflow.start = async () => {
      throw Object.assign(new Error("connection refused"), { name: "ServiceError" });
    };
    try {
      await expect(start(t.id)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.stringMatching(/did not start/) });
    } finally {
      temporal.workflow.start = startWorkflow;
    }
    expect((await repos.tasks.get(hz.db, A(), t.id)).status).toBe("ready");
    const sessions = (await repos.agents.listSessions(hz.db, A(), { taskId: t.id, limit: 5 })).items;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ outcome: "not_started", endedAt: expect.any(Date) });
    const startedEvents = async () => (await repos.events.list(hz.db, A(), { type: "task.started", limit: 200 })).items.filter((e) => (e.payload as { taskId: string }).taskId === t.id);
    expect(await startedEvents()).toHaveLength(0);

    const again = await start(t.id);
    expect(again.workflow).toMatchObject({ queued: true, workflowId: `session:${again.session.id}` });
    expect((await repos.tasks.get(hz.db, A(), t.id)).status).toBe("running");
    expect(await startedEvents()).toHaveLength(1);
  });

  it("refuses a done or in-review task, an unfinished dependency, a paused, released or capped agent", async () => {
    await expect(start((await task("done")).id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(start((await task("review")).id)).rejects.toMatchObject({ code: "CONFLICT" });

    const first = await task();
    const second = await task();
    await repos.tasks.addEdge(hz.db, A(), first.id, second.id);
    await expect(start(second.id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/depends on/) });

    const agent = await repos.agents.create(hz.db, A(), { name: "Capped Writer", agentType: "copywriter", wageCapMinor: 100 });
    await repos.usage.record(hz.db, A(), { agentId: agent.id, kind: "tokens", quantity: 1, costMinor: 150 });
    await expect(start((await task("ready", agent.id)).id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/wage cap/) });

    await repos.agents.setStatus(hz.db, A(), agent.id, "paused", { pausedReason: "wage_cap" });
    await repos.agents.update(hz.db, A(), agent.id, { wageCapMinor: null });
    await expect(start((await task("ready", agent.id)).id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/paused/) });
    expect((await repos.agents.get(hz.db, A(), agent.id)).status).toBe("paused");

    const leaver = await repos.agents.create(hz.db, A(), { name: "Leaver", agentType: "copywriter" });
    await repos.agents.release(hz.db, A(), leaver.id);
    await expect(start((await task("ready", leaver.id)).id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(hz.caller({ userId: hz.A.memberId }).dev.tasks.reassign({ businessId: A(), taskId: (await task()).id, agentId: leaver.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a start once the monthly model budget is used up, on the founder's own key too, and starts again when it is raised or removed (audit #15)", async () => {
    // Earlier tests leave sessions open, and the Free plan holds four; this one is about the budget, not the plan.
    for (const open of (await repos.agents.listSessions(hz.db, A(), { openOnly: true, limit: 100 })).items) await repos.agents.endSession(hz.db, A(), open.id, { outcome: "done" });
    // The business is on its own key: only the budget stands between the team and the Anthropic bill.
    await repos.businesses.update(hz.db, A(), { modelBilling: "byok" });
    try {
      const spent = (await repos.usage.totals(hz.db, A(), { from: new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z") })).costMinor;
      await repos.usage.record(hz.db, A(), { agentId: hz.A.agent2Id, kind: "tokens", quantity: 1, costMinor: 400, billedTo: "byok" });
      const used = spent + 400;
      await repos.businesses.setModelBudget(hz.db, A(), used);
      const t = await task();
      await expect(start(t.id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/monthly model budget is used up/) });
      expect((await repos.tasks.get(hz.db, A(), t.id)).status).toBe("ready");
      expect((await repos.agents.listSessions(hz.db, A(), { taskId: t.id, limit: 5 })).items).toHaveLength(0);
      // Raised above what was spent: it starts. Removed: it starts.
      await repos.businesses.setModelBudget(hz.db, A(), used + 1);
      const started = await start(t.id);
      expect(started.session.taskId).toBe(t.id);
      await repos.agents.endSession(hz.db, A(), started.session.id, { outcome: "done" });
      await repos.businesses.setModelBudget(hz.db, A(), used);
      const again = await task();
      await expect(start(again.id)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/monthly model budget/) });
      await repos.businesses.setModelBudget(hz.db, A(), null);
      expect((await start(again.id)).session.taskId).toBe(again.id);
    } finally {
      await repos.businesses.setModelBudget(hz.db, A(), null);
      await repos.businesses.update(hz.db, A(), { modelBilling: "credits" });
    }
  });
});

describe("a new key and a top-up lift the stop they caused, never Stop all agents", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "autoresume" });
  }, 120_000);
  afterAll(() => hz.close());
  const A = () => hz.A.businessId;
  const owner = () => hz.caller({ userId: hz.A.ownerId });
  const paused = async () => (await repos.agents.list(hz.db, A(), { limit: 50 })).items.filter((a) => a.status === "paused").length;

  it("revoke stops the team; storing a key resumes it by itself", async () => {
    await owner().keys.setAnthropic({ businessId: A(), apiKey: KEY });
    const revoked = await owner().keys.revoke({ businessId: A() });
    expect(revoked.pausedAgents).toBeGreaterThanOrEqual(2);
    expect(await repos.businesses.stopState(hz.db, A())).toMatchObject({ stopped: true, reason: "key_revoked" });
    // The free tier falls back to its included credits, so an owner could resume now; a stored key needs no one.
    const stored = await owner().keys.setAnthropic({ businessId: A(), apiKey: KEY });
    expect(stored.resumed).toMatchObject({ reason: "key_revoked" });
    expect(await paused()).toBe(0);
    expect(await repos.businesses.stopState(hz.db, A())).toMatchObject({ stopped: false });
  });

  it("a key stored after Stop all agents leaves the team stopped", async () => {
    await owner().business.stopAllAgents({ businessId: A() });
    const stored = await owner().keys.rotate({ businessId: A(), apiKey: `${KEY}-2` });
    expect(stored.resumed).toBeNull();
    expect(await repos.businesses.stopState(hz.db, A())).toMatchObject({ stopped: true, reason: "kill_switch" });
    expect(await paused()).toBeGreaterThanOrEqual(2);
    await owner().business.resumeAgents({ businessId: A() });
    expect(await paused()).toBe(0);
  });

  it("used-up credits stop the team; a resume is refused until a top-up, which resumes it by itself", async () => {
    await owner().keys.revoke({ businessId: A() });
    await owner().billing.changeTier({ businessId: A(), tier: "pro" });
    try {
      await owner().keys.setAnthropic({ businessId: A(), apiKey: KEY });
      await owner().keys.revoke({ businessId: A() }); // pro falls back to credits
      await owner().business.resumeAgents({ businessId: A() });
      const period = new Date().toISOString().slice(0, 7);
      await repos.usage.grantCredits(hz.db, A(), period, 100);
      await repos.usage.chargeCredits(hz.db, A(), period, 100);
      await stopBusinessAgents(hz.db, A(), { reason: "credits_exhausted" });
      await expect(owner().business.resumeAgents({ businessId: A() })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/credits are used up/) });
      // A top-up is a checkout; its (mock) payment grants the credits and lifts the stop.
      const buy = async (amountMinor: number) => {
        const opened = await owner().billing.topUp({ businessId: A(), amountMinor });
        return owner().billing.checkout.completeMock({ businessId: A(), checkoutId: opened.checkout.id });
      };
      const topped = await buy(5_000);
      expect(topped.resumed).toMatchObject({ reason: "credits_exhausted" });
      expect(await paused()).toBe(0);
      // A top-up after Stop all agents resumes nothing.
      await owner().business.stopAllAgents({ businessId: A() });
      expect((await buy(1_000)).resumed).toBeNull();
      expect(await repos.businesses.stopState(hz.db, A())).toMatchObject({ stopped: true, reason: "kill_switch" });
      await owner().business.resumeAgents({ businessId: A() });
    } finally {
      await owner().billing.changeTier({ businessId: A(), tier: "free" });
    }
  });
});
