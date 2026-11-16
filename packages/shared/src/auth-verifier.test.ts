/**
 * The shared verifier's new rules (WP-11 T13). The api's dev-auth, google-auth and google-signin-hardening suites cover
 * the rest through apps/api's re-export.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuthVerifier } from "./auth-verifier";

const DEV = "00000000-0000-4000-8000-0000000000de";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
});

const base = () => new SignJWT({ sub: USER, email: "a@example.com", email_verified: true }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuedAt().setAudience("authenticated");

describe("createAuthVerifier", () => {
  it("has no development bypass in a production process, whatever APP_ENV says", async () => {
    const auth = createAuthVerifier({ appEnv: "test", nodeEnv: "production", devUserId: DEV, jwks: createLocalJWKSet({ keys: [jwk] }) });
    expect(auth.devUserId).toBeNull();
    expect(await auth.resolve("Bearer dev")).toBeNull();
    expect(await auth.resolve(`Bearer dev:${OTHER}`)).toBeNull();
    expect(await auth.resolve(null)).toBeNull();
    const dev = createAuthVerifier({ appEnv: "test", nodeEnv: "test", devUserId: DEV });
    expect((await dev.resolve("Bearer dev"))?.userId).toBe(DEV);
  });

  it("refuses a token without exp, and gives expiresAt for one with it", async () => {
    const auth = createAuthVerifier({ appEnv: "production", nodeEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    await expect(auth.verify(await base().sign(privateKey))).rejects.toThrow(/exp/);
    const user = await auth.verify(await base().setExpirationTime("1h").sign(privateKey));
    expect(user.userId).toBe(USER);
    expect(user.expiresAt).toBeGreaterThan(Date.now());
  });

  it("refuses a password-only session", async () => {
    const auth = createAuthVerifier({ appEnv: "production", nodeEnv: "production", jwks: createLocalJWKSet({ keys: [jwk] }) });
    const token = await base().setExpirationTime("1h").sign(privateKey).then(async () =>
      new SignJWT({ sub: USER, email: "a@example.com", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuedAt().setAudience("authenticated").setExpirationTime("1h").sign(privateKey),
    );
    await expect(auth.verify(token)).rejects.toThrow(/password/);
  });
});
