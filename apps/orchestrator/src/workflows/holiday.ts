/**
 * holiday (BUILD §9.6 "Holiday (Automated)", §9.4): while the founder is away, Continue runs itself on the cadence
 * (default every 4 agent-hours), the Chief of Staff decides blocking items within authority, hard gates queue, and the
 * holiday ends on the `until` date/condition, a wake event (checked after every cycle and delivered by the `wake`
 * signal), the budget ceiling, the kill switch (`stop`) or the founder's return. The end builds "While you were away".
 *
 * Every decision the Chief of Staff takes is carried out (audit O-16): `holidayAutoDecide` writes each decision's plan
 * and returns the plans still to run, and this workflow starts `planExecution` for each as `plan:<id>` (abandoned on
 * close, like a founder's plan the API dispatches), so tasks, sessions and channel engines start as for any decision.
 *
 * Versioning: no patch marker is needed. What starts a plan is the activity's answer, and an answer recorded by the old
 * activity carries no `planIds`, so a vacation running when this deploys replays its recorded passes starting nothing
 * and starts plans from its first new pass on (holiday.replay.test.ts replays histories recorded on the old code).
 */
import { ParentClosePolicy, allHandlersFinished, condition, executeChild, proxyActivities, setHandler, sleep, startChild, workflowInfo } from "@temporalio/workflow";
import type { Activities, HolidayCheck, HolidayEnd, HolidayInput, WakePayload } from "../activities";
import { businessCycle } from "./businessCycle";
import { planExecution } from "./planExecution";
import { stopSignal, wakeSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const HOUR_MS = 60 * 60 * 1000;
/** Safety valve: a holiday never runs more cycles than this without a founder return. */
export const MAX_HOLIDAY_CYCLES = 400;

export interface HolidayResult extends HolidayEnd {
  reason: NonNullable<HolidayCheck["reason"]>;
  wakeEventType: string | null;
}

export async function holiday(input: HolidayInput): Promise<HolidayResult> {
  const info = workflowInfo();
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
  let cyclesRun = 0;
  let reason: NonNullable<HolidayCheck["reason"]> | null = null;
  let wakeEventType: string | null = null;

  const settle = async (): Promise<boolean> => {
    if (stopped) {
      reason = "kill_switch";
      return true;
    }
    if (wake) {
      const w: WakePayload = wake;
      reason = "wake_event";
      wakeEventType = w.eventType;
      return true;
    }
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
      reason = "until_reached";
      break;
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
    await decide();
    if (await settle()) break;
    // Sleep the cadence, waking early on a wake event or the kill switch.
    await condition(() => wake !== null || stopped !== null, cadenceMs);
  }

  const end = await acts.endHoliday({ businessId: input.businessId, holiday: loaded, reason: reason ?? "founder_returned", wakeEventType, cyclesRun });
  await condition(allHandlersFinished);
  void info;
  return { ...end, reason: reason ?? "founder_returned", wakeEventType };
}

/** Sleep helper exported for the simulation harness (keeps `sleep` referenced from workflow code). */
export const holidaySleep = sleep;
