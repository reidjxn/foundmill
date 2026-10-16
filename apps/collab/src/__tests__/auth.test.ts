/** Token kinds the collab server accepts: Supabase JWT (HS256 / JWKS), collab service tokens, dev tokens. */
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLAB_SERVICE_AUDIENCE, CollabAuthError, createCollabAuthenticator, JWKS_CACHE_MAX_AGE_MS, JWKS_REFRESH_MS, mintCollabServiceToken, parseDevToken } from "../auth";

const USER = "11111111-2222-4333-8444-555555555555";
const BUSINESS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AGENT = "99999999-8888-4777-8666-555555555555";
const JWT_SECRET = "supabase-legacy-secret-for-tests";
const SERVICE_SECRET = "session-token-secret-for-tests";

const hsToken = (claims: Record<string, unknown>, secret = JWT_SECRET, aud: string | undefined = "authenticated") => {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m");
  if (aud) jwt.setAudience(aud);
  return jwt.sign(new TextEncoder().encode(secret));
};

describe("createCollabAuthenticator", () => {
  it("verifies a legacy HS256 Supabase access token into a user principal", async () => {
    const auth = createCollabAuthenticator({ appEnv: "test", jwtSecret: JWT_SECRET });
    const principal = await auth.verify(await hsToken({ sub: USER, email: "founder@example.test" }));
    expect(principal).toEqual({ kind: "user", userId: USER, email: "founder@example.test" });
  });

  it("verifies an asymmetric Supabase token against the JWKS and enforces the audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "ES256", use: "sig" }] });
    const auth = createCollabAuthenticator({ appEnv: "production", jwks });
    const good = await new SignJWT({ sub: USER }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setAudience("authenticated").setExpirationTime("5m").sign(privateKey);
    expect(await auth.verify(good)).toMatchObject({ kind: "user", userId: USER });
    const wrongAud = await new SignJWT({ sub: USER }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setAudience("anon").setExpirationTime("5m").sign(privateKey);
    await expect(auth.verify(wrongAud)).rejects.toBeInstanceOf(CollabAuthError);
  });

  it("rejects a wrong secret, a non-UUID subject, an expired token and garbage", async () => {
    const auth = createCollabAuthenticator({ appEnv: "test", jwtSecret: JWT_SECRET });
    await expect(auth.verify(await hsToken({ sub: USER }, "other-secret"))).rejects.toThrow(/verification failed/);
    await expect(auth.verify(await hsToken({ sub: "not-a-uuid" }))).rejects.toThrow(/UUID subject/);
    const expired = await new SignJWT({ sub: USER }).setProtectedHeader({ alg: "HS256" }).setAudience("authenticated").setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode(JWT_SECRET));
    await expect(auth.verify(expired)).rejects.toBeInstanceOf(CollabAuthError);
    await expect(auth.verify("garbage")).rejects.toThrow(/malformed/);
    await expect(auth.verify("")).rejects.toThrow(/missing token/);
  });

  it("mints and verifies collab service tokens bound to one business and agent", async () => {
    const auth = createCollabAuthenticator({ appEnv: "staging", jwtSecret: JWT_SECRET, serviceSecret: SERVICE_SECRET });
    const token = await mintCollabServiceToken({ secret: SERVICE_SECRET, businessId: BUSINESS, agentId: AGENT, service: "orchestrator" });
    expect(await auth.verify(token)).toEqual({ kind: "agent", agentId: AGENT, businessId: BUSINESS, sessionId: null, service: "orchestrator" });
    // The Supabase secret never validates a service token and vice versa (audiences differ).
    const forged = await hsToken({ businessId: BUSINESS, agentId: AGENT }, JWT_SECRET, COLLAB_SERVICE_AUDIENCE);
    await expect(auth.verify(forged)).rejects.toBeInstanceOf(CollabAuthError);
    const noAgent = await hsToken({ businessId: BUSINESS }, SERVICE_SECRET, COLLAB_SERVICE_AUDIENCE);
    await expect(auth.verify(noAgent)).rejects.toThrow(/agentId/);
    const unconfigured = createCollabAuthenticator({ appEnv: "staging", jwtSecret: JWT_SECRET });
    await expect(unconfigured.verify(token)).rejects.toThrow(/SESSION_TOKEN_SECRET/);
    const expired = await mintCollabServiceToken({ secret: SERVICE_SECRET, businessId: BUSINESS, agentId: AGENT, ttlSeconds: 1, now: () => new Date(Date.now() - 60_000) });
    await expect(auth.verify(expired)).rejects.toBeInstanceOf(CollabAuthError);
  });

  it("honours dev tokens only in development/test", async () => {
    const dev = createCollabAuthenticator({ appEnv: "test", devUserId: USER });
    expect(await dev.verify(undefined)).toEqual({ kind: "user", userId: USER, email: null });
    expect(await dev.verify("dev")).toMatchObject({ userId: USER });
    expect(await dev.verify(`dev:${AGENT}`)).toMatchObject({ userId: AGENT });
    expect(parseDevToken("dev:nope", USER)).toBeNull();
    const prod = createCollabAuthenticator({ appEnv: "production", devUserId: USER, jwtSecret: JWT_SECRET });
    expect(prod.devUserId).toBeNull();
    await expect(prod.verify("dev")).rejects.toBeInstanceOf(CollabAuthError);
    await expect(prod.verify(undefined)).rejects.toThrow(/missing token/);
  });
});

describe("keepKeysFresh (audit api-db F7)", () => {
  afterEach(() => vi.useRealTimers());
  const SUPABASE_URL = "https://project.supabase.test";
  /** Supabase's JWKS endpoint: serves `keys`, counts the fetches, fails while `down`. */
  function jwksEndpoint() {
    const state = { keys: [] as JWK[], urls: [] as string[], down: false };
    const fetchImpl = (async (url: string | URL) => {
      state.urls.push(String(url));
      if (state.down) throw new Error("connect ECONNREFUSED");
      return new Response(JSON.stringify({ keys: state.keys }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { state, fetchImpl };
  }
  const pair = async (kid: string) => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    return { jwk: { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" } as JWK, key: privateKey };
  };
  const signed = (k: { jwk: JWK; key: CryptoKey }) => new SignJWT({ sub: USER }).setProtectedHeader({ alg: "ES256", kid: k.jwk.kid! }).setAudience("authenticated").setExpirationTime("2h").sign(k.key);

  it("fetches at boot and on its interval, so a connection finds the keys cached well past jose's 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const [k1, k2] = [await pair("k1"), await pair("k2")];
    const { state, fetchImpl } = jwksEndpoint();
    state.keys = [k1.jwk];
    const auth = createCollabAuthenticator({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl });
    const keys = auth.keepKeysFresh!();
    expect(await keys.ready).toBe(true);
    expect(state.urls).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`]);
    await vi.advanceTimersByTimeAsync(JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(2);
    keys.stop();
    // 14 minutes after the last fetch, with the refresh stopped: answered from the cache.
    vi.setSystemTime(Date.now() + 14 * 60_000);
    expect(await auth.verify(await signed(k1))).toMatchObject({ userId: USER });
    expect(state.urls).toHaveLength(2);
    // A rotated key still fetches at once; past the cache's age a lookup that cannot reach Supabase fails closed.
    state.keys = [k1.jwk, k2.jwk];
    expect(await auth.verify(await signed(k2))).toMatchObject({ userId: USER });
    expect(state.urls).toHaveLength(3);
    vi.setSystemTime(Date.now() + JWKS_CACHE_MAX_AGE_MS);
    state.down = true;
    await expect(auth.verify(await signed(k1))).rejects.toBeInstanceOf(CollabAuthError);
    await vi.advanceTimersByTimeAsync(3 * JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(4);
  });

  it("reports a failed fetch, and has nothing to do without SUPABASE_URL", async () => {
    const { state, fetchImpl } = jwksEndpoint();
    state.down = true;
    const errors: unknown[] = [];
    const keys = createCollabAuthenticator({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl }).keepKeysFresh!({ onError: (err) => errors.push(err) });
    expect(await keys.ready).toBe(false);
    expect(errors).toHaveLength(1);
    keys.stop();
    const none = createCollabAuthenticator({ appEnv: "production" }).keepKeysFresh!();
    expect(await none.ready).toBe(false);
    none.stop();
  });
});
