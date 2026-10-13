/**
 * One definition of team health for every screen that shows it: Home's status strip ("Business health"), the department
 * card's pill and its "Team health" metric, and Team › Health's summary. An agent needs the founder when it is failing,
 * down (`injured`) or degraded. Healthy, idle (no task assigned: nothing is wrong) and paused (by the founder or a
 * vacation: a choice, not a fault) agents do not, so they count as healthy; a team of idle agents is 100% healthy, not
 * 0%, and is never called "working".
 */
import type { AgentStatus } from "@foundmill/shared";

/** The statuses that need the founder, worst first (the order the summary names them in). */
export const NEEDS_ATTENTION_STATUSES = ["failing", "injured", "degraded"] as const satisfies readonly AgentStatus[];

export function needsAttention(status: string): boolean {
  return (NEEDS_ATTENTION_STATUSES as readonly string[]).includes(status);
}

/** Healthy for every health figure: anything that does not need the founder. */
export function isHealthyStatus(status: string): boolean {
  return !needsAttention(status);
}

export interface TeamHealthCounts {
  total: number;
  /** Failing, down or degraded. */
  needsYou: number;
  /** On a task right now (`healthy`). */
  working: number;
  idle: number;
  paused: number;
}

export function teamHealthCounts(statuses: Iterable<string>): TeamHealthCounts {
  const counts: TeamHealthCounts = { total: 0, needsYou: 0, working: 0, idle: 0, paused: 0 };
  for (const s of statuses) {
    counts.total += 1;
    if (needsAttention(s)) counts.needsYou += 1;
    else if (s === "healthy") counts.working += 1;
    else if (s === "idle") counts.idle += 1;
    else if (s === "paused") counts.paused += 1;
  }
  return counts;
}

/** Share of agents that do not need the founder (0–1); null for a team with no agents. */
export function teamHealth(statuses: Iterable<string>): number | null {
  const c = teamHealthCounts(statuses);
  return c.total === 0 ? null : (c.total - c.needsYou) / c.total;
}

/** What the share counts, in the words the provenance chips show. */
export const TEAM_HEALTH_SOURCE = "Share of agents not failing, down or degraded";

/**
 * The one-line summary of a team: "2 agents need you" when any do, "Everyone is working" only when every agent is on a
 * task, otherwise "Nobody needs you" with what the rest are doing ("0 working · 26 idle").
 */
export function teamHealthSummary(c: TeamHealthCounts): { tone: "warn" | "good" | "neutral"; text: string; detail?: string } {
  if (c.total === 0) return { tone: "neutral", text: "No agents yet" };
  if (c.needsYou > 0) return { tone: "warn", text: c.needsYou === 1 ? "1 agent needs you" : `${c.needsYou} agents need you` };
  if (c.working === c.total) return { tone: "good", text: "Everyone is working" };
  const parts = [`${c.working} working`];
  if (c.idle) parts.push(`${c.idle} idle`);
  if (c.paused) parts.push(`${c.paused} paused`);
  return { tone: "good", text: "Nobody needs you", detail: parts.join(" · ") };
}
