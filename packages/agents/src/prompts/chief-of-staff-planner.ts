/**
 * Chief of Staff cycle planner (BUILD §12.4). Opus, warn on downgrade. Text is spec-verbatim; v2 (founder, 2026-10-18)
 * adds the product stage: before the founder has signed off the specification and the roadmap only groundwork is
 * planned, and no channel work until distribution has started (the orchestrator also holds channel tasks back in code).
 */
import { PRODUCT_STAGES } from "@foundmill/shared";
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
  /** Where the business stands in its first days (`productStageOf`): drafting, awaiting_signoff, building or selling. */
  product_stage: z.enum(PRODUCT_STAGES),
});

export const chiefOfStaffPlannerPrompt = definePrompt({
  key: "chief_of_staff_planner",
  version: 3,
  route: "chiefOfStaff",
  description: "Plans one business cycle: tasks to start per department with assignees, priorities and the time limit; product first, distribution when the founder starts it.",
  variables: ChiefOfStaffPlannerVariables,
  text: `Plan the next cycle for {business_name}. Inputs: brief, open tasks, budgets, business mode, pending events, roadmap, approvals waiting.
Output: for each department, the tasks to start (with assignee agent ids), priorities, and the time limit. Respect the limit of {max_agents} agents working at once, budget remaining {budget}, and rate-limit capacity {capacity}. Prefer work that unblocks customers.
Product stage: {product_stage}. Before the specification and roadmap are signed off, plan only research, finance, legal and specialist groundwork; until distribution has started, plan no channel work.
Rules:
- Start only tasks listed in open_tasks, by their ids. You cannot create tasks: a roadmap item without tasks needs a task graph the founder builds in Development › Plan, so name it as waiting for that.
- A task whose blocked_by is empty is not blocked; its earlier work is finished.
- The summary describes only the tasks you put in tasks_to_start and the reasons you deferred the others. Never describe an agent starting work that is not one of those tasks.`,
});
