/**
 * What a live session may spend (audit BF-11, O-29, BILL-13). The Agent SDK ran with no budget: a session could take 60
 * Opus turns whatever the task was worth or the business had left, and its cost reached the ledger only when it ended.
 * Now a live session is given `maxBudgetUsd`, the smallest of
 *
 * - what the task has left of its own budget: `task.budgetMinor`, or the cycle's default reserve
 *   (`DEFAULT_TASK_RESERVE_MINOR`, the figure a cycle sets aside for a task without a budget), less what the task's
 *   earlier sessions already cost (so retries cannot spend the budget again and again), and
 * - the credits the business has left this month, when the platform's key pays (a business on its own key spends its own
 *   money: only the task's budget bounds it).
 *
 * A task with nothing left does not start: it is blocked (`budget`) with the amounts. All figures are US cents, an
 * Estimate. A task budget in another currency cannot be compared with US cents, so the default applies to it.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { creditsState, periodOf, repos, type Business, type Task } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { DEFAULT_TASK_RESERVE_MINOR } from "../cycle-contract";

export interface SessionBudget {
  /** What the session may still spend, US cents (an Estimate). */
  remainingMinor: number;
  /** The Agent SDK's `maxBudgetUsd`. */
  maxUsd: number;
  /** What bounds it: the task's own budget, or the business's credits. */
  limit: "task" | "credits";
  /** The task's budget (own or default) and what its earlier sessions cost. */
  taskBudgetMinor: number;
  taskSpentMinor: number;
  /** Credits left this month; null for a business on its own key. */
  creditsLeftMinor: number | null;
}

/** The task's budget in US cents: its own when set in the credits currency, else the cycle's default reserve. */
export function taskBudgetMinor(task: Pick<Task, "budgetMinor" | "currency">): number {
  if (task.budgetMinor === null || task.budgetMinor === undefined || task.currency !== CREDITS_CURRENCY) return DEFAULT_TASK_RESERVE_MINOR;
  return Math.max(0, Number(task.budgetMinor));
}

/** The smallest bound (pure): the task's remaining budget, and the credits left when the platform key pays. */
export function boundSpend(input: { taskBudgetMinor: number; taskSpentMinor: number; creditsLeftMinor: number | null }): Pick<SessionBudget, "remainingMinor" | "limit"> {
  const taskLeft = Math.max(0, input.taskBudgetMinor - input.taskSpentMinor);
  if (input.creditsLeftMinor !== null && input.creditsLeftMinor < taskLeft) return { remainingMinor: Math.max(0, input.creditsLeftMinor), limit: "credits" };
  return { remainingMinor: taskLeft, limit: "task" };
}

/** What the task's other sessions cost so far (ended ones; this session books its cost when it ends). */
async function taskSpentMinor(deps: OrchestratorDeps, businessId: string, taskId: string, exceptSessionId: string): Promise<number> {
  let spent = 0;
  let cursor: string | undefined;
  do {
    const page = await repos.agents.listSessions(deps.db, businessId, { taskId, limit: 200, ...(cursor ? { cursor } : {}) });
    for (const s of page.items) if (s.id !== exceptSessionId && s.endedAt) spent += Number(s.costMinor ?? 0);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return spent;
}

export async function sessionBudget(deps: OrchestratorDeps, input: { business: Pick<Business, "id" | "planTier" | "modelBilling">; task: Pick<Task, "id" | "budgetMinor" | "currency">; sessionId: string }): Promise<SessionBudget> {
  const budget = taskBudgetMinor(input.task);
  const [spent, credits] = await Promise.all([taskSpentMinor(deps, input.business.id, input.task.id, input.sessionId), creditsState(deps.db, input.business, periodOf(deps.clock.now()))]);
  const creditsLeftMinor = credits ? credits.balanceMinor : null;
  const bound = boundSpend({ taskBudgetMinor: budget, taskSpentMinor: spent, creditsLeftMinor });
  return { ...bound, maxUsd: bound.remainingMinor / 100, taskBudgetMinor: budget, taskSpentMinor: spent, creditsLeftMinor };
}

const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the founder reads when a session cannot start, or stops, because its budget is spent. */
export function budgetSummary(limit: SessionBudget["limit"], b: Pick<SessionBudget, "taskBudgetMinor" | "taskSpentMinor">): string {
  if (limit === "credits") return "Blocked: this month's credits are used up, so the session stopped. What it spent is booked; the task runs again after a top-up in Settings › Billing or with next month's credits.";
  return `Blocked: this task has used its budget (${usd(Math.min(b.taskSpentMinor, b.taskBudgetMinor))} of ${usd(b.taskBudgetMinor)}, an Estimate). Raise the task's budget, then run it again.`;
}
