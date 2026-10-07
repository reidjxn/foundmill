/**
 * Bearer-token verification (docs/ARCHITECTURE.md §13, docs/DECISIONS.md "Development auth bypass").
 *
 * - Supabase access tokens are verified with `jose` against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
 *   (ES256/RS256; the remote JWKS is cached by jose and refreshed on an unknown kid).
 * - Projects still on the legacy HS256 secret are accepted when `SUPABASE_JWT_SECRET` is present.
 * - `DEV_AUTH_USER_ID` replaces verification only when `APP_ENV` is development or test (loadEnv already nulls it
 *   elsewhere); the id must be a UUID because it becomes the RLS `sub` claim.
 */
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  userId: string;
  email: string | null;
  /**
   * When the user last authenticated: the most recent `amr` timestamp Supabase stamps on the token (password, otp,
   * oauth, mfa...), falling back to `iat`. Permanent actions (BUILD §11.15 "re-auth") require it to be recent.
   * The development bypass counts as authenticated now.
   */
  authenticatedAt: Date | null;
}

export interface AuthVerifier {
  /** Resolves the user for an Authorization header value (or null when anonymous / invalid). */
  resolve(authorization: string | null | undefined): Promise<AuthUser | null>;
  /** Verifies a raw token. Throws on an invalid token. */
  verify(token: string): Promise<AuthUser>;
}

export interface AuthVerifierOptions {
  supabaseUrl?: string | null;
  /** Legacy HS256 project secret; optional. */
  jwtSecret?: string | null;
  /** Development bypass; honoured only when `appEnv` is development or test. */
  devUserId?: string | null;
  appEnv: string;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
  /** Override the HS256 key (tests). */
  hsKey?: Uint8Array;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m?.[1]?.trim() || null;
}

/** Latest authentication moment from the `amr` claim (`[{ method, timestamp }]`, unix seconds), else `iat`. */
export function authenticatedAtFromPayload(payload: JWTPayload): Date | null {
  const amr = Array.isArray(payload.amr) ? (payload.amr as unknown[]) : [];
  let latest: number | null = null;
  for (const entry of amr) {
    const ts = (entry as { timestamp?: unknown })?.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts)) latest = latest === null ? ts : Math.max(latest, ts);
  }
  const seconds = latest ?? (typeof payload.iat === "number" ? payload.iat : null);
  return seconds === null ? null : new Date(seconds * 1000);
}

function userFromPayload(payload: JWTPayload): AuthUser {
  const sub = payload.sub;
  if (!sub || !UUID_RE.test(sub)) throw new AuthError("token has no UUID subject");
  const email = typeof payload.email === "string" ? payload.email : null;
  return { userId: sub, email, authenticatedAt: authenticatedAtFromPayload(payload) };
}

export function createAuthVerifier(opts: AuthVerifierOptions): AuthVerifier {
  const devBypass = opts.devUserId && (opts.appEnv === "development" || opts.appEnv === "test") ? opts.devUserId : null;
  if (devBypass && !UUID_RE.test(devBypass)) throw new Error("DEV_AUTH_USER_ID must be a UUID");

  let jwks: JWTVerifyGetKey | null = opts.jwks ?? null;
  const getJwks = (): JWTVerifyGetKey => {
    if (jwks) return jwks;
    if (!opts.supabaseUrl) throw new AuthError("SUPABASE_URL is not configured; cannot verify tokens");
    jwks = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", opts.supabaseUrl), { cooldownDuration: 30_000 });
    return jwks;
  };
  const hsKey = opts.hsKey ?? (opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null);

  const verify = async (token: string): Promise<AuthUser> => {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      throw new AuthError("malformed token");
    }
    const audience = "authenticated";
    try {
      if (alg === "HS256") {
        if (!hsKey) throw new AuthError("HS256 token but SUPABASE_JWT_SECRET is not configured");
        const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"], audience });
        return userFromPayload(payload);
      }
      const { payload } = await jwtVerify(token, getJwks(), { audience });
      return userFromPayload(payload);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(`token verification failed: ${(err as Error).message}`);
    }
  };

  return {
    verify,
    async resolve(authorization) {
      const token = bearerToken(authorization);
      if (!token) return devBypass ? { userId: devBypass, email: null, authenticatedAt: new Date() } : null;
      try {
        return await verify(token);
      } catch {
        // In development/test a stale token must not lock the founder out of their own machine.
        return devBypass ? { userId: devBypass, email: null, authenticatedAt: new Date() } : null;
      }
    },
  };
}
