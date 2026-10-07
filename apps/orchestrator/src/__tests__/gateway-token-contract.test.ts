/**
 * Contract: the orchestrator's node:crypto service-token signer (src/gateway-client.ts) and the gateway's jose signer
 * (apps/gateway/src/tokens.ts) must produce interchangeable tokens. @foundmill/gateway is not a workspace dependency
 * of this app (docs/NEEDED_DEPS.md), so the gateway's module is imported by path; it resolves `jose` from its own
 * node_modules. If the gateway ever changes issuer, audience, algorithm or required claims, this suite fails here.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICE_TOKEN_TTL_SECONDS as GW_TTL, SERVICE_AUDIENCE as GW_SERVICE_AUDIENCE, TOKEN_ISSUER as GW_TOKEN_ISSUER, signServiceToken as gatewaySign, verifyServiceToken } from "../../../gateway/src/tokens";
import { DEFAULT_SERVICE_TOKEN_TTL_SECONDS, SERVICE_AUDIENCE, TOKEN_ISSUER, signServiceToken } from "../gateway-client";

const SECRET = "contract-test-secret-0123456789abcdef";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("orchestrator ↔ gateway service-token contract", () => {
  it("shares issuer, audience and default ttl with apps/gateway", () => {
    expect(TOKEN_ISSUER).toBe(GW_TOKEN_ISSUER);
    expect(SERVICE_AUDIENCE).toBe(GW_SERVICE_AUDIENCE);
    expect(DEFAULT_SERVICE_TOKEN_TTL_SECONDS).toBe(GW_TTL);
  });

  it("a token signed by the orchestrator verifies with the gateway's verifier and carries the same claims", async () => {
    const token = signServiceToken(SECRET, "orchestrator", 60);
    const verified = await verifyServiceToken(SECRET, token);
    expect(verified.svc).toBe("orchestrator");
    expect(verified.exp - verified.iat).toBe(60);
    await expect(verifyServiceToken("another-secret-0123456789abcdef", token)).rejects.toThrow(/signature|invalid/i);
  });

  it("both signers emit identical headers and claim sets (only iat/exp/jti differ by construction)", async () => {
    const now = () => new Date("2026-10-07T12:00:00.000Z");
    const ours = signServiceToken(SECRET, "orchestrator", 60, now);
    const theirs = await gatewaySign(SECRET, "orchestrator", 60);
    const [oh, op] = ours.split(".") as [string, string, string];
    const [th, tp] = theirs.split(".") as [string, string, string];
    expect(decode(oh)).toEqual(decode(th));
    const ourClaims = decode(op);
    const theirClaims = decode(tp);
    expect(Object.keys(ourClaims).sort()).toEqual(Object.keys(theirClaims).sort());
    expect(ourClaims).toMatchObject({ svc: "orchestrator", iss: GW_TOKEN_ISSUER, aud: GW_SERVICE_AUDIENCE });
    expect(theirClaims).toMatchObject({ svc: "orchestrator", iss: TOKEN_ISSUER, aud: SERVICE_AUDIENCE });
    expect(Number(theirClaims.exp) - Number(theirClaims.iat)).toBe(Number(ourClaims.exp) - Number(ourClaims.iat));
    // Same HMAC over the same signing input: re-sign the gateway's payload with node:crypto and compare.
    const [, , theirSig] = theirs.split(".") as [string, string, string];
    expect(createHmac("sha256", SECRET).update(`${th}.${tp}`).digest("base64url")).toBe(theirSig);
  });
});
