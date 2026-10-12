/**
 * agentSession activities on PGlite + the replay sandbox: credential assertion before launch (AC-11.6.6), streaming to
 * as:{sessionId}, loop detection (same call 3× → failed), approval holds released by a decision, pause/resume through
 * the control bus with a fake clock, and the task/agent/event bookkeeping of finishSession.
 */
import { repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { LongLivedCredentialError, MockSandboxProvider, RECORDINGS, findRecording } from "@foundmill/sandbox";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSandboxEnv, createSessionActivities, mcpToolNames, recordingForTask, toolRefs } from "../activities/session";
import { FakeClock } from "../clock";
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
    // One MCP server per connector the gateway serves: never the session workspace (`sandbox`), which would 404.
    expect(launch.mcpConnectors).not.toContain("sandbox");
    expect(launch.allowedTools).toContain("platform:list_tasks");
    expect(launch.envNames).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(launch)).not.toMatch(/sk-ant|Bearer|token/i);
  });

  it("tool grants map to the real tools behind them: gateway refs and SDK MCP names", () => {
    // A tool name, a template capability, a wildcard; the session workspace and a later-phase connector get nothing.
    const grants = [{ connectorKey: "gmail", tools: ["send_message", "threads.read"] }, { connectorKey: "github", tools: ["*"] }, { connectorKey: "sandbox", tools: ["read_file"] }, { connectorKey: "figma", tools: ["files.read"] }];
    expect(toolRefs(grants)).toEqual(["gmail:send_message", "gmail:list_messages", "gmail:get_message", "gmail:list_labels", "github:*"]);
    expect(mcpToolNames(grants)).toEqual(["mcp__gmail__send_message", "mcp__gmail__list_messages", "mcp__gmail__get_message", "mcp__gmail__list_labels", "mcp__github"]);
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
