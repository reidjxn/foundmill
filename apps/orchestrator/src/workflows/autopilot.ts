/**
 * autopilot (0041): one per business that turned Autopilot on, workflow id `autopilot:<businessId>`. It waits for the
 * next planned cycle, checks the guard rails through an activity (`decideAutopilot`: the stop flag, credits, failed or
 * empty cycles, a vacation, a running cycle, an Inbox item that blocks Continue, the day's cycle and spend limits) and
 * then starts `businessCycle` exactly as Continue does (same workflow, same `cycle:<businessId>:<n>` id, trigger
 * `autopilot`), so every approval, hard gate, section wall and policy check applies as for a founder press. It never
 * approves or decides anything. A guard rail that pauses it persists the pause and ends the workflow; the founder turns
 * it on again (which starts a new run). Stop all agents signals `stop`, which ends it and passes the stop to the cycle
 * it is waiting on. `autopilotRefresh` (settings changed, an Inbox decision made) makes it look again at once. The
 * history is carried forward with `continueAsNew` every few hundred rounds.
 */
import { ParentClosePolicy, allHandlersFinished, condition, continueAsNew, proxyActivities, setHandler, startChild, type ChildWorkflowHandle } from "@temporalio/workflow";
import type { Activities } from "../activities";
import { businessCycle } from "./businessCycle";
import { autopilotRefreshSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

/** Rounds (one look at the guard rails each) before the run continues as new, keeping the history small. */
export const AUTOPILOT_ROUNDS_PER_RUN = 300;

export interface AutopilotInput {
  businessId: string;
  /** Carried across `continueAsNew`. */
  cyclesStarted?: number;
  unrecordedFailures?: number;
  /** Override `AUTOPILOT_ROUNDS_PER_RUN` (tests). */
  maxRounds?: number;
}

export interface AutopilotResult {
  /** `off`: turned off; `ended`: the business is archived; `paused`: a guard rail paused it; `stopped`: Stop all agents. */
  outcome: "off" | "ended" | "paused" | "stopped";
  pausedReason: string | null;
  cyclesStarted: number;
}

export async function autopilot(input: AutopilotInput): Promise<AutopilotResult> {
  const { businessId } = input;
  let stopped = false;
  let refresh = false;
  let child: ChildWorkflowHandle<typeof businessCycle> | null = null;
  let cyclesStarted = input.cyclesStarted ?? 0;
  // Cycles that died before writing `cycle.started` (so the event log cannot show them); reset by any cycle that ran.
  let unrecordedFailures = input.unrecordedFailures ?? 0;
  const maxRounds = input.maxRounds ?? AUTOPILOT_ROUNDS_PER_RUN;

  setHandler(stopSignal, (p) => {
    stopped = true;
    if (child) void child.signal(stopSignal, p).catch(() => undefined);
  });
  setHandler(autopilotRefreshSignal, () => {
    refresh = true;
  });

  const done = async (result: AutopilotResult): Promise<AutopilotResult> => {
    await condition(allHandlersFinished);
    return result;
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (stopped) {
      await acts.autopilotPause({ businessId, reason: "kill_switch" });
      return done({ outcome: "stopped", pausedReason: "kill_switch", cyclesStarted });
    }
    refresh = false;
    const evaluation = await acts.autopilotEvaluate({ businessId, unrecordedFailures });
    const d = evaluation.decision;
    switch (d.action) {
      case "off":
        return done({ outcome: "off", pausedReason: null, cyclesStarted });
      case "end":
        return done({ outcome: "ended", pausedReason: null, cyclesStarted });
      case "paused":
        return done({ outcome: "paused", pausedReason: d.reason, cyclesStarted });
      case "pause":
        await acts.autopilotPause({ businessId, reason: d.reason });
        return done({ outcome: "paused", pausedReason: d.reason, cyclesStarted });
      case "wait":
        // A refresh or the stop signal ends the wait early; otherwise it runs out and the guard rails are checked again.
        await condition(() => refresh || stopped, evaluation.waitMs);
        break;
      case "start": {
        const { cycleNumber } = await acts.nextCycleNumber({ businessId });
        const workflowId = `cycle:${businessId}:${cycleNumber}`;
        try {
          child = await startChild(businessCycle, { workflowId, args: [{ businessId, cycleNumber, trigger: "autopilot" }], parentClosePolicy: ParentClosePolicy.ABANDON });
        } catch (err) {
          // A founder's Continue got there first (same cycle number): look again once that cycle has run.
          if ((err as Error).name === "WorkflowExecutionAlreadyStartedError") {
            await condition(() => refresh || stopped, 60_000);
            break;
          }
          unrecordedFailures += 1;
          await acts.autopilotCycleFailed({ businessId, workflowId, error: (err as Error).message ?? String(err) });
          await condition(() => refresh || stopped, 60_000);
          break;
        }
        cyclesStarted += 1;
        await acts.autopilotCycleStarted({ businessId, cycleNumber, workflowId, cadence: evaluation.cadence, cyclesToday: evaluation.cyclesToday + 1 });
        try {
          await child.result();
          unrecordedFailures = 0;
        } catch (err) {
          const closed = await acts.autopilotCycleFailed({ businessId, workflowId, error: (err as Error).message ?? String(err) });
          if (!closed.recorded) unrecordedFailures += 1;
        } finally {
          child = null;
        }
        break;
      }
    }
  }
  if (stopped) {
    await acts.autopilotPause({ businessId, reason: "kill_switch" });
    return done({ outcome: "stopped", pausedReason: "kill_switch", cyclesStarted });
  }
  await condition(allHandlersFinished);
  return continueAsNew<typeof autopilot>({ businessId, cyclesStarted, unrecordedFailures, ...(input.maxRounds ? { maxRounds: input.maxRounds } : {}) });
}
