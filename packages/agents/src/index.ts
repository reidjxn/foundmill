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
export * from "./design-check";
export * from "./second-read";
export * from "./post-draft";
export * from "./showcase-script";
export * from "./post-media";
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
  // Team call (docs/TEAM_CALL.md §4): the turn director and the wrap-up.
  TEAM_CALL_TURN_ROUTE,
  TEAM_CALL_WRAP_UP_ROUTE,
  TEAM_CALL_TURN_MODES,
  TEAM_CALL_ACTION_TYPES,
  TEAM_CALL_TURN_RESERVE_TOKENS,
  TEAM_CALL_WRAP_UP_RESERVE_TOKENS,
  TEAM_CALL_TURN_USAGE_KIND,
  TEAM_CALL_WRAP_UP_USAGE_KIND,
  TEAM_CALL_FALLBACK_LINE,
  TEAM_CALL_DONE_NOTE,
  TEAM_CALL_AI_NOTE,
  TEAM_CALL_FALLBACK_SUMMARY,
  TEAM_CALL_SPEND_STEP,
  teamCallTurnPrompt,
  teamCallWrapUpPrompt,
  teamCallRound,
  teamCallRemit,
  teamCallDoneClaim,
  buildTeamCallTurnRequest,
  finaliseTeamCallTurns,
  finaliseTurnText,
  teamCallTurnsContext,
  buildTeamCallWrapUpRequest,
  finaliseTeamCallWrapUp,
  teamCallWrapUpContext,
  cutAtSentence,
  type TeamCallTurnMode,
  type TeamCallBusinessInput,
  type TeamCallParticipantInput,
  type TeamCallBriefInput,
  type TeamCallTranscriptTurn,
  type TeamCallTurnInput,
  type TeamCallAgentInput,
  type TeamCallWrapUpInput,
  type TeamCallTurnRequest,
  type TeamCallWrapUpRequest,
  type TeamCallTurnsContext,
  type TeamCallFinalTurn,
  type FinalisedTeamCallTurns,
  type TeamCallWrapUpContext,
  type TeamCallFinalAction,
  type FinalisedTeamCallWrapUp,
} from "./prompts";
