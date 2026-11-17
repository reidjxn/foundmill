/**
 * Token verification for the upgrade and for refreshed tokens, through the api's own verifier
 * (`@foundmill/shared/auth-verifier`, WP-11 T13): password-only sessions are refused and `emailConfirmed` is computed, so
 * the admission check applies the confirmed-address rule. This file keeps the stream's shape: a raw token (from the
 * subprotocol, not an Authorization header), `expiresAt` always present, and `StreamAuthError`.
 *
 * Before T13 this was an older copy of the api's module (docs/ARCHITECTURE.md §12, §13; docs/DECISIONS.md
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
import { createAuthVerifier, AuthError, JWKS_CACHE_MAX_AGE_MS, JWKS_REFRESH_MS, parseDevToken, supabaseJwks, type AuthUser as SharedAuthUser, type KeyRefresher } from "@foundmill/shared/auth-verifier";
import type { JWTVerifyGetKey } from "jose";

export { JWKS_CACHE_MAX_AGE_MS, JWKS_REFRESH_MS, parseDevToken, supabaseJwks, type KeyRefresher };

export interface AuthUser {
  userId: string;
  email: string | null;
  /** When the token stops being valid (epoch ms; its `exp`), so a socket never outlives it. Null for dev tokens. */
  expiresAt: number | null;
  /** The token shows its holder controls `email`; the admission check trusts a listed address only then. */
  emailConfirmed: boolean;
}

export interface TokenVerifier {
  /** Resolves the user for a token; null when anonymous or invalid. */
  resolve(token: string | null | undefined): Promise<AuthUser | null>;
  /** Verifies a JWT; throws `StreamAuthError` on failure. */
  verify(token: string): Promise<AuthUser>;
  readonly devUserId: string | null;
  /** Fetches Supabase's signing keys now and every `intervalMs` (default `JWKS_REFRESH_MS`) on an unref'd timer. */
  keepKeysFresh?(options?: { intervalMs?: number; onError?: (err: unknown) => void }): KeyRefresher;
}

export interface TokenVerifierOptions {
  supabaseUrl?: string | null;
  jwtSecret?: string | null;
  devUserId?: string | null;
  appEnv: string;
  /** Default `process.env.NODE_ENV`: a production process has no development bypass. */
  nodeEnv?: string;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
  /** The `fetch` the remote JWKS uses (tests). */
  jwksFetch?: typeof fetch;
  hsKey?: Uint8Array;
}

export class StreamAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamAuthError";
  }
}

const toStreamUser = (u: SharedAuthUser): AuthUser => ({ userId: u.userId, email: u.email, expiresAt: u.expiresAt ?? null, emailConfirmed: u.emailConfirmed === true });

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const inner = createAuthVerifier(opts);
  return {
    devUserId: inner.devUserId ?? null,
    async verify(token) {
      try {
        return toStreamUser(await inner.verify(token));
      } catch (err) {
        if (err instanceof AuthError) throw new StreamAuthError(err.message);
        throw err;
      }
    },
    ...(inner.keepKeysFresh ? { keepKeysFresh: inner.keepKeysFresh.bind(inner) } : {}),
    async resolve(token) {
      const t = token?.trim() || null;
      const user = await inner.resolve(t ? `Bearer ${t}` : null);
      return user ? toStreamUser(user) : null;
    },
  };
}
