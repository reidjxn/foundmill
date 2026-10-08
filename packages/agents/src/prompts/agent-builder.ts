/** Agent builder (BUILD §11.13): sentence → Opus drafts description, instructions, skills, tools and a model suggestion. */
import { z } from "zod";
import { definePrompt } from "./template";

export const AgentBuilderVariables = z.object({
  business_name: z.string().min(1),
  sentence: z.string().min(1),
  /** Connector keys and tool names available to this business (from the gateway catalogue). */
  available_tools: z.array(z.string().min(1)).min(1),
  /** Existing skill keys the draft may reuse before proposing custom ones. */
  existing_skill_keys: z.array(z.string().min(1)).min(1),
});

export const agentBuilderPrompt = definePrompt({
  key: "agent_builder",
  version: 1,
  route: "departmentLead",
  description: "Drafts a complete agent template from one sentence: description, structured instructions, skills, tools, model.",
  variables: AgentBuilderVariables,
  text: `The founder of {business_name} wants a new agent: "{sentence}".
Available tools (connector.tool): {available_tools}
Existing skills: {existing_skill_keys}
Return JSON {{"name", "role", "description" (what I do: purpose, responsibilities, inputs, outputs, never-does), "instructions": {{"role", "goals": [...], "rules": [...], "playbook": [...], "tone", "examples": [{{"input", "output"}}]}}, "tools": [{{"connectorKey", "tools": [...]}}], "modelKey": "opus|sonnet|haiku", "skills": [existing keys], "custom_skills": [{{"key", "name", "description", "group": "craft"}}], "autonomy": {{"mode": "inherit|lower|higher", "spendCapMinor", "approvalThresholdMinor"}}}}.
Rules:
- Instructions never restate or weaken the house rules; they add role-specific goals, rules and a step-by-step playbook.
- Grant only tools from the available list and only those the playbook uses; tools that spend money or contact third parties require the playbook to ask first.
- Suggest haiku for classify/extract work, sonnet for execution, opus only for planning, review or judgement-heavy roles.
- Reuse existing skills; propose custom craft skills only for abilities no existing skill covers, at most 4.
- Output JSON only.`,
});
