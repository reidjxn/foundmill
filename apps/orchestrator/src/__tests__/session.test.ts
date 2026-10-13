/**
 * agentSession activities on PGlite + the replay sandbox: credential assertion before launch (AC-11.6.6), streaming to
 * as:{sessionId}, loop detection (same call 3× → failed), approval holds released by a decision, pause/resume through
 * the control bus with a fake clock, and the task/agent/event bookkeeping of finishSession.
 *
 * Waiting for the founder is bounded: an undecided approval ends the session `blocked` after APPROVAL_WAIT_MINUTES and
 * a long pause parks the run (the next run continues the replay where it stopped). Nothing a session does un-pauses an
 * agent, and a Redis outage never takes a session (or the worker) down.
 */
import { repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { LongLivedCredentialError, MockSandboxProvider, RECORDINGS, findRecording } from "@foundmill/sandbox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSandboxEnv, createSessionActivities, mcpToolNames, recordingForTask, toolRefs } from "../activities/session";
import type { SessionResult } from "../activities/types";
import { FakeClock } from "../clock";
import type { SessionControlBus } from "../control-bus";
import { openSessionRow, setupOrchestratorHarness, wait, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let acts: ReturnType<typeof createSessionActivities>;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "sess" });
  acts = createSessionActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

describe("credential assertion before launch (AC-11.6.6)", () => {
  it("accepts the short-lived session env and rejects long-lived credentials by name or value", () => {
    const base = { businessId: "b", agentId: "a", taskId: "t", sessionId: "s", gatewayUrl: "http://gateway" };
    expect(Object.keys(buildSandboxEnv(base))).toEqual(["FM_BUSINESS_ID", "FM_AGENT_ID", "FM_TASK_ID", "FM_SESSION_ID", "FM_GATEWAY_URL"]);
    expect(() => buildSandboxEnv({ ...base, extra: { ANTHROPIC_API_KEY: "sk-ant-api03-" + "x".repeat(60) } })).toThrow(LongLivedCredentialError);
    expect(() => buildSandboxEnv({ ...base, extra: { STRIPE_SECRET_KEY: "whatever" } })).toThrow(LongLivedCredentialError);
    expect(() => buildSandboxEnv({ ...base, extra: { DATABASE_URL: "postgres://user:pass@host/db" } })).toThrow(LongLivedCredentialError);
  });

  it("prepareSession returns launch facts without secrets and picks a recording of the task's kind", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const launch = await acts.prepareSession({ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId });
    expect(launch.sandboxMode).toBe("mock");
    expect(launch.modelKey).toBe("sonnet");
    expect(launch.recordingKey).toBeTruthy();
    expect(findRecording(launch.recordingKey!)?.taskKind).toBe("code");
    // Every ref must satisfy the gateway's ToolRef grammar (connector:tool, connector:* or *).
    expect(launch.allowedTools.every((ref) => /^[a-z][a-z0-9_]{1,40}:(\*|[a-zA-Z][a-zA-Z0-9_]{0,120})$/.test(ref))).toBe(true);
    expect(launch.mcpConnectors.length).toBeGreaterThan(0);
    expect(launch.envNames).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(launch)).not.toMatch(/sk-ant|Bearer|token/i);
  });

  it("tool grants map to gateway refs and SDK MCP names", () => {
    const grants = [{ connectorKey: "gmail", tools: ["send_message", "search"] }, { connectorKey: "github", tools: ["*"] }];
    expect(toolRefs(grants)).toEqual(["gmail:send_message", "gmail:search", "github:*"]);
    expect(mcpToolNames(grants)).toEqual(["mcp__gmail__send_message", "mcp__gmail__search", "mcp__github"]);
    expect(recordingForTask({ id: "x", kind: "research" })).toBe("northwind-supplier-shortlist");
  });
});

describe("runAgentSession (mock replay)", () => {
  it("streams every recorded event to as:{sessionId}, persists progress and finishes the task", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("done");
    const recording = findRecording("ledgerly-webhook-retry")!;
    const stream = await readSessionEvents(t.redis, sessionId);
    // system start note + every recorded event
    expect(stream.length).toBeGreaterThanOrEqual(recording.events.length + 1);
    expect(stream[0]!.event.kind).toBe("note");
    expect(result.progress.progress).toBeGreaterThan(0.5);
    expect(result.toolCalls).toBeGreaterThan(0);
    const finish = await acts.finishSession(input, launch, result);
    expect(["done", "review"]).toContain(finish.taskStatus);
    const task = await repos.tasks.get(t.db, t.businessId, t.codeTaskId);
    expect(task.status).toBe(finish.taskStatus);
    expect(Number(task.progress)).toBeGreaterThan(0);
    const session = await repos.agents.getSession(t.db, t.businessId, sessionId);
    expect(session.endedAt).not.toBeNull();
    expect(session.outcome).toBe("done");
    const usage = await repos.usage.list(t.db, t.businessId, { sessionId, limit: 10 });
    expect(usage.items.some((u) => u.kind === "sandbox")).toBe(true);
    const completed = await repos.events.list(t.db, t.businessId, { type: "task.completed", limit: 5 });
    expect(completed.items.some((e) => (e.payload as { sessionId: string }).sessionId === sessionId)).toBe(true);
  });

  it("fails the session when the same call repeats three times and marks the agent failing", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-flaky-import-test" };
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("failed");
    expect(result.blockedReason).toBe("loop_detected");
    const stream = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(stream.some((r) => r.event.kind === "note" && r.event.source === "system" && /Loop detected/.test(r.event.text))).toBe(true);
    const finish = await acts.finishSession(input, launch, result);
    expect(finish.taskStatus).toBe("failed");
    expect(finish.healthChanged).toBe(true);
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("failing");
    const blocked = await repos.events.list(t.db, t.businessId, { type: "task.blocked", limit: 5 });
    expect(blocked.items.some((e) => (e.payload as { reason: string; sessionId: string }).sessionId === sessionId && (e.payload as { reason: string }).reason === "loop_detected")).toBe(true);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
  });

  it("an approval hold creates an approvals row + approval.requested and continues on the decision command", async () => {
    // The usage-index recording holds with no auto-resolve: a real founder decision is needed.
    const provider = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: "as_recorded", recordings: RECORDINGS });
    const local = await setupOrchestratorHarness({ prefix: "hold" });
    try {
      const deps = { ...local.deps, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-usage-index" };
      const run = localActs.runAgentSession(input, launch);
      let approvalId: string | null = null;
      await vi.waitFor(async () => {
        const pending = await repos.approvals.pending(local.db, local.businessId);
        const mine = pending.find((a) => a.sessionId === sessionId);
        if (!mine) throw new Error("no approval yet");
        approvalId = mine.id;
      }, { timeout: 10_000, interval: 50 });
      const requested = await repos.events.list(local.db, local.businessId, { type: "approval.requested", limit: 5 });
      expect(requested.items.some((e) => (e.payload as { approvalId: string }).approvalId === approvalId)).toBe(true);
      await local.control.post(sessionId, { kind: "decision", approvalId: approvalId!, outcome: "approved", by: local.fixture.ownerId });
      const result = await run;
      expect(["done", "blocked"]).toContain(result.outcome);
      expect((await repos.approvals.get(local.db, local.businessId, approvalId!)).outcome).toBe("approved");
      const resolved = await repos.events.list(local.db, local.businessId, { type: "approval.resolved", limit: 5 });
      expect(resolved.items.length).toBeGreaterThan(0);
    } finally {
      await local.close();
    }
  });

  it("a hold whose decision type Team › Responsibilities delegates to an agent is approved by it and the replay goes on (TPD-04)", async () => {
    // The coupon hold waits for a decision ("wait"): only the delegated agent's approval can release it.
    const provider = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: "wait", recordings: RECORDINGS });
    const local = await setupOrchestratorHarness({ prefix: "delegated" });
    try {
      await repos.departments.update(local.db, local.businessId, local.fixture.departmentId, { approvers: [{ decisionType: "spend_above_threshold", handler: { kind: "agent", id: local.chiefId } }] });
      const deps = { ...local.deps, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-annual-plan-discount" };
      const result = await localActs.runAgentSession(input, launch);
      // It ran past the coupon to the hard gate (accepting terms is never delegated), never waiting for the founder.
      expect(result.blockedReason).not.toBe("awaiting_approval");
      const mine = (await repos.approvals.list(local.db, local.businessId, { agentId: local.workerId, limit: 10 })).items.filter((a) => a.sessionId === sessionId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ tool: "create_coupon", decisionType: "spend_above_threshold", handlerKind: "agent", handlerId: local.chiefId, outcome: "approved", byKind: "agent", byId: local.chiefId });
      const requested = await repos.events.list(local.db, local.businessId, { type: "approval.requested", limit: 20 });
      expect(requested.items.some((e) => (e.payload as { approvalId: string }).approvalId === mine[0]!.id)).toBe(false);
      const resolved = await repos.events.list(local.db, local.businessId, { type: "approval.resolved", limit: 20 });
      expect(resolved.items.find((e) => (e.payload as { approvalId: string }).approvalId === mine[0]!.id)?.payload).toMatchObject({ outcome: "approved", resolvedBy: { kind: "agent", id: local.chiefId } });
    } finally {
      await local.close();
    }
  });

  it("pause holds the replay and resume continues it; a Nudge appears in the log (AC-11.6.4)", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const provider = new MockSandboxProvider({ speed: 1, autoplay: false, holds: { autoResolveAfterMs: 1 }, recordings: RECORDINGS, sleep: (ms, signal) => clock.sleep(ms, signal).catch(() => undefined), now: () => clock.now() });
    const local = await setupOrchestratorHarness({ prefix: "pause" });
    try {
      const deps = { ...local.deps, clock, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
      const recording = findRecording("ledgerly-webhook-retry")!;
      const run = localActs.runAgentSession(input, launch);
      // t=0 events are emitted immediately; the rest wait on the fake clock.
      await vi.waitFor(async () => {
        const n = (await readSessionEvents(local.redis, sessionId)).length;
        if (n < 2) throw new Error("not started");
      }, { timeout: 5_000, interval: 25 });
      await local.control.post(sessionId, { kind: "pause", by: local.fixture.ownerId });
      await local.control.post(sessionId, { kind: "shout", message: "Focus on tests", preset: "focus_tests", by: local.fixture.ownerId });
      await wait(600); // two control polls
      const pausedCount = (await readSessionEvents(local.redis, sessionId)).length;
      const notes = await readSessionEvents(local.redis, sessionId, { kinds: ["note"] });
      expect(notes.some((r) => r.event.kind === "note" && r.event.source === "shout" && r.event.text === "Focus on tests")).toBe(true);
      expect(notes.some((r) => r.event.kind === "note" && /Paused/.test(r.event.text))).toBe(true);
      // Time passes while paused: nothing new from the recording.
      await clock.advance(recording.events[recording.events.length - 1]!.tMs + 1_000);
      await wait(300);
      const stillPaused = (await readSessionEvents(local.redis, sessionId)).length;
      expect(stillPaused).toBe(pausedCount);
      await local.control.post(sessionId, { kind: "resume", by: local.fixture.ownerId });
      await wait(600);
      // After resume the replay re-waits on the clock from where it stopped; push time forward until it finishes.
      for (let i = 0; i < 40; i++) {
        await clock.advance(5_000);
        await wait(20);
      }
      const result = await run;
      expect(result.outcome).toBe("done");
      const after = await readSessionEvents(local.redis, sessionId);
      expect(after.length).toBeGreaterThan(stillPaused);
      expect(after.some((r) => r.event.kind === "note" && /Resumed/.test(r.event.text))).toBe(true);
    } finally {
      await local.close();
    }
  });

  it("stop ends the session as stopped", async () => {
    const clock = new FakeClock();
    const provider = new MockSandboxProvider({ speed: 1, autoplay: false, holds: { autoResolveAfterMs: 1 }, recordings: RECORDINGS, sleep: (ms, signal) => clock.sleep(ms, signal).catch(() => undefined), now: () => clock.now() });
    const deps = { ...t.deps, clock, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
    const localActs = createSessionActivities(deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const run = localActs.runAgentSession(input, launch);
    await wait(100);
    await t.control.post(sessionId, { kind: "stop", reason: "founder_stop", by: t.fixture.ownerId });
    const result = await run;
    expect(result.outcome).toBe("stopped");
    expect(result.reason).toBe("founder_stop");
    const finish = await localActs.finishSession(input, launch, result);
    expect(finish.taskStatus).toBe("stopped");
  });
});

/** A replay on the fake clock: recorded gaps wait for `clock.advance`. */
const clockedProvider = (clock: FakeClock, holds: "as_recorded" | { autoResolveAfterMs: number } = { autoResolveAfterMs: 1 }) =>
  new MockSandboxProvider({ speed: 1, autoplay: false, holds, recordings: RECORDINGS, sleep: (ms, signal) => clock.sleep(ms, signal).catch(() => undefined), now: () => clock.now() });

/** Push the fake clock forward until `run` settles. */
async function drive<T>(clock: FakeClock, run: Promise<T>): Promise<T> {
  let settled = false;
  void run.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 80 && !settled; i++) {
    await clock.advance(5_000);
    await wait(20);
  }
  return run;
}

describe("waiting for the founder never holds a slot for long", () => {
  it("an approval left undecided past APPROVAL_WAIT_MINUTES ends the session blocked; the approval stays open (contract 3)", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    // The usage-index recording holds with no auto-resolve: only a founder decision would release it.
    const provider = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: "as_recorded", recordings: RECORDINGS });
    const local = await setupOrchestratorHarness({ prefix: "wait" });
    try {
      const deps = { ...local.deps, clock, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-usage-index" };
      const run = localActs.runAgentSession(input, launch);
      let settled = false;
      void run.then(() => (settled = true));
      let approvalId = "";
      await vi.waitFor(async () => {
        const mine = (await repos.approvals.pending(local.db, local.businessId)).find((a) => a.sessionId === sessionId);
        if (!mine) throw new Error("no approval yet");
        approvalId = mine.id;
      }, { timeout: 10_000, interval: 50 });
      await wait(400); // a control poll sees the hold
      await clock.advance(29 * 60_000);
      await wait(500);
      expect(settled).toBe(false);
      await clock.advance(2 * 60_000);
      const result = await run;
      expect(result).toMatchObject({ outcome: "blocked", blockedReason: "awaiting_approval", approvalId });
      expect((await repos.approvals.get(local.db, local.businessId, approvalId)).outcome).toBeNull();
      const notes = await readSessionEvents(local.redis, sessionId, { kinds: ["note"] });
      expect(notes.some((r) => r.event.kind === "note" && /^No decision on the pending approval after 30 minutes/.test(r.event.text))).toBe(true);
      const finish = await localActs.finishSession(input, launch, result);
      expect(finish.taskStatus).toBe("blocked");
      const blocked = await repos.events.list(local.db, local.businessId, { type: "task.blocked", limit: 5 });
      expect(blocked.items.find((e) => (e.payload as { sessionId: string }).sessionId === sessionId)?.payload).toMatchObject({ reason: "awaiting_approval", approvalId });
    } finally {
      await local.close();
    }
  });

  it("a pause that outlasts SESSION_PAUSE_HOLD_MINUTES parks the run; the next run plays every remaining event once and ignores stale commands", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const provider = clockedProvider(clock);
    const local = await setupOrchestratorHarness({ prefix: "park" });
    try {
      const deps = { ...local.deps, clock, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
      const recording = findRecording("ledgerly-webhook-retry")!;
      const first = localActs.runAgentSession(input, launch, null, { fromSeq: 0, resume: null });
      // t=0 events play at once; the rest wait on the fake clock.
      await vi.waitFor(async () => {
        if ((await readSessionEvents(local.redis, sessionId)).length < 2) throw new Error("not started");
      }, { timeout: 5_000, interval: 25 });
      await local.control.post(sessionId, { kind: "pause", by: local.fixture.ownerId, seq: 0 });
      await wait(600);
      await clock.advance(11 * 60_000);
      const parked = await first;
      expect(parked).toMatchObject({ outcome: "stopped", reason: "paused", parked: { cursor: expect.stringMatching(/^ledgerly-webhook-retry@\d+$/), carry: [] } });
      const index = Number(parked.parked!.cursor!.split("@")[1]);
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(recording.events.length);

      // A pause posted for the parked run (seq 0) must not pause the next one, which starts at seq 1.
      await local.control.post(sessionId, { kind: "pause", by: local.fixture.ownerId, seq: 0 });
      const second = await drive(clock, localActs.runAgentSession(input, launch, null, { fromSeq: 1, resume: { cursor: parked.parked!.cursor, progress: parked.progress } }));
      expect(second.outcome).toBe("done");
      expect(second.progress.progress).toBeGreaterThanOrEqual(parked.progress.progress);
      // Every recorded tool call reached the stream exactly once across the two runs.
      const calls = (await readSessionEvents(local.redis, sessionId, { kinds: ["tool_call"] })).length;
      expect(calls).toBe(recording.events.filter((e) => (e.event as { kind: string }).kind === "tool_call").length);
      const notes = await readSessionEvents(local.redis, sessionId, { kinds: ["note"] });
      expect(notes.some((r) => r.event.kind === "note" && /^Paused for 10 minutes: the session saves its work/.test(r.event.text))).toBe(true);
      expect(notes.some((r) => r.event.kind === "note" && /^Session resumed for /.test(r.event.text))).toBe(true);
    } finally {
      await local.close();
    }
  });
});

describe("a Redis outage never takes a session or the worker down (O-10)", () => {
  it("failed control polls are logged and retried; the session finishes and no rejection goes unhandled", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const provider = clockedProvider(clock);
    const local = await setupOrchestratorHarness({ prefix: "redis" });
    try {
      let down = true;
      const outage = () => Object.assign(new Error("Reached the max retries per request limit (which is 3)."), { name: "MaxRetriesPerRequestError" });
      const control: SessionControlBus = {
        post: (sessionId, command) => local.control.post(sessionId, command),
        drain: async (sessionId) => {
          if (down) throw outage();
          return local.control.drain(sessionId);
        },
        clear: async () => {
          throw outage();
        },
      };
      const warn = vi.fn();
      const log = Object.assign(Object.create(local.deps.log) as typeof local.deps.log, { warn });
      const deps = { ...local.deps, clock, control, log, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
      const localActs = createSessionActivities(deps);
      const sessionId = await openSessionRow(local, local.workerId, local.codeTaskId);
      const input = { businessId: local.businessId, agentId: local.workerId, taskId: local.codeTaskId, sessionId };
      const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
      const run = localActs.runAgentSession(input, launch);
      await wait(800); // three polls fail
      down = false;
      await local.control.post(sessionId, { kind: "shout", message: "Back online" });
      const result = await drive(clock, run);
      expect(result.outcome).toBe("done");
      expect(warn.mock.calls.filter(([, msg]) => /session control poll failed/.test(String(msg))).length).toBeGreaterThanOrEqual(2);
      expect(warn.mock.calls.some(([, msg]) => /control list could not be cleared/.test(String(msg)))).toBe(true);
      const notes = await readSessionEvents(local.redis, sessionId, { kinds: ["note"] });
      expect(notes.some((r) => r.event.kind === "note" && r.event.source === "shout" && r.event.text === "Back online")).toBe(true);
    } finally {
      await local.close();
    }
  });
});

describe("a paused agent stays paused (O-06)", () => {
  const resultOf = (outcome: SessionResult["outcome"], blockedReason: SessionResult["blockedReason"]): SessionResult => ({ outcome, reason: outcome, blockedReason, approvalId: null, progress: { planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: false, merged: false, phase: null, progress: 0.5, etaAt: null, at: null }, eventsEmitted: 3, toolCalls: 1, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 0, durationMs: 60_000, prNumber: null, summary: outcome, providerSessionId: null });

  it("prepareSession refuses a paused agent with a non-retryable AgentPaused failure, so the session ends stopped, not failed", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
    try {
      await expect(acts.prepareSession({ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId })).rejects.toMatchObject({ type: "AgentPaused", nonRetryable: true });
    } finally {
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });

  it("a session ending done, blocked, failed or stopped never un-pauses its agent, and a stopped one leaves the task paused for the next cycle", async () => {
    for (const [outcome, blockedReason] of [["done", null], ["blocked", "dependency"], ["failed", "error"], ["failed", "loop_detected"], ["stopped", "stopped"]] as const) {
      const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
      const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
      const launch = await acts.prepareSession(input);
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "running", { force: true });
      // Stop all agents (or the credits pause) lands while the session runs.
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
      const finish = await acts.finishSession(input, launch, resultOf(outcome, blockedReason));
      expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("paused");
      expect(finish.healthChanged).toBe(false);
      if (outcome === "stopped") expect(finish.taskStatus).toBe("paused");
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
    await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
  });

  it("a session whose task was handed to another agent while it ran leaves the task as it now is (TPD-09)", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    try {
      // Released or reassigned mid-session: the task went back to ready under another agent.
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
      await repos.tasks.reassign(t.db, t.businessId, t.codeTaskId, t.chiefId);
      const finish = await acts.finishSession(input, launch, resultOf("failed", "error"));
      expect(finish.taskStatus).toBe("ready");
      expect(await repos.tasks.get(t.db, t.businessId, t.codeTaskId)).toMatchObject({ status: "ready", assigneeAgentId: t.chiefId });
      // The session row still records how it ended.
      expect((await repos.agents.getSession(t.db, t.businessId, sessionId)).outcome).toBe("failed");
    } finally {
      await repos.tasks.reassign(t.db, t.businessId, t.codeTaskId, t.workerId);
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });

  it("a run whose agent was paused while it waited for a slot ends stopped before creating anything", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    const create = vi.spyOn(t.sandbox, "create");
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
    try {
      const result = await acts.runAgentSession(input, launch);
      expect(result).toMatchObject({ outcome: "stopped", reason: "agent paused", blockedReason: "stopped" });
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });

  it("a stop posted while the run waited for a slot ends it before it starts", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    await t.control.post(sessionId, { kind: "stop", reason: "founder_stop", seq: 0 });
    const create = vi.spyOn(t.sandbox, "create");
    try {
      const result = await acts.runAgentSession(input, launch, null, { fromSeq: 0, resume: null });
      expect(result).toMatchObject({ outcome: "stopped", reason: "founder_stop" });
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it("an idle agent is marked working while its session runs, and idle again when it ends (VO-X2)", async () => {
    // Rows other tests opened and never ended would count as the agent's open sessions.
    for (const open of (await repos.agents.listSessions(t.db, t.businessId, { agentId: t.workerId, openOnly: true, limit: 100 })).items) await repos.agents.endSession(t.db, t.businessId, open.id, { outcome: "stopped" });
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const result = await acts.runAgentSession(input, launch);
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("healthy");
    const changes = await repos.events.list(t.db, t.businessId, { type: "agent.health_changed", limit: 10 });
    expect(changes.items.some((e) => (e.payload as { sessionId: string; from: string; to: string }).sessionId === sessionId && (e.payload as { to: string }).to === "healthy")).toBe(true);
    await acts.finishSession(input, launch, result);
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("idle");
  });
});
