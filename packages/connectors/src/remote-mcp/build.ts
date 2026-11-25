/**
 * A connector for a vendor's remote MCP server (founder, 2026-11-19: SaaS tools come in through MCP). The gateway is the
 * only MCP client. Foundmill's own list per server maps every tool to `policyHints`; the server's annotations are never
 * read. A tool the list does not name is reachable only through `call_unlisted_tool`, which asks first in every mode; a
 * tool that would move money, sign, accept terms, delete permanently or change security settings is a `hardGate` entry
 * (no handler, becomes a founder task) or, unlisted, refused by name. Built with `buildLiveConnector`, so scope, state
 * re-check, Cedar, ask, metering, audit and the untrusted envelope are the gateway pipeline's, unchanged.
 *
 * The recorded mock (`RemoteServer.mock`) answers each listed tool with a fixed sample, so INTEGRATIONS_MODE=mock runs
 * the golden path; a mock result is `simulated` like every other.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, type Connector, type JsonSchemaObject, type McpToolDefinition, type MockConnector, type PolicyHint, type ToolContext } from "../contract";
import { buildLiveConnector, buildMockConnector, defineTool, healthResult, type AnyToolSpec } from "../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../mock-utils";
import { resolveLiveOptions, type LiveConnectorOptions, type PlatformSecrets } from "../platform";
import { consentRecord, consentStartOf, hasAuthorizationCode } from "../connectors/_shared/oauth-consent";
import { accessTokenFor, callRemoteTool, listRemoteTools, type RemoteResult } from "./client";
import { consentUrl, discoverEndpoints, exchangeCode, pkceFor, revokeToken, type McpClientIdentity } from "./oauth";

/** A listed tool: the vendor's name and schema as recorded, and what Foundmill decided about it. */
export interface RemoteTool {
  remote: string;
  description: string;
  inputSchema: JsonSchemaObject;
  /** Absent: reads only, runs. Anything outward, costly or hard to undo says so here and asks first. */
  hints?: PolicyHint;
  /** Writes inside the founder's own account with no outward hint (a reviewed entry in `INTERNAL_WRITE_TOOLS`). */
  writes?: boolean;
  /** Required with `hints.hardGate`: what the founder does at the vendor instead. */
  humanAction?: { title: string; instructions: string };
  /** The typed read of the answer's `structured` part (checked values built with `fact.*`, never free text). */
  facts?: (structured: unknown) => unknown;
}

export interface RemoteServer {
  key: string;
  displayName: string;
  /** The server's MCP endpoint (https). */
  url: string;
  /** False until someone checked the server's OAuth and tools against the live vendor: the connector stays mock-only and Settings hides it. */
  live: boolean;
  scopes?: readonly string[];
  /** A smaller set asked once when the vendor refuses `scopes` (connect input `retryScopes: true`): Lovable below Business. */
  retryScopes?: readonly string[];
  /** Scopes a sign-in must not carry (Sentry's write access to keys, teams and alerts): a token that reports one is not connected. */
  refusedScopes?: readonly string[];
  /** Foundmill's pre-registered OAuth client at this vendor (env on the gateway); null when not configured. */
  clientOf(secrets: PlatformSecrets): McpClientIdentity | null;
  /** Env names a ConfigError tells the operator to set. */
  clientEnv: string;
  tools: readonly RemoteTool[];
  /** The recorded mock: sample answer per remote tool name. */
  mock: Readonly<Record<string, (args: Record<string, unknown>) => { text: string; structured?: unknown }>>;
}

/** What a tool on no list asks: outward and not undoable, so assisted mode asks too. */
export const UNLISTED_HINTS: PolicyHint = { contactsThirdParty: true, irreversible: true };

/**
 * Word stems that would cross a hard gate (money out, signing, terms, permanent delete, security, outside filings or
 * access). A remote tool name is split into words (snake, kebab, dot, camelCase, digits) and a word that starts with a
 * stem matches, so `deletePage`, `refunds` and `esign_document` are all caught. Over-matching is safe: a refused read is
 * added to the server's list; a missed hard gate is not safe.
 */
export const HARD_GATE_STEMS = ["delet", "destroy", "purge", "erase", "wipe", "drop", "truncat", "remov", "revok", "refund", "payout", "withdraw", "transfer", "charg", "captur", "pay", "invoice", "bill", "checkout", "purchas", "buy", "subscri", "sign", "esign", "accept", "agree", "terms", "consent", "approv", "password", "secret", "credential", "token", "apikey", "oauth", "auth", "mfa", "2fa", "permission", "grant", "role", "admin", "security", "share", "sharing", "invit", "submit"];
export function remoteNameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export const hardGateName = (name: string): boolean => {
  const words = remoteNameWords(name);
  // "api_key" is two words; check the joined form too.
  return [...words, words.join("")].some((w) => HARD_GATE_STEMS.some((stem) => w.startsWith(stem))) || words.join("").includes("apikey");
};
/**
 * What is wrong with a server's list, as sentences (empty when it is sound): a hard gate needs its human action, and a
 * listed tool whose name sounds like a hard gate must be a `hardGate` entry or `founderExecuted` (the founder's own press,
 * the one way such a tool runs; never a session-token call, see `remoteFounderExecutedCall`).
 */
export function listProblems(server: Pick<RemoteServer, "key" | "tools">): string[] {
  const out: string[] = [];
  for (const t of server.tools) {
    if (t.hints?.hardGate && !t.humanAction) out.push(`${server.key}.${t.remote} is a hard gate without a human action`);
    if (hardGateName(t.remote) && !t.hints?.hardGate && !t.hints?.founderExecuted) out.push(`${server.key}.${t.remote} sounds like a hard gate but is listed as allowed`);
    if (t.hints?.founderExecuted && t.hints.hardGate) out.push(`${server.key}.${t.remote} is both a hard gate and founder-executed`);
  }
  return out;
}
export const toolName = (remote: string): string => remote.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(?=\d)/, "t_");

const Args = z.record(z.string(), z.unknown());
const Out = z.object({ text: z.string(), structured: z.unknown().optional() });
const UNLISTED_NAME = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
export const UNLISTED_TOOL = "call_unlisted_tool";

/** Every tool name a server's connector serves with its hints (grants and the credit saver read this without building the connector). */
export const remoteToolList = (server: Pick<RemoteServer, "tools">): { name: string; hints: PolicyHint }[] => [...server.tools.map((t) => ({ name: toolName(t.remote), hints: t.hints ?? {} })), { name: UNLISTED_TOOL, hints: UNLISTED_HINTS }];

function specsOf(server: RemoteServer): AnyToolSpec[] {
  const listed: AnyToolSpec[] = server.tools.map((t) =>
    defineTool({
      name: toolName(t.remote),
      description: t.description,
      // The vendor validates the values; the list's own `required` is checked here so a malformed call never leaves.
      input: Args.refine((a) => (t.inputSchema.required ?? []).every((k) => k in a), "a required argument is missing"),
      output: Out,
      hints: t.hints ?? {},
      ...(t.humanAction ? { humanAction: () => t.humanAction! } : {}),
      // Every answer is a third party's text, whatever the tool: it reaches agents inside the untrusted envelope.
      ...(t.hints?.hardGate ? {} : { untrusted: "api" as const, untrustedRef: () => `${server.key}:${t.remote}` }),
      ...(t.facts && !t.hints?.hardGate ? { facts: (data: { structured?: unknown }) => t.facts!(data.structured) } : {}),
      annotations: { readOnlyHint: !t.writes && (!t.hints || Object.values(t.hints).every((v) => !v)) },
    }),
  );
  const unlisted = defineTool({
    name: UNLISTED_TOOL,
    description: `Calls a ${server.displayName} tool that ${APP_NAME}'s list does not name. Always asks the founder first. Tools that move money, sign, accept terms, delete permanently or change security settings are refused.`,
    input: z.object({ tool: UNLISTED_NAME, arguments: Args.default({}) }),
    output: Out,
    hints: UNLISTED_HINTS,
    untrusted: "api",
    untrustedRef: (a) => `${server.key}:${a.tool}`,
    annotations: { readOnlyHint: false, destructiveHint: true },
  });
  return [...listed, unlisted];
}

/** The listed tools carry the vendor's own schema (the Zod `Args` above only checks the shape). Edits the connector in place. */
function withVendorSchemas<C extends Connector>(connector: C, server: RemoteServer): C {
  const byName = new Map(server.tools.map((t) => [toolName(t.remote), t.inputSchema]));
  connector.tools = connector.tools.map((d): McpToolDefinition => (byName.has(d.name) ? { ...d, inputSchema: byName.get(d.name)! } : d));
  return connector;
}

/**
 * Why a remote tool refused, as one fixed code (never the vendor's text, which is untrusted and may hold anything):
 * logs and the fallback paths read it, for example Lovable's create_project on a workspace with no credits.
 */
export function remoteErrorReason(text: string): "insufficient_credits" | "plan_required" | "forbidden" | "unauthorized" | "rate_limited" | "other" {
  const t = text.toLowerCase();
  if (/credit|quota|balance/.test(t)) return "insufficient_credits";
  if (/\b(plan|upgrade|business|enterprise|subscription)\b/.test(t)) return "plan_required";
  if (/rate.?limit|too many/.test(t)) return "rate_limited";
  if (/unauthori[sz]ed|invalid.?token|expired/.test(t)) return "unauthorized";
  if (/forbidden|permission|not allowed|scope/.test(t)) return "forbidden";
  return "other";
}

const failed = (r: RemoteResult): never => {
  throw new AppError("remote_tool_error", "The tool reported an error", 502, { reason: remoteErrorReason(r.text) });
};

export interface RemoteOptions extends LiveConnectorOptions {
  /** Refuses private and internal addresses before any request (custom servers). */
  guard?: (url: string) => Promise<void>;
}

export function createRemoteMcpConnector(server: RemoteServer, options: RemoteOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const guard = options.guard ?? (async () => {});
  const specs = specsOf(server);
  const listedRemote = new Map(server.tools.map((t) => [t.remote, t]));
  const client = (): McpClientIdentity | null => server.clientOf(secrets);

  const run = async (ctx: ToolContext, remote: string, args: Record<string, unknown>): Promise<{ text: string; structured?: unknown }> => {
    await guard(server.url);
    const token = await accessTokenFor(ctx, { connectorKey: server.key, serverUrl: server.url, client: client(), fetch, now });
    const r = await callRemoteTool(server.url, token, fetch, remote, args);
    return r.isError ? failed(r) : { text: r.text, ...(r.structured !== undefined ? { structured: r.structured } : {}) };
  };

  const handlers: Record<string, (args: never, ctx: ToolContext) => Promise<unknown>> = {};
  for (const t of server.tools) if (!t.hints?.hardGate) handlers[toolName(t.remote)] = (args: Record<string, unknown>, ctx) => run(ctx, t.remote, args) as Promise<unknown>;
  handlers[UNLISTED_TOOL] = async ({ tool, arguments: args }: { tool: string; arguments: Record<string, unknown> }, ctx) => {
    if (listedRemote.has(tool)) throw new AppError("use_listed_tool", `${tool} is on ${APP_NAME}'s list: call ${toolName(tool)} instead`, 400);
    if (hardGateName(tool)) throw new AppError("hard_gate", `${server.displayName} ${tool} would move money, sign, accept terms, delete permanently or change security settings, which only the founder does at ${server.displayName}`, 403);
    return run(ctx, tool, args);
  };

  const live = buildLiveConnector(
    {
      key: server.key,
      displayName: server.displayName,
      phase: 2,
      auth: { kind: "oauth", authorizationCode: true, ...(server.scopes ? { scopes: [...server.scopes] } : {}) },
      tools: specs,
      rateLimits: { perMinute: 60, perDay: 5_000 },
      now,
      handlers: handlers as never,
      connect: async (businessId, input) => {
        if (!server.live) throw new ConfigError(server.key, `a confirmed ${server.displayName} sign-in`, "this server is recorded but not confirmed against the live vendor yet");
        const id = client();
        if (!id) throw new ConfigError(server.key, server.clientEnv, `register ${APP_NAME}'s sign-in app at ${server.displayName} and set it`);
        await guard(server.url);
        const ep = await discoverEndpoints(server.url, fetch);
        if (!hasAuthorizationCode(input)) {
          const start = consentStartOf(input, server.displayName);
          const { challenge } = pkceFor(secrets.mcpOauthSecret, server.key, start.state);
          const scopes = (input as { retryScopes?: unknown }).retryScopes === true && server.retryScopes ? server.retryScopes : server.scopes;
          return consentRecord(server.key, businessId, consentUrl(ep, { client: id, redirectUri: start.redirectUri, state: start.state, challenge, resource: server.url, ...(scopes ? { scopes } : {}) }), { now, newId: uuid });
        }
        const given = input as { code: string; redirectUri?: string; state?: string };
        const start = consentStartOf({ state: given.state, redirectUri: given.redirectUri }, server.displayName);
        const { verifier } = pkceFor(secrets.mcpOauthSecret, server.key, start.state);
        const t = await exchangeCode(fetch, ep, id, { code: given.code, redirectUri: start.redirectUri, verifier, resource: server.url }, now);
        // A server that grants a scope Foundmill did not ask for (Lightbringer's `mcp:trade-secrets`) is not connected.
        const granted = typeof t.raw.scope === "string" ? t.raw.scope.split(/[\s,]+/).filter(Boolean) : [];
        const extra = server.scopes ? granted.filter((s) => !server.scopes!.includes(s)) : granted.filter((s) => server.refusedScopes?.includes(s));
        if (extra.length > 0) throw new ConnectInputError(server.key, "scope", `${server.displayName} granted access ${APP_NAME} did not ask for (${extra.join(", ")}), so it was not connected. Connect it again and leave that access out.`);
        const createdAt = now().toISOString();
        const label = typeof t.raw.workspace_name === "string" && t.raw.workspace_name ? t.raw.workspace_name : server.displayName;
        const account = [t.raw.workspace_id, t.raw.hub_id, t.raw.user_id].find((v): v is string | number => typeof v === "string" || typeof v === "number");
        return {
          id: uuid(), businessId, connectorKey: server.key, status: "connected", scopes: server.scopes ? [...server.scopes] : granted, accountLabel: label, externalAccountId: account === undefined ? null : String(account),
          config: { server: server.url }, credentialRef: null, expiresAt: t.refreshToken ? null : (t.expiresAt ?? null), lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "oauth", secret: t.accessToken, ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}), ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}) },
        };
      },
      healthcheck: async (integration, credential) => {
        const startedAt = now().getTime();
        if (!credential) return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
        try {
          await guard(server.url);
          const tools = await listRemoteTools(server.url, credential.secret, fetch);
          return healthResult("connected", startedAt, { now, details: { tools: tools.length } });
        } catch {
          // A lapsed access token is refreshed by the next call; the founder is told only when that fails too.
          return healthResult("degraded", startedAt, { now, message: `${server.displayName} did not answer with the stored sign-in` });
        }
      },
      disconnect: async (_integration, credential) => {
        const id = client();
        if (!id || !credential) return false;
        const ep = await discoverEndpoints(server.url, fetch).catch(() => null);
        if (!ep) return false;
        const a = await revokeToken(fetch, ep, id, credential.refreshToken ?? credential.secret);
        const b = credential.refreshToken ? await revokeToken(fetch, ep, id, credential.secret) : a;
        return a || b;
      },
    },
    createRemoteMcpMock(server),
  );
  return withVendorSchemas(live, server);
}

export function createRemoteMcpMock(server: RemoteServer): MockConnector {
  const handlers: Record<string, (args: never, ctx: ToolContext) => Promise<unknown>> = {};
  for (const t of server.tools) {
    if (t.hints?.hardGate) continue;
    const sample = server.mock[t.remote];
    handlers[toolName(t.remote)] = async (args: Record<string, unknown>) => (sample ? sample(args) : { text: `${server.displayName} ${t.remote}: recorded sample` });
  }
  handlers[UNLISTED_TOOL] = async ({ tool }: { tool: string }) => {
    if (listedOf(server).has(tool)) throw new AppError("use_listed_tool", `${tool} is on ${APP_NAME}'s list: call ${toolName(tool)} instead`, 400);
    if (hardGateName(tool)) throw new AppError("hard_gate", `${tool} is refused`, 403);
    return { text: `${server.displayName} ${tool}: recorded sample` };
  };
  return withVendorSchemas(
    buildMockConnector({
      key: server.key,
      displayName: server.displayName,
      phase: 2,
      auth: { kind: "oauth", ...(server.scopes ? { scopes: [...server.scopes] } : {}) },
      tools: specsOf(server),
      rateLimits: { perMinute: 60, perDay: 5_000 },
      now: () => MOCK_NOW,
      handlers: handlers as never,
      connect: async (businessId) => mockIntegrationRecord(server.key, businessId, { accountLabel: `${server.displayName} (mock)`, scopes: [...(server.scopes ?? [])] }),
      healthcheck: async () => mockHealth(server.key, { tools: server.tools.length }),
    }),
    server,
  );
}

const listedOf = (server: RemoteServer): Set<string> => new Set(server.tools.map((t) => t.remote));
