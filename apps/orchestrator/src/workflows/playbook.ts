/**
 * playbook (BUILD §9.4): founder-defined workflows. Each compiled step becomes a one-action plan executed through the
 * typed handlers (so policy, approvals and hard gates apply exactly as for a decision); stop conditions are checked
 * between steps; `stop` ends the run.
 */
import { allHandlersFinished, condition, executeChild, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities, PlanActionResult, PlaybookInput } from "../activities";
import { approvalWait } from "./approvalWait";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3 } });

export interface PlaybookResult {
  playbookId: string;
  stepsRun: number;
  stoppedReason: string | null;
  results: PlanActionResult[];
}

export async function playbook(input: PlaybookInput): Promise<PlaybookResult> {
  const info = workflowInfo();
  let stopped: string | null = null;
  setHandler(stopSignal, (s) => {
    stopped = s?.reason ?? "stopped";
  });
  const startedAt = new Date().toISOString();
  const loaded = await acts.loadPlaybook({ businessId: input.businessId, playbookId: input.playbookId });
  const results: PlanActionResult[] = [];
  if (!loaded.enabled) {
    await condition(allHandlersFinished);
    return { playbookId: input.playbookId, stepsRun: 0, stoppedReason: "disabled", results };
  }
  let stepsRun = 0;
  for (const step of loaded.steps) {
    if (stopped) break;
    const check = await acts.playbookShouldStop({ businessId: input.businessId, playbookId: input.playbookId, stop: loaded.stop, startedAt, runsSoFar: stepsRun });
    if (check.stop) {
      stopped = check.reason;
      break;
    }
    const { planId, actionIds } = await acts.playbookStepToPlan({ businessId: input.businessId, playbookId: input.playbookId, step, event: input.event ? { type: input.event.type, payload: input.event.payload } : null });
    if (!planId) continue;
    for (const actionId of actionIds) {
      let result = await acts.executePlanAction({ businessId: input.businessId, planId, actionId, workflowId: info.workflowId });
      if (result.status === "awaiting_approval" && result.approvalId) {
        const decision = await executeChild(approvalWait, { workflowId: `approval:${result.approvalId}`, args: [{ businessId: input.businessId, approvalId: result.approvalId, planActionId: actionId }] });
        result = await acts.executePlanAction({ businessId: input.businessId, planId, actionId, workflowId: info.workflowId, approved: decision.outcome === "approved", approvalId: result.approvalId });
      }
      results.push(result);
    }
    await acts.finishPlan({ businessId: input.businessId, planId });
    stepsRun += 1;
  }
  await acts.markPlaybookRun({ businessId: input.businessId, playbookId: input.playbookId });
  await condition(allHandlersFinished);
  return { playbookId: input.playbookId, stepsRun, stoppedReason: stopped, results };
}
