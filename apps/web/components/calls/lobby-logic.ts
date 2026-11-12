/**
 * Pure rules of the Team call lobby (docs/TEAM_CALL.md §5, §6): who is ticked to begin with, and the one-line count under
 * a past call.
 */
import { isBackgroundAgent } from "@foundmill/shared/team-tiers";
import { TEAM_CALL_LIMITS, teamCallActionsLine, type TeamCallSummaryView } from "@foundmill/shared/team-call";

interface LobbyAgent {
  id: string;
  archivedAt?: Date | string | null;
  chiefOfStaff?: boolean;
  tier?: string | null;
  layer?: string | null;
  agentType?: string | null;
}

/**
 * The agents ticked when the lobby opens: the Chief of Staff, then the leads, at most eight, in the order the team list
 * gives them. Background helpers and released agents are never offered.
 */
export function defaultCallSelection(agents: readonly LobbyAgent[]): string[] {
  const visible = agents.filter((a) => !a.archivedAt && !isBackgroundAgent({ tier: a.tier as never, layer: a.layer ?? "", agentType: a.agentType ?? "" }));
  const chief = visible.filter((a) => a.chiefOfStaff);
  const leads = visible.filter((a) => !a.chiefOfStaff && a.tier === "lead");
  return [...chief, ...leads].slice(0, TEAM_CALL_LIMITS.maxAgentsInTeamCall).map((a) => a.id);
}

/** "3 filed · 1 needs your go-ahead" for a past call, from the counts its summary row carries. */
export function callRowActionsLine(c: Pick<TeamCallSummaryView, "actionCount" | "filedCount" | "awaitingCount">): string {
  const rest = Math.max(0, c.actionCount - c.filedCount - c.awaitingCount);
  const base = teamCallActionsLine([...Array(c.filedCount).fill({ status: "filed" as const }), ...Array(c.awaitingCount).fill({ status: "awaiting_go_ahead" as const })]);
  if (c.actionCount === 0) return base;
  if (rest === 0) return base;
  const more = `${rest} more`;
  return c.filedCount + c.awaitingCount === 0 ? more : `${base} · ${more}`;
}
