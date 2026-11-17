/**
 * What a live session may spend (audit BF-11, O-29, BILL-13). The Agent SDK ran with no budget: a session could take 60
 * Opus turns whatever the task was worth or the business had left, and its cost reached the ledger only when it ended.
 * Now a live session is given `maxBudgetUsd`, the smallest of
 *
 * - what the task has left of its own budget: `task.budgetMinor`, or the cycle's default reserve
 *   (`DEFAULT_TASK_RESERVE_MINOR`, the figure a cycle sets aside for a task without a budget), less what the task's
 *   earlier sessions already cost (so retries cannot spend the budget again and again), and
 * - the credits the business has left this month, when the platform's key pays (a business on its own key spends its own
 *   money: only the other limits bound it),
 * - what the agent has left of its wage cap this month, and
 * - what the business has left of its monthly model budget (0059), whoever pays the model.
 *
 * The last two are the audit #15 limits. They are read from the ledger when the session starts, so a session that crosses
 * its agent's cap or the business's budget while it runs is stopped by the SDK at that amount, on either key, without
 * booking anything as it goes (only the platform key's sessions do, ./session-credits). A concurrent session of another
 * agent, or of the same agent started by hand, is not counted until it books: the overrun that allows is at most what
 * each running session was handed.
 *
 * A task with nothing left does not start: it is blocked (`budget`) with the amounts. All figures are US cents, an
 * Estimate. A task budget in another currency cannot be compared with US cents, so the default applies to it.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { creditsState, modelBudgetState, periodOf, repos, type Business, type Task } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { DEFAULT_TASK_RESERVE_MINOR } from "../cycle-contract";

/** What can bound a session: the task's budget, the month's credits, the agent's wage cap, the business's monthly model budget. */
export type BudgetLimit = "task" | "credits" | "wage_cap" | "model_budget" | "cycle";

export interface SessionBudget {
  /** What the session may still spend, US cents (an Estimate). */
  remainingMinor: number;
  /** The Agent SDK's `maxBudgetUsd`. */
  maxUsd: number;
  /** What bounds it: the smallest of the limits below. */
  limit: BudgetLimit;
  /** The task's budget (own or default) and what its earlier sessions cost. */
  taskBudgetMinor: number;
  taskSpentMinor: number;
  /** Credits left this month; null for a business on its own key. */
  creditsLeftMinor: number | null;
  /** The agent's wage cap less its spend this month; null: no cap. */
  wageLeftMinor: number | null;
  /** The business's monthly model budget less the month's cost; null: no budget. */
  modelBudgetLeftMinor: number | null;
}

/** The task's budget in US cents: its own when set in the credits currency, else the cycle's default reserve. */
export function taskBudgetMinor(task: Pick<Task, "budgetMinor" | "currency">): number {
  if (task.budgetMinor === null || task.budgetMinor === undefined || task.currency !== CREDITS_CURRENCY) return DEFAULT_TASK_RESERVE_MINOR;
  return Math.max(0, Number(task.budgetMinor));
}

/**
 * The smallest bound (pure): the task's remaining budget, then the credits left when the platform key pays, the
 * business's monthly model budget and the agent's wage cap. A limit that is not set is null; on a tie the earlier one
 * stays the reason.
 */
export function boundSpend(input: { taskBudgetMinor: number; taskSpentMinor: number; creditsLeftMinor: number | null; wageLeftMinor?: number | null; modelBudgetLeftMinor?: number | null; cycleCapMinor?: number | null }): Pick<SessionBudget, "remainingMinor" | "limit"> {
  let remainingMinor = Math.max(0, input.taskBudgetMinor - input.taskSpentMinor);
  let limit: BudgetLimit = "task";
  const tighten = (left: number | null | undefined, by: BudgetLimit) => {
    if (left === null || left === undefined || left >= remainingMinor) return;
    remainingMinor = Math.max(0, left);
    limit = by;
  };
  tighten(input.creditsLeftMinor, "credits");
  tighten(input.modelBudgetLeftMinor, "model_budget");
  tighten(input.wageLeftMinor, "wage_cap");
  // Its share of a capped cycle's budget (Autopilot's own spend ceiling, 0077).
  tighten(input.cycleCapMinor, "cycle");
  return { remainingMinor, limit };
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

export async function sessionBudget(deps: OrchestratorDeps, input: { business: Pick<Business, "id" | "planTier" | "modelBilling">; task: Pick<Task, "id" | "budgetMinor" | "currency">; agentId: string; sessionId: string; spendCapMinor?: number | null }): Promise<SessionBudget> {
  const budget = taskBudgetMinor(input.task);
  // The credits pool is per founder, so the state is read from the full business row.
  const business = await repos.businesses.get(deps.db, input.business.id, { includeArchived: true });
  const now = deps.clock.now();
  const [spent, credits, wage, monthly] = await Promise.all([
    taskSpentMinor(deps, input.business.id, input.task.id, input.sessionId),
    creditsState(deps.db, business, periodOf(now)),
    repos.usage.agentSpend(deps.db, input.business.id, input.agentId, periodOf(now)),
    modelBudgetState(deps.db, business, now),
  ]);
  const creditsLeftMinor = credits ? credits.balanceMinor : null;
  const wageLeftMinor = wage.remainingMinor;
  const modelBudgetLeftMinor = monthly.remainingMinor;
  const bound = boundSpend({ taskBudgetMinor: budget, taskSpentMinor: spent, creditsLeftMinor, wageLeftMinor, modelBudgetLeftMinor, cycleCapMinor: input.spendCapMinor ?? null });
  return { ...bound, maxUsd: bound.remainingMinor / 100, taskBudgetMinor: budget, taskSpentMinor: spent, creditsLeftMinor, wageLeftMinor, modelBudgetLeftMinor };
}

/** How the session's reason line names each limit: when a session cannot start for it, and when it stopped at it. */
export const LIMIT_WORDS: Record<BudgetLimit, { used: string; spent: string }> = {
  task: { used: "the task's budget is spent", spent: "the task's budget" },
  credits: { used: "this month's credits are used up", spent: "the credits it was given" },
  wage_cap: { used: "the agent's wage cap for the month is reached", spent: "what was left of the agent's wage cap" },
  model_budget: { used: "the business's monthly model budget is used up", spent: "what was left of the monthly model budget" },
  cycle: { used: "Autopilot's own spend for today is used up", spent: "its share of Autopilot's spend for today" },
};

/** What the founder reads when a session's share of Autopilot's spend for today is under `MIN_SESSION_CAP_MINOR` (WP-05 T15). */
export const UNDER_FLOOR_SUMMARY = "Paused: what was left of Autopilot's own spend for today (an Estimate) was too little to start this task, so nothing was spent. The task carries on in the next round, or raise Autopilot's own limit in Settings › What the team can do.";

const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the founder reads when a session cannot start, or stops, because its budget is spent. */
export function budgetSummary(limit: BudgetLimit, b: Pick<SessionBudget, "taskBudgetMinor" | "taskSpentMinor">): string {
  if (limit === "credits") return "Blocked: this month's credits are used up, so the session stopped. What it spent is booked; the task runs again after a top-up in Settings › Billing or with next month's credits.";
  if (limit === "wage_cap") return "Blocked: this agent reached its wage cap for the month, so the session stopped. What it spent is booked (an Estimate). Raise the cap on the agent's profile, then run the task again, or wait for next month.";
  if (limit === "cycle") return "Paused: this round of work reached Autopilot's own spend for today (an Estimate), so the session stopped. What it spent is booked; the task carries on in the next round, or raise Autopilot's own limit in Settings › What the team can do.";
  if (limit === "model_budget") return "Blocked: the business reached its monthly model budget, so the session stopped. What it spent is booked (an Estimate). An owner or admin can raise or remove the budget, then the task runs again; otherwise it waits for next month.";
  return `Blocked: this task has used its budget (${usd(Math.min(b.taskSpentMinor, b.taskBudgetMinor))} of ${usd(b.taskBudgetMinor)}, an Estimate). Raise the task's budget, then run it again.`;
}
