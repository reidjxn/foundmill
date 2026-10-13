/**
 * Deploys do not end agent sessions (O-12, CDD-3). A worker that shuts down hands its sessions off: the run saves its
 * place and returns a hand-off, and the next run (on the next worker) continues from there. A run cancelled for a worker
 * shutdown hands off the same way instead of stopping; a retry after a worker died continues from its last heartbeat.
 */
import { readSessionEvents } from "@foundmill/events";
import { MockSandboxProvider, RECORDINGS, findRecording, type SandboxProvider } from "@foundmill/sandbox";
import { Context } from "@temporalio/activity";
import { ActivityCancellationDetails } from "@temporalio/common";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cancelledForShutdown, createSessionActivities, retriedFrom } from "../activities/session";
import { FakeClock } from "../clock";
import { SessionDrain } from "../drain";
import { initialProgress } from "../progress";
import { openSessionRow, setupOrchestratorHarness, wait, type OrchestratorTestHarness } from "./harness";

const clockedProvider = (clock: FakeClock) =>
  new MockSandboxProvider({ speed: 1, autoplay: false, holds: { autoResolveAfterMs: 1 }, recordings: RECORDINGS, sleep: (ms, signal) => clock.sleep(ms, signal).catch(() => undefined), now: () => clock.now() });

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

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "handoff" });
});
afterAll(async () => {
  await t?.close();
});

describe("SessionDrain", () => {
  it("tells running sessions once, and sessions that start later at once", () => {
    const drain = new SessionDrain();
    const seen: string[] = [];
    const off = drain.onBegin(() => seen.push("a"));
    drain.onBegin(() => seen.push("b"))();
    drain.begin();
    drain.begin();
    off();
    drain.onBegin(() => seen.push("late"));
    expect(seen).toEqual(["a", "late"]);
    expect(drain.requested).toBe(true);
  });
});

describe("a worker shutdown hands the session to the next worker", () => {
  it("the run saves its place and returns a hand-off; the next run plays every remaining event once", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const provider = clockedProvider(clock);
    const drain = new SessionDrain();
    const deps = { ...t.deps, clock, drain, sandbox: async () => ({ provider, mode: "mock" as const, fellBackFrom: null }) };
    const acts = createSessionActivities(deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const recording = findRecording("ledgerly-webhook-retry")!;
    const first = acts.runAgentSession(input, launch, null, { fromSeq: 0, resume: null });
    await vi.waitFor(async () => {
      if ((await readSessionEvents(t.redis, sessionId)).length < 2) throw new Error("not started");
    }, { timeout: 5_000, interval: 25 });

    drain.begin();
    const handed = await first;
    expect(handed).toMatchObject({ outcome: "stopped", reason: "worker shutting down", parked: { cursor: expect.stringMatching(/^ledgerly-webhook-retry@\d+$/), carry: [], handoff: true } });
    const index = Number(handed.parked!.cursor!.split("@")[1]);
    expect(index).toBeLessThan(recording.events.length);

    // The next worker (a fresh drain) continues where the run stopped.
    const next = createSessionActivities({ ...deps, drain: new SessionDrain() });
    const second = await drive(clock, next.runAgentSession(input, launch, null, { fromSeq: 0, resume: { cursor: handed.parked!.cursor, progress: handed.progress, reason: "handoff" } }));
    expect(second.outcome).toBe("done");
    const calls = (await readSessionEvents(t.redis, sessionId, { kinds: ["tool_call"] })).length;
    expect(calls).toBe(recording.events.filter((e) => (e.event as { kind: string }).kind === "tool_call").length);
    const notes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(notes.some((r) => r.event.kind === "note" && /shutting down for a deploy/.test(r.event.text))).toBe(true);
    expect(notes.some((r) => r.event.kind === "note" && /^Session continued on a new worker/.test(r.event.text))).toBe(true);
  });

  it("a session that starts while the worker drains hands off before playing anything", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const drain = new SessionDrain();
    drain.begin();
    const deps = { ...t.deps, clock, drain, sandbox: async () => ({ provider: clockedProvider(clock), mode: "mock" as const, fellBackFrom: null }) };
    const acts = createSessionActivities(deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const r = await drive(clock, acts.runAgentSession(input, launch, null, null));
    expect(r.parked).toMatchObject({ handoff: true, cursor: "ledgerly-webhook-retry@0" });
  });

  it("an error the shutdown causes (a step it cut short) hands off instead of failing the session", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const drain = new SessionDrain();
    const broken: SandboxProvider = {
      mode: "mock",
      available: async () => ({ available: true }),
      create: async () => {
        drain.begin();
        throw new Error("Connection terminated: the worker is shutting down");
      },
    };
    const deps = { ...t.deps, clock, drain, sandbox: async () => ({ provider: broken, mode: "mock" as const, fellBackFrom: null }) };
    const acts = createSessionActivities(deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = { ...(await acts.prepareSession(input)), recordingKey: "ledgerly-webhook-retry" };
    const r = await acts.runAgentSession(input, launch, null, { fromSeq: 0, resume: { cursor: "ledgerly-webhook-retry@4", progress: initialProgress({ planSteps: 1, acceptanceTests: 0 }), reason: "handoff" } });
    expect(r).toMatchObject({ outcome: "stopped", blockedReason: "stopped", parked: { handoff: true, cursor: "ledgerly-webhook-retry@4" } });
    const notes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(notes.some((n) => n.event.kind === "note" && /^Session failed/.test(n.event.text))).toBe(false);

    // The same error on a worker that is not shutting down still fails the run.
    const steady: SandboxProvider = { ...broken, create: async () => Promise.reject(new Error("sandbox image missing")) };
    const failing = createSessionActivities({ ...deps, drain: new SessionDrain(), sandbox: async () => ({ provider: steady, mode: "mock" as const, fellBackFrom: null }) });
    const f = await failing.runAgentSession(input, launch, null, null);
    expect(f).toMatchObject({ outcome: "failed", reason: "sandbox image missing" });
    expect(f.parked ?? null).toBeNull();
  });
});

describe("cancellations and retries inside Temporal", () => {
  it("tells a worker-shutdown cancellation from the workflow's", async () => {
    const seenBy = (env: MockActivityEnvironment) =>
      env.run(async () => {
        await Context.current().cancelled.catch(() => undefined);
        return cancelledForShutdown(Context.current().cancellationSignal);
      });
    const shutdown = new MockActivityEnvironment();
    const onShutdown = seenBy(shutdown);
    shutdown.cancel("WORKER_SHUTDOWN", new ActivityCancellationDetails({ workerShutdown: true }));
    expect(await onShutdown).toBe(true);
    const workflow = new MockActivityEnvironment();
    const onStop = seenBy(workflow);
    workflow.cancel("CANCELLED", new ActivityCancellationDetails({ cancelRequested: true }));
    expect(await onStop).toBe(false);
    expect(cancelledForShutdown(null)).toBe(false);
  });

  it("a retried run continues from its last heartbeat; a first attempt starts fresh", async () => {
    const ring = { progress: 0.4, planStepsDone: 2, planSteps: 5, acceptanceTestsPassing: 0, acceptanceTests: 3, reviewPassed: false, merged: false, phase: "build", etaAt: null, at: null };
    const retry = new MockActivityEnvironment({ attempt: 2, heartbeatDetails: { sessionId: "s", cursor: "ledgerly-webhook-retry@7", ring } });
    expect(await retry.run(() => Promise.resolve(retriedFrom()))).toEqual({ cursor: "ledgerly-webhook-retry@7", progress: ring });
    const fresh = new MockActivityEnvironment({ attempt: 1 });
    expect(await fresh.run(() => Promise.resolve(retriedFrom()))).toBeNull();
    const noBeat = new MockActivityEnvironment({ attempt: 3 });
    expect(await noBeat.run(() => Promise.resolve(retriedFrom()))).toEqual({ cursor: null, progress: null });
    expect(retriedFrom()).toBeNull();
  });
});
