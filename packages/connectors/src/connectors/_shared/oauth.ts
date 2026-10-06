/** OAuth 2.0 client-credentials token source with in-memory caching (Tink, Bolagsverket). */
import type { HttpClient } from "../../http";
import { basicAuth } from "../../http";

export interface ClientCredentialsOptions {
  http: HttpClient;
  tokenPath: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** Where the client credentials go: form body (Tink) or Basic header (Bolagsverket). */
  authStyle?: "body" | "basic";
  now?: () => Date;
}

export interface TokenSource {
  get(): Promise<string>;
  invalidate(): void;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export function createClientCredentialsTokenSource(opts: ClientCredentialsOptions): TokenSource {
  const now = opts.now ?? (() => new Date());
  let cached: { token: string; expiresAt: number } | null = null;
  return {
    async get() {
      if (cached && cached.expiresAt - 30_000 > now().getTime()) return cached.token;
      const form: Record<string, string | undefined> = { grant_type: "client_credentials", scope: opts.scope };
      const headers: Record<string, string> = {};
      if (opts.authStyle === "basic") headers.authorization = basicAuth(opts.clientId, opts.clientSecret);
      else {
        form.client_id = opts.clientId;
        form.client_secret = opts.clientSecret;
      }
      const res = await opts.http.json<TokenResponse>("POST", opts.tokenPath, { form, headers });
      cached = { token: res.access_token, expiresAt: now().getTime() + (res.expires_in ?? 600) * 1000 };
      return cached.token;
    },
    invalidate() {
      cached = null;
    },
  };
}
