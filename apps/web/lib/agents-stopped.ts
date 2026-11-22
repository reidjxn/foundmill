/**
 * The team-wide stop as the shell shows it (0023): when `business.get` says the agents are stopped (Stop all agents, a
 * revoked key, used-up credits), the kill switch in the top bar turns into Resume agents with the reason, the time
 * and what else brings the team back by itself. Owners and admins resume; everyone else sees why.
 */
import { AGENT_STOP_REASON_WORDS } from "@foundmill/shared/chief-answers";
import { isAdminRole, type AgentStopReason, type MembershipRole } from "@foundmill/shared/constants";

export interface AgentsStoppedView {
  since: Date | string | null;
  /** Completes "The team stopped … because …". */
  reason: string;
  canResume: boolean;
  hint: string | null;
}

// The same words the Chief of Staff's answers use (packages/shared chief-answers.ts).
const REASON: Record<AgentStopReason, string> = AGENT_STOP_REASON_WORDS;

const HINT: Record<AgentStopReason, string | null> = {
  kill_switch: null,
  key_revoked: "Storing a new key in Settings › Keys resumes the team by itself.",
  credits_exhausted: "The team is resting: this month's team budget is used. Nothing was stopped part-way. It picks up when the budget resets, after a top-up in Settings › Billing, or on your own key in Settings › Keys.",
};

/** Null while the team runs. */
export function agentsStoppedView(business: { agentsStoppedAt?: Date | string | null; agentsStoppedReason?: AgentStopReason | null }, role: MembershipRole | string | null | undefined): AgentsStoppedView | null {
  if (!business.agentsStoppedAt) return null;
  const reason = business.agentsStoppedReason ?? "kill_switch";
  return { since: business.agentsStoppedAt, reason: REASON[reason], canResume: isAdminRole(role), hint: HINT[reason] };
}
