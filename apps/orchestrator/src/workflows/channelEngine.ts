/**
 * channelEngine (BUILD §9.4, §11.7): long-running per enabled channel. Each week: plan → create → approve → launch →
 * measure → learn → report, then `continueAsNew` with the carried state so the history never grows unbounded. The
 * approve step waits on the founder (approvalWait child) in augmented or kit mode; `stop` ends the engine.
 */
import { allHandlersFinished, condition, continueAsNew, executeChild, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities } from "../activities";
import { CHANNEL_STEPS, type ChannelEngineInput, type ChannelEngineState, type ChannelStep } from "../activities/types";
import { approvalWait } from "./approvalWait";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Spacing between the measure/learn steps inside a week (the launch needs time to produce numbers). */
export const MEASURE_DELAY_MS = 24 * 60 * 60 * 1000;

export interface ChannelEngineResult {
  channelId: string;
  weeksRun: number;
  stoppedReason: string | null;
}

export async function channelEngine(input: ChannelEngineInput): Promise<ChannelEngineResult> {
  const info = workflowInfo();
  let stopped: string | null = null;
  setHandler(stopSignal, (s) => {
    stopped = s?.reason ?? "stopped";
  });
  const weekIndex = input.weekIndex ?? 0;
  let state: ChannelEngineState = input.state ?? { campaignId: null, approvalId: null, lastStep: null, weeksRun: 0, learnings: [] };
  const weekStart = Date.now();

  for (const step of CHANNEL_STEPS as readonly ChannelStep[]) {
    if (stopped) break;
    if (step === "measure" || step === "learn") {
      // Give the launch time to produce data; wake early on stop.
      await condition(() => stopped !== null, MEASURE_DELAY_MS);
      if (stopped) break;
    }
    let result = await acts.channelStep({ businessId: input.businessId, channelId: input.channelId, channelKey: input.channelKey, step, weekIndex, state });
    state = result.state;
    if (result.stop) {
      stopped = "channel disabled";
      break;
    }
    if (result.awaitingApprovalId) {
      const decision = await executeChild(approvalWait, { workflowId: `approval:${result.awaitingApprovalId}`, args: [{ businessId: input.businessId, approvalId: result.awaitingApprovalId, timeoutMs: WEEK_MS - (Date.now() - weekStart) }] });
      if (decision.outcome === "approved") {
        result = await acts.channelStep({ businessId: input.businessId, channelId: input.channelId, channelKey: input.channelKey, step, weekIndex, state, approvedApprovalId: result.awaitingApprovalId });
        state = result.state;
      } else {
        state = { ...state, approvalId: null };
      }
    }
  }

  if (stopped) {
    await condition(allHandlersFinished);
    return { channelId: input.channelId, weeksRun: state.weeksRun, stoppedReason: stopped };
  }
  // Rest of the week, then start over with the carried learnings.
  const remaining = WEEK_MS - (Date.now() - weekStart);
  if (remaining > 0) await condition(() => stopped !== null, remaining);
  if (stopped) {
    await condition(allHandlersFinished);
    return { channelId: input.channelId, weeksRun: state.weeksRun, stoppedReason: stopped };
  }
  void info;
  await condition(allHandlersFinished);
  await continueAsNew<typeof channelEngine>({ ...input, weekIndex: weekIndex + 1, state });
  // unreachable
  return { channelId: input.channelId, weeksRun: state.weeksRun, stoppedReason: null };
}
