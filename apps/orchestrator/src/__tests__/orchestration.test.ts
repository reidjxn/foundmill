/**
 * Cycle, vacation and Automated-mode activities on PGlite (audit W01): a retried activity never repeats its effect
 * (cycle events, sessions, the away report), a failed cycle is closed and announced once, an idle cycle says what is
 * in the way without calling a model, and the autopilot holds exactly when it should.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutopilotActivities } from "../activities/autopilot";
import { createBriefActivities, foldDuplicates } from "../activities/brief";
import { createCycleActivities, cycleEventKey, IDLE_CYCLE_SUBJECT } from "../activities/cycle";
import { createHolidayActivities } from "../activities/holiday";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "w01" });
});
afterAll(async () => {
  await t?.close();
});

const DAY = 86_400_000;
const uuidOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const plan = () => ({ summary: "s", timeBoxHours: 4, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus" as const, warning: null, costMinor: 0 });

describe("cycle events are written once per cycle id", () => {
  it("startCycle and completeCycle find the event a retried attempt already wrote", async () => {
    const acts = createCycleActivities(t.deps);
    const brief = await createBriefActivities(t.deps).loadBrief({ businessId: t.businessId });
    const cycleId = uuidOf(9001);
    const input = { businessId: t.businessId, cycleNumber: 1, workflowId: `cycle:${t.businessId}:1`, trigger: "continue" as const, plan: plan(), brief, cycleId };
    const first = await acts.startCycle(input);
    const again = await acts.startCycle(input);
    expect(first.cycleId).toBe(cycleId);
    expect(again).toEqual(first);
    const started = await repos.events.list(t.db, t.businessId, { type: "cycle.started", limit: 20 });
    expect(started.items.filter((e) => (e.payload as { cycleId: string }).cycleId === cycleId)).toHaveLength(1);

    const done = { businessId: t.businessId, cycleId, cycleNumber: 1, workflowId: input.workflowId, outcome: "completed" as const, tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, costMinor: 0, currency: "USD", inboxItemIds: [], durationMs: 10 };
    const c1 = await acts.completeCycle(done);
    const c2 = await acts.completeCycle(done);
    expect(c2).toEqual(c1);
    expect((await repos.events.byIdempotencyKey(t.db, t.businessId, cycleEventKey("completed", cycleId)))?.id).toBe(c1.eventId);
  });
});

describe("a failed cycle is closed and announced once (audit O-07)", () => {
  it("failCycle writes one cycle.completed(failed) and one Inbox note however often it is retried, and a late completeCycle is a no-op", async () => {
    const acts = createCycleActivities(t.deps);
    const cycleId = uuidOf(9002);
    const input = { businessId: t.businessId, cycleId, cycleNumber: 2, workflowId: `cycle:${t.businessId}:2`, reason: "The planner is unavailable", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, costMinor: 0, currency: "USD", durationMs: 5 };
    const a = await acts.failCycle(input);
    const b = await acts.failCycle(input);
    expect(a.inboxItemId).toBeTruthy();
    expect(b.eventId).toBe(a.eventId);
    expect(b.inboxItemId).toBeNull();
    const ev = await repos.events.byIdempotencyKey(t.db, t.businessId, cycleEventKey("completed", cycleId));
    expect(ev?.payload).toMatchObject({ cycleId, outcome: "failed", workflowId: input.workflowId });
    const item = await repos.inbox.get(t.db, t.businessId, a.inboxItemId!);
    expect(item.subject).toBe("Cycle 2 did not finish");
    expect(item.bodyMd).toContain("The planner is unavailable");
    expect(item.blocksContinue).toBe(false);
    const late = await acts.completeCycle({ businessId: t.businessId, cycleId, cycleNumber: 2, workflowId: input.workflowId, outcome: "completed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, costMinor: 0, currency: "USD", inboxItemIds: [], durationMs: 5 });
    expect(late.eventId).toBe(a.eventId);
  });
});

describe("a cycle with nothing to start (audit OL-10, SOAK-04)", () => {
  it("plans without calling a model, names what is in the way, and leaves one note that is not repeated", async () => {
    const acts = createCycleActivities(t.deps);
    const brief = await createBriefActivities(t.deps).loadBrief({ businessId: t.businessId });
    // Every open task waits on another one that is not done.
    const blocked = { ...brief, openTasks: brief.openTasks.map((task) => ({ ...task, blocked: true })), untaskedRoadmap: [{ id: uuidOf(77), title: "Pricing experiment", horizon: "now" }] };
    let modelCalls = 0;
    const complete = t.deps.models.complete.bind(t.deps.models);
    t.deps.models.complete = (async (...args: Parameters<typeof complete>) => {
      modelCalls += 1;
      return complete(...args);
    }) as typeof t.deps.models.complete;
    try {
      const planned = await acts.planCycle({ businessId: t.businessId, cycleNumber: 3, trigger: "continue", brief: blocked });
      expect(planned.idle).toBe(true);
      expect(planned.starts).toEqual([]);
      expect(planned.costMinor).toBe(0);
      expect(modelCalls).toBe(0);
      expect(planned.summary).toMatch(/1 roadmap item has no tasks yet \(Pricing experiment\)/);
      expect(planned.summary).toMatch(/Development › Plan/);
      expect(planned.summary).not.toMatch(/everything open is blocked/i);

      const one = await acts.noteIdleCycle({ businessId: t.businessId, cycleNumber: 3, summary: planned.summary });
      const two = await acts.noteIdleCycle({ businessId: t.businessId, cycleNumber: 4, summary: planned.summary });
      expect(one.inboxItemId).toBeTruthy();
      expect(two.inboxItemId).toBe(one.inboxItemId);
      expect((await repos.inbox.get(t.db, t.businessId, one.inboxItemId!)).subject).toBe(IDLE_CYCLE_SUBJECT);
    } finally {
      t.deps.models.complete = complete;
    }
  });
});

describe("opening a session is idempotent (audit O-44, #244)", () => {
  it("a retried openSession with the same session id returns the row it opened instead of refusing or opening a second", async () => {
    const acts = createCycleActivities(t.deps);
    const sessionId = uuidOf(9003);
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Retry-safe dispatch", status: "ready", assigneeAgentId: t.workerId });
    const a = await acts.openSession({ businessId: t.businessId, agentId: t.workerId, taskId: task.id, sessionId });
    const b = await acts.openSession({ businessId: t.businessId, agentId: t.workerId, taskId: task.id, sessionId });
    expect(a.detail).toBeNull();
    expect(a.sessionId).toBe(sessionId);
    expect(b).toEqual({ sessionId, refused: null, detail: null });
    const sessions = (await repos.agents.listSessions(t.db, t.businessId, { taskId: task.id, limit: 20 })).items;
    expect(sessions.filter((s) => s.id === sessionId)).toHaveLength(1);
    // A different id for the same task is still refused: the task already has a session.
    const other = await acts.openSession({ businessId: t.businessId, agentId: t.workerId, taskId: task.id, sessionId: uuidOf(9004) });
    expect(other.sessionId).toBeNull();
    expect(other.refused).toBe("open_session");
  });
});

describe("the away report is written once (audit O-35)", () => {
  it("endHoliday returns the same report on a retry and ends the row once", async () => {
    const holidayActs = createHolidayActivities(t.deps);
    const started = t.clock.now();
    const h = await repos.holidays.start(t.db, t.businessId, { untilAt: new Date(started.getTime() + 2 * DAY), authority: { decisionTypes: ["publish_content"] }, startedAt: started, currency: "USD" });
    const loaded = await holidayActs.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    const end = { businessId: t.businessId, holiday: loaded, reason: "until_reached" as const, wakeEventType: null, cyclesRun: 2 };
    const a = await holidayActs.endHoliday(end);
    const b = await holidayActs.endHoliday(end);
    expect(a.reportInboxItemId).toBeTruthy();
    expect(b.reportInboxItemId).toBe(a.reportInboxItemId);
    const reports = (await repos.inbox.list(t.db, t.businessId, { type: "report", limit: 50 })).items.filter((i) => i.subject === "While you were away");
    expect(reports.filter((r) => r.id === a.reportInboxItemId)).toHaveLength(1);
    const ended = await repos.events.list(t.db, t.businessId, { type: "holiday.ended", limit: 20 });
    expect(ended.items.filter((e) => (e.payload as { holidayId: string }).holidayId === h.id)).toHaveLength(1);
  });

  it("the away report names the safety limit when a vacation ran that long (audit #239)", async () => {
    const holidayActs = createHolidayActivities(t.deps);
    const h = await repos.holidays.start(t.db, t.businessId, { untilCondition: { text: "until I return" }, authority: { decisionTypes: [] }, startedAt: t.clock.now(), currency: "USD" });
    const loaded = await holidayActs.loadHoliday({ businessId: t.businessId, holidayId: h.id });
    const end = await holidayActs.endHoliday({ businessId: t.businessId, holiday: loaded, reason: "cycle_cap", wakeEventType: null, cyclesRun: 400 });
    const report = await repos.inbox.get(t.db, t.businessId, end.reportInboxItemId!);
    expect(report.bodyMd).toMatch(/400 cycles/);
    expect(report.bodyMd).toMatch(/limit/i);
  });
});

describe("Automated mode's autopilot (audit SOAK-01, #75)", () => {
  it("is active only in Automated mode, holds while a vacation runs or the team is stopped, and ends with the mode", async () => {
    const acts = createAutopilotActivities(t.deps);
    const A = t.businessId;
    await repos.businesses.setBusinessMode(t.db, A, "assisted");
    expect(await acts.autopilotCheck({ businessId: A })).toMatchObject({ active: false, reason: "mode_changed" });

    await repos.businesses.setBusinessMode(t.db, A, "automated");
    expect(await acts.autopilotCheck({ businessId: A })).toMatchObject({ active: true, hold: null });

    const vacation = await repos.holidays.start(t.db, A, { untilAt: new Date(t.clock.now().getTime() + 5 * DAY), startedAt: t.clock.now(), currency: "USD" });
    expect(await acts.autopilotCheck({ businessId: A })).toMatchObject({ active: true, hold: "vacation" });
    await repos.holidays.end(t.db, A, vacation.id);
    expect(await acts.autopilotCheck({ businessId: A })).toMatchObject({ active: true, hold: null });

    const loaded = await acts.loadAutopilot({ businessId: A });
    // Signing is never delegated, in Automated mode or on vacation.
    expect(loaded.authority).not.toContain("sign_contracts");
    expect(loaded.chiefOfStaffId).toBe(t.chiefId);
    await repos.businesses.setBusinessMode(t.db, A, "assisted");
  });
});

describe("the planner sees every kind of work once (audit SOAK-04, #84)", () => {
  it("folds identical open tasks into one line with a count and keeps different statuses apart", () => {
    const task = (id: string, title: string, status: string) => ({ id, title, kind: "ops", status, departmentId: null, assigneeAgentId: null, priority: 0, fileScope: [], dependsOn: [], budgetMinor: null, blocked: false }) as never;
    const folded = foldDuplicates([task("1", "Lead with product work", "ready"), task("2", "Lead with product work ", "ready"), task("3", "lead with product work", "failed"), task("4", "Write the launch post", "ready")]);
    expect(folded.map((f) => [f.task.id, f.count])).toEqual([["1", 2], ["3", 1], ["4", 1]]);
  });

  it("the brief counts every open task, not the page it shows, and lists roadmap items that have no task", async () => {
    const brief = await createBriefActivities(t.deps).loadBrief({ businessId: t.businessId });
    const total = (await repos.tasks.planningCandidates(t.db, t.businessId)).total;
    expect(brief.openTaskTotal).toBe(total);
    expect(brief.openTasks.length).toBeLessThanOrEqual(total);
    expect(Array.isArray(brief.untaskedRoadmap)).toBe(true);
  });
});
