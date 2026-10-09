/**
 * businessFoundations (BUILD §11.1 "Take charge" → first open, §11.5): draft a new business's vision, first
 * specification and first roadmap once, after apps/api claimed the attempt (`foundations:{businessId}:{attempt}`).
 * The model call retries on its own; whatever happens, the row ends ready or failed (with a reason the founder can
 * read and a retry on Home and Product), never stuck in drafting.
 */
import { ActivityFailure, ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type { Activities, BusinessFoundationsInput, BusinessFoundationsResult } from "../activities";

/**
 * One Opus call drafting every section: generous, with backoff for rate limits and overloads. The activity heartbeats
 * while it waits, so a lost worker is noticed within a minute, and an attempt that timed out is cancelled (its model
 * call aborted) before the retry runs: two attempts never draft in parallel.
 */
const draftActs = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", heartbeatTimeout: "1 minute", retry: { maximumAttempts: 3, initialInterval: "15 seconds", backoffCoefficient: 2 } });
/** Database writes: short and retried. */
const writeActs = proxyActivities<Activities>({ startToCloseTimeout: "2 minutes", retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 } });

export const FOUNDATIONS_DRAFT_FAILED = "The drafting did not finish. Try again.";
export const FOUNDATIONS_SAVE_FAILED = "The drafting finished but could not be saved. Try again.";

/** The only failure type whose message is a founder-readable reason (activities/foundations FOUNDATIONS_DRAFT_ERROR). */
export const FOUNDATIONS_DRAFT_ERROR_TYPE = "FoundationsDraftError";

/**
 * The readable reason the draft activity put on its failure (describeFoundationsFailure), or a generic one. Only a
 * `FoundationsDraftError` counts: a timeout, a lost worker or any other failure carries worker or provider text that
 * is never stored or shown (security review L4).
 */
function reasonOf(err: unknown, fallback: string): string {
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.type === FOUNDATIONS_DRAFT_ERROR_TYPE && err.cause.message) return err.cause.message;
  return fallback;
}

export async function businessFoundations(input: BusinessFoundationsInput): Promise<BusinessFoundationsResult> {
  let drafted: Awaited<ReturnType<Activities["draftFoundations"]>>;
  try {
    drafted = await draftActs.draftFoundations(input);
  } catch (err) {
    const error = reasonOf(err, FOUNDATIONS_DRAFT_FAILED);
    await writeActs.failFoundations({ ...input, error });
    return { status: "failed", inboxItemId: null, error };
  }
  if (!drafted.current || !drafted.draft) return { status: "skipped", inboxItemId: null, error: null };
  try {
    const applied = await writeActs.applyFoundations({ ...input, draft: drafted.draft, door: drafted.door, model: drafted.model });
    return { status: applied.applied ? "ready" : "skipped", inboxItemId: applied.inboxItemId, error: null };
  } catch {
    await writeActs.failFoundations({ ...input, error: FOUNDATIONS_SAVE_FAILED });
    return { status: "failed", inboxItemId: null, error: FOUNDATIONS_SAVE_FAILED };
  }
}
