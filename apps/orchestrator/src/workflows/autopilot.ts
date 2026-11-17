/**
 * autopilot (0055): one per business that turned Autopilot on, workflow id `autopilot:<businessId>`. It waits for the
 * next planned cycle, checks the guard rails through an activity (`decideAutopilot`: the stop flag, credits, failed or
 * empty cycles, a vacation, a running cycle, an Inbox item that blocks Continue, the day's cycle and spend limits) and
 * then starts `businessCycle` exactly as Continue does (same workflow, same `cycle:<businessId>:<n>` id, trigger
 * `autopilot`), so every approval, hard gate, section wall and policy check applies as for a founder press. It never
 * approves or decides anything. A guard rail that pauses it persists the pause and ends the workflow; the founder turns
 * it on again (which starts a new run). Stop all agents signals `stop`, which ends it and passes the stop to the cycle
 * it is waiting on. `autopilotRefresh` (settings changed) makes it look again at once; a founder's Inbox decision is noticed at the next look (every few minutes while it waits for the founder). The
 * history is carried forward with `continueAsNew` every few hundred rounds.
 *
 * Continue runs until done (founder, Nov 7, 2026; behind `CONTINUE_RUN_PATCH`): a press of Continue signals
 * `continueRun` with signal-with-start, so the same workflow also runs for a business whose Autopilot is off. A run
 * starts the press's cycle at once (trigger `continue`, the number the API reserved), then round after round (trigger
 * `autopilot`, so failed tasks keep their doubling waits) until `decideRun` ends it: the last round did nothing, a hard
 * stop, a vacation, a stopped round, the day's cycle cap or spend ceiling (the same limits as Autopilot's), an archived
 * business, or `continueRunEnd` (Pause). No 15-minute floor between a run's rounds, only a 1-minute gap; while another
 * cycle is open the run looks again every minute. When a run ends the schedule decides again unchanged; with Autopilot
 * off the workflow then returns `run_ended`. The run is carried across `continueAsNew`.
 */
import { ParentClosePolicy, allHandlersFinished, condition, continueAsNew, patched, proxyActivities, setHandler, startChild, type ChildWorkflowHandle } from "@temporalio/workflow";
import type { ContinueRunEndReason } from "@foundmill/shared";
import type { Activities } from "../activities";
import { businessCycle } from "./businessCycle";
import { autopilotRefreshSignal, continueRunEndSignal, continueRunSignal, stopSignal, type ContinueRunPayload } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

/** Rounds (one look at the guard rails each) before the run continues as new, keeping the history small. */
export const AUTOPILOT_ROUNDS_PER_RUN = 300;

/** Guards Continue's runs: histories recorded before them never register the run signals and replay unchanged. */
export const CONTINUE_RUN_PATCH = "autopilot-continue-run";
/**
 * Autopilot's own limits (0084): a cycle it starts on its own schedule carries the rest of its own spend ceiling as its
 * budget. A patch, so histories recorded before replay unchanged.
 */
export const AUTOPILOT_OWN_BUDGET_PATCH = "autopilot-own-budget";

/** The run one press of Continue started, as the workflow holds it. */
export interface AutopilotRun {
  id: string;
  /** Epoch ms (workflow time) of the press. */
  startedAt: number;
  /** The press's own cycle, not started yet; null once started (or when a cycle was already open). */
  pendingCycleNumber: number | null;
  /** The press's own cycle's extra input (WP-09 T11). */
  pendingCycleInput: NonNullable<ContinueRunPayload["cycleInput"]>;
  /** Rounds of this run that failed before writing a cycle. */
  unrecordedFailures: number;
}

export interface AutopilotInput {
  businessId: string;
  /** Carried across `continueAsNew`. */
  cyclesStarted?: number;
  unrecordedFailures?: number;
  /** The open run, carried across `continueAsNew`. */
  run?: AutopilotRun | null;
  /** A run ended in an earlier execution of this workflow (so Autopilot off still reports `run_ended`). */
  runEnded?: boolean;
  /** Override `AUTOPILOT_ROUNDS_PER_RUN` (tests). */
  maxRounds?: number;
}

export interface AutopilotResult {
  /**
   * `off`: turned off; `ended`: the business is archived; `paused`: a guard rail paused it; `stopped`: Stop all agents;
   * `run_ended`: Autopilot is off and the run a press of Continue started has ended.
   */
  outcome: "off" | "ended" | "paused" | "stopped" | "run_ended";
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

  // Continue's runs (Nov 7, 2026). An execution recorded before this code never registers the handlers: `run` stays
  // null there and every path below is the one it took.
  const runs = patched(CONTINUE_RUN_PATCH);
  let run: AutopilotRun | null = runs ? (input.run ?? null) : null;
  // Set by the handlers (typed wide: the loop reads what a signal wrote between its awaits).
  let endRequest = null as "paused" | "stopped" | null;
  let runEnded = runs && input.runEnded === true;
  // The highest cycle number this execution started: a press that reserved a number already taken starts nothing.
  let lastStartedNumber = 0;
  if (runs) {
    setHandler(continueRunSignal, (p) => {
      if (run?.id === p.runId) return;
      run = { id: p.runId, startedAt: Date.now(), pendingCycleNumber: p.cycleNumber ?? null, pendingCycleInput: p.cycleInput ?? {}, unrecordedFailures: 0 };
      endRequest = null;
      refresh = true;
    });
    setHandler(continueRunEndSignal, (p) => {
      if (run && (!p.runId || p.runId === run.id)) endRequest = p.reason;
      refresh = true;
    });
  }

  const done = async (result: AutopilotResult): Promise<AutopilotResult> => {
    await condition(allHandlersFinished);
    return result;
  };

  const endRun = async (reason: ContinueRunEndReason): Promise<void> => {
    const ending = run;
    if (!ending) return;
    run = null;
    endRequest = null;
    runEnded = true;
    await acts.autopilotRunEnded({ businessId, runId: ending.id, startedAt: ending.startedAt, reason });
  };

  /** Start cycle `cycleNumber` as a child and wait for it; false when nothing started (a collision or a failed start). */
  const runCycle = async (
    cycleNumber: number,
    trigger: "continue" | "autopilot",
    cadence: Parameters<Activities["autopilotCycleStarted"]>[0]["cadence"] | null,
    cyclesToday: number,
    budgetCapMinor: number | null = null,
    cycleInput: ContinueRunPayload["cycleInput"] = {},
  ): Promise<boolean> => {
    const workflowId = `cycle:${businessId}:${cycleNumber}`;
    try {
      child = await startChild(businessCycle, { workflowId, args: [{ businessId, cycleNumber, trigger, ...cycleInput, ...(budgetCapMinor !== null ? { budgetCapMinor } : {}) }], parentClosePolicy: ParentClosePolicy.ABANDON });
    } catch (err) {
      // A founder's Continue got there first (same cycle number): look again once that cycle has run.
      if ((err as Error).name === "WorkflowExecutionAlreadyStartedError") {
        await condition(() => refresh || stopped, 60_000);
        return false;
      }
      unrecordedFailures += 1;
      if (run) run.unrecordedFailures += 1;
      await acts.autopilotCycleFailed({ businessId, workflowId, error: (err as Error).message ?? String(err) });
      await condition(() => refresh || stopped, 60_000);
      return false;
    }
    lastStartedNumber = Math.max(lastStartedNumber, cycleNumber);
    // The press's own cycle is the founder's (the API audited it); every other start is recorded as Autopilot's.
    if (cadence !== null) {
      cyclesStarted += 1;
      await acts.autopilotCycleStarted({ businessId, cycleNumber, workflowId, cadence, cyclesToday: cyclesToday + 1, ...(run ? { runId: run.id } : {}) });
    }
    try {
      await child.result();
      unrecordedFailures = 0;
    } catch (err) {
      const closed = await acts.autopilotCycleFailed({ businessId, workflowId, error: (err as Error).message ?? String(err) });
      if (!closed.recorded) {
        unrecordedFailures += 1;
        if (run) run.unrecordedFailures += 1;
      }
    } finally {
      child = null;
    }
    return true;
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (stopped) {
      await endRun("stopped");
      await acts.autopilotPause({ businessId, reason: "kill_switch" });
      return done({ outcome: "stopped", pausedReason: "kill_switch", cyclesStarted });
    }
    if (endRequest) await endRun(endRequest);
    refresh = false;

    // The press's own cycle starts at once, with the number the API reserved (trigger `continue`: the founder's retry rule).
    if (run && run.pendingCycleNumber !== null) {
      const cycleNumber = run.pendingCycleNumber;
      const cycleInput = run.pendingCycleInput;
      run.pendingCycleNumber = null;
      if (cycleNumber > lastStartedNumber) await runCycle(cycleNumber, "continue", null, 0, null, cycleInput);
      continue;
    }

    const held = run;
    const evaluation = await acts.autopilotEvaluate({ businessId, unrecordedFailures, ...(held ? { run: { id: held.id, startedAt: held.startedAt, unrecordedFailures: held.unrecordedFailures } } : {}) });
    if (held && run === held && evaluation.run) {
      const r = evaluation.run.decision;
      if (r.action === "end") {
        await endRun(r.reason);
        continue;
      }
      if (r.action === "wait") {
        await condition(() => refresh || stopped || endRequest !== null, evaluation.run.waitMs);
        continue;
      }
      const { cycleNumber } = await acts.nextCycleNumber({ businessId });
      await runCycle(cycleNumber, "autopilot", evaluation.cadence, evaluation.cyclesToday);
      continue;
    }
    // A press arrived while the guard rails were read: its run is looked at next round.
    if (run !== held) continue;

    const d = evaluation.decision;
    switch (d.action) {
      case "off":
        return done({ outcome: runEnded ? "run_ended" : "off", pausedReason: null, cyclesStarted });
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
        // Autopilot's own cycle (never a run's round): its own spend ceiling is the cycle's budget.
        const cap = patched(AUTOPILOT_OWN_BUDGET_PATCH) ? (evaluation.cycleBudgetMinor ?? null) : null;
        await runCycle(cycleNumber, "autopilot", evaluation.cadence, evaluation.cyclesToday, cap);
        break;
      }
    }
  }
  if (stopped) {
    await endRun("stopped");
    await acts.autopilotPause({ businessId, reason: "kill_switch" });
    return done({ outcome: "stopped", pausedReason: "kill_switch", cyclesStarted });
  }
  await condition(allHandlersFinished);
  return continueAsNew<typeof autopilot>({ businessId, cyclesStarted, unrecordedFailures, ...(run ? { run } : {}), ...(runEnded ? { runEnded } : {}), ...(input.maxRounds ? { maxRounds: input.maxRounds } : {}) });
}
