/**
 * businessCycle with mocked activities: plans, dispatches agentSession children within the concurrency limit, never
 * runs two tasks with overlapping file scopes at once (AC-11.6.2), narrates and completes; stop ends it early.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, BusinessBrief, CyclePlan, SessionLaunch, SessionResult } from "../../activities";
import { businessCycle, fileScopesOverlap, stopSignal } from "../../workflows";
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
  running: Set<string>;
  maxConcurrent: number;
  overlapSeen: boolean;
  narrated: string[][];
  completed: Record<string, unknown>[];
  started: number;
}

function mockActivities(opts: { holdSessions?: boolean } = {}): { acts: Partial<Activities>; calls: Calls; release: () => void } {
  const calls: Calls = { opened: [], running: new Set(), maxConcurrent: 0, overlapSeen: false, narrated: [], completed: [], started: 0 };
  const scopes = new Map(tasks.map((t) => [t.id, t.fileScope]));
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const acts: Partial<Activities> = {
    async loadBrief() {
      return brief();
    },
    async planCycle() {
      return plan();
    },
    async startCycle() {
      calls.started += 1;
      return { cycleId: id(900), eventId: id(901) };
    },
    async openSession({ taskId, agentId }) {
      calls.opened.push({ taskId, agentId });
      return { sessionId: `${taskId.slice(0, 8)}-0000-4000-8000-${String(calls.opened.length).padStart(12, "0")}` };
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
    expect(m.calls.opened.map((o) => o.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
    expect(m.calls.overlapSeen).toBe(false);
    expect(m.calls.maxConcurrent).toBeLessThanOrEqual(3);
    expect(m.calls.narrated[0]).toEqual([id(777), id(777), id(777), id(777)]);
    expect(m.calls.completed[0]).toMatchObject({ cycleId: id(900), outcome: "completed", tasksDispatched: 4, tasksCompleted: 4, inboxItemIds: [id(555)], currency: "USD" });
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
});
