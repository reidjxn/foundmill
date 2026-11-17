/**
 * Bearer-token verification for the api and the stream, one module (docs/ARCHITECTURE.md §13, docs/DECISIONS.md
 * "Development auth bypass"; WP-11 T13 moved it here from apps/api so the stream stops running an older copy). Imported
 * as `@foundmill/shared/auth-verifier`, never through the package's barrel, so it stays out of the browser bundle.
 *
 * - Supabase access tokens are verified with `jose` against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
 *   (ES256/RS256; the remote JWKS is cached by jose and refreshed on an unknown kid). `keepKeysFresh` fetches the keys
 *   at boot and every 5 minutes in the background, so no request waits for them: until 2026-10-15 the first request
 *   after every 10-minute gap fetched them itself (audit api-db F7).
 * - Projects still on the legacy HS256 secret are accepted when `SUPABASE_JWT_SECRET` is present.
 * - `DEV_AUTH_USER_ID` replaces verification only when `APP_ENV` is development or test (loadEnv already nulls it
 *   elsewhere); the id must be a UUID because it becomes the RLS `sub` claim. Under it a missing token or the literal
 *   `dev` is that user, and `dev:<uuid>` is the account it names (a second account for the Playwright stack, signed in
 *   by apps/web `/auth/dev?as=<uuid>`), handed to `onDevUser` first so a dev bootstrap can make sure it exists. Outside
 *   development and test there is no bypass: `dev` and `dev:<uuid>` are malformed tokens like any other. A process
 *   running with NODE_ENV=production has no bypass either, whatever APP_ENV says (CI boots the production image with
 *   APP_ENV=test and reads only `/health`).
 * - Every token must carry `exp` (`requiredClaims`); `AuthUser.expiresAt` is it, so a socket never outlives its token.
 */
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  userId: string;
  email: string | null;
  /**
   * When the user last signed in: the most recent `amr` timestamp of a sign-in method the product uses
   * (`SIGN_IN_METHODS`; never `token_refresh`, `password`, `anonymous` or a method it does not know), falling back to
   * `iat` only for a token with no `amr` claim at all. Permanent actions (BUILD §11.15 "re-auth") require it to be
   * recent. The development bypass counts as authenticated now.
   */
  authenticatedAt: Date | null;
  /**
   * The token shows its holder controls `email` (`emailConfirmedFromPayload`); false for an anonymous sign-in and a
   * token without an email, and absent counts as false. The allow-list trusts an address only when this is true (SEC2
   * S11). The development bypass counts as confirmed.
   */
  emailConfirmed?: boolean;
  /** When the token stops being valid (epoch ms; its `exp`). Null for the development bypass. */
  expiresAt?: number | null;
}

export interface AuthVerifier {
  /** Resolves the user for an Authorization header value (or null when anonymous / invalid). */
  resolve(authorization: string | null | undefined): Promise<AuthUser | null>;
  /** Verifies a raw token. Throws on an invalid token. */
  verify(token: string): Promise<AuthUser>;
  /**
   * Fetches Supabase's signing keys now and every `intervalMs` (default `JWKS_REFRESH_MS`) on an unref'd timer, so
   * requests find them cached. Nothing to do without SUPABASE_URL (or with an override that cannot reload). `stop()` in
   * the shutdown steps.
   */
  keepKeysFresh?(options?: { intervalMs?: number; onError?: (err: unknown) => void }): KeyRefresher;
  /** The development bypass user when the bypass is active, else null (each service logs a warning at boot). */
  readonly devUserId?: string | null;
}

export interface KeyRefresher {
  /** Resolves when the first fetch has finished: true when the keys were fetched. */
  readonly ready: Promise<boolean>;
  stop(): void;
}

/** How often the signing keys are fetched in the background: a revoked key stops being accepted within this long. */
export const JWKS_REFRESH_MS = 5 * 60_000;
/**
 * How long fetched keys are used before a request would fetch them itself (jose's `cacheMaxAge`, 10 minutes by
 * default). Three background fetches in a row must fail before that happens, and then a request fails closed as it
 * always did when Supabase cannot be reached.
 */
export const JWKS_CACHE_MAX_AGE_MS = 15 * 60_000;

/** jose's remote key set for a Supabase project: cached, reloaded on an unknown kid at most every 30 s. */
export function supabaseJwks(supabaseUrl: string, fetchImpl?: typeof fetch): JWTVerifyGetKey & { reload(): Promise<void> } {
  return createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl), { cooldownDuration: 30_000, cacheMaxAge: JWKS_CACHE_MAX_AGE_MS, ...(fetchImpl ? { [customFetch]: fetchImpl } : {}) });
}

export interface AuthVerifierOptions {
  supabaseUrl?: string | null;
  /** Legacy HS256 project secret; optional. */
  jwtSecret?: string | null;
  /** Development bypass; honoured only when `appEnv` is development or test and `nodeEnv` is not production. */
  devUserId?: string | null;
  appEnv: string;
  /** Default `process.env.NODE_ENV`. */
  nodeEnv?: string;
  /**
   * Development and test only: called with the account a `dev:<uuid>` token names before it resolves (the dev
   * bootstrap that creates the stub auth user on a local database). A failure is reported to `onDevUserError` and the
   * token still resolves: the request then meets whatever the database says about an unknown account.
   */
  onDevUser?: (userId: string) => Promise<void>;
  onDevUserError?: (err: unknown, userId: string) => void;
  /** Override the JWKS fetcher (tests). */
  jwks?: JWTVerifyGetKey;
  /** The `fetch` the remote JWKS uses (tests). */
  jwksFetch?: typeof fetch;
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

/** The development bearer's account: the literal `dev` → the dev user; `dev:<uuid>` → that account; else null. */
export function parseDevToken(token: string, devUserId: string): string | null {
  if (token === "dev") return devUserId;
  if (token.startsWith("dev:")) {
    const id = token.slice(4);
    return UUID_RE.test(id) ? id.toLowerCase() : null;
  }
  return null;
}

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m?.[1]?.trim() || null;
}

/**
 * Latest sign-in moment from the `amr` claim (`[{ method, timestamp }]`, unix seconds), counting only the sign-in
 * methods the product uses (`SIGN_IN_METHODS`). A refreshed token (`token_refresh`), a password, an anonymous sign-in
 * and any method this list does not know never make a session fresh: refreshing proves only that the browser kept its
 * refresh token. A token with an `amr` claim but no sign-in entry has no known sign-in moment (null); `iat` is used only
 * when the token carries no `amr` claim at all (Supabase always writes one; hand-made tokens may not).
 */
export function authenticatedAtFromPayload(payload: JWTPayload): Date | null {
  if (!Array.isArray(payload.amr)) return typeof payload.iat === "number" ? new Date(payload.iat * 1000) : null;
  let latest: number | null = null;
  for (const entry of payload.amr as unknown[]) {
    const { method, timestamp } = (entry ?? {}) as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !SIGN_IN_METHODS.has(method)) continue;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) latest = latest === null ? timestamp : Math.max(latest, timestamp);
  }
  return latest === null ? null : new Date(latest * 1000);
}

/**
 * Sign-in methods (`amr[].method`) that only work for someone who opened a link or code sent to the account's email:
 * a magic link, an email one-time code, the sign-up confirmation, an invite, a password recovery, an email change.
 * Supabase writes `otp` for an SMS code too; it counts only when the token also carries an email (a phone-only account
 * has none), which "Confirm email" keeps confirmed (docs/DEPLOY.md §4).
 */
const INBOX_PROVING_METHODS = new Set(["magiclink", "otp", "email/signup", "invite", "recovery", "email_change"]);

/**
 * The sign-in methods (`amr[].method`, Supabase Auth `models.AuthenticationMethod`) the product issues: the email link
 * and code family above, and `oauth` (Continue with Google). Not `password` (the product never issues password
 * sessions; a token that has nothing else is refused), not `token_refresh`, `anonymous`, MFA factors or SSO.
 */
export const SIGN_IN_METHODS: ReadonlySet<string> = new Set([...INBOX_PROVING_METHODS, "oauth"]);

/**
 * The identity providers a Google-proven session may carry in `app_metadata.providers`: Google itself, and the email
 * identity of an account that signed in by magic link before and was linked to Google by its verified address. Any
 * other provider on the account (another social sign-in, a phone) makes an `oauth` entry in `amr` ambiguous, since
 * Supabase does not say in `amr` which provider an `oauth` sign-in used; such a session is not trusted by this rule.
 */
const GOOGLE_SESSION_PROVIDERS = new Set(["google", "email"]);

function amrMethods(payload: JWTPayload): string[] {
  const amr = Array.isArray(payload.amr) ? (payload.amr as unknown[]) : [];
  return amr.map((entry) => String((entry as { method?: unknown })?.method ?? ""));
}

/**
 * A session proven by Google (Supabase's Google provider, web sign-in): `amr` has an `oauth` entry, the account's
 * providers (`app_metadata.providers`, falling back to `app_metadata.provider`) include `google` and nothing but
 * `google` and `email`, and the address is marked verified (`user_metadata.email_verified`).
 *
 * `amr` and `app_metadata` are written by Supabase Auth alone (a user cannot change their own `app_metadata`); they are
 * what proves the sign-in. `user_metadata.email_verified` is user-writable: any signed-in user can set it to true on
 * their own account with one `updateUser` call, so it protects nothing on its own. It is checked only so that a
 * Google account whose address Google did not verify is refused; it can make this rule refuse, never accept. What
 * actually keeps an unverified address out is Supabase's "Confirm email" (on, Supabase will not finish a Google
 * sign-in for an unverified address; off, it auto-confirms every address), so the api watches that setting and counts
 * no session as confirmed while it is off (services/confirm-email.ts, docs/DEPLOY.md §4).
 */
export function googleVerifiedFromPayload(payload: JWTPayload): boolean {
  if (!amrMethods(payload).includes("oauth")) return false;
  const app = payload.app_metadata && typeof payload.app_metadata === "object" ? (payload.app_metadata as { provider?: unknown; providers?: unknown }) : {};
  const providers = Array.isArray(app.providers) ? app.providers.map(String) : typeof app.provider === "string" ? [app.provider] : [];
  if (!providers.includes("google") || !providers.every((p) => GOOGLE_SESSION_PROVIDERS.has(p))) return false;
  const meta = payload.user_metadata && typeof payload.user_metadata === "object" ? (payload.user_metadata as { email_verified?: unknown }) : {};
  return meta.email_verified === true;
}

/**
 * Whether a Supabase access token shows its holder controls its `email` (SEC2 S11). Supabase access tokens carry no
 * `email_confirmed_at`; they carry `is_anonymous` and `amr`, how the session was authenticated. An anonymous sign-in
 * never counts; otherwise an inbox-proving sign-in does, and so does a Google sign-in (`googleVerifiedFromPayload`):
 * Google verified the address. `user_metadata.email_verified` alone is deliberately not trusted: a signed-in user can
 * write their own `user_metadata`, so a client could set it for an address it cannot read. `amr` is written by Supabase
 * Auth alone. The web signs in by magic link or with Google, so every real session carries a proof.
 */
export function emailConfirmedFromPayload(payload: JWTPayload): boolean {
  if (payload.is_anonymous === true) return false;
  if (typeof payload.email !== "string" || !payload.email.trim()) return false;
  if (amrMethods(payload).some((method) => INBOX_PROVING_METHODS.has(method))) return true;
  return googleVerifiedFromPayload(payload);
}

/**
 * A password session: `amr` names `password` and no sign-in method the product issues. The product never signs anyone
 * in with a password (the Email provider's password sign-up is off, docs/DEPLOY.md §4), so such a token came from
 * somewhere else and is refused like an invalid one. A password beside an email code, a link or Google follows the
 * normal rules (the other method is the proof).
 */
export function passwordOnlyFromPayload(payload: JWTPayload): boolean {
  const methods = amrMethods(payload);
  return methods.includes("password") && !methods.some((method) => SIGN_IN_METHODS.has(method));
}

function userFromPayload(payload: JWTPayload): AuthUser {
  const sub = payload.sub;
  if (!sub || !UUID_RE.test(sub)) throw new AuthError("token has no UUID subject");
  if (passwordOnlyFromPayload(payload)) throw new AuthError("password sessions are not accepted");
  const email = typeof payload.email === "string" ? payload.email : null;
  return { userId: sub, email, authenticatedAt: authenticatedAtFromPayload(payload), emailConfirmed: emailConfirmedFromPayload(payload), expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null };
}

export function createAuthVerifier(opts: AuthVerifierOptions): AuthVerifier {
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;
  const devBypass = opts.devUserId && (opts.appEnv === "development" || opts.appEnv === "test") && nodeEnv !== "production" ? opts.devUserId : null;
  if (devBypass && !UUID_RE.test(devBypass)) throw new Error("DEV_AUTH_USER_ID must be a UUID");

  let jwks: JWTVerifyGetKey | null = opts.jwks ?? null;
  const getJwks = (): JWTVerifyGetKey => {
    if (jwks) return jwks;
    if (!opts.supabaseUrl) throw new AuthError("SUPABASE_URL is not configured; cannot verify tokens");
    jwks = supabaseJwks(opts.supabaseUrl, opts.jwksFetch);
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
        const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"], audience, requiredClaims: ["exp"] });
        return userFromPayload(payload);
      }
      const { payload } = await jwtVerify(token, getJwks(), { audience, requiredClaims: ["exp"] });
      return userFromPayload(payload);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(`token verification failed: ${(err as Error).message}`);
    }
  };

  return {
    devUserId: devBypass,
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
    async resolve(authorization) {
      const token = bearerToken(authorization);
      if (!token) return devBypass ? { userId: devBypass, email: null, authenticatedAt: new Date(), emailConfirmed: true } : null;
      if (devBypass) {
        const dev = parseDevToken(token, devBypass);
        if (dev) {
          if (dev !== devBypass.toLowerCase() && opts.onDevUser) {
            try {
              await opts.onDevUser(dev);
            } catch (err) {
              opts.onDevUserError?.(err, dev);
            }
          }
          return { userId: dev, email: null, authenticatedAt: new Date(), emailConfirmed: true };
        }
      }
      try {
        return await verify(token);
      } catch {
        // In development/test a stale token must not lock the founder out of their own machine.
        return devBypass ? { userId: devBypass, email: null, authenticatedAt: new Date(), emailConfirmed: true } : null;
      }
    },
  };
}
