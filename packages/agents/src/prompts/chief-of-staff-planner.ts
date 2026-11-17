/**
 * Chief of Staff cycle planner (BUILD §12.4). Opus, warn on downgrade. Text is spec-verbatim; v2 (founder, 2026-10-18)
 * adds the product stage: before the founder has signed off the specification and the roadmap only groundwork is
 * planned, and no channel work until distribution has started (the orchestrator also holds channel tasks back in code).
 * v4 (lead, 2026-10-24): a roadmap item without tasks is planned by the cycle itself, never by the founder, and the
 * planner orders the work but never gates it (the orchestrator fills every free agent slot in code).
 * v5 (founder, 2026-10-30): a founder's Continue is the work the founder is waiting on: the tasks it retries come
 * first, ahead of coordination tasks about them, and no task is deferred over the test setup, which the platform runs
 * (the Foundmill business's five code tasks sat behind four re-scoping and diagnosis tasks for three cycles).
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
  version: 5,
  route: "chiefOfStaff",
  description: "Plans one business cycle: tasks to start per department with assignees, priorities and the time limit; product first, distribution when the founder starts it.",
  variables: ChiefOfStaffPlannerVariables,
  text: `Plan the next round of work for {business_name}. Inputs: brief, open tasks, budgets, business mode, pending events, roadmap, approvals waiting.
Output: for each department, the tasks to start (with assignee agent ids), priorities, and the time limit. Respect the limit of {max_agents} agents working at once, budget remaining {budget}, and rate-limit capacity {capacity}. Prefer work that unblocks customers.
Product stage: {product_stage}. Before the specification and roadmap are signed off, plan only research, finance, legal and specialist groundwork; until distribution has started, plan no channel work.
Rules:
- Start only tasks listed in open_tasks, by their ids. You cannot create tasks: a roadmap item without tasks is planned into tasks by the round of work itself; say it is being planned.
- A task whose blocked_by is empty is not blocked; its earlier work is finished.
- You order the work; you never hold it back. Every task you leave out of tasks_to_start that can run is still started while an agent slot is free, so put the most important work first and give a reason for the order.
- When trigger is continue, the founder pressed Continue: the failed and blocked tasks in open_tasks are being retried because the founder is waiting on them. Start them first, before any task about them (re-scoping, diagnosis, a lead's follow-up); a task that only plans or checks other tasks never takes a slot from the work it is about.
- Never defer a task because of the test setup, memory, the sandbox or an earlier failed run: the platform runs each task's tests and puts a failure's reason on the task itself; the next session on the task reads it and fixes what it names.
- The summary describes only the tasks you put in tasks_to_start and the reasons you deferred the others. Never describe an agent starting work that is not one of those tasks.`,
});
