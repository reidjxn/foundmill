/**
 * A custom MCP server the founder connects by its address (Builder view), under the same rules as the vendors' lists:
 * the gateway is the only client, nothing on a list, so every call asks first (`call_unlisted_tool`), and a name that
 * would move money, sign, accept terms, delete permanently or change security settings is refused. The sign-in is a
 * bearer token the founder pastes (sealed in the vault, used only by the gateway); the server's own tool list is
 * readable through `list_remote_tools`.
 *
 * shortcut: the address is checked against private ranges right before each request, not on the socket, so a name that
 * answers public then private (DNS rebinding) is not stopped; upgrade by dialing through `publicOnlyLookup` once the
 * MCP SDK transport accepts a custom dispatcher.
 */
import { z } from "zod";
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, type Connector } from "../contract";
import { buildLiveConnector, buildMockConnector, defineTool, healthResult } from "../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../mock-utils";
import { resolveLiveOptions, type LiveConnectorOptions } from "../platform";
import { isPrivateAddress } from "../connectors/web/tools";
import { systemResolveHost, type ResolveHost } from "../connectors/web/page-fetch";
import { hardGateName, UNLISTED_HINTS } from "./build";
import { callRemoteTool, listRemoteTools } from "./client";
import { assertHttps } from "./oauth";

export const MCP_CUSTOM_KEY = "mcp_custom";

const Args = z.record(z.string(), z.unknown());
const Out = z.object({ text: z.string(), structured: z.unknown().optional() });
const NAME = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);

const customTools = [
  defineTool({ name: "list_remote_tools", description: "The tools the connected MCP server offers (names and descriptions).", input: z.object({}), output: z.object({ tools: z.array(z.object({ name: z.string(), description: z.string() })) }), hints: {}, untrusted: "api", untrustedRef: () => "mcp_custom:tools", annotations: { readOnlyHint: true } }),
  defineTool({
    name: "call_unlisted_tool",
    description: "Calls a tool of the connected MCP server. Always asks the founder first. Tools that move money, sign, accept terms, delete permanently or change security settings are refused.",
    input: z.object({ tool: NAME, arguments: Args.default({}) }),
    output: Out,
    hints: UNLISTED_HINTS,
    untrusted: "api",
    untrustedRef: (a) => `mcp_custom:${a.tool}`,
    annotations: { readOnlyHint: false, destructiveHint: true },
  }),
] as const;

/** https only, and no address that resolves into a private, loopback or link-local range. */
export async function assertPublicServer(url: string, resolveHost: ResolveHost = systemResolveHost): Promise<URL> {
  const u = assertHttps(url, "The server address");
  if (u.protocol !== "https:") throw new ConnectInputError(MCP_CUSTOM_KEY, "serverUrl", "The server address must use https");
  if (u.username || u.password) throw new ConnectInputError(MCP_CUSTOM_KEY, "serverUrl", "Leave the sign-in out of the address");
  const addresses = await resolveHost(u.hostname.replace(/^\[|\]$/g, "")).catch(() => []);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new ConnectInputError(MCP_CUSTOM_KEY, "serverUrl", "That address is not a public server");
  return u;
}

export function createMcpCustomConnector(options: LiveConnectorOptions & { resolveHost?: ResolveHost } = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const mock = buildMockConnector({
    key: MCP_CUSTOM_KEY,
    displayName: "Custom MCP server",
    phase: 3,
    auth: { kind: "api_key" },
    tools: customTools,
    rateLimits: { perMinute: 30, perDay: 2_000 },
    now: () => MOCK_NOW,
    handlers: {
      list_remote_tools: async () => ({ tools: [{ name: "lookup_order", description: "Look an order up (sample)" }] }),
      call_unlisted_tool: async ({ tool }) => {
        if (hardGateName(tool)) throw new AppError("hard_gate", `${tool} is refused`, 403);
        return { text: `${tool}: recorded sample` };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(MCP_CUSTOM_KEY, businessId, { accountLabel: "Custom server (mock)" }),
    healthcheck: async () => mockHealth(MCP_CUSTOM_KEY),
  });

  const serverOf = async (ctx: { integration: { config: Record<string, unknown> }; credential?: { secret: string } | undefined }) => {
    const url = typeof ctx.integration.config.server === "string" ? ctx.integration.config.server : "";
    if (!ctx.credential?.secret || !url) throw new ConfigError(MCP_CUSTOM_KEY, "server address and token", "connect it in Builder view");
    await assertPublicServer(url, options.resolveHost);
    return { url, token: ctx.credential.secret };
  };

  return buildLiveConnector(
    {
      key: MCP_CUSTOM_KEY,
      displayName: "Custom MCP server",
      phase: 3,
      auth: { kind: "api_key" },
      connectFields: [
        { name: "serverUrl", label: "Server address", secret: false, required: true, placeholder: "https://mcp.example.com/mcp", hint: "The https address of the MCP server." },
        { name: "apiKey", label: "Access token", secret: true, required: true, hint: "A token the server issued to you. Every call it makes asks you first." },
      ],
      tools: customTools,
      rateLimits: { perMinute: 30, perDay: 2_000 },
      now,
      handlers: {
        list_remote_tools: async (_a, ctx) => {
          const s = await serverOf(ctx);
          return { tools: await listRemoteTools(s.url, s.token, fetch) };
        },
        call_unlisted_tool: async ({ tool, arguments: args }, ctx) => {
          if (hardGateName(tool)) throw new AppError("hard_gate", `${tool} would move money, sign, accept terms, delete permanently or change security settings, which only the founder does`, 403);
          const s = await serverOf(ctx);
          const r = await callRemoteTool(s.url, s.token, fetch, tool, args);
          if (r.isError) throw new AppError("remote_tool_error", "The tool reported an error", 502);
          return { text: r.text, ...(r.structured !== undefined ? { structured: r.structured } : {}) };
        },
      },
      connect: async (businessId, input) => {
        const serverUrl = connectInputValue(input, "serverUrl");
        const token = connectInputValue(input, "apiKey");
        if (!serverUrl) throw new ConnectInputError(MCP_CUSTOM_KEY, "serverUrl", "Enter the server's address");
        if (!token) throw new ConnectInputError(MCP_CUSTOM_KEY, "apiKey", "Enter the access token");
        const url = await assertPublicServer(serverUrl, options.resolveHost);
        // The token is checked by asking for the tool list: a server that refuses it is not connected.
        const tools = await listRemoteTools(url.toString(), token, fetch).catch(() => {
          throw new ConnectInputError(MCP_CUSTOM_KEY, "apiKey", "The server did not accept that address and token");
        });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: MCP_CUSTOM_KEY, status: "connected", scopes: [], accountLabel: url.host, externalAccountId: url.host, config: { server: url.toString(), toolCount: tools.length }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt, credentialToStore: { kind: "api_key", secret: token } };
      },
      healthcheck: async (integration, credential) => {
        const startedAt = now().getTime();
        const url = typeof integration.config.server === "string" ? integration.config.server : "";
        if (!credential || !url) return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
        try {
          await assertPublicServer(url, options.resolveHost);
          await listRemoteTools(url, credential.secret, fetch);
          return healthResult("connected", startedAt, { now });
        } catch {
          return healthResult("degraded", startedAt, { now, message: "The server did not answer with the stored token" });
        }
      },
    },
    mock,
  );
}
