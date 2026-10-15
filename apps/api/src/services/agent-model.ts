/**
 * Changing agents' model (BUILD §11.10, AC-11.10.5). The change itself (skip work locked to one model, warn on a
 * downgrade, queue a retest of each changed agent on a draft copy of its live version) is `changeAgentModels` in
 * @foundmill/db, shared with the orchestrator's `set_agent_model` plan step (FU-T2-2). This file starts and stops the
 * retests' workflows after the caller's transaction commits (`startModelRetests`).
 */
import { changeAgentModels, routeOf, type ModelChange } from "@foundmill/db";
import { SIGNALS, WORKFLOWS, workflowIds, type TemporalService } from "./temporal";

export { changeAgentModels, routeOf, type ModelChange };

/**
 * After commit: stop the superseded retests and start the new ones (each degrades to `{ queued: false }` without
 * Temporal). While the team is stopped (`waitForResume`) the retests stay queued instead: a retest spends credits, so
 * it starts when the agents resume (Resume agents, a new key or a top-up; killswitch.ts).
 */
export async function startModelRetests(temporal: TemporalService, businessId: string, change: Pick<ModelChange, "retests" | "superseded">, options: { waitForResume?: boolean } = {}) {
  if (change.superseded.length) await temporal.signalMany(change.superseded.map((runId) => workflowIds.training(runId)), SIGNALS.stop);
  if (options.waitForResume) {
    return change.retests.map((runId) => ({ runId, workflow: { queued: false, workflowId: workflowIds.training(runId), reason: "agents are stopped; the retest starts when they resume" } }));
  }
  const workflows = await Promise.all(change.retests.map((runId) => temporal.start(WORKFLOWS.trainingRun, { workflowId: workflowIds.training(runId), args: [{ businessId, trainingRunId: runId }] })));
  return change.retests.map((runId, i) => ({ runId, workflow: workflows[i]! }));
}
