/**
 * Every activity the worker registers, built from one `OrchestratorDeps`. Workflows import only the `Activities`
 * type (`import type`), so this file and its dependencies never enter the workflow bundle.
 */
import { APP_NAME } from "@foundmill/config";
import type { OrchestratorDeps } from "../deps";
import { createApprovalActivities } from "./approvals";
import { createAutomatedModeActivities } from "./automatedMode";
import { createAutopilotActivities } from "./autopilot";
import { createBriefActivities } from "./brief";
import { createChannelActivities } from "./channel";
import { createCycleActivities } from "./cycle";
import { createFoundationsActivities } from "./foundations";
import { createHealthActivities } from "./health";
import { createHolidayActivities } from "./holiday";
import { createJourneyActivities } from "./journey";
import { createMergeActivities } from "./merge";
import { createMiscActivities } from "./misc";
import { createNotifyActivities } from "./notify";
import { createPlanActivities } from "./plan";
import { createPostDraftActivities } from "./post-draft";
import { createPostMediaActivities } from "./post-media";
import { createRoadmapPlanActivities } from "./roadmap-plan";
import { createScheduleActivities } from "./schedules";
import { createSessionActivities } from "./session";
import { createSourceWatcherActivities } from "./source-watcher";
import { createTrainingActivities } from "./training";

export function createActivities(deps: OrchestratorDeps) {
  return {
    /** Gate 0 hello workflow: proves the worker, the queue and an activity round-trip. */
    async greet(input: { name: string }): Promise<string> {
      return `Hello from ${APP_NAME}, ${input.name}`;
    },
    ...createBriefActivities(deps),
    ...createCycleActivities(deps),
    ...createRoadmapPlanActivities(deps),
    ...createSessionActivities(deps),
    ...createMergeActivities(deps),
    ...createPlanActivities(deps),
    ...createApprovalActivities(deps),
    ...createTrainingActivities(deps),
    ...createHealthActivities(deps),
    ...createHolidayActivities(deps),
    ...createAutomatedModeActivities(deps),
    ...createChannelActivities(deps),
    ...createJourneyActivities(deps),
    ...createMiscActivities(deps),
    ...createFoundationsActivities(deps),
    ...createScheduleActivities(deps),
    ...createAutopilotActivities(deps),
    ...createSourceWatcherActivities(deps),
    ...createNotifyActivities(deps),
    ...createPostDraftActivities(deps),
    ...createPostMediaActivities(deps),
  };
}

export type Activities = ReturnType<typeof createActivities>;
export * from "./types";
export type { AutopilotEvaluation } from "./autopilot";
export type { SourceWatchInput, SourceWatchReason, SourceWatchResult, SourceWatchSweepInput, SourceWatchWorkflowInput, SourceWatchWorkflowResult } from "./source-watcher";
export type { PostDraftInput, PostDraftResult } from "./post-draft";
export type { PostMediaInput, PostMediaStep, PostMediaStepInput, PostVideoCheck } from "./post-media";
