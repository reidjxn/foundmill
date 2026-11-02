/**
 * mergeReview (BUILD §9.6): a code task that passed its acceptance tests reaches the default branch. The pull request is
 * opened (or found) and the repository's tests started (activities/merge.ts `prepareMerge`); GitHub's merge state decides
 * whether anyone is asked at all (`assessMerge`: a branch that conflicts with or fell behind the default branch, or whose
 * checks already failed, goes back to its agent); then the merge is asked for through the gateway's policy (`askMerge`),
 * which makes it the founder's one tap in every mode (decision 2026-11-01). A branch the default branch moved past is
 * brought up to date by GitHub first (`updateBranch`, one merge commit on the agent's branch) and its tests run again, so
 * the founder approves the change as it would land (Nov 2, 2026). Once approved, the review waits for the
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

/** A branch the default branch moved past: GitHub's own word, or the compare's count. */
const isBehind = (a: MergeAssessment): boolean => a.mergeable === "behind" || (a.behindBy ?? 0) > 0;

export async function mergeReview(input: MergeInput): Promise<MergeOutcome> {
  const prepared = await acts.prepareMerge(input);
  if (prepared.status !== "ready") return prepared;
  const pr = { prNumber: prepared.prNumber, prUrl: prepared.prUrl };
  let checksStarted = prepared.checksStarted;

  // What GitHub says, before anyone is asked. A pull request just opened reads `unknown` for a few seconds.
  const assess = async (): Promise<MergeAssessment> => {
    let a: MergeAssessment = { mergeable: "unknown", checks: "unknown", detail: null };
    for (let i = 0; i < ASSESS_TRIES; i++) {
      a = await acts.assessMerge({ ...input, ...pr });
      if (a.mergeable !== "unknown") break;
      await sleep(ASSESS_WAIT_MS);
    }
    return a;
  };
  let assessment = await assess();
  if (assessment.mergeable === "conflicts") return acts.handBack({ ...input, ...pr, approvalId: null, why: "conflicts", detail: assessment.detail });
  // The default branch moved on since the branch was cut: GitHub brings the branch up to date (one merge commit on the
  // agent's branch) and the tests run again on the new head, so what the founder approves is the change as it would
  // land. A branch GitHub cannot update (conflicts appeared) goes back to its agent, the one case an agent is for.
  if (isBehind(assessment)) {
    const updated = await acts.updateBranch({ ...input, ...pr });
    if (!updated.updated && updated.reason !== null) return acts.handBack({ ...input, ...pr, approvalId: null, why: "conflicts", detail: updated.reason });
    if (updated.updated) {
      checksStarted = checksStarted || updated.checksStarted;
      await sleep(ASSESS_WAIT_MS);
      assessment = await assess();
      if (assessment.mergeable === "conflicts") return acts.handBack({ ...input, ...pr, approvalId: null, why: "conflicts", detail: assessment.detail });
    }
  }
  if (assessment.checks === "failure") return acts.handBack({ ...input, ...pr, approvalId: null, why: "checks_failed", detail: assessment.detail });

  const asked = await acts.askMerge({ ...input, ...pr });
  if (asked.status !== "awaiting_approval") return asked;
  const decision = await executeChild(approvalWait, { workflowId: `approval:${asked.approvalId}`, args: [{ businessId: input.businessId, approvalId: asked.approvalId }] });
  if (decision.outcome !== "approved") return acts.recordMergeDecision({ ...input, ...pr, approvalId: asked.approvalId, outcome: decision.outcome });

  // Approved: the merge waits for the repository's own tests. Without a test run to wait for (the repository has no
  // workflow, or it could not be started) the merge is tried once and the repository's rules decide.
  const approvalId = asked.approvalId;
  const waitForChecks = async (first: boolean): Promise<"success" | "failure" | "timeout"> => {
    const polls = Math.ceil(CHECKS_TIMEOUT_MS / CHECKS_POLL_MS);
    for (let i = 0; i < polls; i++) {
      const checks = await acts.awaitChecks({ ...input, ...pr, approvalId, first: first && i === 0 });
      if (checks.state === "failure" || checks.state === "success") return checks.state;
      await sleep(CHECKS_POLL_MS);
    }
    return "timeout";
  };
  const merge = async () => {
    let outcome = await acts.completeMerge({ ...input, ...pr, approvalId, decidedBy: decision.decidedBy });
    for (let i = 0; i < MERGE_RETRIES && outcome.status === "held" && outcome.retryable; i++) {
      await sleep(MERGE_RETRY_WAIT_MS);
      outcome = await acts.completeMerge({ ...input, ...pr, approvalId, decidedBy: decision.decidedBy });
    }
    return outcome;
  };
  if (checksStarted) {
    const checks = await waitForChecks(true);
    if (checks === "failure") return acts.handBack({ ...input, ...pr, approvalId, why: "checks_failed", detail: null });
    if (checks === "timeout") return acts.holdMerge({ ...input, ...pr, approvalId, why: "checks_timeout", detail: null });
  }

  let outcome = await merge();
  if (outcome.status === "held") {
    // Refused after the checks passed and the retries: conflicts that appeared meanwhile hand the branch back; a default
    // branch that moved meanwhile is brought in once more and the tests waited for again; anything else holds.
    const again = await acts.assessMerge({ ...input, ...pr });
    if (again.mergeable === "conflicts") return acts.handBack({ ...input, ...pr, approvalId, why: "conflicts", detail: again.detail });
    if (isBehind(again)) {
      const updated = await acts.updateBranch({ ...input, ...pr });
      if (!updated.updated && updated.reason !== null) return acts.handBack({ ...input, ...pr, approvalId, why: "conflicts", detail: updated.reason });
      if (updated.updated) {
        if (updated.checksStarted) {
          const checks = await waitForChecks(false);
          if (checks === "failure") return acts.handBack({ ...input, ...pr, approvalId, why: "checks_failed", detail: null });
          if (checks === "timeout") return acts.holdMerge({ ...input, ...pr, approvalId, why: "checks_timeout", detail: null });
        }
        outcome = await merge();
      }
    }
    if (outcome.status === "held") return acts.holdMerge({ ...input, ...pr, approvalId, why: "refused", detail: outcome.reason });
  }
  const { retryable: _retryable, ...clean } = outcome;
  void _retryable;
  return clean;
}
