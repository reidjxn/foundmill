/**
 * @foundmill/agents — agent templates, prompt templates (BUILD §12), skill definitions and test sets (§11.10),
 * rating calibration, club-rules enforcement and archetype seeds (§11.1). See docs/ARCHITECTURE.md §1.
 *
 * Nothing here calls a model or a connector: this package is data plus pure functions. The orchestrator, composer and
 * api import from it; `evals/` runs its templates against live models.
 */
export * from "./types";
export * from "./connectors";
export * from "./traits";
export * from "./calibration";
export * from "./club-rules";
export * from "./archetypes";
export * from "./foundations";
export * from "./foundations-staged";
export * from "./ideation";
export * from "./registry";
export * from "./templates";
export * from "./skills";
export * from "./voice";
export * from "./nudges";
export * from "./conversation";
export * as prompts from "./prompts";
export {
  type PromptTemplate,
  type PromptTemplateInit,
  PromptRenderError,
  definePrompt,
  extractPlaceholders,
  formatVariable,
  NoVariables,
  PROMPTS,
  PROMPT_LIST,
  type PromptKey,
  getPrompt,
  CLUB_RULES,
  type ClubRule,
  clubRulesPrompt,
  ClubRulesVariables,
} from "./prompts";
