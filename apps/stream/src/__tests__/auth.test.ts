import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createTokenVerifier, parseDevToken, StreamAuthError } from "../auth";
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
    expect(await auth.verify(token)).toEqual({ userId: USER_A, email: "founder@example.test" });
    expect(await auth.resolve(token)).toEqual({ userId: USER_A, email: "founder@example.test" });
  });

  it("rejects the wrong audience, an expired token, a non-uuid subject and garbage", async () => {
    const auth = createTokenVerifier({ appEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    await expect(auth.verify(await sign({ sub: USER_A }, { aud: "anon" }))).rejects.toBeInstanceOf(StreamAuthError);
    await expect(auth.verify(await sign({ sub: USER_A }, { exp: "-1h" }))).rejects.toBeInstanceOf(StreamAuthError);
    await expect(auth.verify(await sign({ sub: "service" }))).rejects.toThrow(/UUID subject/);
    await expect(auth.verify("garbage")).rejects.toThrow(/malformed/);
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
    expect(await dev.resolve(null)).toEqual({ userId: USER_A, email: null });
    expect(await dev.resolve("dev")).toEqual({ userId: USER_A, email: null });
    expect(await dev.resolve(`dev:${USER_B}`)).toEqual({ userId: USER_B, email: null });
    expect(await dev.resolve("dev:nope")).toEqual({ userId: USER_A, email: null }); // falls back to the dev user
    expect(await dev.resolve("stale.jwt.value")).toEqual({ userId: USER_A, email: null });

    const prod = createTokenVerifier({ appEnv: "production", devUserId: USER_A, jwks: createLocalJWKSet({ keys: [jwk] }) });
    expect(prod.devUserId).toBeNull();
    expect(await prod.resolve("dev")).toBeNull();
    expect(await prod.resolve(null)).toBeNull();
    expect(await prod.resolve(await sign({ sub: USER_B }))).toEqual({ userId: USER_B, email: null });
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
