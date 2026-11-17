/**
 * Approval bookkeeping for `approvalWait` (BUILD §9.4): resolve the approvals row on the `decision` signal and emit
 * `approval.resolved`. Resolution is idempotent (a second decision does nothing). An approval the founder already
 * answered in the Inbox (`inbox.decide`, `team.approvals.resolve`) is reported as answered, never expired, however the
 * wait learns of it (the signal, a poll, or its timeout).
 *
 * `openApprovalNote` is how every approval the orchestrator opens (a session's recorded hold, a plan action, a channel
 * launch) reaches the founder: one decision Inbox item with Approve and Reject (audit FR-01).
 */
import { recordExpiredApprovals } from "@foundmill/events";
import { approvalTaskTitle, closeApprovalItem, openApprovalItem, repos, type Approval, type Executor } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ApprovalDecision } from "./types";

export interface ApprovalNoteInput {
  /** The agent who asks; the Chief of Staff speaks for an approval that names none. */
  agent: { id: string; name: string } | null;
  taskTitle?: string | null;
  argsSummary?: string | null;
  /** The `approval.requested` event the note narrates. */
  sourceEventIds?: readonly string[];
}

/**
 * Opens the approval's decision item (once) and writes `inbox.item_created` through the outbox. Returns the item id, or
 * null when nobody can speak for it (no agent and no Chief of Staff).
 */
export async function openApprovalNote(db: Executor, businessId: string, approval: Approval, input: ApprovalNoteInput): Promise<string | null> {
  const speaker = input.agent ?? (await repos.agents.chiefOfStaff(db, businessId));
  if (!speaker) return null;
  const taskTitle = input.taskTitle !== undefined ? input.taskTitle : await approvalTaskTitle(db, businessId, approval);
  const { item, created } = await openApprovalItem(db, businessId, approval, { agentId: speaker.id, agentName: speaker.name, taskTitle, argsSummary: input.argsSummary ?? null, sourceEventIds: input.sourceEventIds ?? [] });
  if (created) {
    await emitEvent(db, {
      businessId,
      type: "inbox.item_created",
      actor: { kind: "agent", id: speaker.id },
      payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [...(input.sourceEventIds ?? [])], cost: null },
    });
  }
  return item.id;
}

/**
 * An approval a plan action grants by naming it (`approve_spend` with `approval_id`): the same bookkeeping as an answer
 * in the Inbox, so nothing is left waiting on it. `approval.resolved` goes through the outbox, the decision item stops
 * blocking Continue, and a session still waiting on the call gets the decision on its control bus. An approval already
 * answered is returned as it is.
 */
export async function grantApproval(deps: Pick<OrchestratorDeps, "db" | "clock" | "control">, businessId: string, approvalId: string, by: string | null): Promise<Approval> {
  const approval = await repos.approvals.get(deps.db, businessId, approvalId);
  if (approval.outcome !== null) return approval;
  const resolved = await repos.approvals.resolve(deps.db, businessId, approvalId, { outcome: "approved", byKind: by ? "user" : "system", byId: by });
  const resolvedBy = by ? { kind: "user" as const, id: by } : systemActor;
  if (approval.agentId) {
    await emitEvent(deps.db, {
      businessId,
      type: "approval.resolved",
      actor: resolvedBy,
      payload: { approvalId, planActionId: approval.planActionId, agentId: approval.agentId, outcome: "approved", resolvedBy, note: null, latencyMs: Math.max(0, deps.clock.nowMs() - new Date(approval.createdAt).getTime()) },
    });
  }
  await closeApprovalItem(deps.db, businessId, resolved);
  const session = approval.sessionId ? await repos.agents.getSession(deps.db, businessId, approval.sessionId).catch(() => null) : null;
  if (session && session.endedAt === null) await deps.control.post(session.id, { kind: "decision", approvalId, outcome: "approved", by, at: deps.clock.now().toISOString() });
  return resolved;
}

export function createApprovalActivities(deps: OrchestratorDeps) {
  return {
    async loadApproval(input: { businessId: string; approvalId?: string | null; planActionId?: string | null }): Promise<{ approvalId: string; outcome: string | null; agentId: string | null; planActionId: string | null; createdAt: string } | null> {
      const { db } = deps;
      const approval = input.approvalId ? await repos.approvals.get(db, input.businessId, input.approvalId) : input.planActionId ? await repos.approvals.forPlanAction(db, input.businessId, input.planActionId) : null;
      if (!approval) return null;
      return { approvalId: approval.id, outcome: approval.outcome, agentId: approval.agentId, planActionId: approval.planActionId, createdAt: new Date(approval.createdAt).toISOString() };
    },

    async resolveApproval(input: { businessId: string; approvalId: string; decision: ApprovalDecision }): Promise<{ outcome: "approved" | "rejected" | "expired"; alreadyResolved: boolean; eventId: string | null }> {
      const { db } = deps;
      const approval = await repos.approvals.get(db, input.businessId, input.approvalId);
      if (approval.outcome !== null) return { outcome: approval.outcome, alreadyResolved: true, eventId: null };
      const byKind = input.decision.byKind ?? (input.decision.by ? "user" : "system");
      const resolved = await repos.approvals.resolve(db, input.businessId, approval.id, { outcome: input.decision.outcome, byKind, byId: byKind === "user" ? (input.decision.by ?? null) : null });
      const resolvedBy = byKind === "user" && input.decision.by ? { kind: "user" as const, id: input.decision.by } : byKind === "chief_of_staff" && input.decision.by ? { kind: "agent" as const, id: input.decision.by } : systemActor;
      let eventId: string | null = null;
      if (approval.agentId) {
        const ev = await emitEvent(db, {
          businessId: input.businessId,
          type: "approval.resolved",
          actor: resolvedBy,
          payload: { approvalId: approval.id, planActionId: approval.planActionId, agentId: approval.agentId, outcome: input.decision.outcome, resolvedBy, note: input.decision.note ?? null, latencyMs: Math.max(0, deps.clock.nowMs() - new Date(approval.createdAt).getTime()) },
        });
        eventId = ev.id;
      }
      // Answered some other way than the Inbox: the item stops asking (and stops blocking Continue).
      await closeApprovalItem(db, input.businessId, resolved);
      await repos.audit.append(db, input.businessId, { actorKind: resolvedBy.kind, actorId: resolvedBy.kind === "system" ? null : resolvedBy.id, action: "approval.resolve", target: { kind: "approval", id: approval.id }, details: { outcome: input.decision.outcome, planActionId: approval.planActionId } });
      return { outcome: resolved.outcome ?? input.decision.outcome, alreadyResolved: false, eventId };
    },

    /**
     * Expires an approval nobody answered in time. One the founder answered meanwhile (the decision signal never
     * arrived) is not expired: its stored outcome comes back instead, so the caller acts on the founder's answer.
     */
    async expireApproval(input: { businessId: string; approvalId: string }): Promise<{ expired: boolean; outcome: "approved" | "rejected" | "expired" | "withdrawn" }> {
      const approval = await repos.approvals.get(deps.db, input.businessId, input.approvalId);
      if (approval.outcome !== null) return { expired: false, outcome: approval.outcome };
      const expired = await repos.approvals.resolve(deps.db, input.businessId, approval.id, { outcome: "expired", byKind: "system" });
      // The event says it expired and the note closes (WP-02 T1): requested minus resolved stays the number still open.
      await recordExpiredApprovals(deps.db, input.businessId, [expired], deps.clock.now());
      return { expired: true, outcome: "expired" };
    },
  };
}

export type ApprovalActivities = ReturnType<typeof createApprovalActivities>;
