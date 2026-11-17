/**
 * agentSession activities on PGlite + the replay sandbox: credential assertion before launch (AC-11.6.6), streaming to
 * as:{sessionId}, loop detection (same call 3× → failed), approval holds released by a decision, pause/resume through
 * the control bus with a fake clock, and the task/agent/event bookkeeping of finishSession.
 *
 * Waiting for the founder is bounded: an undecided approval ends the session `blocked` after APPROVAL_WAIT_MINUTES and
 * a long pause parks the run (the next run continues the replay where it stopped). Nothing a session does un-pauses an
 * agent, a run the platform cancels (a deploy) is not a Stop (its task runs again), and a Redis outage never takes a
 * session (or the worker) down.
 */
import { repos, resumeBusinessAgents } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { LongLivedCredentialError, MockSandboxProvider, RECORDINGS, findRecording } from "@foundmill/sandbox";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AGENTS_STOPPED_REASON, buildSandboxEnv, createSessionActivities, mcpToolNames, recordingForTask, STOP_CHECK_MS, toolRefs } from "../activities/session";
import type { SessionResult } from "../activities/types";
import { FakeClock } from "../clock";
import type { SessionControlBus } from "../control-bus";
import { openSessionRow, setupOrchestratorHarness, wait, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let acts: ReturnType<typeof createSessionActivities>;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "sess" });
  // These tests cover a paid plan's sessions; a free business runs every session on the free plan's model (WP-13 T4).
  await repos.businesses.update(t.db, t.businessId, { planTier: "pro" });
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
    const refs = toolRefs(grants);
    expect(refs.slice(0, 4)).toEqual(["gmail:send_message", "gmail:list_messages", "gmail:get_message", "gmail:list_labels"]);
    // GitHub's wildcard is spelled out without the platform's route-only tools (its checkout's download_archive).
    const github = refs.slice(4);
    expect(github).toContain("github:read_file");
    expect(github.every((r) => r.startsWith("github:") && r !== "github:*")).toBe(true);
    expect(github).not.toContain("github:download_archive");
    const names = mcpToolNames(grants);
    expect(names.slice(0, 4)).toEqual(["mcp__gmail__send_message", "mcp__gmail__list_messages", "mcp__gmail__get_message", "mcp__gmail__list_labels"]);
    expect(names.slice(4)).toEqual(github.map((r) => `mcp__github__${r.slice("github:".length)}`));
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

  it("a replayed UI change gets a design check labeled simulated, with no screenshot and no review (item 13)", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "northwind-bundle-picker" };
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("done");
    const checked = await repos.events.list(t.db, t.businessId, { type: "task.design_checked", limit: 20 });
    const mine = checked.items.find((e) => (e.payload as { sessionId?: string }).sessionId === sessionId);
    expect(mine).toBeDefined();
    const record = (mine!.payload as { result: { status: string; before: unknown[]; after: unknown[]; fixes: unknown[]; pages: string[] } }).result;
    expect(record).toMatchObject({ status: "simulated", before: [], after: [], fixes: [], pages: ["/"] });
    const notes = (await readSessionEvents(t.redis, sessionId)).map((e) => e.event).filter((e) => e.kind === "note");
    expect(notes.some((n) => n.kind === "note" && /^Design check simulated, not done/.test(n.text))).toBe(true);
    await acts.finishSession(input, launch, result);
  });

  it("a replay that changes no UI file gets no design check", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const result = await acts.runAgentSession(input, launch);
    const checked = await repos.events.list(t.db, t.businessId, { type: "task.design_checked", limit: 20 });
    expect(checked.items.some((e) => (e.payload as { sessionId?: string }).sessionId === sessionId)).toBe(false);
    await acts.finishSession(input, launch, result);
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

  it("a hold the replay resolves by itself leaves no approvals row pending, and the session does not end as waiting on it (audit #241)", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-annual-plan-discount" };
    const result = await acts.runAgentSession(input, launch);
    // The recording ends blocked on a hard gate afterwards (Stripe's terms), never on the approval that was granted.
    expect(result.outcome).toBe("blocked");
    expect(result.blockedReason).toBe("dependency");
    expect(result.approvalId).toBeNull();
    const mine = (await repos.approvals.pending(t.db, t.businessId)).filter((a) => a.sessionId === sessionId);
    expect(mine).toEqual([]);
    const rows = (await repos.approvals.list(t.db, t.businessId, { limit: 50 })).items.filter((a) => a.sessionId === sessionId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.resolvedAt !== null && a.outcome === "approved")).toBe(true);
    await acts.finishSession(input, launch, result);
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
      expect(parked).toMatchObject({ outcome: "stopped", reason: "paused", parked: { cursor: expect.stringMatching(/^ledgerly-webhook-retry@\d+$/), carry: [], lastSeq: 0 } });
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

const resultOf = (outcome: SessionResult["outcome"], blockedReason: SessionResult["blockedReason"], reason: string = outcome): SessionResult => ({ outcome, reason, blockedReason, approvalId: null, progress: { planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: false, merged: false, phase: null, progress: 0.5, etaAt: null, at: null }, eventsEmitted: 3, toolCalls: 1, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 0, durationMs: 60_000, prNumber: null, summary: outcome, providerSessionId: null });

describe("a session the platform cancelled is not a Stop", () => {
  it("returns its task to ready for a later round of work (or keeps the founder's pause), where a Stop leaves it stopped", async () => {
    for (const [before, reason, expected] of [["running", "cancelled", "ready"], ["paused", "cancelled", "paused"], ["running", "founder_stop", "stopped"]] as const) {
      const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
      const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
      const launch = await acts.prepareSession(input);
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, before, { force: true });
      const finish = await acts.finishSession(input, launch, resultOf("stopped", "stopped", reason));
      expect(finish.taskStatus).toBe(expected);
      expect((await repos.tasks.get(t.db, t.businessId, t.codeTaskId)).status).toBe(expected);
      expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("idle");
    }
    await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
  });

  it("a mock replay the worker cancels ends stopped with the cancel reason", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const localActs = createSessionActivities({ ...t.deps, clock, sandbox: async () => ({ provider: clockedProvider(clock), mode: "mock" as const, fellBackFrom: null }) });
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const env = new MockActivityEnvironment();
    const run = env.run(localActs.runAgentSession, input, launch);
    await vi.waitFor(async () => {
      if ((await readSessionEvents(t.redis, sessionId)).length < 2) throw new Error("not started");
    }, { timeout: 5_000, interval: 25 });
    env.cancel();
    const result = (await run) as SessionResult;
    expect(result).toMatchObject({ outcome: "stopped", reason: "cancelled", blockedReason: "stopped" });
    expect((await acts.finishSession(input, launch, result)).taskStatus).toBe("ready");
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
  });
});

describe("a paused agent stays paused (O-06)", () => {
  it("prepareSession refuses a paused agent with a non-retryable AgentPaused failure, so the session ends stopped, not failed", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
    try {
      await expect(acts.prepareSession({ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId })).rejects.toMatchObject({ type: "AgentPaused", nonRetryable: true });
    } finally {
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });

  it("a session ending done, blocked, failed or stopped never un-pauses its agent, and a stopped one leaves the task paused for the next round of work", async () => {
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

  it("a run whose team was stopped while it waited for a slot ends stopped before creating anything, even with its agent not paused (SEC3)", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    const create = vi.spyOn(t.sandbox, "create");
    // Stop all agents committed after prepareSession; its signal never reached this session.
    await repos.businesses.setAgentsStopped(t.db, t.businessId, { reason: "kill_switch" });
    try {
      const result = await acts.runAgentSession(input, launch);
      expect(result).toMatchObject({ outcome: "stopped", reason: AGENTS_STOPPED_REASON, blockedReason: "stopped" });
      expect(create).not.toHaveBeenCalled();
      expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("idle");
    } finally {
      create.mockRestore();
      await resumeBusinessAgents(t.db, t.businessId);
    }
  });

  it("a pause that lands after the run read its agent idle is never overwritten by marking it working: the run ends before anything starts (SEC3)", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    const idle = await repos.agents.get(t.db, t.businessId, t.workerId);
    expect(idle.status).toBe("idle");
    // The run reads the agent idle; the pause (Stop all agents committing, a wage cap) is written right after.
    const read = vi.spyOn(repos.agents, "get").mockResolvedValueOnce(idle);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused", { pausedReason: "wage_cap" });
    const create = vi.spyOn(t.sandbox, "create");
    try {
      const result = await acts.runAgentSession(input, launch);
      expect(result).toMatchObject({ outcome: "stopped", reason: "agent paused", blockedReason: "stopped" });
      expect(create).not.toHaveBeenCalled();
      expect(await repos.agents.get(t.db, t.businessId, t.workerId)).toMatchObject({ status: "paused", pausedReason: "wage_cap" });
      const changes = await repos.events.list(t.db, t.businessId, { type: "agent.health_changed", limit: 20 });
      expect(changes.items.some((e) => (e.payload as { sessionId?: string }).sessionId === sessionId)).toBe(false);
    } finally {
      read.mockRestore();
      create.mockRestore();
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });

  it("a running session re-reads the stop flag and stops itself once the team is stopped, with no signal; the task waits paused (SEC3)", async () => {
    const clock = new FakeClock();
    const deps = { ...t.deps, clock, sandbox: async () => ({ provider: clockedProvider(clock), mode: "mock" as const, fellBackFrom: null }) };
    const localActs = createSessionActivities(deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await localActs.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const recording = findRecording("ledgerly-webhook-retry")!;
    expect(recording.events.at(-1)!.tMs).toBeGreaterThan(2 * STOP_CHECK_MS);
    const run = localActs.runAgentSession(input, launch);
    await vi.waitFor(async () => {
      if ((await readSessionEvents(t.redis, sessionId)).length < 2) throw new Error("not started");
    }, { timeout: 5_000, interval: 25 });
    // A credits stop (or a revoked key) signals nothing: only the flag changes.
    await repos.businesses.setAgentsStopped(t.db, t.businessId, { reason: "credits_exhausted" });
    try {
      await clock.advance(STOP_CHECK_MS);
      await wait(600); // two control polls: the check is due
      const result = await drive(clock, run);
      expect(result).toMatchObject({ outcome: "stopped", reason: AGENTS_STOPPED_REASON });
      // Stopped at the first check, about 5 s into a 19 s recording: most of it never played.
      expect(result.eventsEmitted).toBeLessThan(recording.events.length / 2);
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "running", { force: true });
      const finish = await localActs.finishSession(input, launch, result);
      expect(finish.taskStatus).toBe("paused");
    } finally {
      await resumeBusinessAgents(t.db, t.businessId);
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
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

  it("a pause that lands while the session settles is kept: the health write never undoes it", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "failing");
    // Stop all agents lands after finishSession read the agent (failing), before it writes the agent's health.
    const listSessions = repos.agents.listSessions.bind(repos.agents);
    const spy = vi.spyOn(repos.agents, "listSessions").mockImplementationOnce(async (...args) => {
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
      return listSessions(...args);
    });
    try {
      const finish = await acts.finishSession(input, launch, resultOf("done", null));
      expect(spy).toHaveBeenCalled();
      expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("paused");
      expect(finish.healthChanged).toBe(false);
    } finally {
      spy.mockRestore();
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
      await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
    }
  });

  it("a pause that lands while the run starts is kept: marking the agent working never undoes it", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    // Stop all agents lands after the run read the agent (idle), before it marks it working.
    const drain = t.control.drain.bind(t.control);
    const spy = vi.spyOn(t.control, "drain").mockImplementationOnce(async (id) => {
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "paused");
      return drain(id);
    });
    try {
      await acts.runAgentSession(input, launch);
      expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("paused");
      const changes = await repos.events.list(t.db, t.businessId, { type: "agent.health_changed", limit: 20 });
      expect(changes.items.some((e) => (e.payload as { sessionId?: string }).sessionId === sessionId)).toBe(false);
    } finally {
      spy.mockRestore();
      await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    }
  });
});

describe("what a session books for its sandbox and its model (BILL-09, BILL-11)", () => {
  const live = (sandboxMs: number, extra: Partial<SessionResult> = {}): SessionResult => ({ outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: false, merged: false, phase: null, progress: 1, etaAt: null, at: null }, eventsEmitted: 1, toolCalls: 1, toolFailures: 0, tokensIn: 400, tokensOut: 100, costMinor: 0, costMicroMinor: 300_000, durationMs: 3_600_000, sandboxMs, prNumber: null, summary: "done", providerSessionId: null, ...extra });
  const run = async (sandboxMode: "e2b" | "docker", result: SessionResult) => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), sandboxMode };
    await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "running", { force: true });
    await acts.finishSession(input, launch, result);
    await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
    return (await repos.usage.list(t.db, t.businessId, { sessionId, limit: 10 })).items;
  };

  it("an E2B sandbox is priced for the time it ran, in US dollars, and billed to credits (the platform pays E2B)", async () => {
    const rows = await run("e2b", live(150_000));
    const sandbox = rows.find((u) => u.kind === "sandbox")!;
    // 150 s at 3,025 millionths of a cent a second; the session itself lasted an hour but held no sandbox for it.
    expect(sandbox).toMatchObject({ quantity: 3, unit: "minutes", currency: "USD", billedTo: "credits" });
    expect(Number(sandbox.costMicroMinor)).toBe(453_750);
    expect(sandbox.details).toMatchObject({ label: "Estimate", sandboxMode: "e2b" });
  });

  it("a Docker sandbox costs nothing, and a live session that never needed a sandbox books none", async () => {
    const docker = await run("docker", live(90_000));
    expect(Number(docker.find((u) => u.kind === "sandbox")!.costMicroMinor)).toBe(0);
    const none = await run("e2b", live(0));
    expect(none.some((u) => u.kind === "sandbox")).toBe(false);
  });

  it("the model's exact cost is booked, not its rounding to whole cents", async () => {
    const rows = await run("e2b", live(0));
    const tokens = rows.find((u) => u.kind === "tokens")!;
    expect(tokens).toMatchObject({ quantity: 500, currency: "USD" });
    expect(Number(tokens.costMicroMinor)).toBe(300_000);
    expect(Number(tokens.costMinor)).toBe(0);
  });
});
