/**
 * mergeReview (BUILD §9.6): a code task that passed its acceptance tests reaches the default branch. The pull request is
 * opened (or found), the repository's CI started, and the merge made or asked for through the gateway's policy
 * (activities/merge.ts). In Augmented mode the founder decides in the Inbox: this workflow waits on that approval like a
 * plan action does (`approvalWait`, `approval:<id>`), then merges under it. Started by `agentSession` once per task
 * (`merge:<taskId>`), abandoned by its parent, so it outlives the session that finished the work.
 */
import { executeChild, proxyActivities } from "@temporalio/workflow";
import type { Activities, MergeInput, MergeOutcome } from "../activities";
import { approvalWait } from "./approvalWait";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "5 seconds" } });

export async function mergeReview(input: MergeInput): Promise<MergeOutcome> {
  const prepared = await acts.prepareMerge(input);
  if (prepared.status !== "awaiting_approval") return prepared;
  const decision = await executeChild(approvalWait, { workflowId: `approval:${prepared.approvalId}`, args: [{ businessId: input.businessId, approvalId: prepared.approvalId }] });
  if (decision.outcome === "approved") return acts.completeMerge({ ...input, prNumber: prepared.prNumber, approvalId: prepared.approvalId, decidedBy: decision.decidedBy });
  return acts.recordMergeDecision({ ...input, prNumber: prepared.prNumber, prUrl: prepared.prUrl, approvalId: prepared.approvalId, outcome: decision.outcome });
}
