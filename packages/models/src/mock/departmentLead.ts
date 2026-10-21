/** Mock department lead: assigns the department's tasks to its agents, lists blockers and writes a short report. */
import type { DepartmentLeadOutput } from "../schemas";
import { readTasks, scoreTask } from "./chiefOfStaff";
import { type AgentLike, type MockContext, agentsFrom, truncate } from "./inputs";

const ROLE_FOR_KIND: Record<string, RegExp> = {
  code: /engineer|developer|frontend|backend|coding|qa|infra/i,
  research: /research|analyst|product/i,
  channel: /distribution|growth|marketing|channel|strategist|email|seo|ads|social/i,
  specialist: /specialist|sourcing|formulation|logistics|quality|packaging/i,
  legal: /legal|counsel|compliance/i,
  finance: /finance|cfo|accountant/i,
  ops: /operations|ops|assistant/i,
};

export function generateDepartmentLead(ctx: MockContext): DepartmentLeadOutput {
  const department = ctx.getRecord("department");
  const departmentId = (department && typeof department.id === "string" && department.id) || ctx.getString("department_id") || "department";
  const departmentName = (department && typeof department.name === "string" && department.name) || ctx.getString("department_name") || "the department";
  const goal = ctx.getString("goal", "objective", "cycle_goal");
  const allTasks = readTasks(ctx);
  const scoped = allTasks.filter((t) => t.department_id === departmentId);
  // Tasks without department ids (or a prompt that already scoped them) all belong to this lead.
  const tasks = scoped.length > 0 ? scoped : allTasks;
  const agents = agentsFrom(ctx).filter((a) => !a.department_id || a.department_id === departmentId);
  const doneIds = new Set(allTasks.filter((t) => t.status === "done").map((t) => t.id));

  const assignments: DepartmentLeadOutput["assignments"] = [];
  const blockers: DepartmentLeadOutput["blockers"] = [];
  const load = new Map<string, number>();

  for (const t of [...tasks].sort((a, b) => scoreTask(a) - scoreTask(b))) {
    if (t.status === "done") continue;
    const unmet = t.blocked_by.filter((b) => !doneIds.has(b));
    if (t.status === "blocked" || unmet.length > 0) {
      blockers.push({ task_id: t.id, reason: unmet.length > 0 ? `Depends on ${unmet.join(", ")} which is not done` : "Marked blocked; needs a founder or lead decision" });
      continue;
    }
    const agent = pickLeast(agents, t.kind, load);
    if (!agent) {
      blockers.push({ task_id: t.id, reason: "No agent in this department can take this kind of task; consider hiring" });
      continue;
    }
    load.set(agent.id, (load.get(agent.id) ?? 0) + 1);
    assignments.push({
      task_id: t.id,
      agent_id: agent.id,
      // plain-allow: agent-facing. The assignment is the worker agent's instruction and names the branch it must use.
      instructions: `${truncate(t.title, 80)}. Work on branch agent/${t.id}; write the tests for what counts as done first; report progress every phase; ask before any external action or spend.`,
      priority: scoreTask(t),
    });
  }

  const report = [
    `## ${departmentName} — plan for this round of work`,
    goal ? `Goal: ${goal}` : undefined,
    `${assignments.length} task${assignments.length === 1 ? "" : "s"} assigned across ${load.size} agent${load.size === 1 ? "" : "s"}; ${blockers.length} blocked.`,
    assignments.length > 0 ? `Starting with: ${assignments.slice(0, 3).map((a) => tasks.find((t) => t.id === a.task_id)?.title ?? a.task_id).join("; ")}.` : "Nothing can start until the blockers clear.",
    blockers.length > 0 ? `Blockers: ${blockers.map((b) => `${b.task_id} (${b.reason})`).join("; ")}.` : undefined,
    "Nothing in this plan moves money, signs anything or contacts anyone new without your approval.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { department_id: departmentId, assignments, blockers, report_md: report };
}

function pickLeast(agents: AgentLike[], kind: string, load: Map<string, number>): AgentLike | undefined {
  if (agents.length === 0) return undefined;
  const re = ROLE_FOR_KIND[kind];
  const suited = re ? agents.filter((a) => re.test(`${a.role} ${a.name}`)) : [];
  const pool = suited.length > 0 ? suited : agents;
  return [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
}
