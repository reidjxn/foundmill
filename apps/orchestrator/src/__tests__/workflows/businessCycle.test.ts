/**
 * businessCycle with mocked activities: plans, dispatches agentSession children within the concurrency limit, never
 * runs two tasks with overlapping file scopes at once (AC-11.6.2), narrates and completes; stop ends it early.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, BusinessBrief, CyclePlan, SessionLaunch, SessionResult } from "../../activities";
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
}

function mockActivities(opts: { holdSessions?: boolean; stoppedBrief?: boolean; refuseAfter?: number; planned?: number; idle?: boolean; planFails?: boolean; openFailsOnce?: boolean; startFailsOnce?: boolean } = {}): { acts: Partial<Activities>; calls: Calls; release: () => void } {
  const calls: Calls = { opened: [], openInputs: [], running: new Set(), maxConcurrent: 0, overlapSeen: false, narrated: [], completed: [], failed: [], startInputs: [], idleNotes: [], started: 0 };
  const scopes = new Map(tasks.map((t) => [t.id, t.fileScope]));
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let openFailed = false;
  let startFailed = false;
  const acts: Partial<Activities> = {
    async loadBrief() {
      return { ...brief(), agentsStopped: opts.stoppedBrief ?? false };
    },
    async planCycle({ brief: b }) {
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
      return { cycleId: input.cycleId ?? id(900), eventId: id(901) };
    },
    async openSession(input) {
      const { taskId, agentId } = input;
      calls.openInputs.push({ ...input });
      // The kill switch lands after `refuseAfter` sessions: every later dispatch is refused.
      if (opts.refuseAfter !== undefined && calls.opened.length >= opts.refuseAfter) return { sessionId: null, refused: "agents_stopped" as const, detail: "agents are stopped (kill switch)" };
      if (opts.openFailsOnce && !openFailed) {
        openFailed = true;
        throw new Error("connection reset");
      }
      calls.opened.push({ taskId, agentId });
      return { sessionId: input.sessionId ?? id(800 + calls.opened.length), refused: null, detail: null };
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
    async failCycle(input) {
      calls.failed.push(input);
      return { eventId: id(903), inboxItemId: id(556) };
    },
    async noteIdleCycle({ summary }) {
      calls.idleNotes.push(summary);
      return { inboxItemId: id(557) };
    },
  };
  return { acts, calls, release };
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

  it("opens each session without a placeholder workflow id: the row carries session:<id> and the child runs under it", async () => {
    const m = mockActivities({ planned: 1 });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const r = await client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:3`, taskQueue, args: [{ businessId: B, cycleNumber: 3, trigger: "continue" }] });
      const sessionId = String(m.calls.openInputs[0]!.sessionId);
      const child = await client.workflow.getHandle(`session:${sessionId}`).describe();
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

  it("a planner that throws closes the cycle as failed and tells the founder, instead of leaving it running (audit O-07)", async () => {
    const m = mockActivities({ planFails: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:7`, taskQueue, args: [{ businessId: B, cycleNumber: 7, trigger: "continue" }] }));
    expect(result.outcome).toBe("failed");
    expect(m.calls.completed).toHaveLength(0);
    expect(m.calls.failed).toHaveLength(1);
    expect(m.calls.failed[0]).toMatchObject({ businessId: B, cycleNumber: 7, cycleId: result.cycleId, workflowId: `cycle:${B}:7` });
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

  it("a brief that says the team is stopped dispatches nothing and records the cycle as stopped", async () => {
    const m = mockActivities({ stoppedBrief: true });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(businessCycle, { workflowId: `cycle:${B}:5`, taskQueue, args: [{ businessId: B, cycleNumber: 5, trigger: "continue" }] }));
    expect(result).toMatchObject({ outcome: "stopped", tasksDispatched: 0, costMinor: 0 });
    expect(m.calls.openInputs).toHaveLength(0);
    expect(m.calls.completed[0]).toMatchObject({ outcome: "stopped", tasksDispatched: 0 });
  });
});
