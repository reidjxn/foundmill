/**
 * agentSession (BUILD §9.4): one agent working one task. prepare → run (long activity with heartbeats) → finish.
 * Signals reach the running activity through the session control bus (`postSessionCommand`); the `progress` query
 * reports the ring state the workflow knows about. Loop detection (same tool+args 3×) fails the session inside the
 * runner; a pause holds the replay / SDK until resume; a decision releases a tool call waiting for approval.
 */
import { ActivityCancellationType, CancellationScope, allHandlersFinished, condition, isCancellation, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities, AgentSessionInput, ProgressSnapshot, SessionCommand, SessionFinish, SessionLaunch, SessionResult } from "../activities";
import { decisionSignal, pauseSignal, progressQuery, resumeSignal, shoutSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const control = proxyActivities<Activities>({ startToCloseTimeout: "30 seconds", retry: { maximumAttempts: 5 } });
const runner = proxyActivities<Activities>({
  startToCloseTimeout: "8 hours",
  heartbeatTimeout: "3 minutes",
  retry: { maximumAttempts: 1 },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});

export interface AgentSessionOutcome {
  result: SessionResult;
  finish: SessionFinish | null;
  launch: SessionLaunch | null;
}

export interface AgentSessionWorkflowInput extends AgentSessionInput {
  /** Brief text from the dispatching cycle (prompt-cached for live sessions). */
  briefText?: string | null;
}

export async function agentSession(input: AgentSessionWorkflowInput): Promise<AgentSessionOutcome> {
  const snapshot: ProgressSnapshot = { state: "pending", progress: 0, phase: null, planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: false, merged: false, etaAt: null, updatedAt: null, detail: null };
  const queued: SessionCommand[] = [];
  let running = false;
  let stopRequested: { reason: string; by: string | null } | null = null;
  let flushing: Promise<void> = Promise.resolve();

  const deliver = (command: SessionCommand) => {
    if (command.kind === "stop") stopRequested = { reason: command.reason, by: command.by ?? null };
    if (command.kind === "pause" && snapshot.state === "running") snapshot.state = "paused";
    if (command.kind === "resume" && snapshot.state === "paused") snapshot.state = "running";
    if (!running) {
      queued.push(command);
      return;
    }
    // Serialise control activities so commands reach the runner in signal order.
    flushing = flushing.then(() => control.postSessionCommand({ sessionId: input.sessionId, command })).catch(() => undefined);
  };

  setHandler(pauseSignal, (p) => deliver({ kind: "pause", by: p?.by ?? null, at: p?.at }));
  setHandler(resumeSignal, (p) => deliver({ kind: "resume", by: p?.by ?? null, at: p?.at }));
  setHandler(stopSignal, (p) => deliver({ kind: "stop", reason: p?.reason ?? "stopped", by: p?.by ?? null }));
  setHandler(shoutSignal, (p) => deliver({ kind: "shout", message: p.message, preset: p.preset ?? null, modelKey: p.modelKey ?? null, by: p.by ?? null, at: p.at }));
  setHandler(decisionSignal, (d) => {
    if (!d.approvalId) return;
    deliver({ kind: "decision", approvalId: d.approvalId, outcome: d.outcome, by: d.by ?? null });
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
    snapshot.state = "failed";
    snapshot.detail = (err as Error).message;
    const result = fail(`prepare failed: ${(err as Error).message}`.slice(0, 500), "error", "failed");
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
    snapshot.state = "running";
    running = true;
    const backlog = queued.splice(0, queued.length);
    for (const c of backlog) deliver(c);
    try {
      result = await CancellationScope.nonCancellable(() => runner.runAgentSession(input, launch, input.briefText ?? null));
    } catch (err) {
      if (isCancellation(err)) result = fail("cancelled", "stopped", "stopped");
      else result = fail(`run failed: ${(err as Error).message}`.slice(0, 500), "error", "failed");
    }
    running = false;
    await flushing;
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
    snapshot.detail = `finish failed: ${(err as Error).message}`;
  }
  snapshot.state = result.outcome === "done" ? "done" : result.outcome === "failed" ? "failed" : result.outcome === "blocked" ? "blocked" : "stopped";
  await condition(allHandlersFinished);
  void workflowInfo();
  return { result, finish, launch };
}
