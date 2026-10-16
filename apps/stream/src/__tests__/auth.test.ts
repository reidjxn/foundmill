import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTokenVerifier, JWKS_CACHE_MAX_AGE_MS, JWKS_REFRESH_MS, parseDevToken, StreamAuthError } from "../auth";
import { USER_A, USER_B } from "./helpers";

let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
});

async function sign(claims: Record<string, unknown>, opts: { aud?: string; exp?: string } = {}): Promise<string> {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuedAt().setAudience(opts.aud ?? "authenticated").setExpirationTime(opts.exp ?? "1h");
  return jwt.sign(privateKey);
}

describe("token verifier", () => {
  it("verifies a Supabase-shaped access token against the JWKS", async () => {
    const auth = createTokenVerifier({ appEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    const token = await sign({ sub: USER_A, email: "founder@example.test" });
    const exp = decodeJwt(token).exp! * 1000;
    expect(await auth.verify(token)).toEqual({ userId: USER_A, email: "founder@example.test", expiresAt: exp });
    expect(await auth.resolve(token)).toEqual({ userId: USER_A, email: "founder@example.test", expiresAt: exp });
  });

  it("rejects the wrong audience, an expired token, a non-uuid subject and garbage", async () => {
    const auth = createTokenVerifier({ appEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    await expect(auth.verify(await sign({ sub: USER_A }, { aud: "anon" }))).rejects.toBeInstanceOf(StreamAuthError);
    await expect(auth.verify(await sign({ sub: USER_A }, { exp: "-1h" }))).rejects.toBeInstanceOf(StreamAuthError);
    await expect(auth.verify(await sign({ sub: "service" }))).rejects.toThrow(/UUID subject/);
    await expect(auth.verify("garbage")).rejects.toThrow(/malformed/);
    // A token without `exp` would keep a socket open forever (audit SIEC-4): refused.
    const forever = await new SignJWT({ sub: USER_A }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setAudience("authenticated").sign(privateKey);
    await expect(auth.verify(forever)).rejects.toThrow(/exp/);
    expect(await auth.resolve("garbage")).toBeNull();
    expect(await auth.resolve(null)).toBeNull();
    expect(await auth.resolve("")).toBeNull();
  });

  it("accepts HS256 tokens only when a secret is configured", async () => {
    const secret = new TextEncoder().encode("a-very-long-legacy-project-secret-value-123456");
    const token = await new SignJWT({ sub: USER_B }).setProtectedHeader({ alg: "HS256" }).setAudience("authenticated").setExpirationTime("1h").sign(secret);
    const withSecret = createTokenVerifier({ appEnv: "production", hsKey: secret });
    expect((await withSecret.verify(token)).userId).toBe(USER_B);
    const without = createTokenVerifier({ appEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    await expect(without.verify(token)).rejects.toThrow(/no JWT secret/);
  });

  it("honours the dev bypass only in development/test", async () => {
    const dev = createTokenVerifier({ appEnv: "test", devUserId: USER_A });
    expect(dev.devUserId).toBe(USER_A);
    expect(await dev.resolve(null)).toEqual({ userId: USER_A, email: null, expiresAt: null });
    expect(await dev.resolve("dev")).toEqual({ userId: USER_A, email: null, expiresAt: null });
    expect(await dev.resolve(`dev:${USER_B}`)).toEqual({ userId: USER_B, email: null, expiresAt: null });
    expect(await dev.resolve("dev:nope")).toEqual({ userId: USER_A, email: null, expiresAt: null }); // falls back to the dev user
    expect(await dev.resolve("stale.jwt.value")).toEqual({ userId: USER_A, email: null, expiresAt: null });

    const prod = createTokenVerifier({ appEnv: "production", devUserId: USER_A, jwks: createLocalJWKSet({ keys: [jwk] }) });
    expect(prod.devUserId).toBeNull();
    expect(await prod.resolve("dev")).toBeNull();
    expect(await prod.resolve(null)).toBeNull();
    expect(await prod.resolve(await sign({ sub: USER_B }))).toMatchObject({ userId: USER_B, email: null, expiresAt: expect.any(Number) });
  });

  it("requires a UUID dev user id and parses dev tokens strictly", () => {
    expect(() => createTokenVerifier({ appEnv: "development", devUserId: "founder" })).toThrow(/UUID/);
    expect(parseDevToken("dev", USER_A)).toBe(USER_A);
    expect(parseDevToken(`dev:${USER_B}`, USER_A)).toBe(USER_B);
    expect(parseDevToken("dev:x", USER_A)).toBeNull();
    expect(parseDevToken("developer", USER_A)).toBeNull();
  });

  it("explains a missing SUPABASE_URL instead of crashing", async () => {
    const auth = createTokenVerifier({ appEnv: "production" });
    await expect(auth.verify(await sign({ sub: USER_A }))).rejects.toThrow(/SUPABASE_URL/);
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
  const signed = (k: { jwk: JWK; key: CryptoKey }) => new SignJWT({ sub: USER_A }).setProtectedHeader({ alg: "ES256", kid: k.jwk.kid! }).setAudience("authenticated").setExpirationTime("2h").sign(k.key);

  it("fetches at boot and on its interval, so an upgrade finds the keys cached well past jose's 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const [k1, k2] = [await pair("k1"), await pair("k2")];
    const { state, fetchImpl } = jwksEndpoint();
    state.keys = [k1.jwk];
    const auth = createTokenVerifier({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl });
    const keys = auth.keepKeysFresh!();
    expect(await keys.ready).toBe(true);
    expect(state.urls).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`]);
    await vi.advanceTimersByTimeAsync(JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(2);
    keys.stop();
    // 14 minutes after the last fetch, with the refresh stopped: answered from the cache.
    vi.setSystemTime(Date.now() + 14 * 60_000);
    expect(await auth.verify(await signed(k1))).toMatchObject({ userId: USER_A });
    expect(state.urls).toHaveLength(2);
    // A rotated key still fetches at once; past the cache's age a lookup that cannot reach Supabase fails closed.
    state.keys = [k1.jwk, k2.jwk];
    expect(await auth.verify(await signed(k2))).toMatchObject({ userId: USER_A });
    expect(state.urls).toHaveLength(3);
    vi.setSystemTime(Date.now() + JWKS_CACHE_MAX_AGE_MS);
    state.down = true;
    await expect(auth.verify(await signed(k1))).rejects.toBeInstanceOf(StreamAuthError);
    await vi.advanceTimersByTimeAsync(3 * JWKS_REFRESH_MS);
    expect(state.urls).toHaveLength(4);
  });

  it("reports a failed fetch, and has nothing to do without SUPABASE_URL", async () => {
    const { state, fetchImpl } = jwksEndpoint();
    state.down = true;
    const errors: unknown[] = [];
    const keys = createTokenVerifier({ appEnv: "production", supabaseUrl: SUPABASE_URL, jwksFetch: fetchImpl }).keepKeysFresh!({ onError: (err) => errors.push(err) });
    expect(await keys.ready).toBe(false);
    expect(errors).toHaveLength(1);
    keys.stop();
    const none = createTokenVerifier({ appEnv: "production" }).keepKeysFresh!();
    expect(await none.ready).toBe(false);
    none.stop();
  });
});
