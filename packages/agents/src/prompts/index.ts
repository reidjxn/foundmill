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
import { researchPrompt } from "./research";
import { distributionStrategistPrompt } from "./distribution-strategist";
import { jurisdictionRecommenderPrompt } from "./jurisdiction-recommender";
import { plannerPrompt } from "./planner";
import { reviewAgentPrompt } from "./review-agent";
import { sourceRelevancePrompt, sourceWatcherPrompt } from "./source-watcher";
import { entitySweepPrompt } from "./entity-sweep";
import { chapterTitlePrompt } from "./chapter-title";
import { agentBuilderPrompt } from "./agent-builder";
import { customSkillTestsPrompt } from "./custom-skill-tests";
import { foundationsPrompt } from "./foundations";

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
export * from "./research";
export * from "./distribution-strategist";
export * from "./jurisdiction-recommender";
export * from "./planner";
export * from "./review-agent";
export * from "./source-watcher";
export * from "./entity-sweep";
export * from "./chapter-title";
export * from "./agent-builder";
export * from "./custom-skill-tests";
export * from "./foundations";

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
  researchPrompt,
  distributionStrategistPrompt,
  jurisdictionRecommenderPrompt,
  plannerPrompt,
  reviewAgentPrompt,
  sourceRelevancePrompt,
  sourceWatcherPrompt,
  entitySweepPrompt,
  chapterTitlePrompt,
  agentBuilderPrompt,
  customSkillTestsPrompt,
  foundationsPrompt,
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
