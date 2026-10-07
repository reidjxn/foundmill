/**
 * agentSession workflow: loop detection ends the session as failed (real activities on PGlite + the replay sandbox);
 * pause/resume/shout/decision signals reach the running activity through the control bus in order, and the
 * `progress` query reports the state.
 */
import { repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { MockSandboxProvider, RECORDINGS, findRecording } from "@foundmill/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActivities, type Activities, type SessionCommand, type SessionLaunch, type SessionResult } from "../../activities";
import { agentSession, pauseSignal, progressQuery, resumeSignal, shoutSignal, decisionSignal, stopSignal } from "../../workflows";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "../harness";
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

  it("delivers pause / shout / decision / resume to the running session in signal order and answers the progress query", async () => {
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
