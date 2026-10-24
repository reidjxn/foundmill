/**
 * Who runs a task when nobody chose (lead, 2026-10-24): one pure rule the business cycle (`planCycle`, follow-up starts)
 * and `dev.tasks.start` share, so a task started by hand and a task the cycle starts land on the same agent.
 *
 * Order: the agent asked for (the planner's `agent_id`), the task's own assignee, a worker of the task's department
 * whose template is staffed for the task's kind, any such worker, any worker of the department. Only usable agents
 * count: never paused, down (`injured`), failing, archived or over the wage cap. An agent already chosen for another
 * start this cycle (`exclude`) is avoided when another usable agent fits, and taken when nobody else does.
 */
import type { TaskKind } from "@foundmill/shared";
import { getTemplateByAgentType } from "./registry";

/** The agent facts the rule reads: the cycle's brief rows and the `agents` table rows both have them. */
export interface AssignableAgent {
  id: string;
  status: string;
  layer: string;
  agentType: string;
  departmentIds: readonly string[];
  /** Set on a released agent; absent on brief rows (which never list released agents). */
  archivedAt?: Date | string | null;
  /** What is left of the wage cap this period (null or absent: uncapped). At or below zero the agent takes no work (BUILD §10.4). */
  wageRemainingMinor?: number | null;
}

export interface AssignableTask {
  kind: string;
  departmentId: string | null;
  assigneeAgentId?: string | null;
}

export interface PickAssigneeOptions {
  /** The agent the planner named for the task. */
  requested?: string | null;
  /** Agents already chosen for another start this cycle: avoided when another usable agent fits. */
  exclude?: ReadonlySet<string> | readonly string[];
}

/** An agent the cycle may give work: not paused, down or failing (failing agents rest first), not released, under its wage cap. */
export function agentUsable(a: AssignableAgent): boolean {
  if (a.archivedAt) return false;
  if (a.status === "paused" || a.status === "injured" || a.status === "failing") return false;
  return a.wageRemainingMinor === undefined || a.wageRemainingMinor === null || a.wageRemainingMinor > 0;
}

/** True when the agent's template is staffed for tasks of this kind. */
export function agentFitsKind(a: Pick<AssignableAgent, "agentType">, kind: string): boolean {
  const template = getTemplateByAgentType(a.agentType);
  return template ? template.taskKinds.includes(kind as TaskKind) : false;
}

export function pickAssignee<A extends AssignableAgent>(task: AssignableTask, agents: readonly A[], options: PickAssigneeOptions = {}): A | null {
  const byId = new Map(agents.map((a) => [a.id, a] as const));
  const excluded = options.exclude instanceof Set ? options.exclude : new Set(options.exclude ?? []);
  const workers = agents.filter((a) => a.layer === "worker");
  const inDept = task.departmentId ? workers.filter((a) => a.departmentIds.includes(task.departmentId!)) : workers;
  // In order of preference; the same agent may appear more than once and is considered at its first place.
  const ordered: (A | undefined)[] = [
    options.requested ? byId.get(options.requested) : undefined,
    task.assigneeAgentId ? byId.get(task.assigneeAgentId) : undefined,
    ...inDept.filter((a) => agentFitsKind(a, task.kind)),
    ...workers.filter((a) => agentFitsKind(a, task.kind)),
    ...inDept,
  ];
  const seen = new Set<string>();
  const usable: A[] = [];
  for (const a of ordered) {
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    if (agentUsable(a)) usable.push(a);
  }
  return usable.find((a) => !excluded.has(a.id)) ?? usable[0] ?? null;
}
