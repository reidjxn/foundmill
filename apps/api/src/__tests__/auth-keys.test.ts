/**
 * Supabase's signing keys are fetched at boot and refreshed in the background, so no request waits for them (audit
 * api-db F7): until 2026-10-15 jose fetched them inside the first request after every 10-minute gap.
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthVerifier, JWKS_CACHE_MAX_AGE_MS, JWKS_REFRESH_MS } from "../auth";

const USER = "11111111-2222-4333-8444-555555555555";
const SUPABASE_URL = "https://project.supabase.test";

let k1: { jwk: JWK; key: CryptoKey };
let k2: { jwk: JWK; key: CryptoKey };
beforeAll(async () => {
  const pair = async (kid: string) => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    return { jwk: { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }, key: privateKey };
  };
  k1 = await pair("k1");
  k2 = await pair("k2");
});
afterEach(() => vi.useRealTimers());

const token = (k: { jwk: JWK; key: CryptoKey }) => new SignJWT({ sub: USER }).setProtectedHeader({ alg: "ES256", kid: k.jwk.kid! }).setAudience("authenticated").setExpirationTime("2h").sign(k.key);

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

describe("keepKeysFresh (audit api-db F7)", () => {
  it("fetches at boot; a request finds the keys cached well past jose's 10 minutes; the cache still ends, failing closed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { state, fetchImpl } = jwksEndpoint();
    state.keys = [k1.jwk];
    const auth = createAuthVerifier({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl });
    const keys = auth.keepKeysFresh!();
    expect(await keys.ready).toBe(true);
    expect(state.urls).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`]);
    keys.stop();

    expect((await auth.verify(await token(k1))).userId).toBe(USER);
    // 14 minutes on (the background refresh stopped): still answered from the cache, no fetch on the request path.
    vi.setSystemTime(Date.now() + 14 * 60_000);
    expect((await auth.verify(await token(k1))).userId).toBe(USER);
    expect(state.urls).toHaveLength(1);
    // Past the cache's age (every background fetch failed meanwhile) a request fetches them itself, and fails closed
    // when Supabase cannot be reached.
    vi.setSystemTime(Date.now() + JWKS_CACHE_MAX_AGE_MS);
    state.down = true;
    await expect(auth.verify(await token(k1))).rejects.toThrow(/token verification failed/);
    expect(state.urls).toHaveLength(2);
  });

  it("refreshes on its interval until stopped, and an unknown key still fetches at once (after the 30 s cooldown)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { state, fetchImpl } = jwksEndpoint();
    state.keys = [k1.jwk];
    const auth = createAuthVerifier({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl });
    const keys = auth.keepKeysFresh!();
    await keys.ready;
    await vi.advanceTimersByTimeAsync(JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(3);

    // Supabase rotated to a new key: a token signed with it fetches the set again rather than waiting for the interval.
    state.keys = [k1.jwk, k2.jwk];
    vi.setSystemTime(Date.now() + 31_000);
    expect((await auth.verify(await token(k2))).userId).toBe(USER);
    expect(state.urls).toHaveLength(4);

    keys.stop();
    await vi.advanceTimersByTimeAsync(3 * JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(4);
  });

  it("a failed fetch is reported and retried on the interval; nothing to do without SUPABASE_URL", async () => {
    const { state, fetchImpl } = jwksEndpoint();
    state.down = true;
    const errors: unknown[] = [];
    const auth = createAuthVerifier({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl });
    const keys = auth.keepKeysFresh!({ onError: (err) => errors.push(err) });
    expect(await keys.ready).toBe(false);
    expect(errors).toHaveLength(1);
    keys.stop();

    const none = createAuthVerifier({ appEnv: "production", jwtSecret: "a-legacy-project-secret-for-tests-only" }).keepKeysFresh!();
    expect(await none.ready).toBe(false);
    none.stop();
  });
});
