/**
 * Changing agents' model (BUILD §11.10, AC-11.10.5): one implementation for Agent profile › Model (`agent.model.set`)
 * and for a plan's `set_agent_model` action, whether the api runs it as the founder decides an Inbox option or the
 * orchestrator runs it as a playbook or a confirmed plan step. Both skip work locked to one model, warn on a downgrade
 * and queue a retest of each changed agent on a draft copy of its live version (audit api-services-28, FU-T2-2). The
 * change is written inside the caller's transaction; the caller starts the retests' `trainingRun` workflows after it
 * commits, and stops those listed as superseded.
 */
import { getTemplateByAgentType } from "@foundmill/agents";
import { resolveModel, type RouteKey } from "@foundmill/models";
import type { ModelKey } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { Agent } from "./schema";

/** The model route an agent's work runs on: its template's, else the worker route. */
export const routeOf = (agent: Pick<Agent, "agentType">): RouteKey => getTemplateByAgentType(agent.agentType)?.route ?? "worker";

export interface ModelChange {
  updated: string[];
  skipped: { agentId: string; reason: string }[];
  warnings: string[];
  /** Retest training runs queued for the changed agents (their workflows start after commit). */
  retests: string[];
  /** Earlier retests of a model these agents no longer run, canceled here; their workflows are stopped after commit. */
  superseded: string[];
}

/**
 * Moves `targets` to `modelKey` inside the caller's transaction. The agent works on the new model at once; each changed
 * agent gets a retest run on a draft copy of its live version (`repos.training.createModelRetest`), whose Promote makes
 * the copy live on the new model. An agent already on the model has nothing new to retest.
 */
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
