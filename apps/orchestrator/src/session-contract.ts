/**
 * Names the agentSession workflow, its activities and the worker setup agree on. Pure (no imports): workflow code
 * bundles it, and so do the activities and ./index.ts.
 */

/**
 * The task queue agent sessions run on (`runAgentSession`): `${TEMPORAL_TASK_QUEUE}-sessions`, served by its own
 * worker with `ORCHESTRATOR_MAX_SESSIONS` slots. A session that runs for hours, or waits for the founder, therefore
 * never takes a slot from cycles, plans, imports, training, vacations or the control activities that reach sessions.
 */
export const sessionTaskQueue = (taskQueue: string): string => `${taskQueue}-sessions`;

/** `ApplicationFailure.type` of a session refused because its agent is paused (ends `stopped`, never `failed`). */
export const AGENT_PAUSED_FAILURE = "AgentPaused";

/**
 * The reason a session ends `stopped` when the platform cancelled its run (the worker shut down for a deploy), not
 * anyone's Stop: its task is not dropped and runs again on a later cycle.
 */
export const CANCELLED_REASON = "cancelled";

/** The workflow patch that moved the runner activity to the sessions task queue (in-flight histories keep the old queue). */
export const SESSION_QUEUE_PATCH = "agent-session-own-task-queue";

/** Model usage so far (USD cents, an Estimate), carried on every heartbeat of a session run. */
export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  costMinor: number;
}

/**
 * The usage a run's last heartbeat reported, or zeros. A run that dies without returning (its worker lost, a heartbeat
 * or start-to-close timeout) still has its spend booked from the `lastHeartbeatDetails` of the timeout.
 */
export function usageFromHeartbeat(details: unknown): RunUsage {
  const usage = details && typeof details === "object" ? (details as { usage?: unknown }).usage : null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  if (!usage || typeof usage !== "object") return { tokensIn: 0, tokensOut: 0, costMinor: 0 };
  const u = usage as Record<string, unknown>;
  return { tokensIn: n(u.tokensIn), tokensOut: n(u.tokensOut), costMinor: n(u.costMinor) };
}
