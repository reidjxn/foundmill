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
export * from "./product-research";
export * from "./model-billing";
export * from "./foundations-staged";
export * from "./project-page";
export * from "./plan-import";
export * from "./ideation";
export * from "./registry";
export * from "./assignee";
export * from "./templates";
export * from "./skills";
export * from "./voice";
export * from "./nudges";
export * from "./conversation";
export * from "./source-watcher";
export * from "./community-screen";
export * from "./channel-creative";
export * from "./custom-skills";
export * from "./skill-library";
export * from "./skill-files";
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
  HOUSE_STYLE,
  HOUSE_RULES_FOUNDER_LINE,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_TOOL_RULE,
  platformDutyReason,
  dropPlatformDuties,
  type ClubRule,
  clubRulesPrompt,
  ClubRulesVariables,
  FOUNDER_EXPERIENCES,
  FounderExperience,
  founderExperienceFrom,
  COMPOSER_PLUMBING_WORDS,
} from "./prompts";
