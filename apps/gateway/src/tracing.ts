/**
 * Trace spans for tool calls (BUILD §15: Continue press → workflow → agent session → tool call → vendor API). Each call
 * through `/v1/call` or `/mcp/:connector` is one span, a child of the agent session's span when the caller sent its
 * `traceparent` (the orchestrator sets it on the session's MCP connections). A no-op until the gateway installed
 * telemetry with an OTLP endpoint.
 */
import type { MiddlewareHandler } from "hono";
import { getTracer, parseTraceparent, runInSpanContext } from "@foundmill/shared/telemetry";
import { executeToolCall, type GatewayDeps, type ToolCallResult } from "./pipeline";
import type { SessionToken } from "./tokens";
import type { CallRequestParsed } from "./types";

/** Runs the rest of the request in the caller's trace (its `traceparent` header), so tool call spans join it. */
export const callerTrace: MiddlewareHandler = (c, next) => runInSpanContext(parseTraceparent(c.req.header("traceparent")), () => next());

/** `executeToolCall` inside a span named after the connector and tool, with the outcome and cost. */
export function tracedToolCall(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed): Promise<ToolCallResult> {
  const tracer = getTracer();
  if (!tracer.enabled) return executeToolCall(deps, session, req);
  return tracer.withSpan(
    `tool ${req.connector}.${req.tool}`,
    { "tool.connector": req.connector, "tool.name": req.tool, "foundmill.business_id": session.businessId, "foundmill.agent_id": session.agentId, "foundmill.session_id": session.sessionId },
    async (span) => {
      const result = await executeToolCall(deps, session, req);
      span.setAttributes({ "tool.outcome": result.body.outcome, "http.status_code": result.status, "tool.cost.minor": "costMinor" in result.body ? result.body.costMinor : null, "tool.cost.label": "Estimate" });
      return result;
    },
    { kind: 2 },
  );
}
