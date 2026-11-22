/**
 * The gateway as an MCP client: one short-lived streamable-HTTP session per call, bearer token from the sealed
 * credential, redirects refused (a redirect would carry the token to another host). The agent never reaches the server:
 * this runs inside a connector handler, after the gateway's pipeline allowed the call.
 */
import { AppError } from "@foundmill/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APP_NAME } from "@foundmill/config";
import { reportRefreshedCredential, ConfigError, type DecryptedCredential, type ToolContext } from "../contract";
import type { FetchLike } from "../http";
import { discoverEndpoints, refreshTokens, type McpClientIdentity } from "./oauth";

export interface RemoteResult {
  text: string;
  structured?: unknown;
  isError: boolean;
}

const MAX_TEXT = 200_000;

/** What an agent may read of a failure: never the server's own words (they are a third party's text, outside the untrusted envelope). */
function hidden(e: unknown): never {
  if (e instanceof AppError) throw e;
  const code = (e as { code?: unknown }).code;
  const status = typeof code === "number" && code >= 400 && code < 600 ? code : 502;
  throw new AppError("remote_unavailable", status === 401 || status === 403 ? "The server refused the stored sign-in" : "The server did not answer the call", status === 401 || status === 403 ? 403 : 502);
}

async function withClient<T>(url: string, token: string, fetch: FetchLike, run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch, requestInit: { headers: { authorization: `Bearer ${token}` }, redirect: "error" } });
  const client = new Client({ name: `${APP_NAME.toLowerCase()}-gateway`, version: "0.1.0" });
  try {
    await client.connect(transport);
    return await run(client);
  } catch (e) {
    return hidden(e);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function callRemoteTool(url: string, token: string, fetch: FetchLike, tool: string, args: Record<string, unknown>): Promise<RemoteResult> {
  return withClient(url, token, fetch, async (client) => {
    const res = await client.callTool({ name: tool, arguments: args });
    const parts = Array.isArray(res.content) ? res.content : [];
    const text = parts.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).filter(Boolean).join("\n");
    return { text: text.slice(0, MAX_TEXT), ...(res.structuredContent !== undefined ? { structured: res.structuredContent } : {}), isError: res.isError === true };
  });
}

export async function listRemoteTools(url: string, token: string, fetch: FetchLike): Promise<{ name: string; description: string }[]> {
  return withClient(url, token, fetch, async (client) => (await client.listTools()).tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 300) })));
}

/** Per-credential refresh queue: a vendor that rotates refresh tokens (Notion) treats a replayed one as theft. */
const refreshing = new Map<string, Promise<DecryptedCredential>>();

/**
 * The access token for this call: the stored one while it has more than five minutes left, otherwise refreshed
 * (rotated refresh token sealed back through `ctx.onCredentialRefreshed`). `invalid_grant` is terminal: the founder
 * reconnects. Calls in this process that need a refresh at the same time share one request.
 */
export async function accessTokenFor(ctx: ToolContext, o: { connectorKey: string; serverUrl: string; client: McpClientIdentity | null; fetch: FetchLike; now: () => Date }): Promise<string> {
  const cred = ctx.credential;
  if (!cred?.secret) throw new ConfigError(o.connectorKey, "sign-in credential", "connect it in Settings → Integrations");
  const expires = cred.expiresAt ? Date.parse(cred.expiresAt) : Number.POSITIVE_INFINITY;
  if (expires - 5 * 60_000 > o.now().getTime() || !cred.refreshToken) return cred.secret;
  if (!o.client) throw new ConfigError(o.connectorKey, "the sign-in app client id", "needed to refresh an expired sign-in");
  const client = o.client;
  const key = `${ctx.businessId}|${ctx.integration.id}`;
  let pending = refreshing.get(key);
  if (!pending) {
    pending = (async () => {
      const ep = await discoverEndpoints(o.serverUrl, o.fetch);
      const t = await refreshTokens(o.fetch, ep, client, { refreshToken: cred.refreshToken!, resource: o.serverUrl }, o.now);
      const next: DecryptedCredential = { ...cred, secret: t.accessToken, refreshToken: t.refreshToken ?? cred.refreshToken!, ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}) };
      await reportRefreshedCredential(ctx, next, o.connectorKey);
      return next;
    })();
    refreshing.set(key, pending);
    // Kept for a moment after it settles: a call that loaded the old credential before it was sealed must not refresh with the old (already rotated) refresh token.
    void pending.then(() => undefined, () => undefined).then(() => setTimeout(() => refreshing.delete(key), 60_000).unref());
  }
  return (await pending).secret;
}
