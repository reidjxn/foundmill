/**
 * approvalWait (BUILD §9.4): human-in-the-loop. Waits for the `decision` signal (no timeout by default), resolves the
 * approvals row and returns the outcome. A `stop` signal withdraws the wait; an optional timeout expires the approval.
 */
import { condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, ApprovalDecision } from "../activities";
import { decisionSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "2 minutes", retry: { maximumAttempts: 5 } });

export interface ApprovalWaitInput {
  businessId: string;
  approvalId?: string | null;
  planActionId?: string | null;
  /** Milliseconds; omit for no timeout. */
  timeoutMs?: number;
}

export interface ApprovalWaitResult {
  approvalId: string | null;
  outcome: "approved" | "rejected" | "expired" | "withdrawn";
  decidedBy: string | null;
  alreadyResolved: boolean;
}

export async function approvalWait(input: ApprovalWaitInput): Promise<ApprovalWaitResult> {
  const loaded = await acts.loadApproval({ businessId: input.businessId, approvalId: input.approvalId ?? null, planActionId: input.planActionId ?? null });
  if (!loaded) return { approvalId: null, outcome: "withdrawn", decidedBy: null, alreadyResolved: false };
  if (loaded.outcome) return { approvalId: loaded.approvalId, outcome: loaded.outcome as ApprovalWaitResult["outcome"], decidedBy: null, alreadyResolved: true };

  let decision: ApprovalDecision | null = null;
  let withdrawn = false;
  setHandler(decisionSignal, (d) => {
    // Only the decision for this approval (or an unaddressed one) counts.
    if (d.approvalId && d.approvalId !== loaded.approvalId) return;
    if (d.planActionId && loaded.planActionId && d.planActionId !== loaded.planActionId) return;
    if (!decision) decision = d;
  });
  setHandler(stopSignal, () => {
    withdrawn = true;
  });

  const decided = input.timeoutMs && input.timeoutMs > 0 ? await condition(() => decision !== null || withdrawn, input.timeoutMs) : (await condition(() => decision !== null || withdrawn), true);
  if (decision !== null) {
    const d: ApprovalDecision = decision;
    const resolved = await acts.resolveApproval({ businessId: input.businessId, approvalId: loaded.approvalId, decision: d });
    return { approvalId: loaded.approvalId, outcome: resolved.outcome, decidedBy: d.by ?? null, alreadyResolved: resolved.alreadyResolved };
  }
  if (!decided) {
    await acts.expireApproval({ businessId: input.businessId, approvalId: loaded.approvalId });
    return { approvalId: loaded.approvalId, outcome: "expired", decidedBy: null, alreadyResolved: false };
  }
  return { approvalId: loaded.approvalId, outcome: "withdrawn", decidedBy: null, alreadyResolved: false };
}
