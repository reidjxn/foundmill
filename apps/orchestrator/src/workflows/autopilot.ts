/**
 * autopilot (BUILD §11.3 "In Automated mode Continue auto-runs"): one long-lived workflow per business in Automated
 * mode, `autopilot:<businessId>`. Each tick it lets the Chief of Staff answer what blocks Continue within Automated mode's
 * authority, runs a cycle, answers what the cycle raised (and runs the next cycle straight away while that keeps
 * unblocking work, a few times at most), then waits for the cadence. It holds while a vacation runs (that workflow does
 * the same job) or the team is stopped, and ends when the mode changes (`stop` signal or the next check). Every
 * AUTOPILOT_CYCLES_PER_RUN cycles it continues as new, so its history stays short.
 */
import { allHandlersFinished, condition, continueAsNew, executeChild, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, AutopilotInput } from "../activities";
import { HOLIDAY_CYCLES_PER_RUN } from "../holiday-contract";
import { businessCycle } from "./businessCycle";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const HOUR_MS = 60 * 60 * 1000;
/** Cycles one run holds before it continues as new. */
export const AUTOPILOT_CYCLES_PER_RUN = HOLIDAY_CYCLES_PER_RUN;
/** Back-to-back cycles in one tick while the decisions the last one raised keep unblocking work. */
export const AUTOPILOT_CHAINED_CYCLES = 3;
/** How long a held autopilot (vacation, stopped team) waits before it looks again. */
const HOLD_MS = 30 * 60 * 1000;

export interface AutopilotResult {
  cyclesRun: number;
  reason: "mode_changed" | "archived" | "stopped";
}

export async function autopilot(input: AutopilotInput): Promise<AutopilotResult> {
  let stopped = false;
  setHandler(stopSignal, () => {
    stopped = true;
  });
  const loaded = await acts.loadAutopilot({ businessId: input.businessId });
  const cadenceMs = Math.max(60_000, (input.cadenceAgentHours ?? loaded.cadenceAgentHours) * HOUR_MS);
  let cyclesRun = input.cyclesRun ?? 0;
  let cyclesThisRun = 0;

  for (;;) {
    if (stopped) return { cyclesRun, reason: "stopped" };
    const check = await acts.autopilotCheck({ businessId: input.businessId });
    if (!check.active) return { cyclesRun, reason: check.reason === "archived" ? "archived" : "mode_changed" };
    if (check.hold) {
      await condition(() => stopped, HOLD_MS);
      continue;
    }
    if (cyclesThisRun >= AUTOPILOT_CYCLES_PER_RUN) {
      await condition(allHandlersFinished);
      return continueAsNew<typeof autopilot>({ ...input, cyclesRun });
    }
    await acts.autopilotAutoDecide({ businessId: input.businessId, autopilot: loaded });
    for (let chained = 0; chained < AUTOPILOT_CHAINED_CYCLES && !stopped; chained++) {
      const { cycleNumber } = await acts.autopilotNextCycleNumber({ businessId: input.businessId });
      try {
        await executeChild(businessCycle, { workflowId: `cycle:${input.businessId}:${cycleNumber}`, args: [{ businessId: input.businessId, cycleNumber, trigger: "schedule", timeBoxAgentHours: loaded.cadenceAgentHours }] });
      } catch {
        // A failed cycle, or one the founder started a moment ago, must not end the autopilot; the next tick tries again.
        break;
      }
      cyclesRun += 1;
      cyclesThisRun += 1;
      const decided = await acts.autopilotAutoDecide({ businessId: input.businessId, autopilot: loaded });
      if (decided.decided === 0) break;
    }
    await condition(() => stopped, cadenceMs);
  }
}
