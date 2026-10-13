/**
 * `ALL /mcp/:connector` — one MCP streamable-HTTP server per connector (BUILD §9.3, ARCHITECTURE §9),
 * built on the low-level `Server` from @modelcontextprotocol/sdk 1.32 so the connector's JSON-schema tool
 * definitions are listed verbatim, and on `WebStandardStreamableHTTPServerTransport` in stateless mode
 * (one Server + transport per HTTP request, JSON responses) so any gateway replica can answer any request.
 *
 * `tools/list` shows only the tools the session token allows; `tools/call` runs the exact same pipeline as
 * `POST /v1/call` and returns the gateway's outcome envelope as `structuredContent` plus a text copy.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { APP_NAME } from "@foundmill/config";
import { AppError, NotFoundError } from "@foundmill/shared";
import type { Connector, McpToolDefinition } from "@foundmill/connectors";
import { CallRequest } from "./types";
import { executeToolCall, GatewayError, modeFor, safeError, type GatewayDeps } from "./pipeline";
import { toolAllowed, type SessionToken } from "./tokens";

export const MCP_SERVER_VERSION = "0.1.0";

/** The connector's MCP tool definitions this session may see. */
export function visibleTools(connector: Connector, session: SessionToken): McpToolDefinition[] {
  return connector.tools.filter((t) => toolAllowed(session.allowedTools, connector.key, t.name));
}

function toMcpTool(def: McpToolDefinition): Tool {
  // The gateway answers with its own outcome envelope, so the connector's outputSchema is deliberately not
  // advertised (an MCP client validates structuredContent against outputSchema when one is declared).
  return {
    name: def.name,
    ...(def.title ? { title: def.title } : {}),
    description: def.description,
    inputSchema: def.inputSchema as Tool["inputSchema"],
    ...(def.annotations ? { annotations: def.annotations } : {}),
  };
}

export function createMcpServer(deps: GatewayDeps, session: SessionToken, connector: Connector): Server {
  const server = new Server(
    { name: `${APP_NAME.toLowerCase()}-gateway/${connector.key}`, title: `${APP_NAME} gateway — ${connector.displayName}`, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: `Tools of ${connector.displayName} for this agent session. Every call is policy-checked; an "ask" outcome means a founder approval was requested and the call did not run.` },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: visibleTools(connector, session).map(toMcpTool) }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const req = CallRequest.parse({ connector: connector.key, tool: request.params.name, args: request.params.arguments ?? {} });
    try {
      const { status, body } = await executeToolCall(deps, session, req);
      return {
        content: [{ type: "text", text: JSON.stringify(body) }],
        structuredContent: body as unknown as Record<string, unknown>,
        isError: status >= 400,
      };
    } catch (e) {
      const err = e instanceof AppError ? { code: e.code, message: e.message, status: e.status } : { code: "internal", message: "Tool call failed", status: 500 };
      if (!(e instanceof AppError)) deps.log.error({ err: safeError(e) }, "mcp tools/call failed");
      const body = { outcome: "error" as const, error: err };
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: true };
    }
  });

  return server;
}

/** Serves one HTTP request of the MCP streamable-HTTP transport for `connectorKey`. */
export async function handleMcpRequest(deps: GatewayDeps, session: SessionToken, connectorKey: string, request: Request): Promise<Response> {
  let connector: Connector;
  try {
    connector = deps.registry.get(connectorKey, modeFor(deps, connectorKey));
  } catch (e) {
    if (e instanceof NotFoundError) throw new GatewayError("unknown_connector", `Unknown connector "${connectorKey}"`, 404, { connector: connectorKey });
    throw e;
  }
  const server = createMcpServer(deps, session, connector);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: JSON mode resolves the response only after the result was sent, so closing here is safe.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}
