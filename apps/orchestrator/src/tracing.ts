/**
 * One trace span per activity execution (BUILD §15: workflow → agent session → tool call): named after the activity,
 * with the workflow, the attempt and the business, session, agent and task it works for. An agent session's run is the
 * span its model calls and its tool calls through the gateway join (the run passes its `traceparent` on the session's
 * MCP connections). A no-op until the orchestrator installed telemetry with an OTLP endpoint.
 */
import type { ActivityInterceptorsFactory } from "@temporalio/worker";
import { getTracer, type SpanAttributes } from "@foundmill/shared/telemetry";

const IDS = ["businessId", "sessionId", "agentId", "taskId"] as const;
const ATTRIBUTE: Record<(typeof IDS)[number], string> = { businessId: "foundmill.business_id", sessionId: "foundmill.session_id", agentId: "foundmill.agent_id", taskId: "foundmill.task_id" };

/** The ids an activity's first argument names (most take `{ businessId, … }`). */
export function activityAttributes(args: readonly unknown[]): SpanAttributes {
  const first = args[0];
  const out: SpanAttributes = {};
  if (!first || typeof first !== "object") return out;
  for (const key of IDS) {
    const v = (first as Record<string, unknown>)[key];
    if (typeof v === "string") out[ATTRIBUTE[key]] = v;
  }
  return out;
}

export const activitySpans: ActivityInterceptorsFactory = (ctx) => ({
  inbound: {
    async execute(input, next) {
      const tracer = getTracer();
      if (!tracer.enabled) return next(input);
      const info = ctx.info;
      return tracer.withSpan(
        `activity ${info.activityType}`,
        { "temporal.activity_type": info.activityType, "temporal.workflow_id": info.workflowExecution?.workflowId ?? null, "temporal.workflow_type": info.workflowType, "temporal.task_queue": info.taskQueue, "temporal.attempt": info.attempt, ...activityAttributes(input.args) },
        () => next(input),
      );
    },
  },
});
