/**
 * Records approvals that expired (WP-02 T1; audit a5 GTM-02): one `approval.resolved` with outcome "expired" for each
 * that has an agent (the event's agentId is required; one without writes nothing and does not throw), and its Inbox
 * note closed. Every path that sets `outcome: "expired"` calls this in the same transaction, so the approvals requested
 * minus the approvals resolved is the number still open. Approvals that expired before this existed have no event;
 * their history is read from `approvals.outcome`.
 */
import { closeApprovalItem, repos, type Approval, type Executor } from "@foundmill/db";
import { buildEvent } from "./outbox/writer";

/** Who expired it: the clock, never a person. */
export const EXPIRY_ACTOR = { kind: "system", id: "expiry" } as const;

export async function recordExpiredApprovals(db: Executor, businessId: string, approvals: readonly Approval[], at: Date): Promise<void> {
  for (const approval of approvals) {
    if (approval.agentId) {
      const event = buildEvent({
        businessId,
        type: "approval.resolved",
        actor: EXPIRY_ACTOR,
        payload: { approvalId: approval.id, planActionId: approval.planActionId, agentId: approval.agentId, outcome: "expired", resolvedBy: EXPIRY_ACTOR, note: null, latencyMs: Math.max(0, at.getTime() - new Date(approval.createdAt).getTime()) },
      });
      await repos.events.write(db, businessId, { id: event.id, type: event.type, actor: event.actor, entityIds: event.entityIds, payload: event.payload as Record<string, unknown>, occurredAt: event.occurredAt });
    }
    await closeApprovalItem(db, businessId, approval);
  }
}
