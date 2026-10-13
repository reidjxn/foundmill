/**
 * Changing agents' model (BUILD §11.10, AC-11.10.5): one implementation for Agent profile › Model (`agent.model.set`)
 * and for a plan's `set_agent_model` action (an Inbox decision or a confirmed plan), so both skip work locked to one
 * model, warn on a downgrade and queue a retest of each changed agent on a draft copy of its live version (audit
 * api-services-28). The change is written inside the caller's transaction; the retest workflows start after it commits
 * (`startModelRetests`).
 */
import { getTemplateByAgentType } from "@foundmill/agents";
import { repos, type Agent, type Executor } from "@foundmill/db";
import { resolveModel, type RouteKey } from "@foundmill/models";
import type { ModelKey } from "@foundmill/shared";
import { SIGNALS, WORKFLOWS, workflowIds, type TemporalService } from "./temporal";

export const routeOf = (agent: Agent): RouteKey => getTemplateByAgentType(agent.agentType)?.route ?? "worker";

export interface ModelChange {
  updated: string[];
  skipped: { agentId: string; reason: string }[];
  warnings: string[];
  /** Retest training runs queued for the changed agents (their workflows start after commit). */
  retests: string[];
  /** Earlier retests of a model these agents no longer run, canceled here; their workflows are stopped after commit. */
  superseded: string[];
}

/** Moves `targets` to `modelKey` inside the caller's transaction. */
export async function changeAgentModels(tx: Executor, businessId: string, targets: readonly Agent[], modelKey: ModelKey, requestedBy: string | null): Promise<ModelChange> {
  const change: ModelChange = { updated: [], skipped: [], warnings: [], retests: [], superseded: [] };
  for (const agent of targets) {
    const r = resolveModel(routeOf(agent), modelKey);
    if (r.locked && r.modelKey !== modelKey) {
      change.skipped.push({ agentId: agent.id, reason: r.warning ?? "this work is locked to one model" });
      continue;
    }
    if (r.warning) change.warnings.push(`${agent.name}: ${r.warning}`);
    await repos.agents.setModel(tx, businessId, agent.id, modelKey);
    change.updated.push(agent.id);
    // An agent already on this model has nothing new to retest.
    if (agent.modelKey === modelKey) continue;
    const { retest, superseded } = await repos.training.createModelRetest(tx, businessId, agent.id, { modelKey, requestedBy });
    change.superseded.push(...superseded.map((run) => run.id));
    if (retest) change.retests.push(retest.run.id);
  }
  return change;
}

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
