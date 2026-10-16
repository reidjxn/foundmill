/**
 * Token verification for the collab server (docs/ARCHITECTURE.md §13 JWT rules, §9 service tokens).
 *
 * Three token kinds are accepted on `onAuthenticate` (the Hocuspocus provider sends the token in its first
 * message) and on the HTTP agent-edit endpoint (Bearer):
 *
 *  - **Supabase access tokens** (ES256/RS256 against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, or legacy
 *    HS256 with the project JWT secret), audience `authenticated` → a `user` principal. `keepKeysFresh` fetches the
 *    keys at boot and every 5 minutes in the background, so no connection waits for them.
 *  - **Collab service tokens** (HS256 with `SESSION_TOKEN_SECRET`, audience `foundmill-collab/service`) minted by
 *    the orchestrator for one agent session → an `agent` principal bound to one business. Agents therefore edit
 *    through the same server and the same CRDT as humans (BUILD §11.5), never through the database directly.
 *  - **Dev tokens** (`dev`, `dev:<uuid>`) only when `DEV_AUTH_USER_ID` is set and `APP_ENV` is development/test
 *    (docs/DECISIONS.md "Development auth bypass").
 */
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { isGuid } from "./document-name";

export const COLLAB_SERVICE_AUDIENCE = "foundmill-collab/service" as const;
export const SUPABASE_AUDIENCE = "authenticated" as const;

export type Principal =
  | { kind: "user"; userId: string; email: string | null }
  | { kind: "agent"; agentId: string; businessId: string; sessionId: string | null; service: string };

export class CollabAuthError extends Error {
  /** Sent to the provider as the permission-denied reason. */
  readonly reason: string;
  constructor(message: string, reason = "permission-denied") {
    super(message);
    this.name = "CollabAuthError";
    this.reason = reason;
  }
}

export interface CollabAuthenticator {
  /** Verifies a token and returns who is connecting; throws `CollabAuthError`. */
  verify(token: string | null | undefined): Promise<Principal>;
  readonly devUserId: string | null;
  /**
   * Fetches Supabase's signing keys now and every `intervalMs` (default `JWKS_REFRESH_MS`) on an unref'd timer, so a
   * connection finds them cached. Nothing to do without SUPABASE_URL (or with an override that cannot reload).
   */
  keepKeysFresh?(options?: { intervalMs?: number; onError?: (err: unknown) => void }): KeyRefresher;
}

export interface KeyRefresher {
  /** Resolves when the first fetch has finished: true when the keys were fetched. */
  readonly ready: Promise<boolean>;
  stop(): void;
}

/** How often the signing keys are fetched in the background: a revoked key stops being accepted within this long. */
export const JWKS_REFRESH_MS = 5 * 60_000;
/**
 * How long fetched keys are used before a connection would fetch them itself (jose's `cacheMaxAge`, 10 minutes by
 * default): three background fetches in a row must fail first, and then verification fails closed as it always did.
 */
export const JWKS_CACHE_MAX_AGE_MS = 15 * 60_000;

/** jose's remote key set for a Supabase project: cached, reloaded on an unknown kid at most every 30 s. */
export function supabaseJwks(supabaseUrl: string, fetchImpl?: typeof fetch): JWTVerifyGetKey & { reload(): Promise<void> } {
  return createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl), { cooldownDuration: 30_000, cacheMaxAge: JWKS_CACHE_MAX_AGE_MS, ...(fetchImpl ? { [customFetch]: fetchImpl } : {}) });
}

export interface CollabAuthenticatorOptions {
  appEnv: string;
  supabaseUrl?: string | null;
  /** Legacy Supabase HS256 project secret. */
  jwtSecret?: string | null;
  /** `SESSION_TOKEN_SECRET`: signs the agent service tokens. Without it no agent can connect. */
  serviceSecret?: string | null;
  devUserId?: string | null;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
  /** The `fetch` the remote JWKS uses (tests). */
  jwksFetch?: typeof fetch;
  now?: () => Date;
}

const encoder = new TextEncoder();

function userFromPayload(payload: JWTPayload): Principal {
  const sub = payload.sub;
  if (!sub || !isGuid(sub)) throw new CollabAuthError("token has no UUID subject");
  return { kind: "user", userId: sub.toLowerCase(), email: typeof payload.email === "string" ? payload.email : null };
}

function agentFromPayload(payload: JWTPayload): Principal {
  const businessId = payload.businessId;
  const agentId = payload.agentId;
  if (typeof businessId !== "string" || !isGuid(businessId)) throw new CollabAuthError("service token has no businessId");
  if (typeof agentId !== "string" || !isGuid(agentId)) throw new CollabAuthError("service token has no agentId");
  const sessionId = typeof payload.sessionId === "string" && isGuid(payload.sessionId) ? payload.sessionId.toLowerCase() : null;
  const service = typeof payload.svc === "string" && payload.svc ? payload.svc : "orchestrator";
  return { kind: "agent", agentId: agentId.toLowerCase(), businessId: businessId.toLowerCase(), sessionId, service };
}

/** `dev` → the configured dev user; `dev:<uuid>` → that user. Null when the token is not a dev token. */
export function parseDevToken(token: string, devUserId: string): string | null {
  if (token === "dev") return devUserId;
  if (token.startsWith("dev:")) {
    const id = token.slice(4);
    return isGuid(id) ? id.toLowerCase() : null;
  }
  return null;
}

export interface MintServiceTokenInput {
  secret: string;
  businessId: string;
  agentId: string;
  sessionId?: string | null;
  /** Calling service (`svc` claim); defaults to "orchestrator". */
  service?: string;
  ttlSeconds?: number;
  now?: () => Date;
}

/** Mints the HS256 service token an agent session presents to the collab server. */
export async function mintCollabServiceToken(input: MintServiceTokenInput): Promise<string> {
  if (!input.secret) throw new Error("mintCollabServiceToken: secret is required");
  if (!isGuid(input.businessId) || !isGuid(input.agentId)) throw new Error("mintCollabServiceToken: businessId and agentId must be UUIDs");
  const now = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
  const ttl = Math.max(1, Math.floor(input.ttlSeconds ?? 3600));
  return new SignJWT({ businessId: input.businessId, agentId: input.agentId, sessionId: input.sessionId ?? null, svc: input.service ?? "orchestrator" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience(COLLAB_SERVICE_AUDIENCE)
    .setSubject(`agent:${input.agentId}`)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(encoder.encode(input.secret));
}

export function createCollabAuthenticator(opts: CollabAuthenticatorOptions): CollabAuthenticator {
  const devUserId = opts.devUserId && (opts.appEnv === "development" || opts.appEnv === "test") ? opts.devUserId : null;
  if (devUserId && !isGuid(devUserId)) throw new Error("DEV_AUTH_USER_ID must be a UUID");
  const hsKey = opts.jwtSecret ? encoder.encode(opts.jwtSecret) : null;
  const serviceKey = opts.serviceSecret ? encoder.encode(opts.serviceSecret) : null;
  const currentDate = opts.now ? () => opts.now!() : undefined;

  let jwks: JWTVerifyGetKey | null = opts.jwks ?? null;
  const getJwks = (): JWTVerifyGetKey => {
    if (jwks) return jwks;
    if (!opts.supabaseUrl) throw new CollabAuthError("SUPABASE_URL is not configured; cannot verify tokens", "auth-unavailable");
    jwks = supabaseJwks(opts.supabaseUrl, opts.jwksFetch);
    return jwks;
  };

  const verifyJwt = async (token: string): Promise<Principal> => {
    let alg: string | undefined;
    let aud: JWTPayload["aud"];
    try {
      alg = decodeProtectedHeader(token).alg;
      aud = decodeJwt(token).aud;
    } catch {
      throw new CollabAuthError("malformed token");
    }
    const audiences = Array.isArray(aud) ? aud : aud ? [aud] : [];
    try {
      if (audiences.includes(COLLAB_SERVICE_AUDIENCE)) {
        if (!serviceKey) throw new CollabAuthError("service token but SESSION_TOKEN_SECRET is not configured", "auth-unavailable");
        const { payload } = await jwtVerify(token, serviceKey, { algorithms: ["HS256"], audience: COLLAB_SERVICE_AUDIENCE, currentDate: currentDate?.() });
        return agentFromPayload(payload);
      }
      if (alg === "HS256") {
        if (!hsKey) throw new CollabAuthError("HS256 token but no JWT secret is configured", "auth-unavailable");
        const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"], audience: SUPABASE_AUDIENCE, currentDate: currentDate?.() });
        return userFromPayload(payload);
      }
      const { payload } = await jwtVerify(token, getJwks(), { audience: SUPABASE_AUDIENCE, currentDate: currentDate?.() });
      return userFromPayload(payload);
    } catch (err) {
      if (err instanceof CollabAuthError) throw err;
      throw new CollabAuthError(`token verification failed: ${(err as Error).message}`);
    }
  };

  return {
    devUserId,
    keepKeysFresh(options = {}) {
      const keys = opts.jwks ?? (opts.supabaseUrl ? getJwks() : null);
      const reload = (keys as Partial<{ reload(): Promise<void> }> | null)?.reload;
      if (typeof reload !== "function") return { ready: Promise.resolve(false), stop: () => undefined };
      const refresh = () =>
        reload.call(keys).then(
          () => true,
          (err: unknown) => {
            options.onError?.(err);
            return false;
          },
        );
      const ready = refresh();
      const timer = setInterval(() => void refresh(), options.intervalMs ?? JWKS_REFRESH_MS);
      timer.unref?.();
      return { ready, stop: () => clearInterval(timer) };
    },
    async verify(token) {
      const t = token?.trim() || null;
      if (!t) {
        if (devUserId) return { kind: "user", userId: devUserId, email: null };
        throw new CollabAuthError("missing token");
      }
      if (devUserId) {
        const dev = parseDevToken(t, devUserId);
        if (dev) return { kind: "user", userId: dev, email: null };
      }
      return verifyJwt(t);
    },
  };
}
