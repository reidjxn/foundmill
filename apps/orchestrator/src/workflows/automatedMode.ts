/**
 * automatedMode (BUILD §11.3 "In Automated mode Continue auto-runs"): one long-lived workflow per business in Automated
 * mode, `automated:<businessId>`. Each tick it lets the Chief of Staff answer what blocks Continue within Automated mode's
 * authority, runs a cycle, answers what the cycle raised (and runs the next cycle straight away while that keeps
 * unblocking work, a few times at most), then waits for the cadence. It holds while a vacation runs (that workflow does
 * the same job) or the team is stopped, and ends when the mode changes (`stop` signal or the next check). Every
 * AUTOMATED_MODE_CYCLES_PER_RUN cycles it continues as new, so its history stays short.
 */
import { allHandlersFinished, condition, continueAsNew, executeChild, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, AutomatedModeInput } from "../activities";
import { HOLIDAY_CYCLES_PER_RUN } from "../holiday-contract";
import { businessCycle } from "./businessCycle";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });
const HOUR_MS = 60 * 60 * 1000;
/** Cycles one run holds before it continues as new. */
export const AUTOMATED_MODE_CYCLES_PER_RUN = HOLIDAY_CYCLES_PER_RUN;
/** Back-to-back cycles in one tick while the decisions the last one raised keep unblocking work. */
export const AUTOMATED_MODE_CHAINED_CYCLES = 3;
/** How long a held loop (vacation, stopped team) waits before it looks again. */
const HOLD_MS = 30 * 60 * 1000;

export interface AutomatedModeResult {
  cyclesRun: number;
  reason: "mode_changed" | "archived" | "stopped";
}

export async function automatedMode(input: AutomatedModeInput): Promise<AutomatedModeResult> {
  let stopped = false;
  setHandler(stopSignal, () => {
    stopped = true;
  });
  const loaded = await acts.loadAutomatedMode({ businessId: input.businessId });
  const cadenceMs = Math.max(60_000, (input.cadenceAgentHours ?? loaded.cadenceAgentHours) * HOUR_MS);
  let cyclesRun = input.cyclesRun ?? 0;
  let cyclesThisRun = 0;

  for (;;) {
    if (stopped) return { cyclesRun, reason: "stopped" };
    const check = await acts.automatedModeCheck({ businessId: input.businessId });
    if (!check.active) return { cyclesRun, reason: check.reason === "archived" ? "archived" : "mode_changed" };
    if (check.hold) {
      await condition(() => stopped, HOLD_MS);
      continue;
    }
    if (cyclesThisRun >= AUTOMATED_MODE_CYCLES_PER_RUN) {
      await condition(allHandlersFinished);
      return continueAsNew<typeof automatedMode>({ ...input, cyclesRun });
    }
    await acts.automatedModeAutoDecide({ businessId: input.businessId, automatedMode: loaded });
    for (let chained = 0; chained < AUTOMATED_MODE_CHAINED_CYCLES && !stopped; chained++) {
      const { cycleNumber } = await acts.automatedModeNextCycleNumber({ businessId: input.businessId });
      try {
        await executeChild(businessCycle, { workflowId: `cycle:${input.businessId}:${cycleNumber}`, args: [{ businessId: input.businessId, cycleNumber, trigger: "schedule", timeBoxAgentHours: loaded.cadenceAgentHours }] });
      } catch {
        // A failed cycle, or one the founder started a moment ago, must not end the loop; the next tick tries again.
        break;
      }
      cyclesRun += 1;
      cyclesThisRun += 1;
      const decided = await acts.automatedModeAutoDecide({ businessId: input.businessId, automatedMode: loaded });
      if (decided.decided === 0) break;
    }
    await condition(() => stopped, cadenceMs);
  }
}
