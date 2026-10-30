/**
 * businessCycle with mocked activities: plans, dispatches agentSession children within the concurrency limit, never
 * runs two tasks with overlapping file scopes at once (AC-11.6.2), narrates and completes; stop ends it early.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, BusinessBrief, CyclePlan, CycleStart, MergeInput, RoadmapPlanResult, SessionLaunch, SessionResult } from "../../activities";
import { ApplicationFailure } from "@temporalio/common";
import { CYCLE_PLAN_FAILURE, PLAN_FAILED_MESSAGE } from "../../cycle-contract";
import { businessCycle, fileScopesOverlap, pauseSignal, resumeSignal, stopSignal } from "../../workflows";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agents = [id(101), id(102), id(103), id(104)];
const tasks = [
  { id: id(1), fileScope: ["src/api/**"] },
  { id: id(2), fileScope: ["src/api/routes.ts"] }, // overlaps task 1
  { id: id(3), fileScope: ["src/web/**"] },
  { id: id(4), fileScope: [] },
];

function brief(): BusinessBrief {
  return {
    businessId: B,
    businessName: "Ledgerly",
    businessMode: "assisted",
    archetype: "b2b_saas",
    currency: "EUR",
    glossary: {},
    holidayActive: false,
    departments: [{ id: id(50), name: "Engineering", slug: "engineering", leadAgentId: null, moduleKeys: ["development"], budgetMinor: null }],
    agents: agents.map((a, i) => ({ id: a, name: `Agent ${i}`, role: "Engineer", agentType: "backend_engineer", layer: "worker", modelKey: "sonnet", status: "idle", departmentIds: [id(50)], wageCapMinor: null })),
    chiefOfStaffId: null,
    openTasks: tasks.map((t) => ({ id: t.id, title: `Task ${t.id}`, kind: "code", status: "ready", departmentId: id(50), assigneeAgentId: null, priority: 0, fileScope: t.fileScope, dependsOn: [], budgetMinor: null, blocked: false })),
    pendingApprovals: 0,
    blockingInboxItems: 0,
    budgetRemainingMinor: null,
    creditsCurrency: "USD",
    maxAgents: 3,
    capacity: "mock",
    text: "brief",
    approxTokens: 1,
    builtAt: "2026-10-05T08:00:00.000Z",
  };
}

function plan(): CyclePlan {
  return { summary: "Ship the API and the web", timeBoxHours: 4, starts: tasks.map((t, i) => ({ taskId: t.id, agentId: agents[i]!, departmentId: id(50), priority: 1, reason: "planned", kind: "code", fileScope: t.fileScope, budgetMinor: null })), deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 12 };
}

const launch: SessionLaunch = { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "claude-sonnet-5-5", recordingKey: "stub", allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: "agent/x", maxTurns: 1, planSteps: 1, acceptanceTests: 1 };
const done = (): SessionResult => ({ outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 1, planSteps: 1, acceptanceTestsPassing: 1, acceptanceTests: 1, reviewPassed: true, merged: true, phase: "done", progress: 1, etaAt: null, at: null }, eventsEmitted: 3, toolCalls: 1, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 5, durationMs: 60_000, prNumber: null, summary: "ok", providerSessionId: null });

interface Calls {
  opened: { taskId: string; agentId: string }[];
  /** The session ids handed out, in order (each child runs as `session:<id>`). */
  sessionIds: string[];
  /** Every openSession input as received (the workflow sends no workflow id: the row carries `session:<id>`). */
  openInputs: Record<string, unknown>[];
  running: Set<string>;
  maxConcurrent: number;
  overlapSeen: boolean;
  narrated: string[][];
  completed: Record<string, unknown>[];
  failed: Record<string, unknown>[];
  startInputs: Record<string, unknown>[];
  idleNotes: string[];
  started: number;
  /** An openSession call is waiting on `releaseOpen` (only with `holdOpen`). */
  opening: boolean;
  plans: number;
  startedPlans: CyclePlan[];
  planFailures: { message: string; details: unknown }[];
  /** Every planCycle input's `roadmapPlanned`, in order. */
  roadmapPlanned: (RoadmapPlanResult | null | undefined)[];
  roadmapPlans: number;
  briefs: number;
  /** Every followUpStarts input as received. */
  followUps: { exclude: string[]; busyAgentIds?: string[]; limit?: number }[];
  /** Tasks whose merge review the cycle started (`prepareMerge` is its first step). */
  merges: string[];
}

/** Each test's sessions get their own ids: children an earlier test abandoned may still run under theirs. */
let rigRun = 0;

function mockActivities(opts: { holdSessions?: boolean; holdOpen?: boolean; stoppedBrief?: boolean; refuseAfter?: number; planned?: number; planError?: () => Error; budgetMinor?: number; idle?: boolean; planFails?: boolean; openFailsOnce?: boolean; startFailsOnce?: boolean; untaskedNow?: boolean; roadmapResult?: RoadmapPlanResult; followUp?: CycleStart; merges?: MergeInput[] } = {}): { acts: Partial<Activities>; calls: Calls; release: () => void; releaseOpen: () => void } {
  const calls: Calls = { opened: [], sessionIds: [], openInputs: [], running: new Set(), maxConcurrent: 0, overlapSeen: false, narrated: [], completed: [], started: 0, opening: false, plans: 0, startedPlans: [], planFailures: [], failed: [], startInputs: [], idleNotes: [], roadmapPlanned: [], roadmapPlans: 0, briefs: 0, followUps: [], merges: [] };
  const run = String((rigRun += 1)).padStart(4, "0");
  const scopes = new Map(tasks.map((t) => [t.id, t.fileScope]));
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let openFailed = false;
  let startFailed = false;
  let releaseOpen = () => {};
  const openHeld = new Promise<void>((r) => (releaseOpen = r));
  const acts: Partial<Activities> = {
    async pendingMerges() {
      return opts.merges ?? [];
    },
    async prepareMerge(input) {
      calls.merges.push(input.taskId);
      return { status: "skipped", reason: "test" };
    },
    async loadBrief() {
      calls.briefs += 1;
      return { ...brief(), agentsStopped: opts.stoppedBrief ?? false, budgetRemainingMinor: opts.budgetMinor ?? null, ...(opts.untaskedNow ? { untaskedRoadmap: [{ id: id(300), title: "Repository context for code sessions", horizon: "now" }] } : {}) };
    },
    async planRoadmap() {
      calls.roadmapPlans += 1;
      return opts.roadmapResult ?? { planned: [], failed: [], skipped: "nothing to plan", costMinor: 0 };
    },
    async followUpStarts(input) {
      calls.followUps.push({ exclude: input.exclude, busyAgentIds: input.busyAgentIds, limit: input.limit });
      return opts.followUp && !input.exclude.includes(opts.followUp.taskId) ? [opts.followUp] : [];
    },
    async planCycle({ brief: b, roadmapPlanned }) {
      calls.plans += 1;
      calls.roadmapPlanned.push(roadmapPlanned);
      if (opts.planError) throw opts.planError();
      if (opts.planFails) throw new Error("The planner is unavailable");
      if (opts.idle) return { ...plan(), starts: [], costMinor: 0, idle: true, summary: "Everything open is blocked." };
      if (b.agentsStopped) return { ...plan(), starts: [], costMinor: 0 };
      return opts.planned === undefined ? plan() : { ...plan(), starts: plan().starts.slice(0, opts.planned) };
    },
    async startCycle(input) {
      calls.startInputs.push({ ...input });
      if (opts.startFailsOnce && !startFailed) {
        startFailed = true;
        throw new Error("connection reset");
      }
      calls.started += 1;
      calls.startedPlans.push(input.plan);
      return { cycleId: input.cycleId ?? id(900), eventId: id(901) };
    },
    async openSession(input) {
      const { taskId, agentId } = input;
      calls.openInputs.push({ ...input });
      if (opts.holdOpen) {
        calls.opening = true;
        await openHeld;
      }
      // The kill switch lands after `refuseAfter` sessions: every later dispatch is refused.
      if (opts.refuseAfter !== undefined && calls.opened.length >= opts.refuseAfter) return { sessionId: null, refused: "agents_stopped" as const, detail: "agents are stopped (kill switch)" };
      if (opts.openFailsOnce && !openFailed) {
        openFailed = true;
        throw new Error("connection reset");
      }
      calls.opened.push({ taskId, agentId });
      const sessionId = `${taskId.slice(0, 8)}-${run}-4000-8000-${String(calls.opened.length).padStart(12, "0")}`;
      calls.sessionIds.push(sessionId);
      return { sessionId, refused: null, detail: null };
    },
    async prepareSession() {
      return launch;
    },
    async runAgentSession(input) {
      for (const other of calls.running) if (fileScopesOverlap(scopes.get(other) ?? [], scopes.get(input.taskId) ?? [])) calls.overlapSeen = true;
      calls.running.add(input.taskId);
      calls.maxConcurrent = Math.max(calls.maxConcurrent, calls.running.size);
      if (opts.holdSessions) await held;
      else await new Promise((r) => setTimeout(r, 150));
      calls.running.delete(input.taskId);
      return done();
    },
    async postSessionCommand() {},
    async finishSession() {
      return { taskStatus: "done", eventIds: [id(777)], healthChanged: false };
    },
    async narrateCycle({ eventIds }) {
      calls.narrated.push(eventIds);
      return { inboxItemIds: [id(555)], viaComposer: false };
    },
    async completeCycle(input) {
      calls.completed.push(input);
      return { eventId: id(902) };
    },
    async notePlanFailure(input) {
      calls.planFailures.push(input);
      return { inboxItemIds: [id(556)] };
    },
    async failCycle(input) {
      calls.failed.push(input);
      return { eventId: id(903), inboxItemId: id(556) };
    },
    async noteIdleCycle({ summary }) {
      calls.idleNotes.push(summary);
      return { inboxItemId: id(557) };
    },
  };
  return { acts, calls, release, releaseOpen };
}

describe("fileScopesOverlap", () => {
  it("detects prefixes, globs and exact files", () => {
    expect(fileScopesOverlap(["src/api/**"], ["src/api/routes.ts"])).toBe(true);
    expect(fileScopesOverlap(["src/api"], ["src/api/routes.ts"])).toBe(true);
    expect(fileScopesOverlap(["src/api/**"], ["src/web/**"])).toBe(false);
    expect(fileScopesOverlap([], ["src/web/**"])).toBe(false);
    expect(fileScopesOverlap(["README.md"], ["README.md"])).toBe(true);
  });
});

describe("businessCycle workflow", () => {
  it("completes with mocked activities: every planned task dispatched, overlapping scopes serialised, narrated, completed", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:1`, taskQueue, args: [{ businessId: B, cycleNumber: 1, trigger: "continue" }] }));
    expect(result.outcome).toBe("completed");
    expect(result.tasksDispatched).toBe(4);
    expect(result.tasksCompleted).toBe(4);
    expect(result.tasksBlocked).toBe(0);
    expect(result.inboxItemIds).toEqual([id(555)]);
    expect(result.costMinor).toBe(12 + 4 * 5);
    expect(m.calls.started).toBe(1);
    // The workflow names the cycle itself, so a retried start and the completion speak of the same one.
    expect(m.calls.startInputs[0]).toMatchObject({ cycleId: result.cycleId });
    expect(m.calls.opened.map((o) => o.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
    expect(m.calls.overlapSeen).toBe(false);
    expect(m.calls.maxConcurrent).toBeLessThanOrEqual(3);
    expect(m.calls.narrated[0]).toEqual([id(777), id(777), id(777), id(777)]);
    expect(m.calls.completed[0]).toMatchObject({ cycleId: result.cycleId, outcome: "completed", tasksDispatched: 4, tasksCompleted: 4, inboxItemIds: [id(555)], currency: "USD" });
  });

  it("starts the merge review of each code task that waits in review with nothing moving it, once per task, outliving the cycle", async () => {
    const waiting: MergeInput = { businessId: B, taskId: id(901), agentId: id(902), sessionId: id(903), branch: `agent/${id(901)}`, acceptance: { passing: 145, total: 145 }, summary: "Hydration fix" };
    const m = mockActivities({ merges: [waiting] });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const cycle = await client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:2`, taskQueue, args: [{ businessId: B, cycleNumber: 2, trigger: "continue" }] });
      return { cycle, review: await client.workflow.getHandle(`merge:${id(901)}`).result() };
    });
    expect(result.cycle.outcome).toBe("completed");
    expect(result.review).toEqual({ status: "skipped", reason: "test" });
    expect(m.calls.merges).toEqual([id(901)]);
    // The planned work is unaffected: every task still dispatched.
    expect(result.cycle.tasksDispatched).toBe(4);
  });

  it("stop ends the cycle early and fans the stop out to the running sessions", async () => {
    const m = mockActivities({ holdSessions: true });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(businessCycle, { workflowId: `cycle:${B}:2`, taskQueue, args: [{ businessId: B, cycleNumber: 2, trigger: "continue" }] });
      for (let i = 0; i < 200 && m.calls.running.size < 2; i++) await new Promise((r) => setTimeout(r, 25));
      await handle.signal(stopSignal, { reason: "kill_switch", by: "founder" });
      // Children are abandoned by the parent but still finish once released.
      setTimeout(() => m.release(), 200);
      return handle.result();
    });
    expect(result.outcome).toBe("stopped");
    expect(m.calls.completed[0]).toMatchObject({ outcome: "stopped" });
  });

  it("a stop that lands while a session is being opened still reaches that session", async () => {
    const m = mockActivities({ planned: 1, holdOpen: true });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(businessCycle, { workflowId: `cycle:${B}:6`, taskQueue, args: [{ businessId: B, cycleNumber: 6, trigger: "continue" }] });
      for (let i = 0; i < 200 && !m.calls.opening; i++) await new Promise((r) => setTimeout(r, 25));
      // The kill switch signals the cycle while openSession is still running: the fan-out finds no child yet.
      await handle.signal(stopSignal, { reason: "kill_switch", by: "founder" });
      m.releaseOpen();
      const r = await handle.result();
      const child = client.workflow.getHandle(`session:${m.calls.sessionIds[0]!}`);
      await child.result();
      const history = await child.fetchHistory();
      const signals = (history.events ?? []).map((e) => e.workflowExecutionSignaledEventAttributes?.signalName).filter(Boolean);
      expect(signals).toContain("stop");
      return r;
    });
    expect(result.outcome).toBe("stopped");
    expect(m.calls.sessionIds).toHaveLength(1);
  });

  it("opens each session without a placeholder workflow id: the row carries session:<id> and the child runs under it", async () => {
    const m = mockActivities({ planned: 1 });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const r = await client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:3`, taskQueue, args: [{ businessId: B, cycleNumber: 3, trigger: "continue" }] });
      const child = await client.workflow.getHandle(`session:${m.calls.sessionIds[0]!}`).describe();
      expect(child.type).toBe("agentSession");
      return r;
    });
    expect(result.tasksDispatched).toBe(1);
    expect(m.calls.openInputs).toHaveLength(1);
    expect(m.calls.openInputs[0]).not.toHaveProperty("workflowId");
    // The id is chosen by the workflow, so a retried openSession finds the row it opened (audit O-44).
    expect(m.calls.openInputs[0]!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a retried openSession and a retried startCycle carry the same ids (no second session, no second cycle)", async () => {
    const m = mockActivities({ planned: 1, openFailsOnce: true, startFailsOnce: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:6`, taskQueue, args: [{ businessId: B, cycleNumber: 6, trigger: "continue" }] }));
    expect(result.outcome).toBe("completed");
    expect(m.calls.startInputs).toHaveLength(2);
    expect(m.calls.startInputs[1]!.cycleId).toBe(m.calls.startInputs[0]!.cycleId);
    expect(m.calls.openInputs).toHaveLength(2);
    expect(m.calls.openInputs[1]!.sessionId).toBe(m.calls.openInputs[0]!.sessionId);
    expect(m.calls.opened).toHaveLength(1);
  });

  it("a planner that throws ends the cycle failed with a plain reason in the Inbox, recorded under the id the workflow chose (audit O-07, BILL-06)", async () => {
    const m = mockActivities({ planFails: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:7`, taskQueue, args: [{ businessId: B, cycleNumber: 7, trigger: "continue" }] }));
    expect(result.outcome).toBe("failed");
    expect(m.calls.startInputs[0]).toMatchObject({ cycleId: result.cycleId });
    expect(m.calls.planFailures[0]).toMatchObject({ cycleNumber: 7, message: PLAN_FAILED_MESSAGE });
    expect(m.calls.completed[0]).toMatchObject({ cycleId: result.cycleId, outcome: "failed" });
    expect(m.calls.failed).toHaveLength(0);
  });

  it("any other failure (the brief cannot load) closes the cycle as failed and tells the founder, instead of leaving it running (audit O-07)", async () => {
    const m = mockActivities({});
    m.acts.loadBrief = async () => {
      throw new Error("The planner is unavailable");
    };
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:70`, taskQueue, args: [{ businessId: B, cycleNumber: 70, trigger: "continue" }] }));
    expect(result.outcome).toBe("failed");
    expect(m.calls.completed).toHaveLength(0);
    expect(m.calls.failed).toHaveLength(1);
    expect(m.calls.failed[0]).toMatchObject({ businessId: B, cycleNumber: 70, cycleId: result.cycleId, workflowId: `cycle:${B}:70` });
    expect(String(m.calls.failed[0]!.reason)).toContain("The planner is unavailable");
  });

  it("a cycle with nothing to start leaves one plain note and calls no narrator (audit O-02, SOAK-04)", async () => {
    const m = mockActivities({ idle: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:8`, taskQueue, args: [{ businessId: B, cycleNumber: 8, trigger: "continue" }] }));
    expect(result).toMatchObject({ outcome: "waiting", tasksDispatched: 0, inboxItemIds: [id(557)] });
    expect(m.calls.idleNotes).toEqual(["Everything open is blocked."]);
    expect(m.calls.narrated).toHaveLength(0);
    expect(m.calls.completed[0]).toMatchObject({ outcome: "waiting" });
  });

  it("a paused cycle opens nothing new until it is resumed", async () => {
    const m = mockActivities({ planned: 1 });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(businessCycle, { workflowId: `cycle:${B}:9`, taskQueue, args: [{ businessId: B, cycleNumber: 9, trigger: "continue" }] });
      await handle.signal(pauseSignal, {});
      await new Promise((r) => setTimeout(r, 300));
      const openedWhilePaused = m.calls.opened.length;
      await handle.signal(resumeSignal, {});
      const r = await handle.result();
      return { r, openedWhilePaused };
    });
    expect(result.r.outcome).toBe("completed");
    expect(result.openedWhilePaused).toBe(0);
    expect(m.calls.opened).toHaveLength(1);
  });

  it("a refused dispatch because the team was stopped ends the cycle: nothing else is opened", async () => {
    const m = mockActivities({ refuseAfter: 1 });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:4`, taskQueue, args: [{ businessId: B, cycleNumber: 4, trigger: "continue" }] }));
    expect(result.outcome).toBe("stopped");
    expect(m.calls.opened).toHaveLength(1);
    // The refusal stopped the loop at the first refused task; the others were never asked for.
    expect(m.calls.openInputs).toHaveLength(2);
    expect(m.calls.completed[0]).toMatchObject({ outcome: "stopped", tasksDispatched: 1 });
  });

  it("a finished session gives its reserve back and takes what it really cost, so the cycle's credits last for the whole plan (audit O-29)", async () => {
    // 1,500 US cents of credits: the first sessions reserve it all, and the task whose scope waits for the first can only
    // start once that session returned its reserve (it cost 5).
    const m = mockActivities({ budgetMinor: 1_500 });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:71`, taskQueue, args: [{ businessId: B, cycleNumber: 71, trigger: "continue" }] }));
    expect(result.tasksDispatched).toBe(4);
    expect(m.calls.opened.map((o) => o.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
  });

  it("a session that cost more than its reserve ends the dispatching: later tasks wait for the next cycle", async () => {
    const expensive = mockActivities({ budgetMinor: 1_500 });
    expensive.acts.runAgentSession = async (input) => {
      await new Promise((r) => setTimeout(r, 100));
      return { ...done(), costMinor: input.taskId === id(1) ? 1_400 : 5 };
    };
    const result = await rig.run(expensive.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:72`, taskQueue, args: [{ businessId: B, cycleNumber: 72, trigger: "continue" }] }));
    // Task 1 spent 1,400 against a 500 reserve: nothing is left for task 2, which was waiting behind it.
    expect(expensive.calls.opened.map((o) => o.taskId)).not.toContain(id(2));
    expect(result.tasksDispatched).toBe(3);
  });

  it("a plan the model account cannot pay for ends the cycle failed at once, with the reason in the Inbox (audit BILL-06)", async () => {
    const billing = "This cycle's plan could not run: the model account that runs Foundmill is out of credit. Our team has been alerted, and nothing was charged to your credits. Try again later.";
    const m = mockActivities({ planError: () => ApplicationFailure.create({ type: CYCLE_PLAN_FAILURE, message: billing, nonRetryable: true, details: [{ kind: "billing", billedTo: "credits", reason: "credit_balance" }] }) });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:6`, taskQueue, args: [{ businessId: B, cycleNumber: 6, trigger: "continue" }] }));
    expect(result).toMatchObject({ outcome: "failed", tasksDispatched: 0, costMinor: 0, inboxItemIds: [id(556)] });
    // Not retried: the account cannot pay until someone adds credit.
    expect(m.calls.plans).toBe(1);
    expect(m.calls.openInputs).toHaveLength(0);
    // Recorded as a cycle (so the shell stops showing it as processing) with nothing planned.
    expect(m.calls.startedPlans[0]).toMatchObject({ starts: [], summary: billing });
    expect(m.calls.planFailures[0]).toEqual({ businessId: B, cycleNumber: 6, message: billing, details: { kind: "billing", billedTo: "credits", reason: "credit_balance" } });
    expect(m.calls.completed[0]).toMatchObject({ outcome: "failed", tasksDispatched: 0, inboxItemIds: [id(556)] });
  });

  it("a plan that fails every retry ends the cycle failed with a plain reason instead of failing the workflow", async () => {
    const m = mockActivities({ planError: () => new Error("Anthropic unavailable after 4 attempts for route \"chiefOfStaff\": overloaded") });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:7`, taskQueue, args: [{ businessId: B, cycleNumber: 7, trigger: "continue" }] }));
    expect(result.outcome).toBe("failed");
    expect(m.calls.plans).toBe(3);
    expect(m.calls.planFailures[0]).toMatchObject({ cycleNumber: 7, message: PLAN_FAILED_MESSAGE, details: { kind: "error" } });
    expect(m.calls.planFailures[0]!.message).not.toMatch(/Anthropic|overloaded|chiefOfStaff/);
    expect(m.calls.completed[0]).toMatchObject({ outcome: "failed" });
  });

  it("plans Now roadmap items without tasks before the plan, reloads the brief when something was planned, and adds the cost (lead, 2026-10-24)", async () => {
    const roadmapResult: RoadmapPlanResult = { planned: [{ roadmapItemId: id(300), title: "Repository context for code sessions", taskIds: [id(301), id(302)], costMinor: 7 }], failed: [], skipped: null, costMinor: 7 };
    const m = mockActivities({ planned: 1, untaskedNow: true, roadmapResult });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:80`, taskQueue, args: [{ businessId: B, cycleNumber: 80, trigger: "continue" }] }));
    expect(result.outcome).toBe("completed");
    expect(m.calls.roadmapPlans).toBe(1);
    expect(m.calls.briefs).toBe(2);
    expect(m.calls.roadmapPlanned).toEqual([roadmapResult]);
    expect(result.costMinor).toBe(12 + 7 + 5);

    // Nothing in Now without tasks: no planning call, one brief.
    const none = mockActivities({ planned: 1 });
    await rig.run(none.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:81`, taskQueue, args: [{ businessId: B, cycleNumber: 81, trigger: "continue" }] }));
    expect(none.calls.roadmapPlans).toBe(0);
    expect(none.calls.briefs).toBe(1);
    expect(none.calls.roadmapPlanned).toEqual([null]);

    // Nothing planned (a failed Planner, a held item): the brief is not reloaded and the plan still hears about it.
    const held: RoadmapPlanResult = { planned: [], failed: [{ roadmapItemId: id(300), title: "Repository context for code sessions", reason: "the Planner did not answer" }], skipped: null, costMinor: 0 };
    const failed = mockActivities({ planned: 1, untaskedNow: true, roadmapResult: held });
    await rig.run(failed.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:82`, taskQueue, args: [{ businessId: B, cycleNumber: 82, trigger: "continue" }] }));
    expect(failed.calls.briefs).toBe(1);
    expect(failed.calls.roadmapPlanned).toEqual([held]);

    // A stopped team plans no roadmap either.
    const stoppedTeam = mockActivities({ stoppedBrief: true, untaskedNow: true, roadmapResult });
    await rig.run(stoppedTeam.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:83`, taskQueue, args: [{ businessId: B, cycleNumber: 83, trigger: "continue" }] }));
    expect(stoppedTeam.calls.roadmapPlans).toBe(0);
  });

  it("a cycle whose first task finishes gets the task it unblocked dispatched in the same cycle (decision 8)", async () => {
    const followUp: CycleStart = { taskId: id(5), agentId: agents[1]!, departmentId: id(50), priority: 6, reason: "its earlier work finished during this cycle", kind: "code", fileScope: [], budgetMinor: null };
    const m = mockActivities({ planned: 1, followUp });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:84`, taskQueue, args: [{ businessId: B, cycleNumber: 84, trigger: "continue" }] }));
    expect(result.outcome).toBe("completed");
    expect(m.calls.opened.map((o) => o.taskId)).toEqual([id(1), id(5)]);
    expect(result.tasksDispatched).toBe(2);
    expect(result.tasksCompleted).toBe(2);
    // Asked once per finished session, with every task the cycle holds excluded and the cycle's concurrency as the limit.
    expect(m.calls.followUps.length).toBeGreaterThanOrEqual(2);
    expect(m.calls.followUps[0]).toMatchObject({ exclude: [id(1)], busyAgentIds: [], limit: 3 });
    expect(m.calls.followUps[1]!.exclude.sort()).toEqual([id(1), id(5)].sort());
    expect(m.calls.completed[0]).toMatchObject({ tasksDispatched: 2, tasksCompleted: 2 });
  });

  it("a brief that says the team is stopped dispatches nothing and records the cycle as stopped", async () => {
    const m = mockActivities({ stoppedBrief: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:5`, taskQueue, args: [{ businessId: B, cycleNumber: 5, trigger: "continue" }] }));
    expect(result).toMatchObject({ outcome: "stopped", tasksDispatched: 0, costMinor: 0 });
    expect(m.calls.openInputs).toHaveLength(0);
    expect(m.calls.completed[0]).toMatchObject({ outcome: "stopped", tasksDispatched: 0 });
  });
});
