import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SERVICE_AUDIENCE, TOKEN_ISSUER, createGatewayClient, createOfflineGatewayClient, signServiceToken } from "../gateway-client";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("gateway client", () => {
  it("signs an HS256 service JWT with the gateway's issuer and service audience", () => {
    const now = () => new Date("2026-10-05T08:00:00.000Z");
    const token = signServiceToken("s3cret-s3cret-s3cret", "orchestrator", 60, now);
    const [h, p, sig] = token.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "HS256", typ: "JWT" });
    const payload = decode(p);
    expect(payload).toMatchObject({ svc: "orchestrator", iss: TOKEN_ISSUER, aud: SERVICE_AUDIENCE, iat: 1_791_187_200, exp: 1_791_187_260 });
    expect(typeof payload.jti).toBe("string");
    expect(sig).toBe(createHmac("sha256", "s3cret-s3cret-s3cret").update(`${h}.${p}`).digest("base64url"));
    expect(() => signServiceToken("", "orchestrator")).toThrow(/SESSION_TOKEN_SECRET/);
  });

  it("mints session tokens through POST /v1/session-tokens with a Bearer service token and builds MCP urls", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ token: "sess", expiresAt: "2026-10-05T12:00:00.000Z", jti: "j" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createGatewayClient({ baseUrl: "http://gateway.test/", serviceSecret: "x".repeat(32), fetch: fetchStub });
    const minted = await client.mintSessionToken({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: ["gmail:*"] });
    expect(minted.token).toBe("sess");
    expect(calls[0]!.url).toBe("http://gateway.test/v1/session-tokens");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer eyJ/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: ["gmail:*"] });
    expect(client.mcpUrl("gmail")).toBe("http://gateway.test/mcp/gmail");
    expect(client.sessionHeaders("sess")).toEqual({ authorization: "Bearer sess" });
  });

  it("returns policy outcomes on 403/429 instead of throwing, and throws on transport errors", async () => {
    const client = createGatewayClient({ baseUrl: "http://gateway.test", serviceSecret: "x".repeat(32), fetch: async () => new Response(JSON.stringify({ outcome: "deny", reasons: ["hard gate"] }), { status: 403 }) });
    expect((await client.call("t", { connector: "stripe", tool: "create_payout", args: {} })).outcome).toBe("deny");
    const down = createGatewayClient({ baseUrl: "http://gateway.test", serviceSecret: "x".repeat(32), fetch: async () => { throw new Error("ECONNREFUSED"); } });
    await expect(down.health()).rejects.toMatchObject({ code: "gateway_unreachable" });
  });

  it("offline client records mints and answers allow", async () => {
    const offline = createOfflineGatewayClient();
    const minted = await offline.mintSessionToken({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: [] });
    expect(minted.token).toMatch(/^offline\./);
    expect((await offline.call(minted.token, { connector: "gmail", tool: "send_message", args: {} })).outcome).toBe("allow");
    expect(offline.minted).toHaveLength(1);
    expect(offline.calls).toHaveLength(1);
  });
});
