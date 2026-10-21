/** Planner (BUILD §11.6 "Roadmap → agents", Opus): builds a task graph with goals, acceptance criteria, test expectations, file-scope hints and dependencies. */
import { z } from "zod";
import { definePrompt } from "./template";

export const PlannerVariables = z.object({
  roadmap_item: z.string().min(1),
  spec_excerpt: z.string().min(1),
  /** File tree summary and conventions of the repository (or "greenfield"). */
  repo_summary: z.string().min(1),
  max_tasks: z.number().int().min(1).max(64),
  /** Agent types that can be staffed, e.g. backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer. */
  worker_types: z.array(z.string().min(1)).min(1),
});

export const plannerPrompt = definePrompt({
  key: "planner",
  version: 1,
  route: "planner",
  description: "Decomposes a roadmap item into a dependency-ordered task graph with acceptance criteria, tests and file scopes.",
  variables: PlannerVariables,
  text: `Plan the engineering work for this roadmap item: {roadmap_item}
Specification excerpt: {spec_excerpt}
Repository: {repo_summary}
Return JSON {{"tasks": [{{"id", "title", "goal", "acceptance_criteria": [...], "test_expectations": [...], "file_scope": [...], "worker_type", "hard": boolean, "estimate_hours", "depends_on": [...ids]}}], "edges": [{{"from", "to"}}], "risks": [...], "questions_for_founder": [...]}}.
Rules:
- At most {max_tasks} tasks; each finishable by one agent in under 4 hours; split anything larger.
- Every task has at least one acceptance criterion that a test can check, and names the tests it must add or pass.
- file_scope lists the directories or files the task may change; two tasks that share a file scope must have a dependency edge between them so they never run concurrently.
- worker_type is one of {worker_types}; mark "hard": true only for tasks involving code that runs in parallel, security, data migration or ambiguous requirements.
- Schema changes, auth changes and payment flows get their own task with "ask before schema changes" in acceptance criteria.
- Never plan work the specification does not ask for; put uncertainty in questions_for_founder rather than inventing requirements.
- The graph must be acyclic; depends_on only references ids in this plan.
- Output JSON only.`,
});
