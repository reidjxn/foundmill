/**
 * trainingRun (BUILD §11.10, AC-11.10.1): re-score a draft agent version. Skill test sets run in parallel (one
 * activity per skill, each heartbeating per test), results are written on the run and narrated through
 * `training.completed`. The live version is never touched; Promote/Discard is the founder's decision in apps/api.
 *
 * Whatever happens the run ends awaiting a decision, failed or canceled, never queued: a run that cannot start
 * (`loadTrainingRun` refuses it, for instance a candidate that is the live version, or keeps failing) is failed with
 * the reason through `failTrainingRun`, so the Training tab never shows "Queued" for a run nothing will pick up. Results
 * that cannot be written (`finalizeTrainingRun` keeps failing) end the run failed the same way, never "Running".
 *
 * A run asked for at half price (`input.batch`, WP-09 T10) sends its candidate answers as one batch, looks every two
 * minutes until it ends, runs the deterministic checks, sends the grades as a second batch, waits again and collects.
 * A batch that has not ended a day after the run started fails the run with `TRAINING_BATCH_TIMEOUT`. Behind
 * `patched("training-batch")`, so runs recorded before it replay on the old path.
 */
import { ActivityFailure, ApplicationFailure, allHandlersFinished, condition, patched, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { Activities, LoadedTrainingRun, SkillTestsOutcome, TrainingRunInput, TrainingRunResult } from "../activities";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3 } });
const tests = proxyActivities<Activities>({ startToCloseTimeout: "30 minutes", heartbeatTimeout: "5 minutes", retry: { maximumAttempts: 2 } });

/** Skill test activities run at once (target 2–5 minutes for a whole run). */
export const TRAINING_PARALLELISM = 6;

/** The only failure type whose message is a founder-readable reason (activities/training TRAINING_RUN_ERROR). */
export const TRAINING_RUN_ERROR_TYPE = "TrainingRunError";
export const TRAINING_START_FAILED = "The run could not start. Train again from the Training tab.";
export const TRAINING_FINISH_FAILED = "The results could not be saved. Train again from the Training tab.";
export const TRAINING_BATCH_TIMEOUT = "The half-price check did not finish in a day. Run it now, or try again.";
/** The patch id of the batch path (Temporal `patched`). Never rename it: recorded histories carry it. */
export const TRAINING_BATCH_PATCH = "training-batch";
const BATCH_POLL = "2 minutes";
const BATCH_DEADLINE_MS = 24 * 60 * 60 * 1000;

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
  let outcomes: SkillTestsOutcome[] = [];
  let error: string | null = null;
  if (input.batch && patched(TRAINING_BATCH_PATCH)) {
    const run = { ...input, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, skillKeys: loaded.skillKeys, modelKey: loaded.modelKey, ...(loaded.measuredSkillKey ? { measuredSkillKey: loaded.measuredSkillKey } : {}) };
    const deadline = Date.now() + BATCH_DEADLINE_MS;
    // A canceled run still waits for a batch it sent: Anthropic charges for it, so it is collected and booked.
    const ended = async (batchId: string) => {
      while (!(await acts.trainingBatchEnded({ batchId, businessId: input.businessId }))) {
        if (Date.now() >= deadline) return false;
        await sleep(BATCH_POLL);
      }
      return true;
    };
    try {
      const { batchId: candidateBatchId } = await acts.submitTrainingCandidates(run);
      if (candidateBatchId && !(await ended(candidateBatchId))) return await timedOut(input);
      const { batchId: graderBatchId } = candidateBatchId && !cancelled ? await acts.submitTrainingGrades({ ...run, candidateBatchId }) : { batchId: null };
      if (graderBatchId && !(await ended(graderBatchId))) return await timedOut(input);
      outcomes = await tests.collectTrainingOutcomes({ ...run, candidateBatchId, graderBatchId });
    } catch (err) {
      error = (err as Error).message.slice(0, 400);
    }
  } else {
    const queue = [...loaded.skillKeys];
    const worker = async () => {
      for (;;) {
        const skillKey = queue.shift();
        if (!skillKey || cancelled || error) return;
        try {
          outcomes.push(await tests.runSkillTests({ ...input, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, skillKey, modelKey: loaded.modelKey, ...(loaded.measuredSkillKey ? { measuredSkillKey: loaded.measuredSkillKey } : {}) }));
        } catch (err) {
          error = `${skillKey}: ${(err as Error).message}`.slice(0, 400);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRAINING_PARALLELISM, Math.max(1, queue.length)) }, worker));
  }
  let result: TrainingRunResult;
  try {
    result = await acts.finalizeTrainingRun({ ...input, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, liveVersionId: loaded.liveVersionId, outcomes, clubRuleFlags: loaded.clubRuleFlags, retest: loaded.retest ?? null, check: !!loaded.measuredSkillKey, startedAt, ...(cancelled ? { status: "cancelled" as const } : error ? { status: "failed" as const, error } : {}) });
  } catch {
    result = await acts.failTrainingRun({ ...input, error: TRAINING_FINISH_FAILED });
  }
  await condition(allHandlersFinished);
  return result;
}

async function timedOut(input: TrainingRunInput): Promise<TrainingRunResult> {
  const result = await acts.failTrainingRun({ ...input, error: TRAINING_BATCH_TIMEOUT });
  await condition(allHandlersFinished);
  return result;
}
