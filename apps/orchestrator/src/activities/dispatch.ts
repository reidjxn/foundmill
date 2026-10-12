/**
 * Dispatch guard: the one place the orchestrator opens an agent session (a cycle's `openSession`, a plan's
 * `create_task`). Before the row exists it refuses work while the team is stopped (Stop all agents, a revoked key,
 * used-up credits; 0023), for a paused or released agent, for a task that already has an open session (no duplicate
 * sessions on one task), when every concurrent agent the plan tier holds is working (`concurrencyAllowance`, the count
 * the cycle and dev.tasks.start use) and for an agent at its wage cap, which it pauses until the next period with one
 * Inbox note (BUILD §10.4: alerts at 50 and 80 %, pause at 100 %). The row is created with its real workflow id
 * (`session:<id>`) before the workflow starts, so every pause, nudge, stop and the kill switch reach the session.
 *
 * `recoverAgents` is the other half of the loop: before each cycle plans, an agent that failed rests (`retry.ts`) and
 * then goes back to idle, and an agent paused for its wage cap comes back once it is under the cap again (a new
 * period, or a higher cap). Neither touches any other pause.
 */
import { LIMITS } from "@foundmill/config";
import { concurrencyAllowance, periodOf, periodRange, repos, type Agent } from "@foundmill/db";
import { formatMoney } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent, systemActor } from "../events";
import { agentCooldown, failureStreak } from "../retry";

export type DispatchRefusal = "agents_stopped" | "agent_paused" | "agent_archived" | "wage_cap" | "open_session" | "concurrency_limit";

export type OpenSessionResult = { sessionId: string; workflowId: string; refused: null; detail: null } | { sessionId: null; workflowId: null; refused: DispatchRefusal; detail: string };

export const WAGE_ALERT_ACTION = "agent.wage_alert";

const refuse = (refused: DispatchRefusal, detail: string): OpenSessionResult => ({ sessionId: null, workflowId: null, refused, detail });

/** First day of the month after `now` (UTC): when a wage cap resets. */
export function nextPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Open a session for `agentId` on `taskId`, or say why not. See the module comment. */
export async function openAgentSession(deps: OrchestratorDeps, input: { businessId: string; agentId: string; taskId: string }): Promise<OpenSessionResult> {
  const { db, clock } = deps;
  const businessId = input.businessId;
  const stop = await repos.businesses.stopState(db, businessId);
  if (stop.stopped) return refuse("agents_stopped", stop.archived ? "the business is archived" : `agents are stopped (${(stop.reason ?? "kill_switch").replace(/_/g, " ")}); an owner or admin resumes them`);
  const [agent, task, open, business] = await Promise.all([repos.agents.get(db, businessId, input.agentId), repos.tasks.get(db, businessId, input.taskId), repos.agents.listSessions(db, businessId, { taskId: input.taskId, openOnly: true, limit: 1 }), repos.businesses.get(db, businessId)]);
  if (agent.archivedAt) return refuse("agent_archived", `${agent.name} has left the team`);
  if (agent.status === "paused") return refuse("agent_paused", `${agent.name} is paused${agent.pausedReason === "wage_cap" ? " (wage cap reached)" : ""}`);
  if (open.items.length > 0) return refuse("open_session", `"${task.title}" already has a session running`);
  // The plan tier's concurrent agents, counted as the cycle and dev.tasks.start count them (SEC2 S2): a plan's task or a
  // playbook never runs past the limit because it did not come through a cycle.
  const concurrency = await concurrencyAllowance(db, business, clock.now());
  if (concurrency.room <= 0) return refuse("concurrency_limit", `every agent the ${business.planTier} plan runs at once is working (${concurrency.running} of ${concurrency.limit}); it starts when one finishes`);
  const capped = await checkWageCap(deps, businessId, agent);
  if (capped) return refuse("wage_cap", capped);

  const session = await repos.agents.createSession(db, businessId, { agentId: agent.id, versionId: agent.currentVersionId, taskId: task.id, modelKey: agent.modelKey, startedAt: clock.now() });
  if (task.assigneeAgentId !== agent.id) await repos.tasks.reassign(db, businessId, task.id, agent.id);
  if (task.status !== "running") await repos.tasks.setStatus(db, businessId, task.id, "running", { force: true });
  await emitEvent(db, {
    businessId,
    type: "task.started",
    actor: agentActor(agent.id),
    payload: { taskId: task.id, title: task.title, kind: task.kind, assigneeAgentId: agent.id, sessionId: session.id, roadmapItemId: task.roadmapItemId, workflowId: session.workflowId ?? `session:${session.id}`, branch: `agent/${task.id}` },
  });
  return { sessionId: session.id, workflowId: session.workflowId ?? `session:${session.id}`, refused: null, detail: null };
}

/**
 * The wage cap at dispatch (BUILD §10.4). Under the cap: posts the 50 % and 80 % notes once each per period. At or over
 * it: pauses the agent until the next period (reason `wage_cap`, `agent.health_changed`, one Inbox note) and returns
 * why; null when the agent may work.
 */
export async function checkWageCap(deps: OrchestratorDeps, businessId: string, agent: Agent): Promise<string | null> {
  if (agent.wageCapMinor === null) return null;
  const now = deps.clock.now();
  const period = periodOf(now);
  const spend = await repos.usage.agentSpend(deps.db, businessId, agent.id, period);
  if (spend.wageCapMinor === null || spend.wageCapMinor <= 0) return null;
  const percent = (spend.costMinor / spend.wageCapMinor) * 100;
  const backOn = nextPeriodStart(now);
  const amount = (minor: number) => formatMoney({ amountMinor: minor, currency: agent.currency });
  if (percent >= 100) {
    await pauseForWageCap(deps, businessId, agent, { spentMinor: spend.costMinor, capMinor: spend.wageCapMinor, backOn, amount });
    return `${agent.name} reached its wage cap for the month (${amount(spend.costMinor)} of ${amount(spend.wageCapMinor)}, Estimate)`;
  }
  const crossed = LIMITS.budgetAlertPercents.filter((p) => p < 100 && percent >= p);
  const highest = crossed[crossed.length - 1];
  if (highest === undefined) return null;
  const sent = await repos.audit.list(deps.db, businessId, { action: WAGE_ALERT_ACTION, actorKind: "agent", actorId: agent.id, from: periodRange(period).from, limit: 20 });
  if (sent.items.some((e) => Number((e.details as { percent?: unknown }).percent) >= highest)) return null;
  const chief = await repos.agents.chiefOfStaff(deps.db, businessId);
  if (chief) {
    await postNote(deps, businessId, chief.id, {
      type: "update",
      subject: `${agent.name} has used ${highest}% of its wage cap`.slice(0, 80),
      body: `${agent.name} has spent ${amount(spend.costMinor)} of its ${amount(spend.wageCapMinor)} wage cap this month (Estimate). At 100% it stops taking work until ${shortDate(backOn)}. Raise the cap on its profile if the work is worth it.`,
      blocksContinue: false,
    });
  }
  await repos.audit.append(deps.db, businessId, { actorKind: "agent", actorId: agent.id, action: WAGE_ALERT_ACTION, target: { kind: "agent", id: agent.id }, details: { period, percent: highest, spentMinor: spend.costMinor, capMinor: spend.wageCapMinor } });
  return null;
}

async function pauseForWageCap(deps: OrchestratorDeps, businessId: string, agent: Agent, info: { spentMinor: number; capMinor: number; backOn: Date; amount: (minor: number) => string }): Promise<void> {
  if (agent.status === "paused") return;
  const { db } = deps;
  await repos.agents.setStatus(db, businessId, agent.id, "paused", { pausedReason: "wage_cap" });
  await emitEvent(db, {
    businessId,
    type: "agent.health_changed",
    actor: systemActor,
    payload: { agentId: agent.id, from: agent.status, to: "paused", reason: "wage cap reached for the period", signals: { budgetRemaining: { amountMinor: 0, currency: agent.currency } }, expectedReturnAt: info.backOn.toISOString(), sessionId: null },
  });
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  if (chief) {
    await postNote(deps, businessId, chief.id, {
      type: "warning",
      subject: `${agent.name} reached its wage cap: paused`.slice(0, 80),
      body: `${agent.name} has spent ${info.amount(info.spentMinor)} of its ${info.amount(info.capMinor)} wage cap this month (Estimate), so it takes no new work until ${shortDate(info.backOn)}. Raise the cap on its profile to bring it back sooner; its tasks wait for it or go to a teammate.`,
      blocksContinue: false,
    });
  }
  await repos.audit.append(db, businessId, { actorKind: "agent", actorId: agent.id, action: WAGE_ALERT_ACTION, target: { kind: "agent", id: agent.id }, details: { period: periodOf(deps.clock.now()), percent: 100, spentMinor: info.spentMinor, capMinor: info.capMinor } });
}

async function postNote(deps: OrchestratorDeps, businessId: string, fromAgentId: string, note: { type: "update" | "warning"; subject: string; body: string; blocksContinue: boolean }): Promise<void> {
  const item = await repos.inbox.createItem(deps.db, businessId, {
    type: note.type,
    from_agent_id: fromAgentId,
    subject: note.subject,
    body_md: note.body,
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: null,
    blocks_continue: note.blocksContinue,
    source_event_ids: [],
    entity_ids: [],
  });
  await emitEvent(deps.db, {
    businessId,
    type: "inbox.item_created",
    actor: agentActor(fromAgentId),
    payload: { inboxItemId: item.id, type: item.type, fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: null },
  });
}

export interface RecoveredAgent {
  agentId: string;
  from: Agent["status"];
  to: Agent["status"];
  reason: string;
}

/**
 * Bring agents back to work before a cycle plans (see the module comment). Returns who changed; each change wrote
 * `agent.health_changed`. Nothing happens while the team is stopped.
 */
export async function recoverAgents(deps: OrchestratorDeps, businessId: string): Promise<RecoveredAgent[]> {
  const { db, clock } = deps;
  if (await repos.businesses.agentsStopped(db, businessId)) return [];
  const now = clock.now();
  const [failing, paused] = await Promise.all([repos.agents.list(db, businessId, { status: "failing", limit: 200 }), repos.agents.list(db, businessId, { status: "paused", limit: 200 })]);
  const changed: RecoveredAgent[] = [];
  const recover = async (agent: Agent, reason: string, expectedReturnAt: string | null = null) => {
    const updated = agent.status === "paused" ? await repos.agents.setStatus(db, businessId, agent.id, "idle") : await repos.agents.setHealthStatus(db, businessId, agent.id, "idle");
    if (!updated) return;
    await emitEvent(db, { businessId, type: "agent.health_changed", actor: systemActor, payload: { agentId: agent.id, from: agent.status, to: "idle", reason, signals: {}, expectedReturnAt, sessionId: null } });
    changed.push({ agentId: agent.id, from: agent.status, to: "idle", reason });
  };

  if (failing.items.length > 0) {
    const ids = failing.items.map((a) => a.id);
    const [recent, open] = await Promise.all([repos.agents.recentOutcomes(db, businessId, { agentIds: ids, limit: 50 * ids.length }), Promise.all(ids.map((id) => repos.agents.listSessions(db, businessId, { agentId: id, openOnly: true, limit: 1 })))]);
    for (const [i, agent] of failing.items.entries()) {
      if ((open[i]?.items.length ?? 0) > 0) continue;
      const cooldown = agentCooldown(failureStreak(recent.filter((s) => s.agentId === agent.id)), now);
      if (cooldown.due) await recover(agent, `rested after ${cooldown.failures} failed session${cooldown.failures === 1 ? "" : "s"} in a row; back to work`);
    }
  }

  const period = periodOf(now);
  for (const agent of paused.items.filter((a) => a.pausedReason === "wage_cap")) {
    const spend = await repos.usage.agentSpend(db, businessId, agent.id, period);
    if (spend.remainingMinor === null || spend.remainingMinor > 0) await recover(agent, spend.wageCapMinor === null ? "wage cap removed" : "under the wage cap again (new period or a higher cap)");
  }
  return changed;
}
