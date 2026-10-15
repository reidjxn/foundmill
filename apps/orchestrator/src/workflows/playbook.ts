/**
 * playbook (BUILD §9.4): founder-defined workflows. Each compiled step becomes a one-action plan executed through the
 * typed handlers (so policy, approvals and hard gates apply exactly as for a decision); stop conditions are checked
 * between steps; `stop` ends the run.
 */
import { ParentClosePolicy, allHandlersFinished, condition, executeChild, getExternalWorkflowHandle, patched, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow";
import type { Activities, PlanActionResult, PlaybookInput } from "../activities";
import { agentSession } from "./agentSession";
import { approvalWait } from "./approvalWait";
import { channelEngine } from "./channelEngine";
import { stopSignal } from "./signals";
import { trainingRun } from "./trainingRun";

/** Playbook steps start the children their actions ask for (agent sessions, training runs, channel engines). */
export const PLAYBOOK_SPAWNS_PATCH = "playbook-spawns";

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
  for (const [index, step] of loaded.steps.entries()) {
    if (stopped) break;
    const check = await acts.playbookShouldStop({ businessId: input.businessId, playbookId: input.playbookId, stop: loaded.stop, startedAt, runsSoFar: stepsRun });
    if (check.stop) {
      stopped = check.reason;
      break;
    }
    // A step the founder asked to approve (`approvals`) waits for the decision: every run, or the first run of the playbook.
    const requireApproval = (loaded.approvals ?? []).some((a) => a.step === index && (a.scope === "every_run" || loaded.firstRun));
    const { planId, actionIds } = await acts.playbookStepToPlan({ businessId: input.businessId, playbookId: input.playbookId, step, event: input.event ? { type: input.event.type, payload: input.event.payload } : null, requireApproval });
    if (!planId) continue;
    for (const actionId of actionIds) {
      let result = await acts.executePlanAction({ businessId: input.businessId, planId, actionId, workflowId: info.workflowId });
      if (result.status === "awaiting_approval" && result.approvalId) {
        const decision = await executeChild(approvalWait, { workflowId: `approval:${result.approvalId}`, args: [{ businessId: input.businessId, approvalId: result.approvalId, planActionId: actionId }] });
        result = await acts.executePlanAction({ businessId: input.businessId, planId, actionId, workflowId: info.workflowId, approved: decision.outcome === "approved", approvalId: result.approvalId });
      }
      results.push(result);
      // A model change's superseded retests stop (replays of older histories carry no `stop`, so they emit nothing new).
      for (const id of result.stop ?? []) {
        try {
          await getExternalWorkflowHandle(id).signal(stopSignal, { reason: "superseded by a model change", by: null });
        } catch {
          // Not running.
        }
      }
      // A step's `create_task` opens its session row before returning (so the row carries `session:<id>`); start the
      // child it asks for, as planExecution does, so no row is left open with no workflow behind it. Histories recorded
      // before this never started children and replay without it.
      if (patched(PLAYBOOK_SPAWNS_PATCH)) {
        for (const s of result.spawn) {
          try {
            if (s.workflow === "agentSession") await startChild(agentSession, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
            else if (s.workflow === "trainingRun") await startChild(trainingRun, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
            else if (s.workflow === "channelEngine") await startChild(channelEngine, { workflowId: s.workflowId, args: [s.args as never], parentClosePolicy: ParentClosePolicy.ABANDON });
          } catch {
            // Already running under its deterministic id: nothing to do.
          }
        }
      }
    }
    await acts.finishPlan({ businessId: input.businessId, planId });
    stepsRun += 1;
  }
  await acts.markPlaybookRun({ businessId: input.businessId, playbookId: input.playbookId });
  await condition(allHandlersFinished);
  return { playbookId: input.playbookId, stepsRun, stoppedReason: stopped, results };
}
