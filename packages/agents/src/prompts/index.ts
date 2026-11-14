/** Prompt template registry (BUILD §12). Every template is versioned; `PROMPTS` is keyed by template key. */
import { type PromptTemplate } from "./template";
import { clubRulesPrompt } from "./club-rules";
import { inboxComposerPrompt } from "./inbox-composer";
import { planCompilerPrompt } from "./plan-compiler";
import { chiefOfStaffPlannerPrompt } from "./chief-of-staff-planner";
import { skillGraderPrompt } from "./skill-grader";
import { coachPrompt } from "./coach";
import { quarantinedReaderPrompt } from "./quarantined-reader";
import { journeyCommentaryPrompt } from "./journey-commentary";
import { ideationPrompt } from "./ideation";
import { logoDesignerPrompt, logoMarkPrompt } from "./logo-designer";
import { researchPrompt } from "./research";
import { distributionStrategistPrompt } from "./distribution-strategist";
import { jurisdictionRecommenderPrompt } from "./jurisdiction-recommender";
import { plannerPrompt } from "./planner";
import { reviewAgentPrompt } from "./review-agent";
import { secondReadPrompt } from "./second-read";
import { sourceRelevancePrompt, sourceWatcherPrompt } from "./source-watcher";
import { entitySweepPrompt } from "./entity-sweep";
import { chapterTitlePrompt } from "./chapter-title";
import { taskFounderTitlePrompt } from "./task-founder-title";
import { agentBuilderPrompt } from "./agent-builder";
import { customSkillTestsPrompt } from "./custom-skill-tests";
import { foundationsBriefPrompt, foundationsPrompt, foundationsRoadmapPrompt, foundationsSectionsPrompt, foundationsSkeletonPrompt } from "./foundations";
import { agentConversationPrompt } from "./agent-conversation";
import { channelCreativePrompt } from "./channel-creative";
import { productResearchPlanPrompt } from "./product-research";
import { goalProposalPrompt } from "./goal-proposal";
import { projectPagePrompt } from "./project-page";
import { postDraftPrompt } from "./post-draft";
import { pageQuizPrompt } from "./page-quiz";
import { teamCallTurnPrompt, teamCallWrapUpPrompt } from "./team-call";

export * from "./template";
export * from "./club-rules";
export * from "./inbox-composer";
export * from "./plan-compiler";
export * from "./chief-of-staff-planner";
export * from "./skill-grader";
export * from "./coach";
export * from "./quarantined-reader";
export * from "./journey-commentary";
export * from "./ideation";
export * from "./logo-designer";
export * from "./research";
export * from "./distribution-strategist";
export * from "./jurisdiction-recommender";
export * from "./planner";
export * from "./review-agent";
export * from "./second-read";
export * from "./source-watcher";
export * from "./entity-sweep";
export * from "./chapter-title";
export * from "./task-founder-title";
export * from "./agent-builder";
export * from "./custom-skill-tests";
export * from "./foundations";
export * from "./agent-conversation";
export * from "./channel-creative";
export * from "./product-research";
export * from "./goal-proposal";
export * from "./project-page";
export * from "./post-draft";
export * from "./page-quiz";
export * from "./team-call";

export const PROMPT_LIST = [
  clubRulesPrompt,
  inboxComposerPrompt,
  planCompilerPrompt,
  chiefOfStaffPlannerPrompt,
  skillGraderPrompt,
  coachPrompt,
  quarantinedReaderPrompt,
  journeyCommentaryPrompt,
  ideationPrompt,
  logoDesignerPrompt,
  logoMarkPrompt,
  researchPrompt,
  distributionStrategistPrompt,
  jurisdictionRecommenderPrompt,
  plannerPrompt,
  reviewAgentPrompt,
  secondReadPrompt,
  sourceRelevancePrompt,
  sourceWatcherPrompt,
  entitySweepPrompt,
  chapterTitlePrompt,
  taskFounderTitlePrompt,
  agentBuilderPrompt,
  customSkillTestsPrompt,
  foundationsPrompt,
  foundationsBriefPrompt,
  foundationsSkeletonPrompt,
  foundationsSectionsPrompt,
  foundationsRoadmapPrompt,
  agentConversationPrompt,
  channelCreativePrompt,
  productResearchPlanPrompt,
  goalProposalPrompt,
  projectPagePrompt,
  teamCallTurnPrompt,
  teamCallWrapUpPrompt,
  postDraftPrompt,
  pageQuizPrompt,
] as const;

export type PromptKey = (typeof PROMPT_LIST)[number]["key"];

export const PROMPTS: Readonly<Record<PromptKey, PromptTemplate>> = Object.freeze(
  Object.fromEntries(PROMPT_LIST.map((p) => [p.key, p as PromptTemplate])) as Record<PromptKey, PromptTemplate>,
);

export function getPrompt(key: PromptKey): PromptTemplate {
  const p = PROMPTS[key];
  if (!p) throw new Error(`Unknown prompt template "${key}"`);
  return p;
}
