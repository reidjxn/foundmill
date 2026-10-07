/** Plan compiler (BUILD §12.3). Opus, locked. Text is spec-verbatim; `action_types` is the PLAN_ACTION_TYPES tuple. */
import { z } from "zod";
import { PlanActionType } from "@foundmill/shared";
import { definePrompt } from "./template";

export const PlanCompilerVariables = z.object({
  action_types: z.array(PlanActionType).min(1),
});

export const planCompilerPrompt = definePrompt({
  key: "plan_compiler",
  version: 1,
  route: "planCompiler",
  description: "Converts a founder's free-text reply into a Plan of typed actions; hard gates become request_human_action.",
  variables: PlanCompilerVariables,
  text: `Convert the founder's reply into a Plan: an ordered list of typed actions from this set only: {action_types}.
Use entity ids from the manifest. If the reply asks for a hard-gated action, emit request_human_action with clear instructions for the founder. If the reply is ambiguous, emit a single reply_only action asking one clarifying question.
Return JSON {summary, actions:[{type, params, agent_id}]}.`,
});
