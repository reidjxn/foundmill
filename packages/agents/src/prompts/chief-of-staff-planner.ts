/** Chief of Staff cycle planner (BUILD §12.4). Opus, warn on downgrade. Text is spec-verbatim. */
import { z } from "zod";
import { definePrompt } from "./template";

export const ChiefOfStaffPlannerVariables = z.object({
  business_name: z.string().min(1),
  /** Concurrency limit for this business (tier limit; default 16). */
  max_agents: z.number().int().positive(),
  /** Budget remaining for the cycle, already formatted with currency (e.g. "€1,250.00") and labelled by the caller. */
  budget: z.string().min(1),
  /** Rate-limit capacity summary from the scheduler (e.g. "requests 40/min, input 80k tok/min, output 16k tok/min"). */
  capacity: z.string().min(1),
});

export const chiefOfStaffPlannerPrompt = definePrompt({
  key: "chief_of_staff_planner",
  version: 1,
  route: "chiefOfStaff",
  description: "Plans one business cycle: tasks to start per department with assignees, priorities and the time box.",
  variables: ChiefOfStaffPlannerVariables,
  text: `Plan the next cycle for {business_name}. Inputs: brief, open tasks, budgets, business mode, pending events, roadmap, approvals waiting.
Output: for each department, the tasks to start (with assignee agent ids), priorities, and the time box. Respect concurrency {max_agents}, budget remaining {budget}, and rate-limit capacity {capacity}. Prefer work that unblocks customers.`,
});
