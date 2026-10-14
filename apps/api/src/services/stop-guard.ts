/**
 * The work-starting guard of the team-wide stop (0023, `services/killswitch.ts`). Every procedure that starts work (a
 * task, a cycle, a channel engine, a training run, a vacation) asks it first and answers 409 while the team is stopped
 * or the business is archived, so no member can undo Stop all agents by starting something; only `business.resumeAgents`
 * (an owner or admin), a new key or a top-up lifts the stop.
 */
import { repos, type Executor } from "@foundmill/db";
import { AppError, type AgentStopReason } from "@foundmill/shared";

/** Work refused because the team is stopped (409). */
export class AgentsStoppedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("agents_stopped", message, 409, details);
  }
}

export const STOP_WORDS: Record<AgentStopReason, string> = {
  kill_switch: "Stop all agents",
  key_revoked: "the Anthropic key was revoked",
  credits_exhausted: "the credits ran out",
};

/** Throws `AgentsStoppedError` naming `what` (e.g. "the task") while the team is stopped. */
export async function assertAgentsRunning(ctx: { db: Executor; businessId: string }, what: string): Promise<void> {
  const stop = await repos.businesses.stopState(ctx.db, ctx.businessId);
  if (!stop.stopped) return;
  if (stop.archived) throw new AgentsStoppedError(`This business is archived, so ${what} cannot start.`, { reason: "archived" });
  const reason = stop.reason ?? "kill_switch";
  throw new AgentsStoppedError(`Agents are stopped (${STOP_WORDS[reason]}), so ${what} cannot start. An owner or admin resumes them with Resume agents in the top bar.`, { reason, stoppedAt: stop.stoppedAt?.toISOString() ?? null });
}
