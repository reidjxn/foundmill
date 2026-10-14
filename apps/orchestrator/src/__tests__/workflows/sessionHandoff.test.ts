/**
 * agentSession across a deploy (O-12, CDD-3): a run that hands off (its worker shut down) is followed at once by the
 * next run, which continues from the hand-off's place with the nudges it carried; a hand-off while the founder keeps
 * the session paused parks it instead; and a run whose worker died is tried again instead of failing the session.
 */
import { Context } from "@temporalio/activity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, SessionCommand, SessionLaunch, SessionResult, SessionRunOptions } from "../../activities";
import { agentSession, pauseSignal, progressQuery, resumeSignal } from "../../workflows";
import { wait } from "../harness";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const ids = () => ({ businessId: crypto.randomUUID(), agentId: crypto.randomUUID(), taskId: crypto.randomUUID(), sessionId: crypto.randomUUID() });
const launchStub: SessionLaunch = { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "claude-sonnet-5-5", recordingKey: "stub", allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: "agent/x", maxTurns: 1, planSteps: 2, acceptanceTests: 1 };
const doneResult = (over: Partial<SessionResult> = {}): SessionResult => ({ outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 2, planSteps: 2, acceptanceTestsPassing: 1, acceptanceTests: 1, reviewPassed: true, merged: true, phase: "done", progress: 1, etaAt: null, at: null }, eventsEmitted: 4, toolCalls: 2, toolFailures: 0, tokensIn: 2, tokensOut: 1, costMinor: 1, durationMs: 60_000, prNumber: null, summary: "done", providerSessionId: null, ...over });
const handoff = (carry: SessionCommand[] = []) => doneResult({ outcome: "stopped", reason: "worker shutting down", blockedReason: "stopped", parked: { cursor: "rec@4", carry, lastSeq: 0, handoff: true }, tokensIn: 10, tokensOut: 5, costMinor: 3, eventsEmitted: 6, progress: { ...doneResult().progress, progress: 0.4, merged: false } });

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 1_200; i++) {
    if (await check()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("agentSession across a worker shutdown", () => {
  it("starts the next run at once from the hand-off's place, with the nudges it carried, and adds the usage up", async () => {
    const runs: (SessionRunOptions | null)[] = [];
    const commands: SessionCommand[] = [];
    let finished: SessionResult | null = null;
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession(_input, _launch, _brief, run) {
        runs.push(run ?? null);
        if (runs.length === 1) return handoff([{ kind: "shout", message: "Carried over", seq: 0 }]);
        while (!commands.some((c) => c.kind === "shout")) await wait(20);
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
    const outcome = await rig.run(activities, (client, taskQueue) => client.workflow.execute(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [ids()] }));
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ resume: { cursor: "rec@4", reason: "handoff", progress: { progress: 0.4 } } });
    expect(commands.map((c) => c.kind === "shout" && c.message)).toEqual(["Carried over"]);
    expect(outcome.result).toMatchObject({ outcome: "done", tokensIn: 12, costMinor: 4 });
    expect(finished).toMatchObject({ outcome: "done" });
  });

  it("a hand-off while the founder keeps the session paused parks it until Resume", async () => {
    const runs: (SessionRunOptions | null)[] = [];
    const commands: SessionCommand[] = [];
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession(_input, _launch, _brief, run) {
        runs.push(run ?? null);
        if (runs.length === 1) {
          while (!commands.some((c) => c.kind === "pause")) await wait(20);
          return handoff();
        }
        return doneResult();
      },
      async postSessionCommand({ command }) {
        commands.push(command);
      },
      async finishSession() {
        return { taskStatus: "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, async (client, taskQueue) => {
      const handle = await client.workflow.start(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [ids()] });
      await until(async () => (await handle.query(progressQuery)).state === "running", "the first run");
      await handle.signal(pauseSignal, { by: "founder" });
      await until(async () => (await handle.query(progressQuery)).detail?.startsWith("Paused: the session freed its place") === true, "the park");
      await wait(200);
      const runsWhileParked = runs.length;
      await handle.signal(resumeSignal, { by: "founder" });
      return { runsWhileParked, result: await handle.result() };
    });
    expect(outcome.runsWhileParked).toBe(1);
    expect(runs).toHaveLength(2);
    expect(outcome.result.result.outcome).toBe("done");
  });

  it("a run whose worker died is tried again instead of failing the session", async () => {
    const attempts: number[] = [];
    const activities: Partial<Activities> = {
      async prepareSession() {
        return launchStub;
      },
      async runAgentSession() {
        attempts.push(Context.current().info.attempt);
        // What Temporal reports when the worker running the activity died: the activity failed (a timeout).
        if (attempts.length === 1) throw new Error("activity heartbeat timeout");
        return doneResult();
      },
      async postSessionCommand() {},
      async finishSession() {
        return { taskStatus: "done", eventIds: [], healthChanged: false };
      },
    };
    const outcome = await rig.run(activities, (client, taskQueue) => client.workflow.execute(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [ids()] }));
    expect(attempts).toEqual([1, 2]);
    expect(outcome.result.outcome).toBe("done");
  });
});
