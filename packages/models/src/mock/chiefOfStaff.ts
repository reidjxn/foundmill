/**
 * Mock Chief of Staff cycle planner (BUILD §12.4): from open tasks, agents, budgets and capacity, decide what starts
 * this cycle per department, respecting concurrency, budget and rate-limit capacity, preferring work that unblocks
 * customers.
 */
import { LIMITS } from "@foundmill/config";
import { PLANNABLE_TASK_STATUSES } from "@foundmill/shared";
import type { CyclePlanOutput } from "../schemas";
import { type AgentLike, type MockContext, agentsFrom, isRecord, truncate } from "./inputs";

export interface TaskIn {
  id: string;
  title: string;
  kind: string;
  status: string;
  department_id: string;
  assignee_agent_id?: string;
  priority?: number;
  blocked_by: string[];
}

/** The statuses the orchestrator offers a planner (one list with its DISPATCHABLE set: a failed task is retried, never skipped). */
const OPEN = new Set<string>(PLANNABLE_TASK_STATUSES);
/** Why a channel task waits before the founder has started distribution (the orchestrator's `planCycle` uses the same words). */
export const CHANNEL_WAITS_REASON = "distribution starts when you start it from Distribution › Board";
const CUSTOMER_UNBLOCK = /\b(customer|checkout|payment|signup|onboarding|activation|bug|outage|fix|broken|churn|refund|support|invoice)\b/i;

export function readTasks(ctx: MockContext): TaskIn[] {
  const raw = ctx.getArray<unknown>("open_tasks", "tasks", "task_board", "backlog");
  const out: TaskIn[] = [];
  raw.forEach((t, i) => {
    if (!isRecord(t)) return;
    const id = typeof t.id === "string" ? t.id : typeof t.task_id === "string" ? t.task_id : `task-${i + 1}`;
    const blockedRaw = t.blocked_by ?? t.depends_on ?? t.dependencies;
    out.push({
      id,
      title: typeof t.title === "string" ? t.title : typeof t.goal === "string" ? t.goal : `Task ${i + 1}`,
      kind: typeof t.kind === "string" ? t.kind : "ops",
      status: typeof t.status === "string" ? t.status : "planned",
      department_id: typeof t.department_id === "string" ? t.department_id : typeof t.departmentId === "string" ? t.departmentId : typeof t.department === "string" ? t.department : "general",
      assignee_agent_id: typeof t.assignee_agent_id === "string" ? t.assignee_agent_id : typeof t.assignee === "string" ? t.assignee : undefined,
      priority: typeof t.priority === "number" ? Math.max(1, Math.min(5, Math.round(t.priority))) : undefined,
      blocked_by: Array.isArray(blockedRaw) ? blockedRaw.filter((b): b is string => typeof b === "string") : [],
    });
  });
  return out;
}

export function scoreTask(t: TaskIn): number {
  // 1 = start first, 5 = can wait.
  if (t.priority !== undefined) return t.priority;
  let p = 3;
  if (CUSTOMER_UNBLOCK.test(t.title)) p -= 2;
  if (t.status === "review" || t.status === "paused") p -= 1;
  if (/\b(legal|filing|deadline|compliance)\b/i.test(t.title)) p -= 1;
  if (/\b(nice to have|later|someday|polish)\b/i.test(t.title)) p += 1;
  return Math.max(1, Math.min(5, p));
}

export function generateChiefOfStaff(ctx: MockContext): CyclePlanOutput {
  const tasks = readTasks(ctx);
  const agents = agentsFrom(ctx);
  const maxAgents = ctx.getNumber("max_agents", "concurrency", "max_concurrent_agents") ?? LIMITS.defaultMaxConcurrentAgents;
  const capacityRec = ctx.getRecord("capacity", "rate_limit_capacity");
  const capacitySessions = capacityRec && typeof capacityRec.max_sessions === "number" ? capacityRec.max_sessions : ctx.getNumber("capacity");
  const budgetRemaining = ctx.getNumber("budget_remaining_minor", "budget_remaining", "budget_minor");
  const approvalsWaiting = ctx.getArray<unknown>("approvals_waiting", "pending_approvals", "approvals");
  const businessName = ctx.getString("business_name", "business.name") ?? "the business";
  const mode = ctx.getString("business_mode", "mode") ?? "assisted";
  // The first days are about the product (founder, 2026-10-18): channel work waits until the founder has started
  // distribution. A payload without a stage (an older caller) is read as selling, so nothing it offers is held back.
  const productStage = ctx.getString("product_stage") ?? "selling";

  const limit = Math.max(0, Math.min(maxAgents, capacitySessions ?? Number.POSITIVE_INFINITY, budgetRemaining === 0 ? 0 : Number.POSITIVE_INFINITY));
  const ids = new Set(tasks.map((t) => t.id));
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  const open = tasks.filter((t) => OPEN.has(t.status));
  const ranked = [...open].sort((a, b) => scoreTask(a) - scoreTask(b) || a.id.localeCompare(b.id));

  const busy = new Set<string>();
  const departments = new Map<string, CyclePlanOutput["departments"][number]>();
  const deferred: CyclePlanOutput["deferred"] = [];
  let started = 0;

  for (const t of ranked) {
    // The orchestrator filters out tasks that cannot start (open dependencies, a retry still waiting): a `blocked` or
    // `failed` task that reaches the planner is one to try again.
    const unmet = t.blocked_by.filter((b) => ids.has(b) && !done.has(b));
    if (unmet.length > 0) {
      deferred.push({ task_id: t.id, reason: `Waiting on ${unmet.join(", ")}` });
      continue;
    }
    if (t.kind === "channel" && productStage !== "selling") {
      deferred.push({ task_id: t.id, reason: CHANNEL_WAITS_REASON });
      continue;
    }
    if (started >= limit) {
      deferred.push({ task_id: t.id, reason: budgetRemaining === 0 ? "The model budget is used up; agents are paused except the Inbox" : `At most ${Math.min(maxAgents, capacitySessions ?? maxAgents)} agents can work at once, and they are all busy` });
      continue;
    }
    const agent = chooseAgent(agents, t, busy);
    if (agent) busy.add(agent.id);
    started++;
    const dept = departments.get(t.department_id) ?? { department_id: t.department_id, priorities: [], tasks_to_start: [] };
    dept.tasks_to_start.push({
      task_id: t.id,
      agent_id: agent?.id ?? t.assignee_agent_id ?? null,
      priority: scoreTask(t),
      reason: CUSTOMER_UNBLOCK.test(t.title) ? "Unblocks customers" : scoreTask(t) <= 2 ? "High priority on the board" : "Next on the board with capacity available",
    });
    if (dept.priorities.length < 3) dept.priorities.push(truncate(t.title, 60));
    departments.set(t.department_id, dept);
  }

  const approvalsNeeded: string[] = approvalsWaiting.map((a) => (isRecord(a) && typeof a.title === "string" ? a.title : typeof a === "string" ? a : "Pending approval"));
  if (budgetRemaining === 0) approvalsNeeded.push("Top up the model budget before agents resume");
  if (mode === "augmented" && started > 0) approvalsNeeded.push("Augmented mode: every outside action and every merge waits for your go-ahead");

  const roadmap = ctx.getArray<unknown>("roadmap_without_tasks");
  const summary =
    started === 0
      ? `No tasks start in this round of work for ${businessName}: ${budgetRemaining === 0 ? "the model budget is used up" : open.length === 0 ? "the board is clear" : "the open tasks wait on earlier tasks"}.${roadmap.length > 0 ? ` ${roadmap.length} roadmap item${roadmap.length === 1 ? " has" : "s have"} no tasks yet: plan them from the Plan tab.` : ""}`
      : `Start ${started} task${started === 1 ? "" : "s"} across ${departments.size} department${departments.size === 1 ? "" : "s"} for ${businessName} with at most ${Number.isFinite(limit) ? limit : maxAgents} agents working at once; ${deferred.length} wait. Work that unblocks a customer goes first.`;

  return {
    summary,
    time_box_hours: ctx.getNumber("time_box_hours", "time_box") ?? LIMITS.cycleTimeBoxAgentHours,
    departments: [...departments.values()],
    deferred,
    approvals_needed: approvalsNeeded,
  };
}

function chooseAgent(agents: AgentLike[], task: TaskIn, busy: Set<string>): AgentLike | undefined {
  const free = agents.filter((a) => !busy.has(a.id) && !/paused|failing|injured/.test(a.status ?? ""));
  if (task.assignee_agent_id) {
    const pinned = free.find((a) => a.id === task.assignee_agent_id);
    if (pinned) return pinned;
  }
  const inDept = free.filter((a) => a.department_id === task.department_id);
  const pool = inDept.length > 0 ? inDept : free;
  const byKind: Record<string, RegExp> = {
    code: /engineer|developer|frontend|backend|coding|qa|infra/i,
    research: /research|analyst|product/i,
    channel: /distribution|growth|marketing|channel|strategist|email|seo|ads/i,
    specialist: /specialist|sourcing|formulation|logistics|quality|packaging/i,
    legal: /legal|counsel|compliance/i,
    finance: /finance|cfo|accountant/i,
    ops: /operations|ops|assistant|chief/i,
  };
  const re = byKind[task.kind];
  return (re && pool.find((a) => re.test(`${a.role} ${a.name}`))) || pool[0];
}
