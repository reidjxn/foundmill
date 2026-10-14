/**
 * The team-wide stop and the way back (0023; BUILD §14 kill switch, §10.4–10.5 credits, §10.2 keys).
 *
 * Stop all agents, a revoked Anthropic key and used-up credits each stop the whole team: `stopBusinessAgents` sets the
 * business's stop flag with its reason and pauses every live agent, recording why. While the flag is set every path
 * that starts work refuses (`repos.businesses.agentsStopped`): a cycle's dispatch, a task start, a channel engine, a
 * plan's sessions, a training run, a vacation. Pausing alone was not enough: a task start, a finishing session or a
 * channel toggle used to set agents back to work, and nothing lifted the pause on purpose.
 *
 * `resumeBusinessAgents` is the only way back. An owner or admin resumes from any stop (`business.resumeAgents`); a new
 * key clears only a key revoke and a top-up only used-up credits (`onlyFor`), so neither undoes the founder's Stop all
 * agents. Agents paused by a stop (or with no recorded reason) become idle; a wage-cap pause stays until the agent is
 * under its cap. Both return the agents they changed so callers can write `agent.health_changed` in their transaction.
 *
 * Autopilot (0055) pauses with the stop, in the same transaction, and stays paused through the resume: a stopped team
 * never auto-starts, and only the founder turns Autopilot back on.
 */
import type { AgentStatus, AgentStopReason } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";

export interface StopBusinessResult {
  stoppedAt: Date;
  /** The reason the flag now carries (Stop all agents outranks a key or credits stop already set). */
  reason: AgentStopReason;
  /** The business was already stopped before this call. */
  alreadyStopped: boolean;
  /** Agents this call paused, with the status each had. */
  paused: { id: string; from: AgentStatus }[];
  /** Autopilot was on and this call paused it (0055); only the founder turns it back on, so a resume never restarts it. */
  autopilotPaused: boolean;
}

export async function stopBusinessAgents(db: Executor, businessId: string, input: { reason: AgentStopReason; at?: Date }): Promise<StopBusinessResult> {
  return db.transaction(async (tx) => {
    const flag = await repos.businesses.setAgentsStopped(tx, businessId, input);
    const paused = await repos.agents.pauseEveryone(tx, businessId, { reason: input.reason });
    // A stopped team never auto-starts: Autopilot pauses in the same transaction and stays paused through the resume.
    const autopilotPaused = await repos.autopilot.pause(tx, businessId, input.reason);
    if (autopilotPaused) await repos.audit.append(tx, businessId, { actorKind: "system", action: "autopilot.pause", target: { kind: "business", id: businessId }, details: { reason: input.reason } });
    return { stoppedAt: flag.stoppedAt, reason: flag.reason, alreadyStopped: flag.already, paused, autopilotPaused };
  });
}

export interface ResumeBusinessResult {
  /** The stop flag was cleared, or paused agents were set back to idle. */
  resumed: boolean;
  /** The reason of the stop that was cleared (or that stayed, when `onlyFor` did not match). */
  reason: AgentStopReason | null;
  stoppedAt: Date | null;
  /** Agents set back to idle. */
  agentIds: string[];
}

/**
 * Lifts the team-wide stop. `reason` (one or several) resumes only a stop with that reason, and only when the business
 * is stopped: a new key passes `key_revoked`, a top-up `credits_exhausted`. Without it (an owner or admin) every stop is
 * lifted, and agents left paused by a stop recorded before 0023 come back too.
 */
export async function resumeBusinessAgents(db: Executor, businessId: string, options: { reason?: AgentStopReason | readonly AgentStopReason[] } = {}): Promise<ResumeBusinessResult> {
  const onlyFor = options.reason === undefined ? undefined : typeof options.reason === "string" ? [options.reason] : options.reason;
  return db.transaction(async (tx) => {
    const cleared = await repos.businesses.clearAgentsStopped(tx, businessId, { onlyFor });
    if (onlyFor && !cleared.cleared) return { resumed: false, reason: cleared.reason, stoppedAt: cleared.stoppedAt, agentIds: [] };
    const agentIds = await repos.agents.resumeStopped(tx, businessId);
    return { resumed: cleared.cleared || agentIds.length > 0, reason: cleared.reason, stoppedAt: cleared.stoppedAt, agentIds };
  });
}
