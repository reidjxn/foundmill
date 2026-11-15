/**
 * Planner eval (WP-05 T5; packages/agents `buildPlannerRequest`, route `planner`): the Planner is given the
 * specification's text, the agent types on the team and whether code can land anywhere. Two fixtures, scored
 * deterministically on the product's own request and system prompt:
 *   1. no destination: at least one task, none of kind code, and one task's goal says building starts once the project
 *      has a place to publish;
 *   2. a push-enabled repository: at least one code task, and every code task names its file scope.
 * `runPlannerCase` drives the real route (live in `pnpm evals`; the unit suite feeds it the mock, what mock-mode
 * founders get).
 */
import { buildPlannerRequest, PLANNER_SYSTEM_PROMPT, type PlannerDestination } from "@foundmill/agents";
import { TaskGraphOutput, type ModelClient } from "@foundmill/models";

export interface PlannerCase {
  id: string;
  destination: PlannerDestination;
  goal: string;
  roadmapItem: { id: string; title: string; description: string };
  sections: { section: string; text: string }[];
  workerTypes: string[];
}

const BAKERY_SPEC = [
  { section: "problem", text: "Independent bakeries take orders for celebration cakes by phone and on paper. Orders get lost, and the baker spends evenings calling customers back." },
  { section: "customers", text: "Bakeries with one shop and one to three people baking, who sell twenty to fifty cakes a week to order." },
  { section: "product", text: "A page where a customer picks a cake, a size and a pickup day, and the baker sees every order for the week in one list." },
];

export const PLANNER_CASES: readonly PlannerCase[] = Object.freeze([
  {
    id: "pl01_no_destination",
    destination: "none",
    goal: "Let customers order a celebration cake online and pick a pickup day.",
    roadmapItem: { id: "r1", title: "Online cake orders", description: "A customer orders a cake online; the baker sees the week's orders in one list." },
    sections: BAKERY_SPEC,
    workerTypes: ["chief_of_staff", "product_lead", "researcher", "backend_engineer", "frontend_engineer"],
  },
  {
    id: "pl02_repository",
    destination: "github",
    goal: "Let customers order a celebration cake online and pick a pickup day.",
    roadmapItem: { id: "r1", title: "Online cake orders", description: "A customer orders a cake online; the baker sees the week's orders in one list." },
    sections: BAKERY_SPEC,
    workerTypes: ["chief_of_staff", "product_lead", "researcher", "backend_engineer", "frontend_engineer"],
  },
]);

const BUILDING_LATER = /\bbuild(ing)?\b[^.]*\b(starts?|begins?)\b[^.]*\bplace to publish\b/i;

/** What a plan breaks of the rubric, in a few words each; empty when it passes. */
export function plannerProblems(c: PlannerCase, plan: TaskGraphOutput): string[] {
  const problems: string[] = [];
  if (plan.tasks.length === 0) problems.push("planned no task");
  const code = plan.tasks.filter((t) => t.kind === "code");
  if (c.destination === "none") {
    if (code.length > 0) problems.push(`planned ${code.length} code task${code.length === 1 ? "" : "s"} with nowhere for code to go live`);
    if (!plan.tasks.some((t) => BUILDING_LATER.test(t.goal))) problems.push("no task says building starts once the project has a place to publish");
  } else {
    if (code.length === 0) problems.push("planned no code task with a repository to push to");
    for (const t of code) if (t.file_scope_hints.filter((h) => h.trim()).length === 0) problems.push(`code task ${t.id} names no file scope`);
  }
  return problems;
}

export interface PlannerCaseResult {
  caseId: string;
  plan: TaskGraphOutput | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

/** The product's own Planner request for a case, scored on the rubric. */
export async function runPlannerCase(client: ModelClient, c: PlannerCase): Promise<PlannerCaseResult> {
  try {
    const res = await client.complete({
      route: "planner",
      schema: TaskGraphOutput,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPlannerRequest({ goal: c.goal, roadmapItem: c.roadmapItem, sections: c.sections, destination: c.destination, workerTypes: c.workerTypes }) }],
      scope: `eval:planner:${c.id}`,
    });
    const problems = plannerProblems(c, res.json);
    return { caseId: c.id, plan: res.json, problems, passed: problems.length === 0, costMinor: res.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, plan: null, problems: ["the Planner failed"], passed: false, costMinor: 0, error: (err as Error).message };
  }
}
