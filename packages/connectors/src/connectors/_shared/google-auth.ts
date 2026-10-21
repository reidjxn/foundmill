/**
 * Google OAuth for the Drive/Docs, Gmail and Calendar connectors. The per-business credential holds the
 * access token (+ refresh token); when it is about to expire and the platform client id/secret are known,
 * the token is refreshed against https://oauth2.googleapis.com/token (RFC 6749 §6).
 */
import { ConfigError, reportRefreshedCredential, type IntegrationRecord, type ToolContext } from "../../contract";
import { createHttp, type FetchLike } from "../../http";
import type { PlatformSecrets } from "../../platform";
import { authorizeUrl, consentRecord, consentStartOf, hasAuthorizationCode } from "./oauth-consent";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com";
/** Google's OAuth 2.0 consent page (web server flow). */
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export interface GoogleAuthDeps {
  connectorKey: string;
  secrets: PlatformSecrets;
  fetch: FetchLike;
  now: () => Date;
}

export interface GoogleToken {
  accessToken: string;
  /** Present when the token was refreshed during this call; the gateway should persist it. */
  refreshed?: { accessToken: string; expiresAt: string };
}

export async function googleAccessToken(ctx: ToolContext, deps: GoogleAuthDeps): Promise<GoogleToken> {
  const cred = ctx.credential;
  if (!cred?.secret) throw new ConfigError(deps.connectorKey, "Google sign-in credential", "connect the Google account in Settings → Integrations");
  const expiresAt = cred.expiresAt ? Date.parse(cred.expiresAt) : Number.POSITIVE_INFINITY;
  const stillValid = expiresAt - 60_000 > deps.now().getTime();
  if (stillValid || !cred.refreshToken) return { accessToken: cred.secret };
  const { googleClientId, googleClientSecret } = deps.secrets;
  if (!googleClientId || !googleClientSecret) throw new ConfigError(deps.connectorKey, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", "needed to refresh an expired Google token");
  const http = createHttp({ connectorKey: deps.connectorKey, baseUrl: GOOGLE_TOKEN_URL, fetch: deps.fetch });
  const res = await http.json<{ access_token: string; expires_in: number }>("POST", "/token", {
    form: { client_id: googleClientId, client_secret: googleClientSecret, refresh_token: cred.refreshToken, grant_type: "refresh_token" },
  });
  const refreshedExpiry = new Date(deps.now().getTime() + res.expires_in * 1000).toISOString();
  ctx.log.info({ connector: deps.connectorKey, businessId: ctx.businessId }, "refreshed Google access token");
  await reportRefreshedCredential(ctx, { ...cred, secret: res.access_token, expiresAt: refreshedExpiry }, deps.connectorKey);
  return { accessToken: res.access_token, refreshed: { accessToken: res.access_token, expiresAt: refreshedExpiry } };
}

export const googleHeaders = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

/**
 * The Google connectors' `connect()`. Without a code it answers Google's consent page for the connector's scopes
 * (offline access, so a refresh token comes back, and `prompt=consent`, so a reconnect gets one again); with the code
 * Google sent back it exchanges it.
 */
export async function googleOAuthConnect(input: unknown, deps: GoogleAuthDeps, opts: { businessId: string; scopes: string[]; label: string; newId: () => string }): Promise<IntegrationRecord> {
  if (!hasAuthorizationCode(input)) {
    const start = consentStartOf(input, opts.label);
    if (!deps.secrets.googleClientId) throw new ConfigError(deps.connectorKey, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", "create a client ID for a web application in the Google Cloud console");
    const url = authorizeUrl(GOOGLE_AUTHORIZE_URL, { client_id: deps.secrets.googleClientId, redirect_uri: start.redirectUri, response_type: "code", scope: ["openid", "email", ...opts.scopes].join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: start.state });
    return consentRecord(deps.connectorKey, opts.businessId, url, { now: deps.now, newId: opts.newId });
  }
  const code = input as { code: string; redirectUri?: string };
  const { googleClientId, googleClientSecret } = deps.secrets;
  if (!googleClientId || !googleClientSecret) throw new ConfigError(deps.connectorKey, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  const http = createHttp({ connectorKey: deps.connectorKey, baseUrl: GOOGLE_TOKEN_URL, fetch: deps.fetch });
  const res = await http.json<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>("POST", "/token", {
    form: { code: code.code, client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: code.redirectUri, grant_type: "authorization_code" },
  });
  const info = await createHttp({ connectorKey: deps.connectorKey, baseUrl: "https://openidconnect.googleapis.com", fetch: deps.fetch, headers: googleHeaders(res.access_token) }).json<{ email?: string; sub?: string }>("GET", "/v1/userinfo").catch(() => ({ email: undefined, sub: undefined }));
  const createdAt = deps.now().toISOString();
  const expiresAt = new Date(deps.now().getTime() + res.expires_in * 1000).toISOString();
  return {
    id: opts.newId(), businessId: opts.businessId, connectorKey: deps.connectorKey, status: "connected", scopes: res.scope?.split(" ") ?? opts.scopes, accountLabel: info.email ?? opts.label, externalAccountId: info.sub ?? null,
    config: { email: info.email ?? null }, credentialRef: null, expiresAt: res.refresh_token ? null : expiresAt, lastHealthAt: createdAt, createdAt,
    credentialToStore: { kind: "oauth", secret: res.access_token, refreshToken: res.refresh_token, expiresAt },
  };
}
