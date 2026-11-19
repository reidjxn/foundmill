/**
 * OAuth 2.1 for a vendor's remote MCP server (MCP authorization spec): authorization code with PKCE (S256) and the
 * resource indicator (RFC 8707), endpoints found from the server's own metadata (RFC 9728, RFC 8414) over https only.
 * Foundmill holds one pre-registered client per vendor (`PlatformSecrets`), so nothing is registered at connect time.
 *
 * The connect flow is two stateless steps (see `_shared/oauth-consent.ts`): the code verifier is never stored, it is
 * derived from the api's signed `state` with a server secret (`MCP_OAUTH_SECRET`), so only this gateway can finish a
 * flow it started, and a state seen in a redirect URL does not reveal it.
 */
import { createHash, createHmac } from "node:crypto";
import { ConfigError } from "../contract";
import type { FetchLike } from "../http";

export interface OAuthEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
}

export interface McpClientIdentity {
  clientId: string;
  clientSecret?: string;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** Refuses anything but https (http only for localhost, for tests and local servers). */
export function assertHttps(url: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw Object.assign(new Error(`${what} is not a URL`), { status: 400 });
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) throw Object.assign(new Error(`${what} must use https`), { status: 400 });
  return u;
}

async function getJson(fetch: FetchLike, url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The authorization server of an MCP server and its endpoints; throws when the metadata is missing, not https, or lacks S256. */
export async function discoverEndpoints(serverUrl: string, fetch: FetchLike): Promise<OAuthEndpoints> {
  const server = assertHttps(serverUrl, "The MCP server address");
  const path = server.pathname === "/" ? "" : server.pathname;
  const resource = await getJson(fetch, `${server.origin}/.well-known/oauth-protected-resource${path}`);
  const listed = Array.isArray(resource?.authorization_servers) ? str(resource.authorization_servers[0]) : null;
  const issuer = assertHttps(listed ?? server.origin, "The authorization server").origin;
  const meta = await getJson(fetch, `${issuer}/.well-known/oauth-authorization-server`);
  const authorizationEndpoint = str(meta?.authorization_endpoint);
  const tokenEndpoint = str(meta?.token_endpoint);
  if (!meta || !authorizationEndpoint || !tokenEndpoint) throw Object.assign(new Error("The server does not publish OAuth sign-in details"), { status: 502 });
  const methods = meta.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) throw Object.assign(new Error("The server does not support PKCE (S256)"), { status: 502 });
  const revocation = str(meta.revocation_endpoint);
  return {
    issuer,
    authorizationEndpoint: assertHttps(authorizationEndpoint, "The authorization endpoint").toString(),
    tokenEndpoint: assertHttps(tokenEndpoint, "The token endpoint").toString(),
    revocationEndpoint: revocation ? assertHttps(revocation, "The revocation endpoint").toString() : null,
  };
}

/** The PKCE pair for one flow, derived from its signed state. */
export function pkceFor(secret: string | undefined, connectorKey: string, state: string): { verifier: string; challenge: string } {
  if (!secret || secret.length < 32) throw new ConfigError(connectorKey, "MCP_OAUTH_SECRET", "a random secret of at least 32 characters");
  const verifier = b64url(createHmac("sha256", secret).update(`mcp-pkce|${connectorKey}|${state}`).digest());
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function consentUrl(ep: OAuthEndpoints, o: { client: McpClientIdentity; redirectUri: string; state: string; challenge: string; resource: string; scopes?: readonly string[] }): string {
  const u = new URL(ep.authorizationEndpoint);
  const q: Record<string, string> = { response_type: "code", client_id: o.client.clientId, redirect_uri: o.redirectUri, state: o.state, code_challenge: o.challenge, code_challenge_method: "S256", resource: o.resource, prompt: "consent" };
  if (o.scopes?.length) q.scope = o.scopes.join(" ");
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  raw: Record<string, unknown>;
}

async function tokenRequest(fetch: FetchLike, ep: OAuthEndpoints, client: McpClientIdentity, form: Record<string, string>, now: () => Date): Promise<TokenSet> {
  const body = new URLSearchParams({ ...form, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
  const res = await fetch(ep.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const access = str(json.access_token);
  // The vendor's answer is never echoed: it can hold tokens. Only its status and OAuth error code surface.
  if (!res.ok || !access) throw Object.assign(new Error(`Sign-in was refused (${str(json.error) ?? res.status})`), { status: res.status >= 400 ? res.status : 502, code: str(json.error) ?? "token_refused" });
  const expires = typeof json.expires_in === "number" ? new Date(now().getTime() + json.expires_in * 1000).toISOString() : undefined;
  const refresh = str(json.refresh_token);
  return { accessToken: access, ...(refresh ? { refreshToken: refresh } : {}), ...(expires ? { expiresAt: expires } : {}), raw: json };
}

export const exchangeCode = (fetch: FetchLike, ep: OAuthEndpoints, client: McpClientIdentity, o: { code: string; redirectUri: string; verifier: string; resource: string }, now: () => Date): Promise<TokenSet> =>
  tokenRequest(fetch, ep, client, { grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, resource: o.resource }, now);

export const refreshTokens = (fetch: FetchLike, ep: OAuthEndpoints, client: McpClientIdentity, o: { refreshToken: string; resource: string }, now: () => Date): Promise<TokenSet> =>
  tokenRequest(fetch, ep, client, { grant_type: "refresh_token", refresh_token: o.refreshToken, resource: o.resource }, now);

/** RFC 7009. True when the vendor accepted it; false when it publishes no revocation endpoint or refused. Never throws. */
export async function revokeToken(fetch: FetchLike, ep: OAuthEndpoints, client: McpClientIdentity, token: string): Promise<boolean> {
  if (!ep.revocationEndpoint) return false;
  const body = new URLSearchParams({ token, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
  const res = await fetch(ep.revocationEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return res?.ok === true;
}
