/**
 * business.stopAllAgents — the kill switch (BUILD §14: ≤ 30 s; pauses workflows, engines and campaigns) — and
 * business.resumeAgents, its only way back.
 *
 * Stop signals every running workflow of the business within the budget: Autopilot (`autopilot:<businessId>`, which
 * also pauses in the same transaction as the flag and stays paused through the resume), each open session by its computed id
 * `session:<id>` (never a stored placeholder), the running business cycle (whose children it fans out to, a vacation's
 * cycle included), every enabled channel's engine `engine:<channelId>`, executing plans and the vacation. It then sets
 * the business's stop flag (0023), marks every agent paused with the reason, pauses running tasks and live campaigns,
 * writes the audit entry and one `agent.health_changed` per agent that changed. While the flag is set every path that
 * starts work refuses (`assertAgentsRunning` in stop-guard.ts; the orchestrator's dispatch guard), so a task start, a
 * channel toggle or a cycle cannot undo it. Works without Temporal: the local state is always written; the signal
 * result reports `{ queued: false, reason }`.
 *
 * Resume (owner or admin) lifts the flag, sets the agents the stop paused back to idle and restarts the channel engines
 * that were running. It refuses while the team could not run anyway: a business on its own key with no key stored, or
 * a credit balance used up. Live campaigns the stop paused stay paused (they spend money; Distribution resumes them).
 */
import { LIMITS } from "@foundmill/config";
import { autopilotChangedPayload, periodOf, repos, resumeBusinessAgents, stopBusinessAgents, type Executor } from "@foundmill/db";
import type { AgentStopReason } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { cycleStatus } from "./cycle";
import { AgentsStoppedError } from "./stop-guard";
import { WORKFLOWS, workflowIds, type SignalManyResult, type TemporalResult } from "./temporal";

export { AgentsStoppedError, assertAgentsRunning } from "./stop-guard";

export interface StopAllResult {
  pausedAgents: number;
  pausedTasks: number;
  pausedCampaigns: number;
  workflows: SignalManyResult;
  elapsedMs: number;
  budgetMs: number;
  stoppedAt: Date;
}

export async function stopAllAgents(ctx: BusinessContext, reason = "kill_switch"): Promise<StopAllResult> {
  const started = Date.now();
  const budgetMs = LIMITS.killSwitchSeconds * 1000;
  const { businessId } = ctx;

  const [sessions, channels, plans, holiday, runningTasks, campaigns, cycle] = await Promise.all([
    repos.agents.listSessions(ctx.db, businessId, { openOnly: true, limit: 500 }),
    repos.channels.list(ctx.db, businessId, { enabled: true }),
    repos.plans.list(ctx.db, businessId, { status: "executing", limit: 500 }),
    repos.holidays.current(ctx.db, businessId),
    repos.tasks.list(ctx.db, businessId, { status: "running", limit: 500 }),
    repos.campaigns.active(ctx.db, businessId),
    cycleStatus(ctx),
  ]);

  const ids = new Set<string>();
  // Always the computed id: rows written before 0023 may still say `session:pending`, a workflow that never existed.
  for (const s of sessions.items) ids.add(workflowIds.session(s.id));
  // The running cycle stops dispatching and fans the stop out to its sessions (a vacation's cycle included).
  if (cycle.running) ids.add(cycle.workflowId ?? workflowIds.cycle(businessId, cycle.cycleNumber ?? cycle.nextCycleNumber - 1));
  // Every enabled channel's engine by its deterministic id, whether or not its start was recorded.
  for (const c of channels) {
    ids.add(workflowIds.engine(c.id));
    if (c.engineWorkflowId) ids.add(c.engineWorkflowId);
  }
  for (const p of plans.items) if (p.workflowId) ids.add(p.workflowId);
  if (holiday) ids.add(workflowIds.holiday(holiday.id));
  // Autopilot ends with the stop (it also pauses in the local write below and stays paused through the resume).
  if (ctx.business.autopilotEnabled && ctx.business.autopilotPausedReason === null) ids.add(workflowIds.autopilot(businessId));

  // Signals first (the clock is running), with most of the budget; local writes follow and are fast.
  const workflows = await ctx.temporal.signalMany([...ids], "stop", [{ reason, by: ctx.userId }], Math.max(1_000, budgetMs - 8_000));

  const local = await ctx.rls(async (tx) => {
    const stop = await stopBusinessAgents(tx, businessId, { reason: "kill_switch" });
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
    if (stop.autopilotPaused) await emit(tx, ctx, { type: "autopilot.changed", payload: autopilotChangedPayload(ctx.business, "paused", "kill_switch") });
    for (const a of stop.paused) {
      await emit(tx, ctx, {
        type: "agent.health_changed",
        payload: { agentId: a.id, from: a.from, to: "paused", reason: "Stop all agents (kill switch)", signals: {}, expectedReturnAt: null, sessionId: null },
      });
    }
    await audit(tx, ctx, {
      action: "business.stop_all_agents",
      target: { kind: "business", id: businessId },
      details: { reason, pausedAgents: stop.paused.length, pausedTasks, pausedCampaigns, signalled: workflows.signalled.length, failed: workflows.failed.length, temporalQueued: workflows.queued, temporalReason: workflows.reason ?? null, cycleWorkflowId: cycle.running ? cycle.workflowId : null },
    });
    return { pausedAgents: stop.paused.length, pausedTasks, pausedCampaigns, stoppedAt: stop.stoppedAt };
  });

  return { ...local, workflows, elapsedMs: Date.now() - started, budgetMs };
}

/** Write one `agent.health_changed` per agent a resume set back to idle. */
export async function emitResumed(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, agentIds: readonly string[], reason: string): Promise<void> {
  for (const agentId of agentIds) await emit(tx, ctx, { type: "agent.health_changed", payload: { agentId, from: "paused", to: "idle", reason, signals: {}, expectedReturnAt: null, sessionId: null } });
}

export interface ResumeAgentsResult {
  resumed: boolean;
  /** Why the team had stopped (null when it was not stopped). */
  reason: AgentStopReason | null;
  resumedAgents: number;
  /** Channel engines started again (those the stop ended). */
  engines: TemporalResult[];
}

/** Why the team cannot run right now (no key on a business that runs on its own key, used-up credits), or null. */
export async function resumeBlocker(ctx: BusinessContext): Promise<string | null> {
  if (ctx.business.modelBilling === "byok") {
    const integration = await repos.integrations.getByKey(ctx.db, ctx.businessId, "anthropic");
    const keys = integration && integration.status !== "disconnected" ? await repos.credentials.listMetadata(ctx.db, ctx.businessId, { integrationId: integration.id }) : [];
    if (keys.length === 0) return "This business runs on its own Anthropic key and none is stored. Store a key in Settings › Keys; the team resumes with it.";
    return null;
  }
  const balance = await repos.usage.creditBalance(ctx.db, ctx.businessId, periodOf(new Date()));
  if (balance && Number(balance.balanceMinor) <= 0) return "This month's credits are used up. Top up in Settings › Billing or store your own key in Settings › Keys; the team resumes with either.";
  return null;
}

export async function resumeAgents(ctx: BusinessContext): Promise<ResumeAgentsResult> {
  const blocker = await resumeBlocker(ctx);
  if (blocker) throw new AgentsStoppedError(blocker, { reason: ctx.business.agentsStoppedReason });
  const result = await ctx.rls(async (tx) => {
    const resumed = await resumeBusinessAgents(tx, ctx.businessId);
    await emitResumed(tx, ctx, resumed.agentIds, `Resumed by the ${ctx.role}`);
    await audit(tx, ctx, { action: "business.resume_agents", target: { kind: "business", id: ctx.businessId }, details: { reason: resumed.reason, stoppedAt: resumed.stoppedAt?.toISOString() ?? null, resumedAgents: resumed.agentIds.length } });
    return resumed;
  });
  const engines = result.resumed ? await restartEngines(ctx) : [];
  return { resumed: result.resumed, reason: result.reason, resumedAgents: result.agentIds.length, engines };
}

/** Start again the engines of enabled channels that had one running when the team stopped (deterministic ids). */
export async function restartEngines(ctx: BusinessContext): Promise<TemporalResult[]> {
  const channels = await repos.channels.list(ctx.db, ctx.businessId, { enabled: true });
  return Promise.all(channels.filter((c) => c.engineWorkflowId).map((c) => ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId: workflowIds.engine(c.id), args: [{ businessId: ctx.businessId, channelId: c.id, channelKey: c.channelKey }] })));
}
