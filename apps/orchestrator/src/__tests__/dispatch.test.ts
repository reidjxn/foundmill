/**
 * Dispatch control on PGlite (audit fixes O-01, O-08, O-09, VO-X1, MLSL-05, BILL-18): sessions are opened with their
 * real workflow id, nothing starts while the team is stopped, an agent at its wage cap is paused (and comes back next
 * period), failed tasks and failing agents come back after a backoff, and a finishing session never overwrites a pause.
 */
import { LIMITS } from "@foundmill/config";
import { parkedTasksSentence } from "@foundmill/shared";
import { concurrencyAllowance, modelBudgetState, periodOf, repos, resumeBusinessAgents, stopBusinessAgents, type Task } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { createCycleActivities, lacksTool, PLATFORM_DUTY_STOPPED_AUDIT_ACTION, TOOL_MISSING_STOPPED_AUDIT_ACTION } from "../activities/cycle";
import { LOST_SESSION_AFTER_MS, MODEL_BUDGET_ALERT_ACTION, SESSION_RECONCILED_ACTION, WAGE_ALERT_ACTION, attemptSessionId, closeLostSessions, nextPeriodStart, openAgentSession, recoverAgents } from "../activities/dispatch";
import { createHolidayActivities } from "../activities/holiday";
import { createPlanActivities } from "../activities/plan";
import { ComposerRequestError } from "../composer-client";
import { createSessionActivities } from "../activities/session";
import type { SessionLaunch, SessionResult } from "../activities/types";
import { AGENT_COOLDOWN_BASE_MS, TASK_RETRY_BASE_MS, TASK_RETRY_LIMIT } from "../retry";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";
import type { OrchestratorDeps } from "../deps";

type OrchestratorDepsRunning = OrchestratorDeps["workflowRunning"];

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

describe("paid entry (WP-09 T16)", () => {
  it("opens no session and plans nothing until a founder holds the entry plan", async () => {
    const paid = { ...t.deps, env: { ...t.deps.env, PAID_ENTRY: true } };
    const task = await readyTask("Paid entry");
    expect(await openAgentSession(paid, { businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "entry_plan" });
    expect((await createBriefActivities(paid).loadBrief({ businessId: B() })).agentsStopped).toBe(true);
    // The fixture's owner subscribes (simulated, on this simulated stack): the work opens.
    const row = await repos.checkouts.create(t.db, B(), { kind: "subscription", mode: "mock", amountMinor: 500, createdBy: t.fixture.ownerId });
    await repos.accountPlans.activate(t.db, { userId: t.fixture.ownerId, mode: "mock", checkoutId: row.id });
    expect((await createBriefActivities(paid).loadBrief({ businessId: B() })).agentsStopped).toBe(false);
    expect((await openAgentSession(paid, { businessId: B(), agentId: t.workerId, taskId: task.id })).refused).toBeNull();
  });
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

  it("a retried attempt (same attempt id) hands back its own session instead of refusing the task or opening a second", async () => {
    const task = await readyTask();
    const id = "5e55e55e-0000-4000-8000-0000000000aa";
    expect(attemptSessionId()).toBeNull(); // outside Temporal the id is generated
    const first = await openAgentSession(t.deps, { businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: id });
    const again = await openAgentSession(t.deps, { businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: id });
    expect(first).toMatchObject({ sessionId: id, workflowId: `session:${id}`, refused: null });
    expect(again).toEqual(first);
    expect((await repos.agents.listSessions(t.db, B(), { taskId: task.id, limit: 10 })).items.map((s) => s.id)).toEqual([id]);
    const started = (await repos.events.list(t.db, B(), { type: "task.started", limit: 100 })).items.filter((e) => (e.payload as { taskId: string }).taskId === task.id);
    expect(started).toHaveLength(1);
    // Another attempt (another id) is still refused: the task already has a session.
    expect(await openAgentSession(t.deps, { businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "open_session" });
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

  it("refuses once every concurrent agent the plan holds is working, for a round of work's start and a plan's task alike (SEC2 S2)", async () => {
    const business = await repos.businesses.get(t.db, B());
    const { room } = await concurrencyAllowance(t.db, business, t.clock.now());
    for (let i = 0; i < room; i++) await repos.agents.createSession(t.db, B(), { agentId: t.workerId, startedAt: t.clock.now() });
    const task = await readyTask();
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "concurrency_limit", detail: expect.stringMatching(/plan runs at once is working/) });
    expect((await repos.agents.listSessions(t.db, B(), { taskId: task.id, limit: 10 })).items).toHaveLength(0);
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("ready");
    // A task from a decision did not come through a cycle, and waits all the same (ready for the next cycle).
    const planActs = createPlanActivities(t.deps);
    const plan = await repos.plans.create(t.db, B(), { origin: "option", actions: [{ type: "create_task", params: { title: "Past the limit", kind: "ops" }, agentId: t.workerId }] });
    const res = await planActs.executePlanAction({ businessId: B(), planId: plan.id, actionId: plan.actions[0]!.id, workflowId: "plan:limit" });
    expect(res.spawn).toEqual([]);
    expect(res.result).toMatchObject({ deferred: expect.stringMatching(/plan runs at once is working/) });
    await endOpenSessions();
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
    // No engine starts now, but its id is recorded: that is what makes resuming the agents start it (restartEngines).
    const deferredChannel = enabled.result as { channelId: string; deferred?: string };
    expect(deferredChannel.deferred).toMatch(/starts when they resume/);
    expect((await repos.channels.get(t.db, B(), deferredChannel.channelId)).engineWorkflowId).toBe(`engine:${deferredChannel.channelId}`);

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
    // On the test's clock, like every other session here: a row started on the real clock sorts as the agent's newest
    // once the real date passes the test's (Nov 1, 2026), and its "done" broke the next test's failure streak.
    const session = await repos.agents.createSession(t.db, B(), { agentId: t.workerId, taskId: task.id, startedAt: t.clock.now() });
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
    // The agent is named as markup with its stored name; the subject stays plain (One name everywhere, Nov 8, 2026).
    const worker = await repos.agents.get(t.db, B(), t.workerId);
    expect(note?.bodyMd.startsWith(`[[ent:${worker.id}|${worker.name}]] has spent`)).toBe(true);
    expect(note?.subject).toBe(`${worker.name} reached its wage cap: paused`);
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

  it("an agent that went over its cap while it worked gets its notes and its pause before the next plan, though the planner no longer picks it", async () => {
    await repos.agents.update(t.db, B(), t.workerId, { wageCapMinor: 1_000 });
    const spendTo = async (totalMinor: number) => {
      const now = (await repos.usage.agentSpend(t.db, B(), t.workerId, periodOf(t.clock.now()))).costMinor;
      await repos.usage.record(t.db, B(), { agentId: t.workerId, kind: "tokens", quantity: 1, costMinor: totalMinor - now, occurredAt: t.clock.now() });
    };
    const alerts = async () => (await repos.audit.list(t.db, B(), { action: WAGE_ALERT_ACTION, actorId: t.workerId, limit: 20 })).items.filter((e) => (e.details as { period: string }).period === periodOf(t.clock.now())).map((e) => (e.details as { percent: number }).percent);

    // Spend booked at the end of sessions: no dispatch of this agent in between, only the cycles' briefs.
    await spendTo(400);
    await brief.loadBrief({ businessId: B() });
    expect(await alerts()).toEqual([]);
    await spendTo(600);
    await brief.loadBrief({ businessId: B() });
    expect(await alerts()).toEqual([50]);
    await brief.loadBrief({ businessId: B() });
    expect(await alerts()).toEqual([50]);
    await spendTo(850);
    await brief.loadBrief({ businessId: B() });
    expect((await alerts()).sort()).toEqual([50, 80]);

    await spendTo(1_100);
    const b = await brief.loadBrief({ businessId: B() });
    expect(await repos.agents.get(t.db, B(), t.workerId)).toMatchObject({ status: "paused", pausedReason: "wage_cap" });
    expect(b.agents.find((a) => a.id === t.workerId)).toMatchObject({ status: "paused", wageRemainingMinor: -100 });
    expect((await alerts()).sort((x, y) => x - y)).toEqual([50, 80, 100]);
    const name = (await repos.agents.get(t.db, B(), t.workerId)).name;
    const notes = (await repos.inbox.list(t.db, B(), { limit: 50 })).items.filter((i) => i.subject.startsWith(`${name} reached its wage cap`));
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const health = (await repos.events.list(t.db, B(), { type: "agent.health_changed", limit: 50 })).items.find((e) => (e.payload as { agentId: string; to: string }).agentId === t.workerId && (e.payload as { to: string }).to === "paused");
    expect((health?.payload as { expectedReturnAt: string }).expectedReturnAt).toBe(nextPeriodStart(t.clock.now()).toISOString());
    const task = await readyTask("For a capped agent", t.workerId);
    const plan = await cycle.planCycle({ businessId: B(), cycleNumber: 9, trigger: "continue", brief: await brief.loadBrief({ businessId: B() }) });
    expect(plan.starts.some((s) => s.agentId === t.workerId)).toBe(false);
    expect(plan.starts.some((s) => s.taskId === task.id && s.agentId === t.workerId)).toBe(false);
  });
});

describe("the platform's own steps leave the loop", () => {
  it("a planned task that runs CI, opens a pull request or rebases onto main is stopped and archived before the plan, and what waited on it is freed", async () => {
    const duty = await readyTask("Run CI on the agent branch and read the results", t.workerId);
    const rebase = await repos.tasks.create(t.db, B(), { kind: "code", title: "Rebase the deploy contract branch onto main and hand it to the founder", status: "blocked", assigneeAgentId: t.workerId });
    const real = await readyTask("Implement gateway deploy guards (main head + CI success)", t.workerId);
    await repos.tasks.addEdge(t.db, B(), duty.id, real.id);
    await repos.tasks.addEdge(t.db, B(), rebase.id, real.id);
    let b = await brief.loadBrief({ businessId: B() });
    expect(b.openTasks.find((x) => x.id === real.id)?.blocked).toBe(true);
    const plan = await cycle.planCycle({ businessId: B(), cycleNumber: 11, trigger: "continue", brief: b });
    for (const id of [duty.id, rebase.id]) {
      expect(plan.starts.some((s) => s.taskId === id)).toBe(false);
      expect(plan.deferred.some((d) => d.taskId === id)).toBe(false);
      expect(await repos.tasks.get(t.db, B(), id)).toMatchObject({ status: "stopped", archivedAt: expect.any(Date) });
    }
    const audits = (await repos.audit.list(t.db, B(), { action: PLATFORM_DUTY_STOPPED_AUDIT_ACTION, limit: 20 })).items.filter((a) => [duty.id, rebase.id].includes((a.target as { id: string }).id));
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => (a.details as { reason: string }).reason).sort()).toEqual(["the platform brings a branch up to date and merges it after the founder's approval", "the platform runs the repository's CI on every agent branch"]);
    // The real task no longer waits on either; the platform does those steps for it.
    b = await brief.loadBrief({ businessId: B() });
    expect(b.openTasks.find((x) => x.id === real.id)).toMatchObject({ blocked: false, dependsOn: [] });
    expect(b.openTasks.some((x) => x.id === duty.id || x.id === rebase.id)).toBe(false);
    expect((await repos.tasks.get(t.db, B(), real.id)).status).toBe("ready");
  });
});

describe("a task no agent has a tool for leaves the loop after one attempt", () => {
  it("is stopped and archived before the plan, its dependent freed, the founder told once in one line; a task blocked for any other reason stays", async () => {
    const noTool = await repos.tasks.create(t.db, B(), { kind: "ops", title: "Register agent-pack skills as business skills", founderTitle: "Import agent skills as business skills", status: "blocked", assigneeAgentId: t.workerId });
    const other = await repos.tasks.create(t.db, B(), { kind: "ops", title: "Compare three suppliers", status: "blocked", assigneeAgentId: t.workerId });
    const dependent = await readyTask("Needs the skills", t.workerId);
    await repos.tasks.addEdge(t.db, B(), noTool.id, dependent.id);
    const blockedBy = (task: { id: string; title: string; kind: "ops" }, detail: string) => repos.events.write(t.db, B(), { type: "task.blocked", actor: { kind: "agent", id: t.workerId }, payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: t.workerId, sessionId: null, reason: "dependency", detail, approvalId: null, occurrence: 1 } });
    await blockedBy({ id: noTool.id, title: noTool.title, kind: "ops" }, "No tool is available to create or list business skills. My tools cover GitHub, the task board, messages and founder actions only.");
    await blockedBy({ id: other.id, title: other.title, kind: "ops" }, "Waiting on the supplier's price list; asked by email.");
    expect(lacksTool("none can create or register a business source")).toBe(true);
    expect(lacksTool("I can't do this import with the tools I have")).toBe(true);
    expect(lacksTool("acceptance tests failed (exit 1, 62 passed, 5 failed)")).toBe(false);
    expect(lacksTool("Scope mismatch: the branch changes none of the three scoped paths")).toBe(false);

    const b = await brief.loadBrief({ businessId: B() });
    expect(b.openTasks.find((x) => x.id === dependent.id)?.blocked).toBe(true);
    const plan = await cycle.planCycle({ businessId: B(), cycleNumber: 12, trigger: "continue", brief: b });
    expect(plan.starts.some((s) => s.taskId === noTool.id)).toBe(false);
    expect(plan.deferred.some((d) => d.taskId === noTool.id)).toBe(false);
    expect(await repos.tasks.get(t.db, B(), noTool.id)).toMatchObject({ status: "stopped", archivedAt: expect.any(Date) });
    expect((await repos.tasks.get(t.db, B(), other.id)).status).toBe("blocked");
    const audits = (await repos.audit.list(t.db, B(), { action: TOOL_MISSING_STOPPED_AUDIT_ACTION, limit: 20 })).items.filter((a) => (a.target as { id: string }).id === noTool.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toMatchObject({ cycleNumber: 12, dependentsFreed: 1 });
    // A missing tool is the platform's gap, never a founder chore: no note, to-do or decision of its own (Nov 7, 2026).
    const notes = (await repos.inbox.list(t.db, B(), { limit: 50 })).items.filter((i) => i.subject.includes("Import agent skills as business skills") || i.subject.startsWith("Only you can do this"));
    expect(notes).toEqual([]);
    // It is said once, in the round's note (founder, Nov 15, 2026, D1): the plan carries its founder title and the agent's words.
    expect(plan.parked).toEqual([{ title: "Import agent skills as business skills", detail: "No tool is available to create or list business skills. My tools cover GitHub, the task board, messages and founder actions only." }]);
    expect(plan.summary).not.toContain("Import agent skills");
    const after = await brief.loadBrief({ businessId: B() });
    expect(after.openTasks.find((x) => x.id === dependent.id)).toMatchObject({ blocked: false, dependsOn: [] });
  });

  it("the round's note says it once, in one plain sentence, and never as a to-do or a decision (WP-05 T18)", async () => {
    const parked = [{ title: "Import agent skills as business skills", detail: "No tool is available to create or list business skills." }];
    const sentence = parkedTasksSentence(["Import agent skills as business skills"]);
    const tasksBefore = (await repos.tasks.list(t.db, B(), { limit: 500 })).items.length;
    // Nothing finished: the plain note carries it.
    const plain = await cycle.narrateCycle({ businessId: B(), eventIds: [], summary: "Ship the pricing page.\n\nThis round of work: 0 tasks started.", fallbackSubject: "Round finished", parked });
    const body = (await repos.inbox.get(t.db, B(), plain.inboxItemIds[0]!)).bodyMd;
    expect(body.split(sentence)).toHaveLength(2);
    expect(body.startsWith("Ship the pricing page.")).toBe(true);
    // With events and the composer down (development), the plain note carries it once as well.
    const ev = await repos.events.write(t.db, B(), { type: "task.completed", actor: { kind: "system", id: "test" }, payload: { probe: "parked-said-once" } });
    const down = await cycle.narrateCycle({ businessId: B(), eventIds: [ev.id], summary: "Ship the pricing page.", parked });
    const item = await repos.inbox.get(t.db, B(), down.inboxItemIds[0]!);
    expect(item.bodyMd.split(sentence)).toHaveLength(2);
    expect(item).toMatchObject({ type: "update", decision: null, blocksContinue: false });
    // No to-do for the founder came of it.
    expect((await repos.tasks.list(t.db, B(), { limit: 500 })).items.length).toBe(tasksBefore);
    // A round with nothing parked says nothing about it.
    const none = await cycle.narrateCycle({ businessId: B(), eventIds: [], summary: "Quiet round." });
    expect((await repos.inbox.get(t.db, B(), none.inboxItemIds[0]!)).bodyMd).toBe("Quiet round.");
  });

  it("the composer gets the parked tasks once, with the first batch of events, and a note it wrote is not repeated by the plain one", async () => {
    const parked = [{ title: "Post the demo video", detail: "No video upload tool among my tools." }];
    const calls: { eventIds: string[]; parked?: unknown }[] = [];
    const ids: string[] = [];
    for (let i = 0; i <= LIMITS.narrateMaxEvents; i += 1) ids.push((await repos.events.write(t.db, B(), { type: "task.completed", actor: { kind: "system", id: "test" }, payload: { probe: `parked-batch-${i}` } })).id);
    const composerNote = await repos.inbox.createItem(t.db, B(), { type: "update", from_agent_id: t.chiefId, subject: "Composer note", body_md: "Written by the composer.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    const composer = { ...t.deps.composer, narrate: async (input: { eventIds: string[]; parked?: unknown }) => {
      calls.push(input);
      // The first batch is narrated; the composer turns the second down, so the plain note covers the rest.
      if (calls.length > 1) throw new ComposerRequestError("validation", "Composer /v1/narrate returned 400", 400);
      return { inboxItemId: composerNote.id, replayed: false };
    } } as typeof t.deps.composer;
    const acts = createCycleActivities({ ...t.deps, composer });
    const out = await acts.narrateCycle({ businessId: B(), eventIds: ids, summary: "Busy round.", parked });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ parked });
    expect(calls[1]!.parked).toBeUndefined();
    expect(out.inboxItemIds).toHaveLength(2);
    expect((await repos.inbox.get(t.db, B(), out.inboxItemIds[1]!)).bodyMd).toBe("Busy round.");
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
    // On an automatic cycle (the schedule, autopilot, a wake) the retry waits hold; the founder's Continue is the restart
    // the rule waits for and retries the task at once (decision 2026-10-28).
    let plan = await cycle.planCycle({ businessId: B(), cycleNumber: 1, trigger: "schedule", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toMatch(/retrying after 1 failed session/);
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 1, trigger: "continue", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason ?? "").not.toMatch(/retrying|failed/);

    // After the agent's rest and the task's first wait, both are back in the loop.
    await t.clock.advance(Math.max(AGENT_COOLDOWN_BASE_MS, TASK_RETRY_BASE_MS) + 1_000);
    b = await brief.loadBrief({ businessId: B() });
    expect(b.agents.find((a) => a.id === t.workerId)?.status).toBe("idle");
    mine = b.openTasks.find((x) => x.id === task.id)!;
    expect(mine.retry).toMatchObject({ failures: 1, due: true });
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 2, trigger: "schedule", brief: b });
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
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 3, trigger: "autopilot", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toMatch(/start it from the Plan/);
    expect(plan.starts.some((s) => s.taskId === task.id)).toBe(false);
    // The founder's Continue is that restart: the task is a candidate again, never held for its count.
    plan = await cycle.planCycle({ businessId: B(), cycleNumber: 3, trigger: "continue", brief: b });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason ?? "").not.toMatch(/start it from the Plan|retrying/);
    // The follow-ups of that Continue retry it too, once a slot frees; a scheduled cycle's follow-ups keep the limit
    // (the Foundmill business's five retried code tasks were skipped by the follow-ups for three cycles, Oct 30, 2026).
    const followUps = (trigger?: "continue" | "schedule") => cycle.followUpStarts({ businessId: B(), cycleId: "cycle-3", exclude: [], busyAgentIds: [], ...(trigger ? { trigger } : {}) });
    expect((await followUps()).some((s) => s.taskId === task.id)).toBe(false);
    expect((await followUps("schedule")).some((s) => s.taskId === task.id)).toBe(false);
    expect((await followUps("continue")).some((s) => s.taskId === task.id)).toBe(true);
  });

  it("a task reassigned while its session ran goes back to ready when that session ends, never left running for nobody", async () => {
    const sessions = createSessionActivities(t.deps);
    const task = await readyTask("Reassigned mid-session", t.workerId);
    const opened = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("running");
    // A lead hands the task to someone else while the worker's session is still running.
    const lead = await repos.agents.create(t.db, B(), { name: "Lead who takes it", agentType: (await repos.agents.get(t.db, B(), t.workerId)).agentType, status: "idle", initialVersion: { tools: [{ connectorKey: "platform", tools: ["tasks.list"] }] } });
    await repos.tasks.reassign(t.db, B(), task.id, lead.id);
    const blocked: SessionResult = { ...failed(), outcome: "blocked", reason: "could not run the tests here", summary: "Blocked." };
    const finish = await sessions.finishSession({ businessId: B(), agentId: t.workerId, taskId: task.id, sessionId: opened.sessionId! }, launch, blocked);
    // The session settles only its own row; the task is the new assignee's and waits for the next cycle to start it.
    expect(finish.taskStatus).toBe("ready");
    expect(await repos.tasks.get(t.db, B(), task.id)).toMatchObject({ status: "ready", assigneeAgentId: lead.id });
    expect((await repos.agents.getSession(t.db, B(), opened.sessionId!)).outcome).toBe("blocked");
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
    // The row says stopped, so the backoff never counts a stop as a failure in a row.
    expect((await repos.agents.getSession(t.db, B(), opened.sessionId!)).outcome).toBe("stopped");
    expect((await repos.agents.recentOutcomes(t.db, B(), { taskIds: [task.id] })).map((s) => s.outcome)).toEqual(["stopped"]);
  });
});

describe("the monthly model budget at dispatch (audit #15)", () => {
  const monthSpend = async () => (await modelBudgetState(t.db, { id: B(), modelBudgetMinor: 1_000_000_000 }, t.clock.now())).spentMinor;
  const book = (costMinor: number, billedTo: "credits" | "byok") => repos.usage.record(t.db, B(), { agentId: t.workerId, kind: "tokens", quantity: 1, costMinor, billedTo, occurredAt: t.clock.now() });
  const warnings = async () => (await repos.inbox.list(t.db, B(), { limit: 200 })).items.filter((i) => i.subject === "Monthly model budget used: no new work starts");
  afterEach(async () => {
    await repos.businesses.setModelBudget(t.db, B(), null);
    await repos.businesses.update(t.db, B(), { modelBilling: "credits" });
  });

  it("refuses every start once the month's cost reaches the budget, on the founder's own key, tells the founder once, and starts again when the budget is raised or removed", async () => {
    await repos.businesses.update(t.db, B(), { modelBilling: "byok" });
    const spent = await monthSpend();
    await book(300, "byok");
    await repos.businesses.setModelBudget(t.db, B(), spent + 300);

    const task = await readyTask();
    const refused = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
    expect(refused).toMatchObject({ sessionId: null, refused: "model_budget" });
    expect(refused.detail).toMatch(/monthly model budget is used up \(\$\d[\d,.]* of \$\d[\d,.]*, Estimate\)/);
    // A refusal, not a pause: nothing is stored that has to be undone, and the task stays ready.
    expect(await repos.agents.get(t.db, B(), t.workerId)).toMatchObject({ status: "idle", pausedReason: null });
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("ready");
    expect((await repos.agents.listSessions(t.db, B(), { taskId: task.id, limit: 5 })).items).toHaveLength(0);
    // A plan's create_task goes through the same guard; a second refusal does not repeat the warning.
    expect(await openAgentSession(t.deps, { businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "model_budget" });
    const notes = await warnings();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "warning" });
    expect(notes[0]!.bodyMd).toContain(`until ${nextPeriodStart(t.clock.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`);
    expect((await repos.audit.list(t.db, B(), { action: MODEL_BUDGET_ALERT_ACTION, limit: 10 })).items).toHaveLength(1);

    // The brief shows it and the cycle drafts no plan (a plan costs money too).
    const b = await brief.loadBrief({ businessId: B() });
    expect(b.modelBudgetRemainingMinor).toBe(0);
    const plan = await cycle.planCycle({ businessId: B(), cycleNumber: 21, trigger: "continue", brief: b });
    expect(plan).toMatchObject({ starts: [], costMinor: 0, summary: expect.stringMatching(/monthly model budget is used up/) });
    expect(plan.deferred.find((d) => d.taskId === task.id)?.reason).toBe("monthly model budget used up");

    // Raised: it starts; removed: it starts; neither repeats the warning.
    await repos.businesses.setModelBudget(t.db, B(), spent + 301);
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).sessionId).toBeTruthy();
    await endOpenSessions();
    await repos.businesses.setModelBudget(t.db, B(), spent + 300);
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ refused: "model_budget" });
    await repos.businesses.setModelBudget(t.db, B(), null);
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).sessionId).toBeTruthy();
    await endOpenSessions();
    expect(await warnings()).toHaveLength(1);
    expect((await brief.loadBrief({ businessId: B() })).modelBudgetRemainingMinor).toBeNull();
  });

  it("applies on credits too, warns again when a raised budget is used up in the same month, and lifts itself when the month turns", async () => {
    await repos.businesses.update(t.db, B(), { modelBilling: "credits" });
    const before = (await warnings()).length;
    await book(500, "credits");
    const spent = await monthSpend();
    await repos.businesses.setModelBudget(t.db, B(), spent);
    const task = await readyTask();
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ sessionId: null, refused: "model_budget" });
    expect(await warnings()).toHaveLength(before + 1);
    // Raised and used up again: a different budget, a new warning.
    await repos.businesses.setModelBudget(t.db, B(), spent + 100);
    await book(100, "credits");
    expect(await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).toMatchObject({ refused: "model_budget" });
    expect(await warnings()).toHaveLength(before + 2);

    // The next month starts with nothing spent: the same budget lets work through.
    await t.clock.set(nextPeriodStart(nextPeriodStart(t.clock.now())));
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).sessionId).toBeTruthy();
    await endOpenSessions();
  });
});

describe("lost sessions are closed and their tasks planned again (WP-05 T13, AR-11)", () => {
  /** Answer `workflowRunning` from a table of workflow ids (missing ids answer `fallback`); restored after each test. */
  const original = () => t.deps.workflowRunning;
  let restore: OrchestratorDepsRunning;
  beforeEach(() => {
    restore = original();
  });
  afterEach(() => {
    t.deps.workflowRunning = restore;
  });
  const answer = (fallback: boolean | null, table: Record<string, boolean | null> = {}) => {
    const asked: string[] = [];
    t.deps.workflowRunning = async (id) => {
      asked.push(id);
      return id in table ? table[id]! : fallback;
    };
    return asked;
  };
  const openOne = async (title: string) => {
    const task = await readyTask(title, t.workerId);
    const opened = await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id });
    expect(opened.sessionId).toBeTruthy();
    return { task, sessionId: opened.sessionId!, workflowId: `session:${opened.sessionId!}` };
  };

  it("the default answer is unknown, so a worker that cannot ask Temporal changes nothing", async () => {
    expect(await original()("session:anything")).toBeNull();
  });

  it("a lost session is closed and its task is planned again", async () => {
    const { task, sessionId, workflowId } = await openOne("Lost on a dead worker");
    await t.clock.advance(LOST_SESSION_AFTER_MS + 60_000);
    const asked = answer(true, { [workflowId]: false });
    expect(await closeLostSessions(t.deps, B())).toEqual([sessionId]);
    expect(asked).toContain(workflowId);
    expect(await repos.agents.getSession(t.db, B(), sessionId)).toMatchObject({ outcome: "lost", endedAt: t.clock.now() });
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("ready");
    const audit = (await repos.audit.list(t.db, B(), { action: SESSION_RECONCILED_ACTION, limit: 20 })).items.find((e) => (e.target as { id?: string }).id === sessionId);
    expect(audit?.details).toMatchObject({ outcome: "lost", taskId: task.id, workflowId, taskStatus: "ready" });
    // The task can start again: the dispatch guard no longer sees an open session on it.
    expect((await cycle.openSession({ businessId: B(), agentId: t.workerId, taskId: task.id })).refused).toBeNull();
    // Nothing left to close a second time.
    expect(await closeLostSessions(t.deps, B())).toEqual([]);
  });

  it("an unknown answer changes nothing", async () => {
    const { task, sessionId } = await openOne("Temporal cannot be asked");
    await t.clock.advance(LOST_SESSION_AFTER_MS + 60_000);
    answer(null);
    expect(await closeLostSessions(t.deps, B())).toEqual([]);
    expect((await repos.agents.getSession(t.db, B(), sessionId)).endedAt).toBeNull();
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("running");
  });

  it("a running workflow is left alone", async () => {
    const { task, sessionId } = await openOne("Still working");
    await t.clock.advance(LOST_SESSION_AFTER_MS + 60_000);
    answer(true);
    expect(await closeLostSessions(t.deps, B())).toEqual([]);
    expect((await repos.agents.getSession(t.db, B(), sessionId)).endedAt).toBeNull();
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("running");
  });

  it("a row younger than 10 minutes is left alone, and Temporal is not asked about it", async () => {
    const { task, sessionId } = await openOne("Just opened");
    await t.clock.advance(LOST_SESSION_AFTER_MS - 60_000);
    const asked = answer(false);
    expect(await closeLostSessions(t.deps, B())).toEqual([]);
    expect(asked).toEqual([]);
    expect((await repos.agents.getSession(t.db, B(), sessionId)).endedAt).toBeNull();
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("running");
  });

  it("a task that moved on is closed without being planned again", async () => {
    const { task, sessionId } = await openOne("Moved to review");
    await repos.tasks.setStatus(t.db, B(), task.id, "review");
    await t.clock.advance(LOST_SESSION_AFTER_MS + 60_000);
    answer(false);
    expect(await closeLostSessions(t.deps, B())).toEqual([sessionId]);
    expect((await repos.tasks.get(t.db, B(), task.id)).status).toBe("review");
  });
});
