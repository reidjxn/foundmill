/**
 * Before Google sign-in is switched on (security review, Nov 12):
 * 1. Fail closed while Supabase auto-confirms addresses ("Confirm email" off, `mailer_autoconfirm: true` in its auth
 *    settings): no session counts as a confirmed address, so SIGNUP_ALLOWLIST admits nobody (services/confirm-email.ts).
 * 2. A password-only session is refused like an invalid token (auth.ts `passwordOnlyFromPayload`).
 * 3. A fresh sign-in counts only the sign-in methods the product issues (auth.ts `authenticatedAtFromPayload`).
 */
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv, resetEnvCache } from "@foundmill/shared";
import { createApp } from "../app";
import { authenticatedAtFromPayload, createAuthVerifier, passwordOnlyFromPayload, SIGN_IN_METHODS } from "../auth";
import { createApiDeps } from "../context";
import { EMAIL_UNCONFIRMED_MESSAGE } from "../services/access";
import { CONFIRM_EMAIL_REFRESH_MS, createConfirmEmailGuard } from "../services/confirm-email";
import { silentLog } from "../services/log";
import { createApiHarness, type ApiHarness } from "./harness";

const SUPABASE_URL = "https://project.supabase.test";
const ANON = "anon-key-for-tests";
const now = () => Math.floor(Date.now() / 1000);

/** Supabase Auth's `GET /auth/v1/settings`: answers `body`, or fails while `down`; records every request. */
function settingsEndpoint(initial: Record<string, unknown> | null = { mailer_autoconfirm: false, external: { email: true, google: true } }) {
  const state = { body: initial, status: 200, down: false, requests: [] as { url: string; apikey: string | null }[] };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    state.requests.push({ url: String(url), apikey: new Headers(init?.headers).get("apikey") });
    if (state.down) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(state.body), { status: state.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { state, fetchImpl };
}

function spyLog() {
  const lines = { error: [] as string[], warn: [] as string[], info: [] as string[] };
  return {
    lines,
    log: {
      error: (_o: unknown, msg?: string) => void lines.error.push(String(msg)),
      warn: (_o: unknown, msg?: string) => void lines.warn.push(String(msg)),
      info: (_o: unknown, msg?: string) => void lines.info.push(String(msg)),
    } as unknown as Parameters<typeof createConfirmEmailGuard>[0]["log"],
  };
}

afterEach(() => vi.useRealTimers());

describe("1. Supabase auto-confirming addresses fails closed", () => {
  it("reads mailer_autoconfirm with the anon key; on → one error and no session trusted; off again → trusted", async () => {
    const { state, fetchImpl } = settingsEndpoint();
    const { lines, log } = spyLog();
    const guard = createConfirmEmailGuard({ supabaseUrl: SUPABASE_URL, anonKey: ANON, log, fetchImpl });
    expect(guard.state()).toBe("unknown");
    expect(guard.confirmationTrusted()).toBe(true);

    expect(await guard.refresh()).toBe("off");
    expect(state.requests).toEqual([{ url: `${SUPABASE_URL}/auth/v1/settings`, apikey: ANON }]);
    expect(guard.confirmationTrusted()).toBe(true);

    state.body = { mailer_autoconfirm: true };
    expect(await guard.refresh()).toBe("on");
    expect(guard.confirmationTrusted()).toBe(false);
    await guard.refresh();
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).toMatch(/Confirm email/);

    state.body = { mailer_autoconfirm: false };
    expect(await guard.refresh()).toBe("off");
    expect(guard.confirmationTrusted()).toBe(true);
    expect(lines.info).toHaveLength(1);
  });

  it("an unreadable answer keeps the last known value with a warning: unknown stays unknown, on stays on", async () => {
    const { state, fetchImpl } = settingsEndpoint();
    const { lines, log } = spyLog();
    const guard = createConfirmEmailGuard({ supabaseUrl: SUPABASE_URL, anonKey: ANON, log, fetchImpl });
    state.down = true;
    expect(await guard.refresh()).toBe("unknown");
    expect(guard.confirmationTrusted()).toBe(true);

    state.down = false;
    state.body = { mailer_autoconfirm: true };
    await guard.refresh();
    for (const fail of [() => (state.down = true), () => ((state.down = false), (state.status = 500)), () => ((state.status = 200), (state.body = { external: {} })), () => (state.body = { mailer_autoconfirm: "false" })]) {
      fail();
      expect(await guard.refresh()).toBe("on");
      expect(guard.confirmationTrusted()).toBe(false);
    }
    expect(lines.warn).toHaveLength(5);
    expect(lines.error).toHaveLength(1);
  });

  it("without the anon key nothing is fetched and the state stays unknown (token-only, as before), with a warning", async () => {
    const { state, fetchImpl } = settingsEndpoint({ mailer_autoconfirm: true });
    const { lines, log } = spyLog();
    const guard = createConfirmEmailGuard({ supabaseUrl: SUPABASE_URL, anonKey: undefined, log, fetchImpl });
    expect(await guard.refresh()).toBe("unknown");
    expect(state.requests).toHaveLength(0);
    expect(lines.warn[0]).toMatch(/keeping the last known value/);
  });

  it("start() reads at once without blocking and again every 10 minutes until stopped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { state, fetchImpl } = settingsEndpoint();
    let resolveFirst: (() => void) | null = null;
    const slow = (async (url: string | URL, init?: RequestInit) => {
      if (!resolveFirst) await new Promise<void>((resolve) => (resolveFirst = resolve));
      return fetchImpl(url, init);
    }) as typeof fetch;
    const guard = createConfirmEmailGuard({ supabaseUrl: SUPABASE_URL, anonKey: ANON, log: spyLog().log, fetchImpl: slow });
    const run = guard.start();
    // Boot carries on while the first read is pending.
    expect(guard.state()).toBe("unknown");
    resolveFirst!();
    expect(await run.ready).toBe("off");
    state.body = { mailer_autoconfirm: true };
    await vi.advanceTimersByTimeAsync(CONFIRM_EMAIL_REFRESH_MS);
    expect(state.requests).toHaveLength(2);
    expect(guard.state()).toBe("on");
    run.stop();
    await vi.advanceTimersByTimeAsync(3 * CONFIRM_EMAIL_REFRESH_MS);
    expect(state.requests).toHaveLength(2);
  });

  it("createApiDeps watches the setting only while SIGNUP_ALLOWLIST is set (and SUPABASE_URL is known)", () => {
    resetEnvCache();
    const base = { APP_ENV: "test", LOG_LEVEL: "silent", SUPABASE_URL, SUPABASE_ANON_KEY: ANON, DEV_AUTH_USER_ID: undefined, DATABASE_URL: undefined };
    const build = (extra: Record<string, string | undefined>) => createApiDeps({ env: loadEnv({ ...base, ...extra }), db: {} as never, redis: null, log: silentLog(), recordings: null });
    expect(build({ SIGNUP_ALLOWLIST: "founder@example.test" }).confirmEmail).not.toBeNull();
    expect(build({ SIGNUP_ALLOWLIST: undefined }).confirmEmail).toBeNull();
    expect(build({ SIGNUP_ALLOWLIST: "founder@example.test", SUPABASE_URL: undefined }).confirmEmail).toBeNull();
    resetEnvCache();
  });

  describe("over HTTP", () => {
    let hz: ApiHarness;
    beforeAll(async () => {
      hz = await createApiHarness({ prefix: "confirm-email" });
    }, 120_000);
    afterAll(() => hz.close());
    const secret = new TextEncoder().encode("confirm-email-test-jwt-secret-0123456789");
    const sign = (claims: Record<string, unknown>, sub: string) => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret);

    it("a listed, confirmed member is refused (email_unconfirmed) while Supabase auto-confirms, and admitted once it stops", async () => {
      const { state, fetchImpl } = settingsEndpoint();
      const confirmEmail = createConfirmEmailGuard({ supabaseUrl: SUPABASE_URL, anonKey: ANON, log: spyLog().log, fetchImpl });
      const app = createApp({ ...hz.deps, confirmEmail, auth: createAuthVerifier({ appEnv: "production", hsKey: secret }), env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "listed@confirm-email.test" } });
      const userId = await hz.h.createUser("listed@confirm-email.test");
      const call = async (claims: Record<string, unknown>) => {
        const res = await app.request("/trpc/founder.profile.get", { headers: { authorization: `Bearer ${await sign(claims, userId)}` } });
        const body = (await res.json()) as { error?: { json: { message: string; data: { appCode?: string; details?: { reason?: string } } } } };
        return { status: res.status, message: body.error?.json.message, appCode: body.error?.json.data.appCode, reason: body.error?.json.data.details?.reason };
      };
      const magicLink = { email: "listed@confirm-email.test", amr: [{ method: "magiclink", timestamp: now() }] };
      const google = { email: "listed@confirm-email.test", amr: [{ method: "oauth", timestamp: now() }], app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { email_verified: true } };

      // Never read yet ("unknown"): the tokens decide, as before.
      expect((await call(magicLink)).status).toBe(200);
      await confirmEmail.refresh();
      expect((await call(google)).status).toBe(200);

      state.body = { mailer_autoconfirm: true };
      await confirmEmail.refresh();
      const refused = { status: 403, message: EMAIL_UNCONFIRMED_MESSAGE, appCode: "not_invited", reason: "email_unconfirmed" };
      expect(await call(magicLink)).toEqual(refused);
      expect(await call(google)).toEqual(refused);

      // Supabase cannot be reached: the last known value (on) stays.
      state.down = true;
      await confirmEmail.refresh();
      expect(await call(magicLink)).toEqual(refused);

      state.down = false;
      state.body = { mailer_autoconfirm: false };
      await confirmEmail.refresh();
      expect((await call(magicLink)).status).toBe(200);
    });

    it("2. a password-only session is unauthorized; a password beside an email code or Google follows the normal rules", async () => {
      const app = createApp({ ...hz.deps, auth: createAuthVerifier({ appEnv: "production", hsKey: secret }), env: { ...hz.deps.env, SIGNUP_ALLOWLIST: undefined } });
      const userId = await hz.h.createUser("password@confirm-email.test");
      const status = async (claims: Record<string, unknown>) => (await app.request("/trpc/founder.profile.get", { headers: { authorization: `Bearer ${await sign(claims, userId)}` } })).status;
      const email = "password@confirm-email.test";
      expect(await status({ email, amr: [{ method: "password", timestamp: now() }] })).toBe(401);
      expect(await status({ email, amr: [{ method: "password", timestamp: now() }, { method: "otp", timestamp: now() }] })).toBe(200);
    });
  });
});

describe("2. password sessions are refused", () => {
  const secret = new TextEncoder().encode("password-session-test-jwt-secret-012345");
  const USER = "11111111-2222-4333-8444-555555555555";
  const auth = createAuthVerifier({ appEnv: "production", hsKey: secret });
  const verify = async (claims: Record<string, unknown>) => auth.verify(await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(USER).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret));
  const at = (method: string, timestamp = now()) => ({ method, timestamp });

  it("refuses a token whose only sign-in method is a password (with a refresh, an MFA factor or an anonymous entry beside it too)", async () => {
    for (const amr of [[at("password")], [at("password"), at("token_refresh")], [at("password"), at("totp")], [at("password"), at("anonymous")]]) {
      expect(passwordOnlyFromPayload({ amr }), JSON.stringify(amr)).toBe(true);
      await expect(verify({ email: "a@x.test", amr })).rejects.toThrow(/password sessions are not accepted/);
    }
    // resolve() reads it as anonymous: the existing UNAUTHORIZED path.
    const token = await new SignJWT({ email: "a@x.test", amr: [at("password")] }).setProtectedHeader({ alg: "HS256" }).setSubject(USER).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret);
    expect(await auth.resolve(`Bearer ${token}`)).toBeNull();
  });

  it("a password beside an email code, a magic link or Google follows the normal rules", async () => {
    expect(await verify({ email: "a@x.test", amr: [at("password"), at("otp")] })).toMatchObject({ userId: USER, emailConfirmed: true });
    expect(await verify({ email: "a@x.test", amr: [at("password"), at("magiclink")] })).toMatchObject({ userId: USER, emailConfirmed: true });
    const google = { email: "a@x.test", amr: [at("password"), at("oauth")], app_metadata: { provider: "email", providers: ["email", "google"] }, user_metadata: { email_verified: true } };
    expect(await verify(google)).toMatchObject({ userId: USER, emailConfirmed: true });
    // Google's rule still applies to the oauth entry: an unverified Google address is not confirmed.
    expect(await verify({ ...google, user_metadata: { email_verified: false } })).toMatchObject({ userId: USER, emailConfirmed: false });
    // Tokens without a password are untouched.
    expect(passwordOnlyFromPayload({ amr: [at("anonymous")] })).toBe(false);
    expect(passwordOnlyFromPayload({})).toBe(false);
  });
});

describe("3. a fresh sign-in counts only sign-in methods", () => {
  const at = (method: string, timestamp: number) => ({ method, timestamp });
  const t = now();

  it("takes the latest sign-in method, never a refresh, a password, an anonymous sign-in or an unknown method", () => {
    expect([...SIGN_IN_METHODS].sort()).toEqual(["email/signup", "email_change", "invite", "magiclink", "oauth", "otp", "recovery"]);
    expect(authenticatedAtFromPayload({ iat: t, amr: [at("otp", t - 3600), at("token_refresh", t - 10)] })).toEqual(new Date((t - 3600) * 1000));
    expect(authenticatedAtFromPayload({ iat: t, amr: [at("magiclink", t - 3600), at("password", t - 10)] })).toEqual(new Date((t - 3600) * 1000));
    expect(authenticatedAtFromPayload({ iat: t, amr: [at("oauth", t - 120), at("magiclink", t - 3600)] })).toEqual(new Date((t - 120) * 1000));
    for (const method of ["email/signup", "invite", "recovery", "email_change"]) expect(authenticatedAtFromPayload({ iat: t, amr: [at(method, t - 60)] }), method).toEqual(new Date((t - 60) * 1000));
    // An amr claim with no sign-in entry: no known sign-in moment (iat would be the refresh's own time).
    for (const method of ["token_refresh", "anonymous", "sso/saml", "totp", "web3", "something_new"]) expect(authenticatedAtFromPayload({ iat: t, amr: [at(method, t - 5)] }), method).toBeNull();
    expect(authenticatedAtFromPayload({ iat: t, amr: [] })).toBeNull();
    // A token with no amr claim at all keeps the iat fallback.
    expect(authenticatedAtFromPayload({ iat: t })).toEqual(new Date(t * 1000));
  });
});
