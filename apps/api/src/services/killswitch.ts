/**
 * business.stopAllAgents — the kill switch (BUILD §14: ≤ 30 s; pauses workflows, engines and campaigns) — and
 * business.resumeAgents, its only way back.
 *
 * Stop writes first, then signals. One transaction sets the business's stop flag (0023), pauses Autopilot (it stays
 * paused through the resume), marks every agent paused with
 * the reason, pauses running tasks and live campaigns, cancels the training runs in flight and writes one
 * `agent.health_changed` per agent that changed. From that commit on every path that starts work refuses
 * (`assertAgentsRunning` in stop-guard.ts; the orchestrator's dispatch guard; a session's own start and its periodic
 * re-check; the training activity; the gateway's `agents-stopped` denial), so nothing can start in the seconds the
 * signals take. Only then does it signal every running workflow of the business within the budget: each open session
 * by its computed id `session:<id>` (never a stored placeholder), the running business cycle (whose children it fans
 * out to, a vacation's cycle included), every enabled channel's engine `engine:<channelId>`, executing plans, the
 * vacation and the canceled training runs. It lists open sessions once more afterwards and signals any opened while it
 * worked, then writes the audit entry with what reached Temporal. Works without Temporal: the local state is always
 * written; the signal result reports `{ queued: false, reason }`, as it does when listing the workflows fails (the stop
 * is in effect and audited either way).
 *
 * Resume (owner or admin) lifts the flag, sets the agents the stop paused back to idle, restarts the channel engines
 * that were running and starts the model-change retests queued while the team was stopped. It refuses while the team
 * could not run anyway: a business on its own key with no key stored, or a credit balance used up. Live campaigns the
 * stop paused stay paused (they spend money; Distribution resumes them), and training runs the stop canceled stay
 * canceled (Train again from the Training tab).
 */
import { LIMITS } from "@foundmill/config";
import { autopilotChangedPayload, periodOf, periodRange, platformCredits, repos, resumeBusinessAgents, stopBusinessAgents, waysToContinue, type Executor } from "@foundmill/db";
import { topUpsOnSale, type AgentStopReason } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { cycleStatus, endRun } from "./cycle";
import { runnableChannels } from "./channel-availability";
import { ensureChannelEngines } from "./engines";
import { AgentsStoppedError } from "./stop-guard";
import { WORKFLOWS, workflowIds, type SignalManyResult, type TemporalResult } from "./temporal";

export { AgentsStoppedError, assertAgentsRunning } from "./stop-guard";

export interface StopAllResult {
  pausedAgents: number;
  pausedTasks: number;
  pausedCampaigns: number;
  /** Training runs in flight the stop canceled (their workflows are signalled with the rest). */
  cancelledTraining: number;
  workflows: SignalManyResult;
  elapsedMs: number;
  budgetMs: number;
  stoppedAt: Date;
}

/** The summary a training run canceled by a stop carries (Training tab, `training.completed`). */
export const TRAINING_STOPPED_SUMMARY = "Training canceled: Stop all agents. Train again once the agents resume.";

export async function stopAllAgents(ctx: BusinessContext, reason = "kill_switch"): Promise<StopAllResult> {
  const started = Date.now();
  const budgetMs = LIMITS.killSwitchSeconds * 1000;
  const { businessId } = ctx;

  // 1. The flag and every pause first, in one transaction: from its commit nothing new starts while the signals go out.
  const local = await ctx.rls(async (tx) => {
    const stop = await stopBusinessAgents(tx, businessId, { reason: "kill_switch" });
    const [runningTasks, campaigns] = await Promise.all([repos.tasks.list(tx, businessId, { status: "running", limit: 500 }), repos.campaigns.active(tx, businessId)]);
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
    // Training spends model credits too: runs in flight end canceled (a late worker write never undoes it).
    const training = await repos.training.cancelActive(tx, businessId, { coachSummaryMd: TRAINING_STOPPED_SUMMARY });
    if (stop.autopilotPaused) await emit(tx, ctx, { type: "autopilot.changed", payload: autopilotChangedPayload(ctx.business, "paused", "kill_switch") });
    for (const a of stop.paused) {
      await emit(tx, ctx, {
        type: "agent.health_changed",
        payload: { agentId: a.id, from: a.from, to: "paused", reason: "Stop all agents (kill switch)", signals: {}, expectedReturnAt: null, sessionId: null },
      });
    }
    return { pausedAgents: stop.paused.length, pausedTasks, pausedCampaigns, cancelledTraining: training.map((r) => r.id), stoppedAt: stop.stoppedAt };
  });

  // 2. Then every workflow still running. Nothing depends on these signals any more (everything re-reads the flag), so
  // a failure while listing them is reported in the result and the audit entry, never thrown over a stop in effect.
  let signals: SignalledStop;
  try {
    signals = await signalStop(ctx, reason, local.cancelledTraining, started, budgetMs);
  } catch (err) {
    const why = `workflows not signaled: ${(err as Error).message ?? String(err)}`.slice(0, 300);
    ctx.log.warn({ businessId, err: (err as Error).message }, "Stop all agents: the stop is in effect but its signals did not go out");
    signals = { workflows: { queued: false, signalled: [], failed: [], reason: why }, lateSessions: 0, cycleWorkflowId: null };
  }
  const { workflows } = signals;

  await ctx.rls((tx) =>
    audit(tx, ctx, {
      action: "business.stop_all_agents",
      target: { kind: "business", id: businessId },
      details: { reason, pausedAgents: local.pausedAgents, pausedTasks: local.pausedTasks, pausedCampaigns: local.pausedCampaigns, cancelledTraining: local.cancelledTraining.length, signalled: workflows.signalled.length, failed: workflows.failed.length, lateSessions: signals.lateSessions, temporalQueued: workflows.queued, temporalReason: workflows.reason ?? null, cycleWorkflowId: signals.cycleWorkflowId },
    }),
  );

  return { pausedAgents: local.pausedAgents, pausedTasks: local.pausedTasks, pausedCampaigns: local.pausedCampaigns, cancelledTraining: local.cancelledTraining.length, stoppedAt: local.stoppedAt, workflows, elapsedMs: Date.now() - started, budgetMs };
}

interface SignalledStop {
  workflows: SignalManyResult;
  /** Sessions opened while the first signals went out, signalled in a second round. */
  lateSessions: number;
  cycleWorkflowId: string | null;
}

/**
 * Signal `stop` to every workflow of the business still running, by its deterministic id, within the budget left; then
 * list open sessions once more and signal those opened meanwhile (a dispatch that read the flag just before it was
 * written; their own start re-checks the flag as well).
 */
async function signalStop(ctx: BusinessContext, reason: string, cancelledTraining: readonly string[], started: number, budgetMs: number): Promise<SignalledStop> {
  const { businessId } = ctx;
  const [sessions, channels, plans, holiday, cycle] = await Promise.all([
    repos.agents.listSessions(ctx.db, businessId, { openOnly: true, limit: 500 }),
    repos.channels.list(ctx.db, businessId, { enabled: true }),
    repos.plans.list(ctx.db, businessId, { status: "executing", limit: 500 }),
    repos.holidays.current(ctx.db, businessId),
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
  // Autopilot ends with the stop (it also paused in the local write above and stays paused through the resume), and so
  // does the run a press of Continue started, which runs on the same workflow with Autopilot off too (Nov 7, 2026).
  if ((ctx.business.autopilotEnabled && ctx.business.autopilotPausedReason === null) || cycle.run) ids.add(workflowIds.autopilot(businessId));
  for (const runId of cancelledTraining) ids.add(workflowIds.training(runId));

  const signal = (list: readonly string[], ms: number) => ctx.temporal.signalMany(list, "stop", [{ reason, by: ctx.userId }], Math.max(1_000, ms));
  const first = await signal([...ids], budgetMs - 8_000 - (Date.now() - started));
  const again = await repos.agents.listSessions(ctx.db, businessId, { openOnly: true, limit: 500 });
  const late = again.items.map((s) => workflowIds.session(s.id)).filter((id) => !ids.has(id));
  const second = late.length ? await signal(late, budgetMs - 4_000 - (Date.now() - started)) : null;
  // The run's end is written here as well (once per run: the workflow's own end finds it), so Continue leaves
  // "processing" at once even when the signal never reaches a worker.
  if (cycle.run) await endRun(ctx, cycle.run, "stopped").catch((err: unknown) => ctx.log.warn({ businessId, err: (err as Error).message }, "Stop all agents: the run's end was not recorded"));
  const unreachable = first.reason ?? second?.reason;
  const workflows: SignalManyResult = second ? { queued: first.queued || second.queued, signalled: [...first.signalled, ...second.signalled], failed: [...first.failed, ...second.failed], ...(unreachable ? { reason: unreachable } : {}) } : first;
  return { workflows, lateSessions: late.length, cycleWorkflowId: cycle.running ? cycle.workflowId : null };
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
  /** Training runs left queued while the team was stopped (a model change's retests), started now. */
  training: TemporalResult[];
}

/** Why the team cannot run right now (no key on a business that runs on its own key, used-up credits), or null. */
export async function resumeBlocker(ctx: BusinessContext): Promise<string | null> {
  if (ctx.business.modelBilling === "byok") {
    const integration = await repos.integrations.getByKey(ctx.db, ctx.businessId, "anthropic");
    const keys = integration && integration.status !== "disconnected" ? await repos.credentials.listMetadata(ctx.db, ctx.businessId, { integrationId: integration.id }) : [];
    if (keys.length === 0) return "This business runs on its own Anthropic key and none is stored. Store a key in Settings › Keys; the team resumes with it.";
    return null;
  }
  if ((await platformCredits(ctx.db, ctx.business, periodOf(new Date()))).exhausted) {
    // A top-up is named only where credits can be bought here (WP-09 T13).
    const period = periodOf(new Date());
    return `This month's credits are used up. ${waysToContinue({ topUps: topUpsOnSale(ctx.env), nextCreditsOn: periodRange(period).to })}`;
  }
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
  const restarted = result.resumed ? await restartAfterResume(ctx) : { engines: [], training: [] };
  return { resumed: result.resumed, reason: result.reason, resumedAgents: result.agentIds.length, ...restarted };
}

/** `env` and `business` (every request context has them) let the restart skip channels that cannot really act. */
type RestartScope = Pick<BusinessContext, "db" | "businessId" | "temporal"> & Partial<Pick<BusinessContext, "env" | "business">>;

/**
 * What every way back (Resume agents, a new key, a top-up) starts again once the stop is lifted: the channel engines
 * the stop ended and the training runs left queued while the team was stopped.
 */
export async function restartAfterResume(ctx: RestartScope): Promise<{ engines: TemporalResult[]; training: TemporalResult[] }> {
  const [engines, training] = await Promise.all([restartEngines(ctx), startQueuedTraining(ctx)]);
  return { engines, training };
}

/**
 * Start again the engine of every enabled channel (deterministic ids; a running one answers "already running"): every
 * channel on the board runs its engine, whether or not one was recorded before the stop (audit GTM-01). A channel that
 * cannot really act and is not in offline tracking is left out (founder, 2026-11-11): its engine would stop at once.
 */
export async function restartEngines(ctx: RestartScope): Promise<TemporalResult[]> {
  const enabled = await repos.channels.list(ctx.db, ctx.businessId, { enabled: true });
  const scope = ctx.env && ctx.business ? { env: ctx.env, businessId: ctx.businessId, business: ctx.business } : null;
  return ensureChannelEngines(ctx, scope ? await runnableChannels(ctx.db, scope, enabled) : enabled);
}

/**
 * Start every queued training run of the business: a model change made while the team was stopped queues its retests
 * without starting them (`agent.model.set`). A run whose workflow is already running answers "already running".
 */
export async function startQueuedTraining(ctx: RestartScope): Promise<TemporalResult[]> {
  const queued = await repos.training.list(ctx.db, ctx.businessId, { status: "queued", limit: 100 });
  return Promise.all(queued.items.map((run) => ctx.temporal.start(WORKFLOWS.trainingRun, { workflowId: workflowIds.training(run.id), args: [{ businessId: ctx.businessId, trainingRunId: run.id }] })));
}
