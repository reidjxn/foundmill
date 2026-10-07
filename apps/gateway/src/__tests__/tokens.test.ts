import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@foundmill/shared";
import { bearerToken, mintSessionToken, signServiceToken, toolAllowed, verifyServiceToken, verifySessionToken } from "../tokens";

const SECRET = "unit-test-secret-0123456789abcdef";
const OTHER = "another-secret-0123456789abcdef";
const ids = { businessId: "11111111-1111-1111-1111-111111111111", agentId: "22222222-2222-2222-2222-222222222222", sessionId: "33333333-3333-3333-3333-333333333333" };

describe("service tokens", () => {
  it("round-trips the svc claim", async () => {
    const token = await signServiceToken(SECRET, "orchestrator");
    const claims = await verifyServiceToken(SECRET, token);
    expect(claims.svc).toBe("orchestrator");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signServiceToken(OTHER, "orchestrator");
    await expect(verifyServiceToken(SECRET, token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a session token is never accepted as a service token (and vice versa)", async () => {
    const session = await mintSessionToken(SECRET, { ...ids, allowedTools: ["gmail:*"] }, 60);
    await expect(verifyServiceToken(SECRET, session.token)).rejects.toThrow(/aud/);
    const service = await signServiceToken(SECRET, "api");
    await expect(verifySessionToken(SECRET, service)).rejects.toThrow(/aud/);
  });
});

describe("session tokens", () => {
  it("carries businessId, agentId, sessionId, allowedTools, kitMode and exp", async () => {
    const now = () => new Date("2026-10-07T10:00:00.000Z");
    const minted = await mintSessionToken(SECRET, { ...ids, allowedTools: ["gmail:send_message", "github:*"], kitMode: true }, 600, now);
    expect(minted.expiresAt).toBe("2026-10-07T10:10:00.000Z");
    const claims = await verifySessionToken(SECRET, minted.token, now);
    expect(claims).toMatchObject({ ...ids, allowedTools: ["gmail:send_message", "github:*"], kitMode: true, jti: minted.jti });
    expect(claims.exp - claims.iat).toBe(600);
  });

  it("expires", async () => {
    const minted = await mintSessionToken(SECRET, { ...ids }, 60, () => new Date("2026-10-07T10:00:00.000Z"));
    await expect(verifySessionToken(SECRET, minted.token, () => new Date("2026-10-07T10:02:00.000Z"))).rejects.toThrow(/expired/i);
  });

  it("rejects malformed claims and tool refs", async () => {
    await expect(mintSessionToken(SECRET, { ...ids, agentId: "not-a-uuid" }, 60)).rejects.toThrow(/Invalid session token claims/);
    await expect(mintSessionToken(SECRET, { ...ids, allowedTools: ["gmail/send"] }, 60)).rejects.toThrow(/Invalid session token claims/);
    await expect(mintSessionToken(SECRET, { ...ids }, 0)).rejects.toThrow(/ttlSeconds/);
  });

  it("toolAllowed honours exact refs, connector wildcards and the global wildcard", () => {
    expect(toolAllowed(["gmail:send_message"], "gmail", "send_message")).toBe(true);
    expect(toolAllowed(["gmail:send_message"], "gmail", "list_messages")).toBe(false);
    expect(toolAllowed(["gmail:*"], "gmail", "list_messages")).toBe(true);
    expect(toolAllowed(["gmail:*"], "github", "open_pr")).toBe(false);
    expect(toolAllowed(["*"], "github", "open_pr")).toBe(true);
    expect(toolAllowed([], "github", "open_pr")).toBe(false);
  });

  it("bearerToken parses the Authorization header", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer   abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
