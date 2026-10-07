/**
 * Query-string token verification (docs/ARCHITECTURE.md §12, §13; docs/DECISIONS.md "Development auth bypass").
 *
 * - Supabase access tokens are verified with `jose` against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
 *   (ES256/RS256; jose caches the JWKS and refreshes it on an unknown kid). Audience must be `authenticated`.
 * - Legacy HS256 project secrets are accepted when one is supplied (`jwtSecret`).
 * - When `DEV_AUTH_USER_ID` is set and `APP_ENV` is development/test: a missing token, the literal token `dev`, or
 *   `dev:<uuid>` (to impersonate another seeded user in Playwright) resolves without touching the network, and an
 *   invalid JWT falls back to the dev user so a stale local session never locks the founder out. Outside those
 *   environments `loadEnv` already nulls the variable, and this module nulls it again.
 */
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  userId: string;
  email: string | null;
}

export interface TokenVerifier {
  /** Resolves the user for a `?token=` value; null when anonymous or invalid. */
  resolve(token: string | null | undefined): Promise<AuthUser | null>;
  /** Verifies a JWT; throws `StreamAuthError` on failure. */
  verify(token: string): Promise<AuthUser>;
  readonly devUserId: string | null;
}

export interface TokenVerifierOptions {
  supabaseUrl?: string | null;
  jwtSecret?: string | null;
  devUserId?: string | null;
  appEnv: string;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
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
  return { userId: sub, email: typeof payload.email === "string" ? payload.email : null };
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
    jwks = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", opts.supabaseUrl), { cooldownDuration: 30_000 });
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
        const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"], audience });
        return userFromPayload(payload);
      }
      const { payload } = await jwtVerify(token, getJwks(), { audience });
      return userFromPayload(payload);
    } catch (err) {
      if (err instanceof StreamAuthError) throw err;
      throw new StreamAuthError(`token verification failed: ${(err as Error).message}`);
    }
  };

  return {
    devUserId,
    verify,
    async resolve(token) {
      const t = token?.trim() || null;
      if (!t) return devUserId ? { userId: devUserId, email: null } : null;
      if (devUserId) {
        const dev = parseDevToken(t, devUserId);
        if (dev) return { userId: dev, email: null };
      }
      try {
        return await verify(t);
      } catch {
        return devUserId ? { userId: devUserId, email: null } : null;
      }
    },
  };
}
