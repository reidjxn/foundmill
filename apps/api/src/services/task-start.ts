/**
 * Starting one task by hand: Development › Plan's Start (routers/dev.ts `dev.tasks.start`) and, since the first-time
 * founder report (Nov 8, 2026), the revision task a sign-off's Request changes creates (services/signoff.ts), which is
 * started at once rather than left for the next cycle to pick up among the rest.
 *
 * An agentSession workflow is started for the task. A task nobody is assigned to gets an agent the way the cycle picks
 * one (`autoAssign`, lead 2026-10-24) and is refused only when nobody on the team does that kind of work. Refused
 * (`TaskStartError`, 409) while the team is stopped, while the task already runs (or has a session open), is in review
 * or done, waits on an unfinished dependency, or when its agent is paused, released or at its wage cap, or the
 * business's monthly model budget is used up: a start never wakes a paused agent, so it cannot undo Stop all agents.
 * Refused with `tier_limit` (the web's upgrade prompt) when every concurrent agent the plan holds is already working.
 * The task is claimed with one conditional update, so a double click starts one session; when the workflow cannot be
 * queued the claim is undone and the session row closed (`TaskNotStartedError`, 503), so a retry is not refused.
 */
import { pickAssignee } from "@foundmill/agents";
import { assertConcurrencyRoom, modelBudgetState, periodOf, repos, type Agent, type AgentSession, type Task } from "@foundmill/db";
import { sessionStreamKey } from "@foundmill/events";
import { AppError, formatMoney, type TaskStatus } from "@foundmill/shared";
import { assertAgentsRunning } from "./stop-guard";
import { WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";
import { audit, emit, type BusinessContext } from "../trpc";

/** Statuses a task may be started from by hand (Start on the Plan): never while running, in review or done. */
export const STARTABLE_TASK_STATUSES = ["planned", "ready", "paused", "blocked", "failed", "stopped"] as const satisfies readonly TaskStatus[];

/** Task start refused for the task's own state (409): already running or finished, an open dependency, its agent. */
export class TaskStartError extends AppError {
  constructor(message: string, details?: unknown) {
    super("task_start_refused", message, 409, details);
  }
}

/** The agentSession workflow was not queued (Temporal unreachable or refusing): nothing started (503). */
export class TaskNotStartedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("task_not_started", message, 503, details);
  }
}

/** The branch an agent's code task works on. */
export const agentBranch = (taskId: string) => `agent/${taskId}`;

/** How a task's kind reads in the refusal when nobody on the team does that work. */
const WORK_WORDS: Record<string, string> = { code: "code", research: "research", channel: "channel", specialist: "specialist", legal: "legal", finance: "finance", ops: "operations" };

/**
 * The agent a task started by hand runs on when none is set (lead, 2026-10-24): chosen the way the cycle chooses
 * (`pickAssignee`: a usable worker of the task's department staffed for its kind, else any such worker, else any worker
 * of the department; never paused, down, failing, released or over its wage cap) and written on the task. Null when
 * nobody on the team fits.
 */
export async function autoAssign(ctx: BusinessContext, task: Task): Promise<Agent | null> {
  // The usage ledger is service-written and read on the service db, before the RLS transaction (one connection on PGlite).
  const wages = await repos.usage.wages(ctx.db, ctx.businessId, periodOf(new Date()));
  const spentBy = new Map(wages.map((w) => [w.agentId, w.costMinor]));
  return ctx.rls(async (tx) => {
    const agents = await repos.agents.list(tx, ctx.businessId, { limit: 200 });
    const rows = agents.items.map((a) => ({ ...a, wageRemainingMinor: a.wageCapMinor === null ? null : Number(a.wageCapMinor) - (spentBy.get(a.id) ?? 0) }));
    const picked = pickAssignee(task, rows);
    if (!picked) return null;
    await repos.tasks.reassign(tx, ctx.businessId, task.id, picked.id);
    return agents.items.find((a) => a.id === picked.id) ?? null;
  });
}

export interface TaskStarted {
  session: AgentSession;
  workflow: TemporalResult;
  stream: string;
}

/** Start `taskId` now, as Plan's Start does; throws `TaskStartError` (409) or `TaskNotStartedError` (503) when it cannot. */
export async function startTaskByHand(ctx: BusinessContext, taskId: string): Promise<TaskStarted> {
  await assertAgentsRunning(ctx, "the task");
  const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, taskId));
  if (!(STARTABLE_TASK_STATUSES as readonly TaskStatus[]).includes(task.status)) throw new TaskStartError(task.status === "running" ? "The task is already running." : `The task is ${task.status}; it cannot be started again.`, { status: task.status });
  const [open, dependencies] = await ctx.rls((tx) => Promise.all([repos.agents.listSessions(tx, ctx.businessId, { taskId: task.id, openOnly: true, limit: 1 }), repos.tasks.openDependencies(tx, ctx.businessId, task.id)]));
  if (open.items.length > 0) throw new TaskStartError("The task already has a session running.", { sessionId: open.items[0]!.id });
  if (dependencies.length > 0) throw new TaskStartError(`Finish what it depends on first: ${dependencies.map((d) => `"${d.title}"`).join(", ")}.`, { dependencies: dependencies.map((d) => d.id) });
  // Nobody chosen: the team picks, as the cycle would, and the choice is written on the task.
  const assignee = task.assigneeAgentId ? await ctx.rls((tx) => repos.agents.get(tx, ctx.businessId, task.assigneeAgentId!)) : await autoAssign(ctx, task);
  if (!assignee) throw new TaskStartError(`No agent on the team does ${WORK_WORDS[task.kind] ?? task.kind} work yet. Hire one or assign the task.`, { kind: task.kind });
  if (assignee.archivedAt) throw new TaskStartError(`${assignee.name} has left the team. Reassign the task first.`);
  if (assignee.status === "paused") throw new TaskStartError(assignee.pausedReason === "wage_cap" ? `${assignee.name} reached its wage cap for the month and is paused. Raise the cap on its profile or reassign the task.` : `${assignee.name} is paused. Resume the agents or reassign the task first.`, { pausedReason: assignee.pausedReason });
  const spend = await repos.usage.agentSpend(ctx.db, ctx.businessId, assignee.id, periodOf(new Date()));
  if (spend.remainingMinor !== null && spend.remainingMinor <= 0) throw new TaskStartError(`${assignee.name} reached its wage cap for the month. Raise the cap on its profile or reassign the task.`);
  // The business's monthly model budget (0059), whoever pays the model, as the orchestrator's dispatch applies it.
  const monthly = await modelBudgetState(ctx.db, ctx.business, new Date());
  if (monthly.budgetMinor !== null && monthly.remainingMinor !== null && monthly.remainingMinor <= 0) {
    const usd = (amountMinor: number) => formatMoney({ amountMinor, currency: "USD" });
    throw new TaskStartError(`The monthly model budget is used up (${usd(monthly.spentMinor)} of ${usd(monthly.budgetMinor)}, an Estimate), so no new work starts until next month. An owner or admin can raise or remove the budget.`, { period: monthly.period, budgetMinor: monthly.budgetMinor });
  }
  // The plan tier's concurrent agents (BUILD §10.5), as the cycle's dispatch counts them (SEC2 S2).
  await assertConcurrencyRoom(ctx.db, ctx.business);
  // Exactly one start wins the task; a second (double click, another tab) finds it running and is refused.
  const claimed = await ctx.rls((tx) => repos.tasks.claimForStart(tx, ctx.businessId, task.id, STARTABLE_TASK_STATUSES));
  if (!claimed) throw new TaskStartError("The task was just started.");
  // Until the workflow is queued, any failure gives the task back and closes the row: an open session nothing runs
  // would refuse every later start (and every cycle) of the task as already running.
  const giveBack = async (opened: AgentSession | null) => {
    if (opened) await repos.agents.endSession(ctx.db, ctx.businessId, opened.id, { outcome: "not_started" });
    await ctx.rls((tx) => repos.tasks.setStatus(tx, ctx.businessId, task.id, task.status, { force: true }));
  };
  // agent_sessions is service-written (orchestrator-owned); created on the service db, outside the RLS transaction.
  let session: AgentSession;
  try {
    session = await repos.agents.createSession(ctx.db, ctx.businessId, { agentId: assignee.id, taskId: task.id, modelKey: assignee.modelKey });
  } catch (err) {
    await giveBack(null);
    throw err;
  }
  const workflow = await ctx.temporal.start(WORKFLOWS.agentSession, { workflowId: workflowIds.session(session.id), args: [{ businessId: ctx.businessId, agentId: assignee.id, taskId: task.id, sessionId: session.id }] });
  if (!workflow.queued) {
    await giveBack(session);
    throw new TaskNotStartedError("The orchestrator did not take the session, so the task did not start. Try again in a moment.", { reason: workflow.reason ?? null });
  }
  await ctx.rls(async (tx) => {
    // A computed status, never over a pause (a stop that lands meanwhile wins).
    await repos.agents.setHealthStatus(tx, ctx.businessId, assignee.id, "healthy");
    await emit(tx, ctx, { type: "task.started", payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: assignee.id, sessionId: session.id, roadmapItemId: task.roadmapItemId, workflowId: workflowIds.session(session.id), branch: task.kind === "code" ? agentBranch(task.id) : null } });
    await audit(tx, ctx, { action: "dev.tasks.start", target: { kind: "task", id: task.id }, details: { sessionId: session.id, from: task.status } });
  });
  return { session, workflow, stream: sessionStreamKey(session.id) };
}
