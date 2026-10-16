/**
 * Token verification for the upgrade and for refreshed tokens (docs/ARCHITECTURE.md §12, §13; docs/DECISIONS.md
 * "Development auth bypass"). The token arrives in the `foundmill.bearer.*` subprotocol, never in the URL (protocol.ts).
 *
 * - Supabase access tokens are verified with `jose` against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
 *   (ES256/RS256; jose caches the JWKS and refreshes it on an unknown kid). Audience must be `authenticated`, and
 *   the token must carry `exp`: it is when the server closes the socket (`AuthUser.expiresAt`). `keepKeysFresh`
 *   fetches the keys at boot and every 5 minutes in the background, so an upgrade never waits for them.
 * - Legacy HS256 project secrets are accepted when one is supplied (`jwtSecret`).
 * - When `DEV_AUTH_USER_ID` is set and `APP_ENV` is development/test: a missing token, the literal token `dev`, or
 *   `dev:<uuid>` (to impersonate another seeded user in Playwright) resolves without touching the network, and an
 *   invalid JWT falls back to the dev user so a stale local session never locks the founder out. Outside those
 *   environments `loadEnv` already nulls the variable, and this module nulls it again.
 */
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  userId: string;
  email: string | null;
  /** When the token stops being valid (epoch ms; its `exp`), so a socket never outlives it. Null for dev tokens. */
  expiresAt: number | null;
}

export interface TokenVerifier {
  /** Resolves the user for a token; null when anonymous or invalid. */
  resolve(token: string | null | undefined): Promise<AuthUser | null>;
  /** Verifies a JWT; throws `StreamAuthError` on failure. */
  verify(token: string): Promise<AuthUser>;
  readonly devUserId: string | null;
  /**
   * Fetches Supabase's signing keys now and every `intervalMs` (default `JWKS_REFRESH_MS`) on an unref'd timer, so an
   * upgrade finds them cached. Nothing to do without SUPABASE_URL (or with an override that cannot reload).
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
 * How long fetched keys are used before an upgrade would fetch them itself (jose's `cacheMaxAge`, 10 minutes by
 * default): three background fetches in a row must fail first, and then verification fails closed as it always did.
 */
export const JWKS_CACHE_MAX_AGE_MS = 15 * 60_000;

/** jose's remote key set for a Supabase project: cached, reloaded on an unknown kid at most every 30 s. */
export function supabaseJwks(supabaseUrl: string, fetchImpl?: typeof fetch): JWTVerifyGetKey & { reload(): Promise<void> } {
  return createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl), { cooldownDuration: 30_000, cacheMaxAge: JWKS_CACHE_MAX_AGE_MS, ...(fetchImpl ? { [customFetch]: fetchImpl } : {}) });
}

export interface TokenVerifierOptions {
  supabaseUrl?: string | null;
  jwtSecret?: string | null;
  devUserId?: string | null;
  appEnv: string;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
  /** The `fetch` the remote JWKS uses (tests). */
  jwksFetch?: typeof fetch;
  hsKey?: Uint8Array;
  audience?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StreamAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamAuthError";
  }
}

function userFromPayload(payload: JWTPayload): AuthUser {
  const sub = payload.sub;
  if (!sub || !UUID_RE.test(sub)) throw new StreamAuthError("token has no UUID subject");
  return { userId: sub, email: typeof payload.email === "string" ? payload.email : null, expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null };
}

/** `dev` → the configured dev user; `dev:<uuid>` → that user. Null when the token is not a dev token. */
export function parseDevToken(token: string, devUserId: string): string | null {
  if (token === "dev") return devUserId;
  if (token.startsWith("dev:")) {
    const id = token.slice(4);
    return UUID_RE.test(id) ? id : null;
  }
  return null;
}

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const devUserId = opts.devUserId && (opts.appEnv === "development" || opts.appEnv === "test") ? opts.devUserId : null;
  if (devUserId && !UUID_RE.test(devUserId)) throw new Error("DEV_AUTH_USER_ID must be a UUID");
  const audience = opts.audience ?? "authenticated";

  let jwks: JWTVerifyGetKey | null = opts.jwks ?? null;
  const getJwks = (): JWTVerifyGetKey => {
    if (jwks) return jwks;
    if (!opts.supabaseUrl) throw new StreamAuthError("SUPABASE_URL is not configured; cannot verify tokens");
    jwks = supabaseJwks(opts.supabaseUrl, opts.jwksFetch);
    return jwks;
  };
  const hsKey = opts.hsKey ?? (opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null);

  const verify = async (token: string): Promise<AuthUser> => {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      throw new StreamAuthError("malformed token");
    }
    try {
      if (alg === "HS256") {
        if (!hsKey) throw new StreamAuthError("HS256 token but no JWT secret is configured");
        const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"], audience, requiredClaims: ["exp"] });
        return userFromPayload(payload);
      }
      const { payload } = await jwtVerify(token, getJwks(), { audience, requiredClaims: ["exp"] });
      return userFromPayload(payload);
    } catch (err) {
      if (err instanceof StreamAuthError) throw err;
      throw new StreamAuthError(`token verification failed: ${(err as Error).message}`);
    }
  };

  return {
    devUserId,
    verify,
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
    async resolve(token) {
      const t = token?.trim() || null;
      if (!t) return devUserId ? { userId: devUserId, email: null, expiresAt: null } : null;
      if (devUserId) {
        const dev = parseDevToken(t, devUserId);
        if (dev) return { userId: dev, email: null, expiresAt: null };
      }
      try {
        return await verify(t);
      } catch {
        return devUserId ? { userId: devUserId, email: null, expiresAt: null } : null;
      }
    },
  };
}
