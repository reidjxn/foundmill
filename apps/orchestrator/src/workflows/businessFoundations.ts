/**
 * businessFoundations (BUILD §11.1 "Take charge" → first open, §11.5): draft a new business's vision, first
 * specification and first roadmap once, after apps/api claimed the attempt (`foundations:{businessId}:{attempt}`).
 *
 * Staged (audit P3): the plan (the vision first, stored within seconds), then every section batch and the roadmap at
 * once, each its own activity with its own retries, so a failed batch is retried alone and only redrafts what it has
 * not stored. Each step stores what it wrote on the row as it lands (the screens fill in); `applyFoundations` then writes
 * it all in one transaction. Whatever happens, the row ends ready or failed (with a reason the founder can read and a
 * retry on Home and Product, which resumes from what was stored), never stuck in drafting.
 */
import { ActivityFailure, ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type { Activities, BusinessFoundationsInput, BusinessFoundationsResult, FoundationsStepUsage } from "../activities";

/**
 * The plan: one short call (low effort). The activity heartbeats while it waits, so a lost worker is noticed within a
 * minute, and an attempt that timed out is cancelled (its model call aborted) before the retry runs.
 */
const planActs = proxyActivities<Activities>({ startToCloseTimeout: "3 minutes", heartbeatTimeout: "1 minute", retry: { maximumAttempts: 3, initialInterval: "10 seconds", backoffCoefficient: 2 } });
/** A batch of two or three sections, or the roadmap: bounded output, retried on its own. */
const writeStepActs = proxyActivities<Activities>({ startToCloseTimeout: "4 minutes", heartbeatTimeout: "1 minute", retry: { maximumAttempts: 3, initialInterval: "5 seconds", backoffCoefficient: 2 } });
/** Database writes: short and retried. */
const writeActs = proxyActivities<Activities>({ startToCloseTimeout: "2 minutes", retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 } });

export const FOUNDATIONS_DRAFT_FAILED = "The drafting did not finish. Try again.";
export const FOUNDATIONS_SAVE_FAILED = "The drafting finished but could not be saved. Try again.";

/** The only failure type whose message is a founder-readable reason (activities/foundations FOUNDATIONS_DRAFT_ERROR). */
export const FOUNDATIONS_DRAFT_ERROR_TYPE = "FoundationsDraftError";

/**
 * The readable reason a drafting activity put on its failure (describeFoundationsFailure), or a generic one. Only a
 * `FoundationsDraftError` counts: a timeout, a lost worker or any other failure carries worker or provider text that
 * is never stored or shown (security review L4).
 */
function reasonOf(err: unknown, fallback: string): string {
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.type === FOUNDATIONS_DRAFT_ERROR_TYPE && err.cause.message) return err.cause.message;
  return fallback;
}

function sumUsage(all: FoundationsStepUsage[]): FoundationsStepUsage {
  return all.reduce(
    (a, b) => ({ calls: a.calls + b.calls, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costMinor: a.costMinor + b.costMinor, model: a.model ?? b.model, mode: a.mode ?? b.mode, repaired: a.repaired || b.repaired }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costMinor: 0, model: null, mode: null, repaired: false },
  );
}

export async function businessFoundations(input: BusinessFoundationsInput): Promise<BusinessFoundationsResult> {
  const fail = async (error: string): Promise<BusinessFoundationsResult> => {
    await writeActs.failFoundations({ ...input, error });
    return { status: "failed", inboxItemId: null, error };
  };

  let plan: Awaited<ReturnType<Activities["draftFoundationsPlan"]>>;
  try {
    plan = await planActs.draftFoundationsPlan(input);
  } catch (err) {
    return fail(reasonOf(err, FOUNDATIONS_DRAFT_FAILED));
  }
  if (!plan.current) return { status: "skipped", inboxItemId: null, error: null };

  // Every batch and the roadmap at once; all of them settle before the outcome is decided (no step is left running).
  const steps = await Promise.allSettled([...plan.chunks.map((sections) => writeStepActs.draftFoundationsSections({ ...input, sections })), writeStepActs.draftFoundationsRoadmap(input)]);
  const failed = steps.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) return fail(reasonOf(failed.reason, FOUNDATIONS_DRAFT_FAILED));
  const done = steps.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<Activities["draftFoundationsRoadmap"]>>>).value);
  if (done.some((d) => !d.current)) return { status: "skipped", inboxItemId: null, error: null };

  const usage = sumUsage([plan.usage, ...done.map((d) => d.usage)]);
  const model = { route: "foundations", model: usage.model, mode: usage.mode, costMinor: usage.costMinor, costLabel: "Estimate", repaired: usage.repaired, runner: "temporal", staged: true, calls: usage.calls };
  try {
    const applied = await writeActs.applyFoundations({ ...input, model });
    return { status: applied.applied ? "ready" : "skipped", inboxItemId: applied.inboxItemId, error: null };
  } catch {
    return fail(FOUNDATIONS_SAVE_FAILED);
  }
}
