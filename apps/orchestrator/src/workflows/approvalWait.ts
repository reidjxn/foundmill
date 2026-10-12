/**
 * approvalWait (BUILD §9.4): human-in-the-loop. Waits for the `decision` signal (no timeout by default), resolves the
 * approvals row and returns the outcome. A `stop` signal withdraws the wait; an optional timeout expires the approval.
 *
 * The founder answers in the Inbox, which resolves the row and then signals `approval:<id>`. A signal that never
 * arrives (Temporal unreachable at that moment) must not lose the answer: the wait re-reads the row every
 * POLL_INTERVAL_MS (hourly, so a wait of months stays well inside a workflow's history limit), and its timeout returns
 * the stored answer instead of expiring one that was given (audit O-02).
 */
import { condition, patched, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, ApprovalDecision } from "../activities";
import { decisionSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "2 minutes", retry: { maximumAttempts: 5 } });

/** Waits re-read their approval this often; histories recorded before it wait on the signal alone. */
export const APPROVAL_WAIT_POLL_PATCH = "approval-wait-poll";
export const POLL_INTERVAL_MS = 60 * 60 * 1000;

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

  const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : null;
  let decided: boolean;
  if (patched(APPROVAL_WAIT_POLL_PATCH)) {
    // Wait in slices; between them, an answer stored without its signal ends the wait as that answer.
    let left = timeoutMs;
    decided = false;
    for (;;) {
      const slice = left === null ? POLL_INTERVAL_MS : Math.min(left, POLL_INTERVAL_MS);
      if (await condition(() => decision !== null || withdrawn, slice)) {
        decided = true;
        break;
      }
      if (left !== null) {
        left -= slice;
        if (left <= 0) break;
      }
      const now = await acts.loadApproval({ businessId: input.businessId, approvalId: loaded.approvalId });
      if (now?.outcome) return { approvalId: loaded.approvalId, outcome: now.outcome as ApprovalWaitResult["outcome"], decidedBy: null, alreadyResolved: true };
    }
  } else {
    decided = timeoutMs !== null ? await condition(() => decision !== null || withdrawn, timeoutMs) : (await condition(() => decision !== null || withdrawn), true);
  }
  if (decision !== null) {
    const d: ApprovalDecision = decision;
    const resolved = await acts.resolveApproval({ businessId: input.businessId, approvalId: loaded.approvalId, decision: d });
    return { approvalId: loaded.approvalId, outcome: resolved.outcome, decidedBy: d.by ?? null, alreadyResolved: resolved.alreadyResolved };
  }
  if (!decided) {
    const expired = await acts.expireApproval({ businessId: input.businessId, approvalId: loaded.approvalId });
    // Answered in the Inbox but the signal never came: the founder's answer, not an expiry (`outcome` is absent from
    // results recorded before it existed).
    if (!expired.expired && expired.outcome) return { approvalId: loaded.approvalId, outcome: expired.outcome, decidedBy: null, alreadyResolved: true };
    return { approvalId: loaded.approvalId, outcome: "expired", decidedBy: null, alreadyResolved: false };
  }
  return { approvalId: loaded.approvalId, outcome: "withdrawn", decidedBy: null, alreadyResolved: false };
}
