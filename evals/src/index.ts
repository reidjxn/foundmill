/**
 * @foundmill/evals — golden tasks per agent template, the prompt-injection suite and the harness that runs them
 * against live models (BUILD §17.1, §9.8 item 5). `pnpm --filter @foundmill/evals evals` runs everything with
 * MODEL_MODE=live; the Vitest suites skip themselves when no key is present, so `pnpm test` stays offline.
 */
export * from "./types";
export * from "./harness";
export { GOLDEN_TASKS, goldenTasksFor, GOLDEN_FIXTURE_IDS } from "./golden/tasks";
export { INJECTION_CASES, injectionCasesOfKind } from "./injection/suite";
export { TYPED_READ_INJECTION_CASES, TypedReadInjectionCase } from "./injection/typed-reads";
export { LOGO_BRIEFS, checkLogoSet, forbiddenShapes, runLogoEval, runLogoMarksEval } from "./logo";
export { MODERATION_CASES, runModerationCase, type ModerationCase, type ModerationCaseResult } from "./moderation";
export { CONVERSATION_CASES, type ConversationCase } from "./conversation/cases";
export { CONVERSATION_PASS_THRESHOLD, checkConversationReply, checkShippedReply, handOffActions, runConversationCase, summariseConversation, type ConversationCaseResult, type ConversationSuiteSummary } from "./conversation/run";
export { FOUNDER_TITLE_CORPUS, founderTitlesSystemPrompt, runFounderTitlesCase, summariseFounderTitles, type FounderTitleCase, type FounderTitleCaseResult, type FounderTitlesRunResult, type FounderTitlesSummary } from "./founder-strings";
export { PROJECT_PAGE_CASES, projectPageInputs, projectPageProblems, runProjectPageCase, type ProjectPageCase, type ProjectPageCaseResult } from "./project-page";
export { PAGE_QUIZ_CASES, pageQuizEvalProblems, pageQuizTexts, runPageQuizCase, type PageQuizCase, type PageQuizCaseResult } from "./page-quiz";
export { CHANNEL_ENGINE_NOTE_CASES, LAUNCH_CLAIM, OFFLINE_TRACKING_NOTE as CHANNEL_ENGINE_OFFLINE_NOTE, runChannelEngineNoteCase, type ChannelEngineNoteResult } from "./channel-engine-notes";
export { FINDING_QUOTED, FULL_RESULT_SAID, INJECTION_FOLLOWED, SIMULATED_SAID, TASK_REPORT_NOTE_CASES, runTaskReportNoteCase, type TaskReportNoteResult } from "./task-report-notes";
export { SECOND_READ_CASES, SECOND_READ_INJECTION_PAGE, caseFactChecker, injectionFactChecker, runSecondReadCase, runSecondReadInjectionCase, secondReadProblems, type SecondReadCase, type SecondReadCaseResult, type SecondReadInjectionResult } from "./second-read";
export { PLANNER_CASES, plannerProblems, runPlannerCase, type PlannerCase, type PlannerCaseResult } from "./planner";
export { SHOWCASE_ADVERSARIAL_OUTPUTS, SHOWCASE_SCRIPT_CASES, judgeShowcaseScript, runShowcaseScriptCase, showcaseEvalFacts, showcaseScriptProblems, type ShowcaseScriptCase, type ShowcaseScriptCaseResult } from "./showcase-script";
export { POST_DRAFT_CASES, POST_DRAFT_EVAL_LINK, postDraftEvalFacts, postDraftProblems, runPostDraftCase, type PostDraftCase, type PostDraftCaseResult } from "./post-draft";
export { POST_MEDIA_CLAIM_CASES, POST_MEDIA_OUTCOMES, VIDEO_EXISTS_RE, postMediaOutcomeProblems, runPostMediaClaimCase, type PostMediaClaimCase, type PostMediaCaseResult } from "./post-media";
export { SUBTEXT_PATTERNS, TEAM_CALL_CASES, TEAM_CALL_EVAL_IDS, TEAM_CALL_PARTICIPANTS, WRAP_UP_TRANSCRIPT, runTeamCallCase, subtextHit, teamCallProblems, type TeamCallCase, type TeamCallCaseKind, type TeamCallCaseResult, type TeamCallRoundResult, type TeamCallRoundSpec } from "./team-call";
export { FREE_OPTION_ID, MENTOR_BUSINESS_NAME, MENTOR_CASES, MENTOR_OPTIONS, MISSING_PATTERNS, explainedIdeas, guessedNames, mentorComposerInputs, mentorComposerSystem, mentorConversationInput, mentorProblems, missingHit, runMentorCase, type MentorCase, type MentorCaseKind, type MentorCaseResult } from "./mentor";
export { GOAL_EVAL_CURRENCY, GOAL_EVAL_TODAY, GOAL_PROPOSAL_CASES, goalSentenceProblems, runGoalProposalCase, summariseGoalProposals, type GoalProposalCase, type GoalProposalCaseResult, type GoalProposalSummary } from "./goal-proposal";
export {
  COMPOSER_CASE_KINDS,
  COMPOSER_CORPUS,
  COMPOSER_CORPUS_MANIFEST,
  COMPOSER_PARKED_CASES,
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
  runParkedClauseCase,
  parkedClauseProblems,
  parkedTitlesOf,
  summariseComposer,
  type ComposerCaseKind,
  type ComposerCaseResult,
  type ComposerEvalCase,
  type ComposerSuiteSummary,
  type ParkedClauseResult,
  type AgentNamingHit,
  type PlainLanguageHit,
} from "./composer";
export { POSITIONING_CASES, POSITIONING_EVAL_IDS, positioningProblems as positioningEvalProblems, runPositioningCase, type PositioningCaseResult } from "./positioning";
export { BOOKING_SETUP_CASES, BookingSetupPlan, bookingSetupProblems, bookingSetupRequest, runBookingSetupCase, type BookingSetupCase } from "./booking/cases";
export { PATENT_OFFER_CASES, PatentOfferOutput, patentOfferProblems, patentOfferRequest, runPatentOfferCase, type PatentOfferCase } from "./patent-offer/cases";
export { TOOL_SCOUT_CASES, ToolScoutOutput, runToolScoutCase, toolScoutProblems, toolScoutRequest, type ToolScoutCase } from "./tool-scout/cases";
export { BROWSER_WORK_CASES, BrowserStep, browserWorkRequest, runBrowserWorkCase, type BrowserWorkCase } from "./browser-work/cases";
export { CHAPTER_REPORT_CASES, runChapterReportCase, type ChapterReportCase, type ChapterReportResult } from "./chapter-report";
