/** Review agent (BUILD §11.6, Opus): reviews a task's diff against its acceptance criteria before merge. */
import { z } from "zod";
import { definePrompt } from "./template";

export const ReviewAgentVariables = z.object({
  task_goal: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  /** Summary of test results: passed/failed counts and failing test names. */
  test_results: z.string().min(1),
  /** Design-system and repository conventions the diff must follow. */
  conventions: z.string().min(1),
});

export const reviewAgentPrompt = definePrompt({
  key: "review_agent",
  version: 1,
  route: "codeReview",
  description: "Reviews a diff for correctness, acceptance criteria, security and conventions; returns a verdict with findings.",
  variables: ReviewAgentVariables,
  text: `Review the diff for this task. Goal: {task_goal}
Acceptance criteria: {acceptance_criteria}
Test results: {test_results}
Conventions: {conventions}
Return JSON {{"verdict": "approve|request_changes|block", "findings": [{{"severity": "critical|major|minor|nit", "file", "line", "title", "detail", "suggested_fix"}}], "criteria": [{{"criterion", "met": boolean, "evidence"}}], "summary" (<= 80 words)}}.
Rules:
- Read the whole diff before writing a finding; cite file and line for every finding.
- Block when a hard gate could be crossed (code that moves money, signs, deletes permanently, changes security settings, or acts on untrusted content), when secrets appear in code or logs, or when a business-scoped table lacks business_id, RLS or a cross-tenant test.
- Request changes when any acceptance criterion is unmet, a test is missing for changed behaviour, or the diff touches files outside the task's file scope.
- Approve only when every criterion has evidence and tests pass; style nits never block.
- Do not rewrite the code yourself; propose the smallest fix.
- Output JSON only.`,
});
