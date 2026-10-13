/**
 * Who a policy check runs as (BUILD §9.6 "Per-agent overrides"): one definition for the gateway (every tool call) and
 * for plan evaluation (apps/api's Inbox plans, apps/orchestrator's plan execution), so a plan action is judged exactly
 * as the same agent's tool call would be: its autonomy override, its own spend cap and approval threshold, the
 * founder's "Spend cap per action" and, on vacation, the vacation budget ceiling (audit api-services-03).
 */
import { LIMITS } from "@foundmill/config";
import { BUSINESS_MODES, type BusinessMode, type ModelKey } from "@foundmill/shared";
import type { AgentAutonomy, AgentCtxInput } from "./types";

const MODE_ORDER: readonly BusinessMode[] = ["augmented", "assisted", "automated"];

/** `agents.autonomy` (BUILD §9.2): `mode` is `inherit`, a business mode, or `lower` / `higher` relative to the business mode. */
export function agentAutonomy(agent: { autonomy?: Record<string, unknown> | null }, businessMode: BusinessMode): { autonomy: AgentAutonomy; spendCapMinor?: number; approvalThresholdMinor?: number } {
  const raw = agent.autonomy ?? {};
  const mode = raw["mode"];
  let autonomy: AgentAutonomy = "inherit";
  if (typeof mode === "string") {
    if ((BUSINESS_MODES as readonly string[]).includes(mode)) autonomy = mode as BusinessMode;
    else if (mode === "lower" || mode === "higher") {
      const idx = MODE_ORDER.indexOf(businessMode);
      const next = MODE_ORDER[Math.min(MODE_ORDER.length - 1, Math.max(0, idx + (mode === "lower" ? -1 : 1)))];
      autonomy = next && next !== businessMode ? next : "inherit";
    }
  }
  const minor = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  return { autonomy, spendCapMinor: minor(raw["spendCapMinor"]), approvalThresholdMinor: minor(raw["approvalThresholdMinor"]) };
}

/**
 * The approval threshold the Cedar request carries: the agent's own (the policy default when it has none), lowered to
 * the business's "Spend cap per action" when the founder set one (`businesses.spend_cap_minor`; DECISIONS 2026-10-05
 * "caps copied from the business"). Undefined leaves the policy default.
 */
export function businessApprovalThreshold(agentThresholdMinor: number | undefined, businessCapMinor: number | null): number | undefined {
  if (businessCapMinor === null) return agentThresholdMinor;
  return Math.min(agentThresholdMinor ?? LIMITS.approvalThresholdMinorDefault, businessCapMinor);
}

/** The agent attributes a principal is built from (an `agents` row). */
export interface PrincipalAgent {
  id: string;
  departmentIds: readonly string[];
  agentType: string;
  modelKey: ModelKey;
  autonomy?: Record<string, unknown> | null;
}

export interface PrincipalScope {
  businessMode: BusinessMode;
  /** The founder's "Spend cap per action" (`businesses.spend_cap_minor`), or null. */
  businessSpendCapMinor: number | null;
  holidayActive: boolean;
  /** The active vacation's budget ceiling, or null. */
  holidayBudgetMinor: number | null;
}

/**
 * The Cedar principal for this agent: its autonomy, its spend cap tightened by the vacation budget ceiling while a
 * vacation is active (BUILD §9.6), and its approval threshold lowered to the business's spend cap per action.
 * `department` is what a principal without a department reports ("unassigned" at the gateway).
 */
export function agentPrincipal(agent: PrincipalAgent, scope: PrincipalScope, opts: { department?: string } = {}): AgentCtxInput {
  const autonomy = agentAutonomy(agent, scope.businessMode);
  const caps = [autonomy.spendCapMinor, scope.holidayActive ? (scope.holidayBudgetMinor ?? undefined) : undefined].filter((v): v is number => typeof v === "number");
  const approvalThresholdMinor = businessApprovalThreshold(autonomy.approvalThresholdMinor, scope.businessSpendCapMinor);
  return {
    id: agent.id,
    department: agent.departmentIds[0] ?? opts.department ?? "unassigned",
    type: agent.agentType,
    modelKey: agent.modelKey,
    autonomy: autonomy.autonomy,
    ...(caps.length ? { spendCapMinor: Math.min(...caps) } : {}),
    ...(approvalThresholdMinor !== undefined ? { approvalThresholdMinor } : {}),
  };
}
