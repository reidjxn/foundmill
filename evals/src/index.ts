/**
 * @foundmill/evals — golden tasks per agent template, the prompt-injection suite and the harness that runs them
 * against live models (BUILD §17.1, §9.8 item 5). `pnpm --filter @foundmill/evals evals` runs everything with
 * MODEL_MODE=live; the Vitest suites skip themselves when no key is present, so `pnpm test` stays offline.
 */
export * from "./types";
export * from "./harness";
export { GOLDEN_TASKS, goldenTasksFor, GOLDEN_FIXTURE_IDS } from "./golden/tasks";
export { INJECTION_CASES, injectionCasesOfKind } from "./injection/suite";
export { LOGO_BRIEFS, checkLogoSet, forbiddenShapes, runLogoEval, runLogoMarksEval } from "./logo";
export { MODERATION_CASES, runModerationCase, type ModerationCase, type ModerationCaseResult } from "./moderation";
export { CONVERSATION_CASES, type ConversationCase } from "./conversation/cases";
export { CONVERSATION_PASS_THRESHOLD, checkConversationReply, checkShippedReply, handOffActions, runConversationCase, summariseConversation, type ConversationCaseResult, type ConversationSuiteSummary } from "./conversation/run";
export { FOUNDER_TITLE_CORPUS, founderTitlesSystemPrompt, runFounderTitlesCase, summariseFounderTitles, type FounderTitleCase, type FounderTitleCaseResult, type FounderTitlesRunResult, type FounderTitlesSummary } from "./founder-strings";
export { PROJECT_PAGE_CASES, projectPageInputs, projectPageProblems, runProjectPageCase, type ProjectPageCase, type ProjectPageCaseResult } from "./project-page";
export { GOAL_EVAL_CURRENCY, GOAL_EVAL_TODAY, GOAL_PROPOSAL_CASES, goalSentenceProblems, runGoalProposalCase, summariseGoalProposals, type GoalProposalCase, type GoalProposalCaseResult, type GoalProposalSummary } from "./goal-proposal";
export {
  COMPOSER_CASE_KINDS,
  COMPOSER_CORPUS,
  COMPOSER_CORPUS_MANIFEST,
  COMPOSER_PASS_THRESHOLD,
  COMPOSER_RUBRIC,
  REPLACE_TIER_PATTERNS,
  composerCase,
  composerCorpus,
  composerSystemPrompt,
  agentNamingHits,
  plainLanguageHits,
  replaceTierPatterns,
  runComposerCase,
  summariseComposer,
  type ComposerCaseKind,
  type ComposerCaseResult,
  type ComposerEvalCase,
  type ComposerSuiteSummary,
  type AgentNamingHit,
  type PlainLanguageHit,
} from "./composer";
