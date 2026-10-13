/**
 * Who may answer an approval (BUILD §11.9 Responsibilities, AC-11.9.2). The Responsibilities matrix names a handler
 * per decision type and department, stored on the approval when it opens (`approvals.handler_kind`/`handler_id`,
 * 0054): no handler means the founder (owners and admins, and members who may write to the team, as before); a named
 * staff member answers their own approvals; an approval handed to an agent was decided by it when it opened. Owners and
 * admins can always step in. Every procedure that resolves an approval (team.approvals.resolve, an Inbox decision on an
 * approval) checks this first.
 */
import type { Approval } from "@foundmill/db";
import { ForbiddenError, type MembershipRole } from "@foundmill/shared";

export interface ApprovalViewer {
  userId: string;
  role: MembershipRole;
}

/** True when this person may answer the approval. */
export function canResolveApproval(approval: Pick<Approval, "handlerKind" | "handlerId">, viewer: ApprovalViewer): boolean {
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  if (approval.handlerKind === "user") return approval.handlerId === viewer.userId;
  // An agent's approval is its own (decided as it opened); only an owner or admin overrides it.
  if (approval.handlerKind === "agent") return false;
  return true;
}

/** `canResolveApproval`, or a 403 that says who handles it instead. */
export function assertCanResolveApproval(approval: Pick<Approval, "handlerKind" | "handlerId">, viewer: ApprovalViewer): void {
  if (canResolveApproval(approval, viewer)) return;
  throw new ForbiddenError(approval.handlerKind === "agent" ? "This approval is delegated to an agent in Team › Responsibilities; an owner or admin can override it" : "This approval is delegated to another staff member in Team › Responsibilities; they, an owner or an admin answer it");
}

/** Whether an approval is waiting for this person in particular (their own delegated approvals, or the founder's queue for owners and admins). */
export function approvalIsForViewer(approval: Pick<Approval, "handlerKind" | "handlerId">, viewer: ApprovalViewer): boolean {
  if (approval.handlerKind === "user") return approval.handlerId === viewer.userId;
  if (approval.handlerKind === "agent") return false;
  return viewer.role === "owner" || viewer.role === "admin";
}
