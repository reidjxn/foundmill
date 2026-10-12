/**
 * trainingRun (BUILD §11.10, AC-11.10.1): re-score a draft agent version. Skill test sets run in parallel (one
 * activity per skill, each heartbeating per test), results are written on the run and narrated through
 * `training.completed`. The live version is never touched; Promote/Discard is the founder's decision in apps/api.
 *
 * Whatever happens the run ends awaiting a decision, failed or canceled, never queued: a run that cannot start
 * (`loadTrainingRun` refuses it, for instance a candidate that is the live version, or keeps failing) is failed with
 * the reason through `failTrainingRun`, so the Training tab never shows "Queued" for a run nothing will pick up.
 */
import { ActivityFailure, ApplicationFailure, allHandlersFinished, condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, LoadedTrainingRun, SkillTestsOutcome, TrainingRunInput, TrainingRunResult } from "../activities";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3 } });
const tests = proxyActivities<Activities>({ startToCloseTimeout: "30 minutes", heartbeatTimeout: "5 minutes", retry: { maximumAttempts: 2 } });

/** Skill test activities run at once (target 2–5 minutes for a whole run). */
export const TRAINING_PARALLELISM = 6;

/** The only failure type whose message is a founder-readable reason (activities/training TRAINING_RUN_ERROR). */
export const TRAINING_RUN_ERROR_TYPE = "TrainingRunError";
export const TRAINING_START_FAILED = "The run could not start. Train again from the Training tab.";

/** The readable reason `loadTrainingRun` gave, or a generic one: worker or database text is never stored or shown. */
function reasonOf(err: unknown): string {
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.type === TRAINING_RUN_ERROR_TYPE && err.cause.message) return err.cause.message;
  return TRAINING_START_FAILED;
}

export async function trainingRun(input: TrainingRunInput): Promise<TrainingRunResult> {
  let cancelled = false;
  setHandler(stopSignal, () => {
    cancelled = true;
  });
  const startedAt = new Date().toISOString();
  let loaded: LoadedTrainingRun;
  try {
    loaded = await acts.loadTrainingRun(input);
  } catch (err) {
    const result = await acts.failTrainingRun({ ...input, error: reasonOf(err) });
    await condition(allHandlersFinished);
    return result;
  }
  const outcomes: SkillTestsOutcome[] = [];
  const queue = [...loaded.skillKeys];
  let error: string | null = null;
  const worker = async () => {
    for (;;) {
      const skillKey = queue.shift();
      if (!skillKey || cancelled || error) return;
      try {
        outcomes.push(await tests.runSkillTests({ ...input, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, skillKey, modelKey: loaded.modelKey }));
      } catch (err) {
        error = `${skillKey}: ${(err as Error).message}`.slice(0, 400);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRAINING_PARALLELISM, Math.max(1, queue.length)) }, worker));
  const result = await acts.finalizeTrainingRun({ ...input, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, liveVersionId: loaded.liveVersionId, outcomes, clubRuleFlags: loaded.clubRuleFlags, retest: loaded.retest ?? null, startedAt, ...(cancelled ? { status: "cancelled" as const } : error ? { status: "failed" as const, error } : {}) });
  await condition(allHandlersFinished);
  return result;
}
