/**
 * holiday (BUILD §9.6 "Holiday (Automated)", §9.4): while the founder is away, Continue runs itself on the cadence
 * (default every 4 agent-hours), the Chief of Staff decides blocking items within authority, hard gates queue, and the
 * holiday ends on the `until` date/condition, a wake event (checked after every cycle and delivered by the `wake`
 * signal), the budget ceiling, the kill switch or the founder's return (`stop`, whose reason says which), or its safety
 * limit of MAX_HOLIDAY_CYCLES cycles (reason `cycle_cap`). The end builds "While you were away" once.
 *
 * Every decision the Chief of Staff takes is carried out (audit O-16): `holidayAutoDecide` writes each decision's plan
 * and returns the plans still to run, and this workflow starts `planExecution` for each as `plan:<id>` (abandoned on
 * close, like a founder's plan the API dispatches), so tasks, sessions and channel engines start as for any decision.
 *
 * A long vacation keeps a short history: every HOLIDAY_CYCLES_PER_RUN cycles the workflow continues as new, carrying
 * the cycles run so far (audit SOAK-10).
 *
 * Versioning: what starts a plan is the activity's answer, and an answer recorded by the old activity carries no
 * `planIds`, so a vacation running when this deploys replays its recorded passes starting nothing and starts plans from
 * its first new pass on (holiday.replay.test.ts replays histories recorded on the old code).
 */
import { ParentClosePolicy, allHandlersFinished, condition, continueAsNew, executeChild, patched, proxyActivities, setHandler, sleep, startChild, workflowInfo } from "@temporalio/workflow";
import type { Activities, HolidayCheck, HolidayEnd, HolidayInput, WakePayload } from "../activities";
import { HOLIDAY_CYCLES_PER_RUN, MAX_HOLIDAY_CYCLES } from "../holiday-contract";
import { businessCycle } from "./businessCycle";
import { planExecution } from "./planExecution";
import { stopSignal, wakeSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const HOUR_MS = 60 * 60 * 1000;
export { HOLIDAY_CYCLES_PER_RUN, MAX_HOLIDAY_CYCLES };
/** Long vacations continue as new; histories recorded before this replay without. */
export const HOLIDAY_CONTINUE_AS_NEW_PATCH = "holiday-continue-as-new";

export interface HolidayResult extends HolidayEnd {
  reason: NonNullable<HolidayCheck["reason"]>;
  wakeEventType: string | null;
}

/** The end reason a `stop` signal carries: the founder's "Come back" or, for anything else, the kill switch. */
export function stopReason(reason: string | null | undefined): "founder_returned" | "kill_switch" {
  return reason === "founder_returned" ? "founder_returned" : "kill_switch";
}

export async function holiday(input: HolidayInput): Promise<HolidayResult> {
  let wake: WakePayload | null = null;
  let stopped: { reason: string } | null = null;
  setHandler(wakeSignal, (w) => {
    if (!wake) wake = w;
  });
  setHandler(stopSignal, (s) => {
    stopped = { reason: s?.reason ?? "kill_switch" };
  });

  const loaded = await acts.loadHoliday(input);
  const cadenceMs = Math.max(60_000, loaded.cadenceAgentHours * HOUR_MS);
  let cyclesRun = input.cyclesRun ?? 0;
  let cyclesThisRun = 0;
  let reason: NonNullable<HolidayCheck["reason"]> | null = null;
  let wakeEventType: string | null = null;

  /** Signals first (they arrive between checks), then the end conditions the activity reads. */
  const signalled = (): boolean => {
    const stop = stopped as { reason: string } | null;
    if (stop) {
      reason = stopReason(stop.reason);
      return true;
    }
    if (wake) {
      const w: WakePayload = wake;
      reason = "wake_event";
      wakeEventType = w.eventType;
      return true;
    }
    return false;
  };
  const settle = async (): Promise<boolean> => {
    if (signalled()) return true;
    const check = await acts.holidayCheck({ businessId: input.businessId, holiday: loaded });
    if (check.shouldEnd && check.reason) {
      reason = check.reason;
      wakeEventType = check.wakeEventType;
      return true;
    }
    return false;
  };

  /** Decide what is blocking within authority, then start every decision's plan that is not running yet. */
  const decide = async (): Promise<void> => {
    const decided = await acts.holidayAutoDecide({ businessId: input.businessId, holiday: loaded });
    // `?? []`: an answer recorded by the old activity, or from a worker still on it mid-deploy, has no plans; a plan
    // decided then is still executing, so the next pass hands it back.
    for (const planId of decided.planIds ?? []) {
      try {
        await startChild(planExecution, { workflowId: `plan:${planId}`, args: [{ businessId: input.businessId, planId }], parentClosePolicy: ParentClosePolicy.ABANDON });
      } catch {
        // Already running under its deterministic id (an earlier pass started it): nothing to do.
      }
    }
  };

  for (;;) {
    if (await settle()) break;
    if (cyclesRun >= MAX_HOLIDAY_CYCLES) {
      reason = "cycle_cap";
      break;
    }
    if (cyclesThisRun >= HOLIDAY_CYCLES_PER_RUN && patched(HOLIDAY_CONTINUE_AS_NEW_PATCH)) {
      // Checked in the same turn as the hand-over, so a stop or wake that just arrived ends the vacation instead.
      if (signalled()) break;
      await condition(allHandlersFinished);
      return continueAsNew<typeof holiday>({ ...input, cyclesRun });
    }
    // 1. decide what is blocking within authority, 2. run a cycle, 3. decide what the cycle raised.
    await decide();
    const { cycleNumber } = await acts.nextCycleNumber({ businessId: input.businessId });
    try {
      await executeChild(businessCycle, { workflowId: `cycle:${input.businessId}:${cycleNumber}`, args: [{ businessId: input.businessId, cycleNumber, trigger: "holiday", timeBoxAgentHours: loaded.cadenceAgentHours }] });
    } catch {
      // A failed or already-running cycle must not end the holiday; the next cadence tick tries again.
    }
    cyclesRun += 1;
    cyclesThisRun += 1;
    await decide();
    if (await settle()) break;
    // Sleep the cadence, waking early on a wake event or the kill switch.
    await condition(() => wake !== null || stopped !== null, cadenceMs);
  }

  const ending = reason ?? "founder_returned";
  const end = await acts.endHoliday({ businessId: input.businessId, holiday: loaded, reason: ending, wakeEventType, cyclesRun });
  await condition(allHandlersFinished);
  return { ...end, reason: ending, wakeEventType };
}

/** Sleep helper exported for the simulation harness (keeps `sleep` referenced from workflow code). */
export const holidaySleep = sleep;
