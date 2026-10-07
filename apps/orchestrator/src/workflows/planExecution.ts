/**
 * planExecution (BUILD §11.3 "Decision → execution"): run a confirmed plan's actions in order through the typed
 * handlers. `ask` outcomes open an approvalWait child and continue on the founder's decision; hard gates become
 * founder tasks and never execute; `deny` is recorded. Children the handlers request (agent sessions, training runs,
 * channel engines) are started with their deterministic ids.
 */
import { ParentClosePolicy, allHandlersFinished, condition, executeChild, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow";
import type { Activities, PlanActionResult } from "../activities";
import { agentSession } from "./agentSession";
import { approvalWait } from "./approvalWait";
import { channelEngine } from "./channelEngine";
import { stopSignal } from "./signals";
import { trainingRun } from "./trainingRun";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

export interface PlanExecutionInput {
  businessId: string;
  planId: string;
}

export interface PlanExecutionResult {
  planId: string;
  status: string;
  results: PlanActionResult[];
  spawned: string[];
}

export async function planExecution(input: PlanExecutionInput): Promise<PlanExecutionResult> {
  const info = workflowInfo();
  let stopped = false;
  setHandler(stopSignal, () => {
    stopped = true;
  });

  const plan = await acts.loadPlan(input);
  const results: PlanActionResult[] = [];
  const spawned: string[] = [];
  for (const action of plan.actions) {
    if (stopped) break;
    if (action.status !== "pending" && action.status !== "awaiting_approval") continue;
    let result = await acts.executePlanAction({ businessId: input.businessId, planId: input.planId, actionId: action.id, workflowId: info.workflowId });
    if (result.status === "awaiting_approval" && result.approvalId) {
      const decision = await executeChild(approvalWait, { workflowId: `approval:${result.approvalId}`, args: [{ businessId: input.businessId, approvalId: result.approvalId, planActionId: action.id }] });
      if (decision.outcome === "approved") {
        result = await acts.executePlanAction({ businessId: input.businessId, planId: input.planId, actionId: action.id, workflowId: info.workflowId, approved: true, approvalId: result.approvalId });
      } else {
        // Re-running records the rejection on the action (denied) without executing anything.
        result = await acts.executePlanAction({ businessId: input.businessId, planId: input.planId, actionId: action.id, workflowId: info.workflowId });
      }
    }
    results.push(result);
    for (const s of result.spawn) {
      try {
        if (s.workflow === "agentSession") await startChild(agentSession, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
        else if (s.workflow === "trainingRun") await startChild(trainingRun, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
        else if (s.workflow === "channelEngine") await startChild(channelEngine, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
        spawned.push(s.workflowId);
      } catch {
        // Already running under its deterministic id: nothing to do.
      }
    }
  }
  const finished = await acts.finishPlan(input);
  await condition(allHandlersFinished);
  return { planId: input.planId, status: finished.status, results, spawned };
}
