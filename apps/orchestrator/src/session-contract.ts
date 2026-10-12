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

/** The workflow patch that moved the runner activity to the sessions task queue (in-flight histories keep the old queue). */
export const SESSION_QUEUE_PATCH = "agent-session-own-task-queue";
