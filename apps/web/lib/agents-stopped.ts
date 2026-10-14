/**
 * The team-wide stop as the shell shows it (0023): when `business.get` says the agents are stopped (Stop all agents, a
 * revoked key, used-up credits), the kill switch in the top bar turns into Resume agents with the reason, the time
 * and what else brings the team back by itself. Owners and admins resume; everyone else sees why.
 */
import type { AgentStopReason, MembershipRole } from "@foundmill/shared/constants";

export interface AgentsStoppedView {
  since: Date | string | null;
  /** Completes "The team stopped … because …". */
  reason: string;
  canResume: boolean;
  hint: string | null;
}

const REASON: Record<AgentStopReason, string> = {
  kill_switch: "Stop all agents was pressed",
  key_revoked: "the Anthropic key was revoked",
  credits_exhausted: "this month's credits ran out",
};

const HINT: Record<AgentStopReason, string | null> = {
  kill_switch: null,
  key_revoked: "Storing a new key in Settings › Keys resumes the team by itself.",
  credits_exhausted: "A top-up in Settings › Billing, or your own key in Settings › Keys, resumes the team by itself.",
};

/** Null while the team runs. */
export function agentsStoppedView(business: { agentsStoppedAt?: Date | string | null; agentsStoppedReason?: AgentStopReason | null }, role: MembershipRole | string | null | undefined): AgentsStoppedView | null {
  if (!business.agentsStoppedAt) return null;
  const reason = business.agentsStoppedReason ?? "kill_switch";
  return { since: business.agentsStoppedAt, reason: REASON[reason], canResume: role === "owner" || role === "admin", hint: HINT[reason] };
}
