/**
 * Custom skill test drafter (BUILD §11.10 "Custom skills: founder adds name + description + optional examples; Opus
 * drafts a test set; founder reviews before it counts"). Opus; output is reviewed, never used as-is.
 */
import { z } from "zod";
import { definePrompt } from "./template";

export const CustomSkillTestsVariables = z.object({
  business_name: z.string().min(1),
  agent_role: z.string().min(1),
  skill_name: z.string().min(1),
  skill_description: z.string().min(1),
  /** Founder-supplied examples ("input => good output"), or "none". */
  examples: z.array(z.string().min(1)).min(1),
  task_count: z.number().int().min(12).max(30),
  /** Mock tool names the sandbox can offer (never real email or spend). */
  mock_tools: z.array(z.string().min(1)).min(1),
});

export const customSkillTestsPrompt = definePrompt({
  key: "custom_skill_tests",
  version: 1,
  route: "coach",
  description: "Drafts a 12-30 task test set with rubric lines for a founder-defined custom skill; half are marked held out.",
  variables: CustomSkillTestsVariables,
  text: `Draft a test set for the custom skill "{skill_name}" of a {agent_role} at {business_name}.
Skill description: {skill_description}
Founder examples: {examples}
Produce exactly {task_count} tasks as JSON {{"tests": [{{"title", "prompt" (the task as the lead would assign it, with concrete inputs), "rubric": [2-5 criteria the grader can score 0-1], "checks": [{{"kind": "json_schema_valid|tests_pass|policy_respected|entity_links_valid|word_count|contains_all|contains_none|no_tool_calls|cites_source_ids", "params": {{}}}}], "mockTools": [subset of {mock_tools}], "heldOut": boolean}}]}}.
Rules:
- Tasks vary in situation, difficulty and inputs; no two tasks test the same thing with different wording.
- Every task runs in a sandbox against mock tools only: no real email, spend, bookings or signatures. A task that needs a hard-gated action must expect the agent to stop and hand it to the founder as a founder action; say so in plain words.
- Rubric criteria describe observable qualities of the output, never the agent's intent.
- Mark exactly half of the tasks heldOut: true, spread across difficulty levels.
- Output JSON only.`,
});
