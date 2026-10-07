/**
 * holiday (BUILD §9.6 "Holiday (Automated)", §9.4): while the founder is away, Continue runs itself on the cadence
 * (default every 4 agent-hours), the Chief of Staff decides blocking items within authority, hard gates queue, and the
 * holiday ends on the `until` date/condition, a wake event (checked after every cycle and delivered by the `wake`
 * signal), the budget ceiling, the kill switch (`stop`) or the founder's return. The end builds "While you were away".
 */
import { allHandlersFinished, condition, executeChild, proxyActivities, setHandler, sleep, workflowInfo } from "@temporalio/workflow";
import type { Activities, HolidayCheck, HolidayEnd, HolidayInput, WakePayload } from "../activities";
import { businessCycle } from "./businessCycle";
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

  for (;;) {
    if (await settle()) break;
    if (cyclesRun >= MAX_HOLIDAY_CYCLES) {
      reason = "until_reached";
      break;
    }
    // 1. decide what is blocking within authority, 2. run a cycle, 3. decide what the cycle raised.
    await acts.holidayAutoDecide({ businessId: input.businessId, holiday: loaded });
    const { cycleNumber } = await acts.nextCycleNumber({ businessId: input.businessId });
    try {
      await executeChild(businessCycle, { workflowId: `cycle:${input.businessId}:${cycleNumber}`, args: [{ businessId: input.businessId, cycleNumber, trigger: "holiday", timeBoxAgentHours: loaded.cadenceAgentHours }] });
    } catch {
      // A failed or already-running cycle must not end the holiday; the next cadence tick tries again.
    }
    cyclesRun += 1;
    await acts.holidayAutoDecide({ businessId: input.businessId, holiday: loaded });
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
