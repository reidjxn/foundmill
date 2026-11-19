import type { Connector } from "../contract";
import type { LiveConnectorOptions } from "../platform";
import { createRemoteMcpConnector } from "./build";
import { HUBSPOT_MCP, NOTION_MCP, SHOPIFY_MCP } from "./servers";

export { createRemoteMcpConnector, createRemoteMcpMock, remoteToolList, toolName, HARD_GATE_NAME, UNLISTED_HINTS, UNLISTED_TOOL, type RemoteServer, type RemoteTool } from "./build";
import { HARD_GATE_NAME as HARD_NAME, UNLISTED_TOOL as UNLISTED } from "./build";
export { createMcpCustomConnector, assertPublicServer, MCP_CUSTOM_KEY } from "./custom";
export { REMOTE_MCP_SERVERS, NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP } from "./servers";

export const createNotionMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(NOTION_MCP, o);
export const createHubspotMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(HUBSPOT_MCP, o);
export const createShopifyMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(SHOPIFY_MCP, o);

/** Connectors with no live implementation yet (a remote server nobody could sign in to): Settings hides them where mocks are not allowed. */
export const MOCK_ONLY_CONNECTORS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP].filter((s) => !s.live).map((s) => s.key));

const REMOTE_KEYS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP].map((s) => s.key).concat("mcp_custom"));

/** The remote tool name a `call_unlisted_tool` call asks for when it would cross a hard gate (money out, signing, terms, permanent delete, security); null otherwise. The gateway denies it before anyone is asked. */
export function remoteHardGateCall(connectorKey: string, tool: string, args: unknown): string | null {
  if (!REMOTE_KEYS.has(connectorKey) || tool !== UNLISTED) return null;
  const name = (args as { tool?: unknown } | null)?.tool;
  return typeof name === "string" && HARD_NAME.test(name) ? name : null;
}
