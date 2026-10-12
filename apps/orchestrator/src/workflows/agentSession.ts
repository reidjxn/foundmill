/**
 * agentSession (BUILD §9.4): one agent working one task. prepare → run (long activity with heartbeats) → finish.
 * Signals reach the running activity through the session control bus (`postSessionCommand`); the `progress` query
 * reports the ring state the workflow knows about. Loop detection (same tool+args 3×) fails the session inside the
 * runner; a pause holds the replay / SDK until resume; a decision releases a tool call waiting for approval.
 *
 * The run activity is the only one on the sessions task queue (../session-contract), so sessions that work for hours or
 * wait for the founder never take a slot from cycles, plans or the control activities that reach them. Waiting is
 * bounded in the runner: a gated call left undecided for APPROVAL_WAIT_MINUTES ends the session `blocked` (the approval
 * stays open), and a session paused for SESSION_PAUSE_HOLD_MINUTES "parks": the run saves its work and returns, this
 * workflow waits for Resume or Stop without any slot, then starts the next run where the last one stopped.
 */
import { ActivityCancellationType, ActivityFailure, ApplicationFailure, CancellationScope, allHandlersFinished, condition, isCancellation, patched, proxyActivities, setHandler, workflowInfo, type ActivityOptions } from "@temporalio/workflow";
import type { Activities, AgentSessionInput, ProgressSnapshot, SessionCommand, SessionFinish, SessionLaunch, SessionResult, SessionRunOptions } from "../activities";
import { AGENT_PAUSED_FAILURE, SESSION_QUEUE_PATCH, sessionTaskQueue } from "../session-contract";
import { decisionSignal, pauseSignal, progressQuery, resumeSignal, shoutSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const control = proxyActivities<Activities>({ startToCloseTimeout: "30 seconds", retry: { maximumAttempts: 5 } });
const RUNNER: ActivityOptions = {
  startToCloseTimeout: "8 hours",
  heartbeatTimeout: "3 minutes",
  retry: { maximumAttempts: 1 },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
};
/** A parked session nobody resumes ends `stopped` after this long. */
const PARK_LIMIT = "7 days";

export interface AgentSessionOutcome {
  result: SessionResult;
  finish: SessionFinish | null;
  launch: SessionLaunch | null;
}

export interface AgentSessionWorkflowInput extends AgentSessionInput {
  /** Brief text from the dispatching cycle (prompt-cached for live sessions). */
  briefText?: string | null;
}

/** The activity's own error rather than Temporal's "Activity task failed" wrapper. */
const failureMessage = (err: unknown): string => (err instanceof ActivityFailure && err.cause ? err.cause.message : (err as Error).message);

/** One session made of several runs (a park and a resume): usage and counts add up, the last run says how it ended. */
export function combineRuns(a: SessionResult, b: SessionResult): SessionResult {
  return {
    ...b,
    eventsEmitted: a.eventsEmitted + b.eventsEmitted,
    toolCalls: a.toolCalls + b.toolCalls,
    toolFailures: a.toolFailures + b.toolFailures,
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costMinor: a.costMinor + b.costMinor,
    durationMs: a.durationMs + b.durationMs,
    prNumber: b.prNumber ?? a.prNumber,
  };
}

export async function agentSession(input: AgentSessionWorkflowInput): Promise<AgentSessionOutcome> {
  const snapshot: ProgressSnapshot = { state: "pending", progress: 0, phase: null, planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: false, merged: false, etaAt: null, updatedAt: null, detail: null };
  // Histories from before the sessions queue keep scheduling the run on the workflow's own queue.
  const runner = proxyActivities<Activities>(patched(SESSION_QUEUE_PATCH) ? { ...RUNNER, taskQueue: sessionTaskQueue(workflowInfo().taskQueue) } : RUNNER);
  const queued: SessionCommand[] = [];
  let running = false;
  let parked = false;
  let stopRequested: { reason: string; by: string | null } | null = null;
  /** The founder's last word on pausing, wherever the session stands: a parked session waits until it is `false`. */
  let pausedByFounder = false;
  /** Every command posted to the control bus is numbered; a run ignores numbers from before it started. */
  let nextSeq = 0;
  let flushing: Promise<void> = Promise.resolve();

  const deliver = (command: SessionCommand) => {
    if (command.kind === "stop") stopRequested = { reason: command.reason, by: command.by ?? null };
    if (command.kind === "pause") pausedByFounder = true;
    if (command.kind === "resume") pausedByFounder = false;
    if (command.kind === "pause" && snapshot.state === "running") snapshot.state = "paused";
    if (command.kind === "resume" && snapshot.state === "paused" && !parked) snapshot.state = "running";
    if (!running) {
      // A parked session has no run to tell: `pausedByFounder` and `stopRequested` carry pause, resume and stop.
      if (parked && command.kind !== "shout" && command.kind !== "decision") return;
      queued.push(command);
      return;
    }
    const numbered: SessionCommand = { ...command, seq: nextSeq++ };
    // Serialise control activities so commands reach the runner in signal order.
    flushing = flushing.then(() => control.postSessionCommand({ sessionId: input.sessionId, command: numbered })).catch(() => undefined);
  };

  setHandler(pauseSignal, (p) => deliver({ kind: "pause", by: p?.by ?? null, at: p?.at }));
  setHandler(resumeSignal, (p) => deliver({ kind: "resume", by: p?.by ?? null, at: p?.at }));
  setHandler(stopSignal, (p) => deliver({ kind: "stop", reason: p?.reason ?? "stopped", by: p?.by ?? null }));
  setHandler(shoutSignal, (p) => deliver({ kind: "shout", message: p.message, preset: p.preset ?? null, modelKey: p.modelKey ?? null, by: p.by ?? null, at: p.at }));
  setHandler(decisionSignal, (d) => {
    if (!d.approvalId) return;
    deliver({ kind: "decision", approvalId: d.approvalId, outcome: d.outcome, by: d.by ?? null, note: d.note ?? null });
  });
  setHandler(progressQuery, () => snapshot);

  const fail = (reason: string, blockedReason: SessionResult["blockedReason"], outcome: SessionResult["outcome"]): SessionResult => ({
    outcome,
    reason,
    blockedReason,
    approvalId: null,
    progress: { planStepsDone: snapshot.planStepsDone, planSteps: snapshot.planSteps, acceptanceTestsPassing: snapshot.acceptanceTestsPassing, acceptanceTests: snapshot.acceptanceTests, reviewPassed: snapshot.reviewPassed, merged: snapshot.merged, phase: null, progress: snapshot.progress, etaAt: null, at: null },
    eventsEmitted: 0,
    toolCalls: 0,
    toolFailures: 0,
    tokensIn: 0,
    tokensOut: 0,
    costMinor: 0,
    durationMs: 0,
    prNumber: null,
    summary: reason,
    providerSessionId: null,
  });

  snapshot.state = "preparing";
  let launch: SessionLaunch;
  try {
    launch = await acts.prepareSession(input);
  } catch (err) {
    // An agent paused before its session could start (founder pause, Stop all agents, the credits pause) is not a
    // failure: the session ends stopped and the agent stays paused.
    const agentPaused = err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.type === AGENT_PAUSED_FAILURE;
    const message = failureMessage(err);
    snapshot.state = agentPaused ? "stopped" : "failed";
    snapshot.detail = message;
    const result = agentPaused ? fail(`not started: ${message}`.slice(0, 500), "stopped", "stopped") : fail(`prepare failed: ${message}`.slice(0, 500), "error", "failed");
    let finish: SessionFinish | null;
    try {
      finish = await acts.finishSession(input, { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "", recordingKey: null, allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: `agent/${input.taskId}`, maxTurns: 0, planSteps: 0, acceptanceTests: 0 }, result);
    } catch {
      finish = null;
    }
    await condition(allHandlersFinished);
    return { result, finish, launch: null };
  }
  snapshot.planSteps = launch.planSteps;
  snapshot.acceptanceTests = launch.acceptanceTests;

  let result: SessionResult;
  if (stopRequested) {
    const stop: { reason: string; by: string | null } = stopRequested;
    snapshot.state = "stopped";
    result = fail(stop.reason, "stopped", "stopped");
  } else {
    let total: SessionResult | null = null;
    let resume: SessionRunOptions["resume"] = null;
    for (;;) {
      snapshot.state = "running";
      running = true;
      const run: SessionRunOptions = { fromSeq: nextSeq, resume };
      const backlog = queued.splice(0, queued.length);
      for (const c of backlog) deliver(c);
      let r: SessionResult;
      try {
        r = await CancellationScope.nonCancellable(() => runner.runAgentSession(input, launch, input.briefText ?? null, run));
      } catch (err) {
        if (isCancellation(err)) r = fail("cancelled", "stopped", "stopped");
        else r = fail(`run failed: ${failureMessage(err)}`.slice(0, 500), "error", "failed");
      }
      running = false;
      await flushing;
      total = total ? combineRuns(total, r) : r;
      if (!r.parked) break;

      // Parked: the run saved its work and freed its slot while the founder keeps the session paused. Wait here for
      // Resume or Stop; nudges and decisions that reach a parked session go to the next run.
      parked = true;
      snapshot.state = "paused";
      snapshot.progress = r.progress.progress;
      snapshot.detail = "Paused: the session freed its place and continues on Resume.";
      queued.unshift(...r.parked.carry);
      resume = { cursor: r.parked.cursor, progress: r.progress };
      const woke = await condition(() => !pausedByFounder || stopRequested !== null, PARK_LIMIT);
      parked = false;
      const stop = stopRequested as { reason: string; by: string | null } | null;
      if (stop || !woke) {
        total = { ...total, outcome: "stopped", reason: stop ? stop.reason : "paused for a week", blockedReason: "stopped", summary: stop ? `Stopped: ${stop.reason}.` : "Stopped after a week paused.", parked: null };
        break;
      }
      snapshot.detail = null;
    }
    result = total;
  }

  Object.assign(snapshot, {
    state: "finishing",
    progress: result.progress.progress,
    phase: result.progress.phase,
    planStepsDone: result.progress.planStepsDone,
    planSteps: result.progress.planSteps,
    acceptanceTestsPassing: result.progress.acceptanceTestsPassing,
    acceptanceTests: result.progress.acceptanceTests,
    reviewPassed: result.progress.reviewPassed,
    merged: result.progress.merged,
    etaAt: result.progress.etaAt,
    updatedAt: result.progress.at,
    detail: result.reason,
  });
  let finish: SessionFinish | null = null;
  try {
    finish = await acts.finishSession(input, launch, result);
  } catch (err) {
    snapshot.detail = `finish failed: ${failureMessage(err)}`;
  }
  snapshot.state = result.outcome === "done" ? "done" : result.outcome === "failed" ? "failed" : result.outcome === "blocked" ? "blocked" : "stopped";
  await condition(allHandlersFinished);
  void workflowInfo();
  return { result, finish, launch };
}
