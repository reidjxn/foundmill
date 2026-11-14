/**
 * Who may answer a gated decision (BUILD §11.9 Responsibilities, AC-11.9.2; SECURITY_REVIEW SEC-7). Owners and admins
 * always may. Anyone else (a member) may only when Team › Responsibilities names them, as a `user` handler, for that
 * decision type in the department the decision belongs to. A decision nobody was named for is the founder's: owners and
 * admins. This holds for an agent's pending approval (`team.approvals.resolve`) and for a plan whose actions asked the
 * founder first (`plan.confirm`), so a member can never approve a spend above the threshold, a contract send or a merge
 * to main that nobody handed to them.
 */
import { repos, type Approval, type Department, type Executor } from "@foundmill/db";
import type { ConnectorRegistry } from "@foundmill/connectors";
import { ADMIN_ROLES as SHARED_ADMIN_ROLES, DECISION_TYPES, ForbiddenError, type DecisionType, type MembershipRole } from "@foundmill/shared";

export interface Decider {
  userId: string;
  role: MembershipRole;
}

const ADMIN_ROLES: readonly MembershipRole[] = SHARED_ADMIN_ROLES;

/** The user handlers each department names, per decision type (`departments.approvers`; malformed rows are ignored). */
export function userHandlers(department: Pick<Department, "approvers">): Map<DecisionType, string> {
  const out = new Map<DecisionType, string>();
  for (const row of Array.isArray(department.approvers) ? department.approvers : []) {
    if (!row || typeof row !== "object") continue;
    const { decisionType, handler } = row as { decisionType?: unknown; handler?: { kind?: unknown; id?: unknown } };
    if (typeof decisionType !== "string" || !(DECISION_TYPES as readonly string[]).includes(decisionType)) continue;
    if (handler?.kind === "user" && typeof handler.id === "string") out.set(decisionType as DecisionType, handler.id);
  }
  return out;
}

/**
 * Whether this person may decide. `departmentIds` are the departments the decision belongs to (its agent's); with none
 * known it is a business-wide decision, which a member answers only when every department names them for it.
 */
export function mayDecide(decider: Decider, decisionType: DecisionType | null, departments: readonly Pick<Department, "id" | "approvers">[], departmentIds: readonly string[]): boolean {
  if (ADMIN_ROLES.includes(decider.role)) return true;
  if (decisionType === null) return false;
  const named = (d: Pick<Department, "approvers">) => userHandlers(d).get(decisionType) === decider.userId;
  const own = departmentIds.length ? departments.filter((d) => departmentIds.includes(d.id)) : [];
  if (own.length) return own.some(named);
  return departments.length > 0 && departments.every(named);
}

const WORDS: Record<DecisionType, string> = {
  spend_above_threshold: "spending above the threshold",
  publish_content: "publishing content",
  merge_to_main: "merging to main",
  sign_contracts: "contracts and signing",
  message_customers: "messaging customers",
  hire_agents: "hiring agents",
  change_models: "changing models",
};

/** `mayDecide`, or a 403 that says who decides instead. */
export function assertMayDecide(decider: Decider, decisionType: DecisionType | null, departments: readonly Pick<Department, "id" | "approvers">[], departmentIds: readonly string[]): void {
  if (mayDecide(decider, decisionType, departments, departmentIds)) return;
  throw new ForbiddenError(
    decisionType
      ? `Only an owner or admin, or the person Team › Responsibilities names for ${WORDS[decisionType]}, can decide this`
      : "Only an owner or admin can decide this",
  );
}

/**
 * The decision type of an agent's approval, from the tool it asked for (the gateway's `decisionTypeFor`, from the
 * connector's own hints): a contract tool is signing, a merge is merge to main, a spending tool is a spend above the
 * threshold, a tool that contacts people is messaging customers. Anything else is the founder's.
 */
export function approvalDecisionType(approval: Pick<Approval, "connectorKey" | "tool"> & { decisionType?: DecisionType | null }, connectors: Pick<ConnectorRegistry, "get"> | null): DecisionType | null {
  // The type the approval was routed under when it opened (Team › Responsibilities) is the one that counts.
  if (approval.decisionType) return approval.decisionType;
  const key = approval.connectorKey;
  const tool = approval.tool;
  if (!key || !tool) return null;
  if (key === "dropbox_sign") return "sign_contracts";
  if (key === "github" && tool === "merge_pr") return "merge_to_main";
  let hints: { spendsMoney?: boolean; contactsThirdParty?: boolean };
  try {
    hints = connectors?.get(key, "mock").policyHints[tool] ?? {};
  } catch {
    return null;
  }
  if (hints.spendsMoney) return "spend_above_threshold";
  if (hints.contactsThirdParty) return "message_customers";
  return null;
}

/** Refuses (403) a person who may not answer this agent's approval. */
export async function assertMayResolveApproval(db: Executor, businessId: string, decider: Decider, approval: Pick<Approval, "agentId" | "connectorKey" | "tool"> & { decisionType?: DecisionType | null }, connectors: Pick<ConnectorRegistry, "get"> | null): Promise<void> {
  if (ADMIN_ROLES.includes(decider.role)) return;
  const decisionType = approvalDecisionType(approval, connectors);
  const [departments, agent] = await Promise.all([repos.departments.list(db, businessId), approval.agentId ? repos.agents.get(db, businessId, approval.agentId).catch(() => null) : Promise.resolve(null)]);
  assertMayDecide(decider, decisionType, departments, agent?.departmentIds ?? []);
}

/** Plan actions that ask the founder first are this decision type (plans.ts `ACTION_TOOLS`: spends and contacts). */
export function planActionDecisionType(type: string): DecisionType | null {
  switch (type) {
    case "set_budget":
    case "approve_spend":
    case "train_agent":
      return "spend_above_threshold";
    case "send_message":
    case "schedule_meeting":
      return "message_customers";
    case "hire_agent":
      return "hire_agents";
    case "set_agent_model":
      return "change_models";
    default:
      return null;
  }
}

/**
 * Refuses (403) a person who may not confirm these plan actions: every action the policy evaluated to `ask` (the
 * founder's "Here is what will happen" step) needs an owner or admin, or the person named for its decision type.
 */
export async function assertMayConfirmAsks(db: Executor, businessId: string, decider: Decider, actions: readonly { type: string; agentId: string | null; policyOutcome: string | null; status: string }[]): Promise<void> {
  if (ADMIN_ROLES.includes(decider.role)) return;
  const asks = actions.filter((a) => a.status === "pending" && a.policyOutcome === "ask");
  if (asks.length === 0) return;
  const agentIds = [...new Set(asks.map((a) => a.agentId).filter((id): id is string => id !== null))];
  const [departments, agents] = await Promise.all([repos.departments.list(db, businessId), agentIds.length ? repos.agents.byIds(db, businessId, agentIds) : Promise.resolve([])]);
  for (const a of asks) {
    const agent = a.agentId ? agents.find((x) => x.id === a.agentId) : undefined;
    assertMayDecide(decider, planActionDecisionType(a.type), departments, agent?.departmentIds ?? []);
  }
}
