/**
 * Dispatch control on PGlite (audit fixes O-01, O-08, O-09, VO-X1, MLSL-05, BILL-18): sessions are opened with their
 * real workflow id, nothing starts while the team is stopped, an agent at its wage cap is paused (and comes back next
 * period), failed tasks and failing agents come back after a backoff, and a finishing session never overwrites a pause.
 */
import { repos, resumeBusinessAgents, stopBusinessAgents, type Task } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { createCycleActivities } from "../activities/cycle";
import { WAGE_ALERT_ACTION, recoverAgents } from "../activities/dispatch";
import { createHolidayActivities } from "../activities/holiday";
import { createPlanActivities } from "../activities/plan";
import { createSessionActivities } from "../activities/session";
import type { SessionLaunch, SessionResult } from "../activities/types";
import { AGENT_COOLDOWN_BASE_MS, TASK_RETRY_BASE_MS, TASK_RETRY_LIMIT } from "../retry";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let cycle: ReturnType<typeof createCycleActivities>;
let brief: ReturnType<typeof createBriefActivities>;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "dispatch" });
  cycle = createCycleActivities(t.deps);
  brief = createBriefActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

const B = () => t.businessId;
let n = 0;
async function readyTask(title = "Dispatch task", assignee: string | null = null): Promise<Task> {
  n += 1;
  return repos.tasks.create(t.db, B(), { kind: "ops", title: `${title} ${n}`, status: "ready", assigneeAgentId: assignee });
}
async function endOpenSessions() {
  const open = await repos.agents.listSessions(t.db, B(), { openOnly: true, limit: 200 });
  for (const s of open.items) await repos.agents.endSession(t.db, B(), s.id, { outcome: "done", endedAt: t.clock.now() });
}

beforeEach(async () => {
  await resumeBusinessAgents(t.db, B());
  await endOpenSessions();
  await repos.agents.setStatus(t.db, B(), t.workerId, "idle");
  await repos.agents.update(t.db, B(), t.workerId, { wageCapMinor: null });
});

describe("openSession", () => {
  it("creates the row with workflow id session:<id> before anything starts, marks the task running and emits task.started with that id", async () => {
    const task = await readyTask();
    const opened = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
    expect(opened.refused).toBeNull();
    const session = await repos.agents.getSession(t.db, B(), opened.sessionId!);
    expect(session.workflowId).toBe(`session:${session.id}`);
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("running");
    const started = (await repos.events.list(t.db, B(), { type: "task.started", limit: 50 })).items.find((e) => (e.payload as { taskId: string }).taskId === task.id);
    expect((started?.payload as { workflowId: string }).workflowId).toBe(`session:${session.id}`);
  });

  it("refuses a second session on a task that already has one open", async () => {
    const task = await readyTask();
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).sessionId).toBeTruthy();
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "open_session" });
    expect((await repos.agents.listSessions(t.db, B(), { taskId: task.id, limit: 10 })).items).toHaveLength(1);
  });

  it("refuses everything while the team is stopped, and works again after the resume", async () => {
    const task = await readyTask();
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "agents_stopped" });
    expect((await repos.agents.listSessions(t.db, B(), { taskId: task.id, limit: 10 })).items).toHaveLength(0);
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("ready");
    await resumeBusinessAgents(t.db, B());
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).sessionId).toBeTruthy();
  });
});

describe("the stop flag reaches every work-starting path", () => {
  it("brief, plan, plan actions, engines, vacations and session preparation all refuse while stopped", async () => {
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    const b = await brief.loadBrief({ businessId: B() });
    expect(b.agentsStopped).toBe(true);
    expect(b.text).toMatch(/The team is stopped/);
    const planned = await cycle.planCycle({ businessId: B(), cycleNumber: 1, trigger: "continue", brief: b });
    expect(planned).toMatchObject({ starts: [], costMinor: 0 });

    const planActs = createPlanActivities(t.deps);
    const plan = await repos.plans.create(t.db, B(), {
      origin: "option",
      actions: [
        { type: "create_task", params: { title: "While stopped", kind: "ops" }, agentId: t.workerId },
        { type: "enable_channel", params: { channel: "seo" }, agentId: t.workerId },
      ],
    });
    const created = await planActs.executePlanAction({ businessId: B(), planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    expect(created.status).toBe("done");
    expect(created.spawn).toEqual([]);
    expect((created.result as { deferred?: string }).deferred).toMatch(/stopped/);
    expect((await repos.tasks.get(t.db, B(), (created.result as { taskId: string }).taskId)).status).toBe("ready");
    const enabled = await planActs.executePlanAction({ businessId: B(), planId: plan.id, actionId: plan.actions[1]!.id, workflowId: "plan:test" });
    expect(enabled.spawn).toEqual([]);

    const channel = await repos.channels.upsert(t.db, B(), { channelKey: "events", line: "wings", enabled: true, ownerAgentId: t.workerId });
    const step = await createChannelActivities(t.deps).channelStep({ businessId: B(), channelId: channel.id, channelKey: "events", step: "create", weekIndex: 0, state: emptyChannelState() });
    expect(step).toMatchObject({ stop: true });
    expect(step.state.campaignId).toBeNull();

    const holiday = await repos.holidays.start(t.db, B(), { untilAt: new Date(t.clock.nowMs() + 86_400_000), authority: {}, startedBy: t.fixture.ownerId });
    const holidays = createHolidayActivities(t.deps);
    const loaded = await holidays.loadHoliday({ businessId: B(), holidayId: holiday.id });
    expect(await holidays.holidayCheck({ businessId: B(), holiday: loaded })).toMatchObject({ shouldEnd: true, reason: "kill_switch" });
    await repos.holidays.end(t.db, B(), holiday.id, { endedAt: t.clock.now() });

    const task = await readyTask("Prepared while stopped", t.workerId);
    const session = await repos.agents.createSession(t.db, B(), { agentId: t.workerId, taskId: task.id });
    await expect(createSessionActivities(t.deps).prepareSession({ businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: session.id })).rejects.toThrow(/paused|stopped/);
  });

  it("an enabled channel records its engine's workflow id when the team is running", async () => {
    const planActs = createPlanActivities(t.deps);
    const plan = await repos.plans.create(t.db, B(), { origin: "option", actions: [{ type: "enable_channel", params: { channel: "affiliate" }, agentId: t.workerId }] });
    const res = await planActs.executePlanAction({ businessId: B(), planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    const channelId = (res.result as { channelId: string }).channelId;
    expect(res.spawn).toEqual([{ workflow: "channelEngine", workflowId: `engine:${channelId}`, args: expect.objectContaining({ channelId }) }]);
    expect((await repos.channels.get(t.db, B(), channelId)).engineWorkflowId).toBe(`engine:${channelId}`);
  });

  it("a plan's create_task opens the session through the same guard, with its real workflow id", async () => {
    const planActs = createPlanActivities(t.deps);
    const plan = await repos.plans.create(t.db, B(), { origin: "option", actions: [{ type: "create_task", params: { title: "From a decision", kind: "ops" }, agentId: t.workerId }] });
    const res = await planActs.executePlanAction({ businessId: B(), planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:test" });
    const spawn = res.spawn[0]!;
    const sessionId = (spawn.args as { sessionId: string }).sessionId;
    expect(spawn.workflowId).toBe(`session:${sessionId}`);
    expect((await repos.agents.getSession(t.db, B(), sessionId)).workflowId).toBe(spawn.workflowId);
    expect((await repos.tasks.get(t.db, B(), (res.result as { taskId: string }).taskId)).status).toBe("running");
  });
});

describe("wage caps at dispatch (BUILD §10.4)", () => {
  it("alerts at 50 and 80 % once each, pauses at 100 % until next period, and the agent comes back when the period turns", async () => {
    await repos.agents.update(t.db, B(), t.workerId, { wageCapMinor: 1_000 });
    const spend = (costMinor: number) => repos.usage.record(t.db, B(), { agentId: t.workerId, kind: "tokens", quantity: 1, costMinor, occurredAt: t.clock.now() });
    const alerts = async () => (await repos.audit.list(t.db, B(), { action: WAGE_ALERT_ACTION, actorId: t.workerId, limit: 20 })).items.map((e) => (e.details as { percent: number }).percent);

    await spend(550);
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: (await readyTask()).id })).sessionId).toBeTruthy();
    await endOpenSessions();
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: (await readyTask()).id })).sessionId).toBeTruthy();
    await endOpenSessions();
    expect(await alerts()).toEqual([50]);

    await spend(300);
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: (await readyTask()).id })).sessionId).toBeTruthy();
    await endOpenSessions();
    expect((await alerts()).sort()).toEqual([50, 80]);

    await spend(200);
    const capped = await readyTask();
    const refused = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: capped.id });
    expect(refused).toMatchObject({ sessionId: null, refused: "wage_cap" });
    expect(refused.detail).toMatch(/wage cap/);
    expect(await repos.agents.get(t.db, B(), t.workerId)).toMatchObject({ status: "paused", pausedReason: "wage_cap" });
    const note = (await repos.inbox.list(t.db, B(), { limit: 20 })).items.find((i) => /reached its wage cap/.test(i.subject));
    expect(note?.bodyMd).toMatch(/until Nov 1, 2026/);
    // The brief shows it and the planner gives it nothing.
    const b = await brief.loadBrief({ businessId: B() });
    expect(b.agents.find((a) => a.id === t.workerId)).toMatchObject({ status: "paused", wageRemainingMinor: -50 });

    // Still October: stays paused. November: back to idle by itself.
    expect((await recoverAgents(t.deps, B())).find((r) => r.agentId === t.workerId)).toBeUndefined();
    await t.clock.set(new Date("2026-11-01T00:05:00.000Z"));
    expect((await recoverAgents(t.deps, B())).find((r) => r.agentId === t.workerId)).toMatchObject({ from: "paused", to: "idle" });
    expect(await repos.agents.get(t.db, B(), t.workerId)).toMatchObject({ status: "idle", pausedReason: null });
  });

  it("a resume after Stop all agents leaves a wage-capped agent paused", async () => {
    await repos.agents.setStatus(t.db, B(), t.workerId, "paused", { pausedReason: "wage_cap" });
    await repos.agents.update(t.db, B(), t.workerId, { wageCapMinor: 1 });
    await repos.usage.record(t.db, B(), { agentId: t.workerId, kind: "tokens", quantity: 1, costMinor: 5, occurredAt: t.clock.now() });
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    const back = await resumeBusinessAgents(t.db, B());
    expect(back.agentIds).not.toContain(t.workerId);
    expect((await recoverAgents(t.deps, B())).find((r) => r.agentId === t.workerId)).toBeUndefined();
  });
});

describe("failed tasks and failing agents come back (bounded backoff)", () => {
  const launch: SessionLaunch = { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "claude-sonnet-5-5", recordingKey: null, allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: "agent/x", maxTurns: 1, planSteps: 1, acceptanceTests: 1 };
  const failed = (): SessionResult => ({ outcome: "failed", reason: "boom", blockedReason: "error", approvalId: null, progress: { planStepsDone: 0, planSteps: 1, acceptanceTestsPassing: 0, acceptanceTests: 1, reviewPassed: false, merged: false, phase: null, progress: 0, etaAt: null, at: null }, eventsEmitted: 0, toolCalls: 0, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 0, durationMs: 1000, prNumber: null, summary: "boom", providerSessionId: null });

  it("a failing agent rests, then goes back to idle; a failed task is retried with a doubling wait, then waits for the founder", async () => {
    const sessions = createSessionActivities(t.deps);
    const task = await readyTask("Flaky", t.workerId);
    const failOnce = async () => {
      const opened = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
      expect(opened.sessionId).toBeTruthy();
      await sessions.finishSession({ businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: opened.sessionId! }, launch, failed());
    };
    await failOnce();
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("failed");
    expect((await repos.agents.get(t.db, B(), t.workerId)).status).toBe("failing");

    // Right after the failure: the agent rests and the task waits for its first retry.
    let b = await brief.loadBrief({ businessId: B() });
    expect(b.agents.find((a) => a.id === t.workerId)?.status).toBe("failing");
    let mine = b.openTasks.find((x) => x.id === task.id)!;
    expect(mine.retry).toMatchObject({ failures: 1, due: false, exhausted: false });
    let plan = await cycle.planCycle({ businessId: B(), cycleNumber: 1, trigger: "continue", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toMatch(/retrying after 1 failed session/);

    // After the agent's rest and the task's first wait, both are back in the loop.
    await t.clock.advance(Math.max(AGENT_COOLDOWN_BASE_MS, TASK_RETRY_BASE_MS) + 1_000);
    b = await brief.loadBrief({ businessId: B() });
    expect(b.agents.find((a) => a.id === t.workerId)?.status).toBe("idle");
    mine = b.openTasks.find((x) => x.id === task.id)!;
    expect(mine.retry).toMatchObject({ failures: 1, due: true });
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 2, trigger: "continue", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason ?? "").not.toMatch(/retrying|failed/);

    // Each failure in a row doubles the wait; past the limit only the founder restarts it.
    for (let i = 2; i <= TASK_RETRY_LIMIT + 1; i++) {
      await repos.agents.setStatus(t.db, B(), t.workerId, "idle");
      await failOnce();
    }
    b = await brief.loadBrief({ businessId: B() });
    mine = b.openTasks.find((x) => x.id === task.id)!;
    expect(mine.retry).toMatchObject({ failures: TASK_RETRY_LIMIT + 1, exhausted: true });
    await t.clock.advance(7 * 24 * 60 * 60 * 1000);
    b = await brief.loadBrief({ businessId: B() });
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 3, trigger: "continue", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toMatch(/start it from the Plan/);
    expect(plan.starts.some((s) => s.taskId === task.id)).toBe(false);
  });

  it("a session that fails while its team is stopped does not fail the task or overwrite the pause", async () => {
    const sessions = createSessionActivities(t.deps);
    const task = await readyTask("Cut short", t.workerId);
    const opened = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
    await stopBusinessAgents(t.db, B(), { reason: "kill_switch" });
    const finish = await sessions.finishSession({ businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: opened.sessionId! }, launch, failed());
    expect(finish.taskStatus).toBe("paused");
    expect(finish.healthChanged).toBe(false);
    expect(await repos.agents.get(t.db, B(), t.workerId)).toMatchObject({ status: "paused", pausedReason: "kill_switch" });
  });
});
