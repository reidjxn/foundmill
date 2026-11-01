/**
 * mergeReview (BUILD §9.6): a code task that passed its acceptance tests reaches the default branch. The pull request is
 * opened (or found) and the repository's tests started (activities/merge.ts `prepareMerge`); GitHub's merge state decides
 * whether anyone is asked at all (`assessMerge`: a branch that conflicts with or fell behind the default branch, or whose
 * checks already failed, goes back to its agent); then the merge is asked for through the gateway's policy (`askMerge`),
 * which makes it the founder's one tap in every mode (decision 2026-11-01). Once approved, the review waits for the
 * repository's checks to conclude (polling `awaitChecks`), merges under the approval (`completeMerge`), and never ends
 * on a silent failure: tests that fail hand the branch back, tests that never conclude hold the merge for the next
 * cycle, and every outcome is on record against the approval, which the Inbox's Decided panel shows.
 *
 * Started by `agentSession` once per task (`merge:<taskId>`) and by every cycle's sweep, abandoned by its parent, so it
 * outlives the session that finished the work.
 */
import { executeChild, proxyActivities, sleep } from "@temporalio/workflow";
import type { Activities, MergeAssessment, MergeInput, MergeOutcome } from "../activities";
import { approvalWait } from "./approvalWait";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "5 seconds" } });

/** GitHub computes a pull request's merge state after it opens or its branch moves: how long, and how often, to look. */
export const ASSESS_TRIES = 6;
export const ASSESS_WAIT_MS = 15_000;
/** After the founder approved: how often the repository's checks are read, and how long before the merge is held for the next cycle. */
export const CHECKS_POLL_MS = 60_000;
export const CHECKS_TIMEOUT_MS = 90 * 60_000;
/** A merge GitHub refuses right after the checks passed ("not mergeable") is tried again this many times, this far apart. */
export const MERGE_RETRIES = 3;
export const MERGE_RETRY_WAIT_MS = 30_000;

export async function mergeReview(input: MergeInput): Promise<MergeOutcome> {
  const prepared = await acts.prepareMerge(input);
  if (prepared.status !== "ready") return prepared;
  const pr = { prNumber: prepared.prNumber, prUrl: prepared.prUrl };

  // What GitHub says, before anyone is asked. A pull request just opened reads `unknown` for a few seconds.
  let assessment: MergeAssessment = { mergeable: "unknown", checks: "unknown", detail: null };
  for (let i = 0; i < ASSESS_TRIES; i++) {
    assessment = await acts.assessMerge({ ...input, ...pr });
    if (assessment.mergeable !== "unknown") break;
    await sleep(ASSESS_WAIT_MS);
  }
  if (assessment.mergeable === "conflicts" || assessment.mergeable === "behind") return acts.handBack({ ...input, ...pr, approvalId: null, why: assessment.mergeable, detail: assessment.detail });
  if (assessment.checks === "failure") return acts.handBack({ ...input, ...pr, approvalId: null, why: "checks_failed", detail: assessment.detail });

  const asked = await acts.askMerge({ ...input, ...pr });
  if (asked.status !== "awaiting_approval") return asked;
  const decision = await executeChild(approvalWait, { workflowId: `approval:${asked.approvalId}`, args: [{ businessId: input.businessId, approvalId: asked.approvalId }] });
  if (decision.outcome !== "approved") return acts.recordMergeDecision({ ...input, ...pr, approvalId: asked.approvalId, outcome: decision.outcome });

  // Approved: the merge waits for the repository's own tests. Without a test run to wait for (the repository has no
  // workflow, or it could not be started) the merge is tried once and the repository's rules decide.
  if (prepared.checksStarted) {
    const polls = Math.ceil(CHECKS_TIMEOUT_MS / CHECKS_POLL_MS);
    let concluded = false;
    for (let i = 0; i < polls; i++) {
      const checks = await acts.awaitChecks({ ...input, ...pr, approvalId: asked.approvalId, first: i === 0 });
      if (checks.state === "failure") return acts.handBack({ ...input, ...pr, approvalId: asked.approvalId, why: "checks_failed", detail: null });
      if (checks.state === "success") {
        concluded = true;
        break;
      }
      await sleep(CHECKS_POLL_MS);
    }
    if (!concluded) return acts.holdMerge({ ...input, ...pr, approvalId: asked.approvalId, why: "checks_timeout", detail: null });
  }

  let outcome = await acts.completeMerge({ ...input, ...pr, approvalId: asked.approvalId, decidedBy: decision.decidedBy });
  for (let i = 0; i < MERGE_RETRIES && outcome.status === "held" && outcome.retryable; i++) {
    await sleep(MERGE_RETRY_WAIT_MS);
    outcome = await acts.completeMerge({ ...input, ...pr, approvalId: asked.approvalId, decidedBy: decision.decidedBy });
  }
  if (outcome.status === "held") {
    // Refused after the checks passed and the retries: conflicts that appeared meanwhile hand the branch back; anything else holds.
    const again = await acts.assessMerge({ ...input, ...pr });
    if (again.mergeable === "conflicts" || again.mergeable === "behind") return acts.handBack({ ...input, ...pr, approvalId: asked.approvalId, why: again.mergeable, detail: again.detail });
    return acts.holdMerge({ ...input, ...pr, approvalId: asked.approvalId, why: "refused", detail: outcome.reason });
  }
  const { retryable: _retryable, ...clean } = outcome;
  void _retryable;
  return clean;
}
