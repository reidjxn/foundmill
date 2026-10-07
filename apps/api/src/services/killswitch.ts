/**
 * business.stopAllAgents — the kill switch (BUILD §14: ≤ 30 s; pauses workflows, engines and campaigns).
 * Signals every running workflow of the business within the budget, marks every agent paused, pauses running
 * tasks and live campaigns, writes the audit entry and one `agent.health_changed` event per agent that changed.
 * Works without Temporal: the local state is always written; the signal result reports `{ queued: false, reason }`.
 */
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { workflowIds, type SignalManyResult } from "./temporal";

export interface StopAllResult {
  pausedAgents: number;
  pausedTasks: number;
  pausedCampaigns: number;
  workflows: SignalManyResult;
  elapsedMs: number;
  budgetMs: number;
}

export async function stopAllAgents(ctx: BusinessContext, reason = "kill_switch"): Promise<StopAllResult> {
  const started = Date.now();
  const budgetMs = LIMITS.killSwitchSeconds * 1000;
  const { businessId } = ctx;

  const [sessions, channels, plans, holiday, agentsBefore, runningTasks, campaigns] = await Promise.all([
    repos.agents.listSessions(ctx.db, businessId, { openOnly: true, limit: 500 }),
    repos.channels.list(ctx.db, businessId, { enabled: true }),
    repos.plans.list(ctx.db, businessId, { status: "executing", limit: 500 }),
    repos.holidays.current(ctx.db, businessId),
    repos.agents.list(ctx.db, businessId, { limit: 500 }),
    repos.tasks.list(ctx.db, businessId, { status: "running", limit: 500 }),
    repos.campaigns.active(ctx.db, businessId),
  ]);

  const ids = new Set<string>();
  for (const s of sessions.items) ids.add(s.workflowId ?? workflowIds.session(s.id));
  for (const c of channels) if (c.engineWorkflowId) ids.add(c.engineWorkflowId);
  for (const p of plans.items) if (p.workflowId) ids.add(p.workflowId);
  if (holiday) ids.add(workflowIds.holiday(holiday.id));

  // Signals first (the clock is running), with most of the budget; local writes follow and are fast.
  const workflows = await ctx.temporal.signalMany([...ids], "stop", [{ reason, by: ctx.userId }], Math.max(1_000, budgetMs - 8_000));

  const local = await ctx.rls(async (tx) => {
    const pausedAgents = await repos.agents.pauseAll(tx, businessId);
    let pausedTasks = 0;
    for (const task of runningTasks.items) {
      await repos.tasks.setStatus(tx, businessId, task.id, "paused");
      pausedTasks++;
    }
    let pausedCampaigns = 0;
    for (const c of campaigns) {
      if (c.status === "live") {
        await repos.campaigns.setStatus(tx, businessId, c.id, "paused");
        pausedCampaigns++;
      }
    }
    for (const a of agentsBefore.items) {
      if (a.status === "paused" || a.archivedAt) continue;
      await emit(tx, ctx, {
        type: "agent.health_changed",
        payload: { agentId: a.id, from: a.status, to: "paused", reason: "Stop all agents (kill switch)", signals: {}, expectedReturnAt: null, sessionId: null },
      });
    }
    await audit(tx, ctx, {
      action: "business.stop_all_agents",
      target: { kind: "business", id: businessId },
      details: { reason, pausedAgents, pausedTasks, pausedCampaigns, signalled: workflows.signalled.length, failed: workflows.failed.length, temporalQueued: workflows.queued, temporalReason: workflows.reason ?? null },
    });
    return { pausedAgents, pausedTasks, pausedCampaigns };
  });

  return { ...local, workflows, elapsedMs: Date.now() - started, budgetMs };
}
