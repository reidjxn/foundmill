/**
 * Approval bookkeeping for `approvalWait` (BUILD §9.4): resolve the approvals row on the `decision` signal and emit
 * `approval.resolved`. Resolution is idempotent (a second decision does nothing).
 */
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ApprovalDecision } from "./types";

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
      await repos.audit.append(db, input.businessId, { actorKind: resolvedBy.kind, actorId: resolvedBy.kind === "system" ? null : resolvedBy.id, action: "approval.resolve", target: { kind: "approval", id: approval.id }, details: { outcome: input.decision.outcome, planActionId: approval.planActionId } });
      return { outcome: resolved.outcome ?? input.decision.outcome, alreadyResolved: false, eventId };
    },

    async expireApproval(input: { businessId: string; approvalId: string }): Promise<{ expired: boolean }> {
      const approval = await repos.approvals.get(deps.db, input.businessId, input.approvalId);
      if (approval.outcome !== null) return { expired: false };
      await repos.approvals.resolve(deps.db, input.businessId, approval.id, { outcome: "expired", byKind: "system" });
      return { expired: true };
    },
  };
}

export type ApprovalActivities = ReturnType<typeof createApprovalActivities>;
