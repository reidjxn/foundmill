/** Token kinds the collab server accepts: Supabase JWT (HS256 / JWKS), collab service tokens, dev tokens. */
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { COLLAB_SERVICE_AUDIENCE, CollabAuthError, createCollabAuthenticator, mintCollabServiceToken, parseDevToken } from "../auth";

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
