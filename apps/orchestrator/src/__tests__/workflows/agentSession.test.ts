/**
 * agentSession workflow: loop detection ends the session as failed (real activities on PGlite + the replay sandbox);
 * pause/resume/shout/decision signals reach the running activity through the control bus in order, and the
 * `progress` query reports the state.
 *
 * The run activity executes on the sessions task queue only, so sessions holding every session slot never stop short
 * activities (another business's cycle, the control commands that release them); a refused start for a paused agent
 * ends `stopped`; a parked session waits for Resume in workflow code and the next run continues it.
 */
import { repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { MockSandboxProvider, RECORDINGS, findRecording } from "@foundmill/sandbox";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActivities, type Activities, type SessionCommand, type SessionLaunch, type SessionResult, type SessionRunOptions } from "../../activities";
import { AGENT_PAUSED_FAILURE, sessionTaskQueue } from "../../session-contract";
import { agentSession, hello, pauseSignal, progressQuery, resumeSignal, shoutSignal, decisionSignal, stopSignal } from "../../workflows";
import { openSessionRow, setupOrchestratorHarness, wait, type OrchestratorTestHarness } from "../harness";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
let t: OrchestratorTestHarness;
beforeAll(async () => {
  rig = await createTemporalRig();
  t = await setupOrchestratorHarness({ prefix: "wf-sess", sandbox: { recordings: RECORDINGS.filter((r) => r.key === "ledgerly-flaky-import-test") } });
});
afterAll(async () => {
  await rig?.teardown();
  await t?.close();
});

const launchStub: SessionLaunch = { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "claude-sonnet-5-5", recordingKey: "stub", allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: "agent/x", maxTurns: 1, planSteps: 2, acceptanceTests: 1 };

describe("agentSession workflow", () => {
  it("fails the session on a detected loop (same call 3×) with the real activities", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId, "session:wf");
    const activities = createActivities(t.deps);
    const outcome = await rig.run(activities, (client, taskQueue) =>
      client.workflow.execute(agentSession, { workflowId: `session:${sessionId}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId }] }),
    );
    expect(outcome.launch?.recordingKey).toBe("ledgerly-flaky-import-test");
    expect(outcome.result.outcome).toBe("failed");
    expect(outcome.result.blockedReason).toBe("loop_detected");
    expect(outcome.finish?.taskStatus).toBe("failed");
    expect((await repos.tasks.get(t.db, t.businessId, t.codeTaskId)).status).toBe("failed");
    expect((await repos.agents.get(t.db, t.businessId, t.workerId)).status).toBe("failing");
    const stream = await readSessionEvents(t.redis, sessionId);
    expect(stream.length).toBeGreaterThanOrEqual(findRecording("ledgerly-flaky-import-test")!.events.length);
    expect(stream.some((r) => r.event.kind === "note" && /Loop detected/.test(r.event.text))).toBe(true);
    await repos.agents.setStatus(t.db, t.businessId, t.workerId, "idle");
    await repos.tasks.setStatus(t.db, t.businessId, t.codeTaskId, "ready", { force: true });
    void MockSandboxProvider;
  });

  it("delivers pause / nudge / decision / resume to the running session in signal order and answers the progress query", async () => {
    const commands: SessionCommand[] = [];
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const result: SessionResult = { outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 2, planSteps: 2, acceptanceTestsPassing: 1, acceptanceTests: 1, reviewPassed: true, merged: true, phase: "done", progress: 1, etaAt: null, at: "2026-10-05T08:10:00.000Z" }, eventsEmitted: 9, toolCalls: 3, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 0, durationMs: 600_000, prNumber: 7, summary: "done", providerSessionId: "rec" };
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession() {
        await released;
        return result;
      },
      async postSessionCommand({ command }) {
        commands.push(command);
        if (command.kind === "resume") release();
      },
      async finishSession() {
        return { taskStatus: "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, async (client, taskQueue) => {
      const handle = await client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
      // Wait until the run activity is in flight, then drive it.
      for (let i = 0; i < 200; i++) {
        const snap = await handle.query(progressQuery);
        if (snap.state === "running") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await handle.signal(pauseSignal, { by: "founder" });
      await handle.signal(shoutSignal, { message: "Simplify", preset: "simplify", by: "founder" });
      await handle.signal(decisionSignal, { approvalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", outcome: "approved", by: "founder" });
      const paused = await handle.query(progressQuery);
      await handle.signal(resumeSignal, { by: "founder" });
      const r = await handle.result();
      const final = await handle.query(progressQuery);
      return { r, paused, final };
    });
    expect(outcome.paused.state).toBe("paused");
    expect(commands.map((c) => c.kind)).toEqual(["pause", "shout", "decision", "resume"]);
    expect(commands[1]).toMatchObject({ kind: "shout", message: "Simplify", preset: "simplify" });
    expect(commands[2]).toMatchObject({ kind: "decision", approvalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", outcome: "approved" });
    expect(outcome.r.result.outcome).toBe("done");
    expect(outcome.final.state).toBe("done");
    expect(outcome.final.progress).toBe(1);
    expect(outcome.final.merged).toBe(true);
  });

  it("a stop before the run starts skips the run and finishes as stopped", async () => {
    let ran = 0;
    let prepared!: () => void;
    const preparing = new Promise<void>((r) => (prepared = r));
    const activities: Partial<Activities> = {
      async prepareSession() {
        await preparing;
        return launchStub;
      },
      async runAgentSession() {
        ran += 1;
        throw new Error("must not run");
      },
      async postSessionCommand() {},
      async finishSession(_input, _launch, result) {
        return { taskStatus: result.outcome === "stopped" ? "stopped" : "failed", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, async (client, taskQueue) => {
      const handle = await client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
      await handle.signal(stopSignal, { reason: "founder_stop", by: "founder" });
      prepared();
      return handle.result();
    });
    expect(ran).toBe(0);
    expect(outcome.result.outcome).toBe("stopped");
    expect(outcome.result.reason).toBe("founder_stop");
    expect(outcome.finish?.taskStatus).toBe("stopped");
  });
});

const doneResult = (over: Partial<SessionResult> = {}): SessionResult => ({ outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 2, planSteps: 2, acceptanceTestsPassing: 1, acceptanceTests: 1, reviewPassed: true, merged: true, phase: "done", progress: 1, etaAt: null, at: null }, eventsEmitted: 4, toolCalls: 2, toolFailures: 0, tokensIn: 2, tokensOut: 1, costMinor: 1, durationMs: 60_000, prNumber: null, summary: "done", providerSessionId: null, ...over });

/** Poll a condition in real time (the time-skipping server only skips time while a test awaits a workflow result). */
async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 1_200; i++) {
    if (await check()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * A workflow's result, waited for in real time: awaiting `result()` lets the time-skipping server jump ahead, which
 * would expire the timeouts of activities these tests deliberately keep running.
 */
async function settled<T>(handle: { describe(): Promise<{ status: { name: string } }>; result(): Promise<T> }, what: string): Promise<T> {
  await until(async () => (await handle.describe()).status.name !== "RUNNING", what);
  return handle.result();
}

describe("agentSession workflow: sessions on their own task queue", () => {
  it("runs the session activity on the sessions task queue, never on the workflow's own", async () => {
    let queue = "";
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession() {
        queue = Context.current().info.taskQueue;
        return doneResult();
      },
      async postSessionCommand() {},
      async finishSession() {
        return { taskStatus: "done", eventIds: [], healthChanged: false };
      },
    };
    const mainQueue = await rig.run(activities, async (client, taskQueue) => {
      await client.workflow.execute(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
      return taskQueue;
    });
    expect(queue).toBe(sessionTaskQueue(mainQueue));
  });

  it("sessions holding every session slot never stop short activities: another workflow runs, and Stop still reaches the held sessions", async () => {
    const commands: { sessionId: string; command: SessionCommand }[] = [];
    let started = 0;
    const activities: Partial<Activities> = {
      ...createActivities(t.deps),
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession(input) {
        started += 1;
        // Waiting for the founder: holds its session slot (heartbeating, like the real runner) until a stop arrives.
        while (!commands.some((c) => c.sessionId === input.sessionId && c.command.kind === "stop")) {
          Context.current().heartbeat();
          await wait(20);
        }
        return doneResult({ outcome: "stopped", reason: "founder_stop", blockedReason: "stopped" });
      },
      async postSessionCommand(input) {
        commands.push(input);
      },
      async finishSession(_input, _launch, result) {
        return { taskStatus: result.outcome === "stopped" ? "stopped" : "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(
      activities,
      async (client, taskQueue) => {
        const start = () => client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
        const [a, b] = [await start(), await start()];
        await until(() => started === 1, "the first session to hold the only session slot");
        // The second session's run waits for a slot; the main queue still serves everyone else.
        const greeting = await settled(await client.workflow.start(hello, { workflowId: `hello:${crypto.randomUUID()}`, taskQueue, args: ["Ada"] }), "another workflow");
        const startedWhileHeld = started;
        for (const h of [a, b]) await h.signal(stopSignal, { reason: "founder_stop", by: "founder" });
        const results = [await settled(a, "the first session"), await settled(b, "the second session")];
        return { greeting, startedWhileHeld, results };
      },
      { maxSessions: 1, maxActivities: 2 },
    );
    expect(outcome.greeting).toMatch(/Ada$/);
    expect(outcome.startedWhileHeld).toBe(1);
    expect(outcome.results.map((r) => r.result.outcome)).toEqual(["stopped", "stopped"]);
  });

  it("a start refused because the agent is paused ends the session stopped, not failed (O-06)", async () => {
    let finished: SessionResult | null = null;
    const activities: Partial<Activities> = {
      async prepareSession() {
        throw ApplicationFailure.nonRetryable("Agent Test Engineer is paused", AGENT_PAUSED_FAILURE);
      },
      async runAgentSession() {
        throw new Error("must not run");
      },
      async postSessionCommand() {},
      async finishSession(_input, _launch, result) {
        finished = result;
        return { taskStatus: "paused", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, (client, taskQueue) => client.workflow.execute(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] }));
    expect(outcome.result).toMatchObject({ outcome: "stopped", blockedReason: "stopped", reason: "not started: Agent Test Engineer is paused" });
    expect(finished).toMatchObject({ outcome: "stopped", blockedReason: "stopped" });
  });

  it("a parked session waits for Resume without a slot; the next run continues it with the carried and new nudges, and usage adds up", async () => {
    const commands: SessionCommand[] = [];
    const runs: (SessionRunOptions | null)[] = [];
    let finished: SessionResult | null = null;
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession(_input, _launch, _brief, run) {
        runs.push(run ?? null);
        if (runs.length === 1) {
          // Paused past the hold: the run saves its work, hands back one nudge it never acted on, and returns.
          while (!commands.some((c) => c.kind === "pause")) await wait(20);
          return doneResult({ outcome: "stopped", reason: "paused", blockedReason: "stopped", parked: { cursor: "rec@4", carry: [{ kind: "shout", message: "Carried over", seq: 1 }] }, tokensIn: 10, tokensOut: 5, costMinor: 3, eventsEmitted: 6, progress: { ...doneResult().progress, progress: 0.4, merged: false } });
        }
        while (commands.filter((c) => c.kind === "shout").length < 2) await wait(20);
        return doneResult();
      },
      async postSessionCommand({ command }) {
        commands.push(command);
      },
      async finishSession(_input, _launch, result) {
        finished = result;
        return { taskStatus: "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, async (client, taskQueue) => {
      const handle = await client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
      await until(async () => (await handle.query(progressQuery)).state === "running", "the first run");
      await handle.signal(pauseSignal, { by: "founder" });
      await until(async () => (await handle.query(progressQuery)).detail?.startsWith("Paused: the session freed its place") === true, "the park");
      const parked = await handle.query(progressQuery);
      await handle.signal(shoutSignal, { message: "While parked", by: "founder" });
      await wait(200);
      const runsWhileParked = runs.length;
      await handle.signal(resumeSignal, { by: "founder" });
      return { parked, runsWhileParked, r: await settled(handle, "the resumed session") };
    });
    expect(outcome.parked).toMatchObject({ state: "paused", progress: 0.4 });
    expect(outcome.runsWhileParked).toBe(1);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ fromSeq: 0, resume: null });
    expect(runs[1]).toMatchObject({ fromSeq: 1, resume: { cursor: "rec@4", progress: { progress: 0.4 } } });
    // The carried nudge goes first, then the one sent while parked; both numbered for the second run.
    const shouts = commands.filter((c): c is Extract<SessionCommand, { kind: "shout" }> => c.kind === "shout");
    expect(shouts.map((c) => c.message)).toEqual(["Carried over", "While parked"]);
    expect(shouts.every((c) => (c.seq ?? -1) >= runs[1]!.fromSeq)).toBe(true);
    // Pause and resume are the workflow's to track while parked; the second run never sees them.
    expect(commands.filter((c) => c.kind === "resume")).toHaveLength(0);
    expect(outcome.r.result).toMatchObject({ outcome: "done", tokensIn: 12, tokensOut: 6, costMinor: 4, eventsEmitted: 10 });
    expect(finished).toMatchObject({ outcome: "done", tokensIn: 12 });
  });

  it("Stop while parked finishes the session stopped with the first run's usage and no second run", async () => {
    let runs = 0;
    const commands: SessionCommand[] = [];
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession() {
        runs += 1;
        while (!commands.some((c) => c.kind === "pause")) await wait(20);
        return doneResult({ outcome: "stopped", reason: "paused", blockedReason: "stopped", parked: { cursor: null, carry: [] }, tokensIn: 7, tokensOut: 3, costMinor: 2 });
      },
      async postSessionCommand({ command }) {
        commands.push(command);
      },
      async finishSession(_input, _launch, result) {
        return { taskStatus: result.outcome === "stopped" ? "stopped" : "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, async (client, taskQueue) => {
      const handle = await client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId: crypto.randomUUID() }] });
      await until(async () => (await handle.query(progressQuery)).state === "running", "the run");
      await handle.signal(pauseSignal, { by: "founder" });
      await until(async () => (await handle.query(progressQuery)).state === "paused" && runs === 1, "the park");
      await handle.signal(stopSignal, { reason: "founder_stop", by: "founder" });
      return settled(handle, "the stopped session");
    });
    expect(runs).toBe(1);
    expect(outcome.result).toMatchObject({ outcome: "stopped", reason: "founder_stop", tokensIn: 7, tokensOut: 3, costMinor: 2, parked: null });
    expect(outcome.finish?.taskStatus).toBe("stopped");
  });
});
