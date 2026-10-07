/**
 * SEC-1: a live session token must stop working the moment the club or the agent may not work any more.
 * Kill switch (`pauseAll`), release (`agents.release`), club archive, key revoke (`credentials.revoke` +
 * `integrations.disconnect`, exactly what apps/api keys.ts does) — each is refused by the pipeline with a stable
 * policy id, an audit row and HTTP 403, and session-token minting is refused for the same reasons.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { AGENT_ARCHIVED_POLICY_ID, AGENT_PAUSED_POLICY_ID, BUSINESS_ARCHIVED_POLICY_ID, KEY_REVOKED_POLICY_ID } from "../pipeline";
import { ANTHROPIC_CONNECTOR_KEY, SessionStateCache, STATE_CACHE_TTL_MS, stateDenial, toolNeedsByokKey } from "../state";
import { setupGateway, type GatewayFixture } from "./harness";
import type { AllowResponse, CallResponse, DenyResponse } from "../types";

const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome).toBe("deny");
  return r as DenyResponse;
};
const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

async function rawCall(g: GatewayFixture, token: string, body: unknown): Promise<Response> {
  return fetch(`${g.server.url}/v1/call`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

describe("agent state (kill switch, release)", () => {
  let g: GatewayFixture;
  beforeAll(async () => {
    g = await setupGateway();
  }, 120_000);
  afterAll(async () => {
    await g.close();
  });

  it("Stop all agents: a live token is refused with agent-paused + audit + 403, and works again once resumed", async () => {
    const token = await g.token();
    asAllow(await g.client.call(token, { connector: "test", tool: "note", args: { text: "before" } }));

    const paused = await repos.agents.pauseAll(g.db, g.businessId);
    expect(paused).toBe(1);
    try {
      const res = await rawCall(g, token, { connector: "test", tool: "note", args: { text: "after" } });
      expect(res.status).toBe(403);
      const r = asDeny((await res.json()) as CallResponse);
      expect(r.policyIds).toEqual([AGENT_PAUSED_POLICY_ID]);
      expect(r.reasons[0]).toMatch(/paused/);
      expect(r.approvalId).toBeUndefined();
      const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
      expect(audit).toMatchObject({ actorKind: "agent", actorId: g.agentId, action: "tool.call" });
      expect(audit.details).toMatchObject({ outcome: "deny", policyIds: [AGENT_PAUSED_POLICY_ID], sessionId: g.sessionId });
      // Nothing reached the connector while paused.
      expect(g.seen.map((s) => s.args)).toEqual([{ text: "before" }]);
      // Every tool, not just internal ones: the hard-gated tool is refused as paused too (no founder task is queued for a paused agent).
      const gated = asDeny(await g.client.call(token, { connector: "test", tool: "pay_out", args: { amountMinor: 5 }, context: { amountMinor: 5 } }));
      expect(gated.policyIds).toEqual([AGENT_PAUSED_POLICY_ID]);
      expect(gated.approvalId).toBeUndefined();
    } finally {
      await repos.agents.setStatus(g.db, g.businessId, g.agentId, "healthy");
    }
    const again = asAllow(await g.client.call(token, { connector: "test", tool: "note", args: { text: "resumed" } }));
    expect(again.policyIds).toEqual(["assisted-allow-within-caps"]);
    expect(g.seen.at(-1)?.args).toEqual({ text: "resumed" });
  });

  it("a healthy agent of a live club is allowed (regression guard for the state check)", async () => {
    const agent = await repos.agents.get(g.db, g.businessId, g.agentId);
    expect(agent.status).toBe("healthy");
    expect(agent.archivedAt).toBeNull();
    asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: {} }));
  });

  it("a released agent is refused with agent-archived even though its token is still valid", async () => {
    const released = await repos.agents.create(g.db, g.businessId, { name: "Leaving Worker", agentType: "developer", modelKey: "sonnet" });
    const session = (await repos.agents.createSession(g.db, g.businessId, { agentId: released.id, modelKey: "sonnet" })).id;
    const token = await g.token({ agentId: released.id, sessionId: session });
    asAllow(await g.client.call(token, { connector: "test", tool: "note", args: {} }));
    await repos.agents.release(g.db, g.businessId, released.id);
    const res = await rawCall(g, token, { connector: "test", tool: "note", args: {} });
    expect(res.status).toBe(403);
    const r = asDeny((await res.json()) as CallResponse);
    expect(r.policyIds).toEqual([AGENT_ARCHIVED_POLICY_ID]);
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.details).toMatchObject({ outcome: "deny", policyIds: [AGENT_ARCHIVED_POLICY_ID] });
    // Minting is refused as well.
    await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: released.id, sessionId: session, allowedTools: ["test:*"] })).rejects.toMatchObject({ status: 403, code: "agent_archived" });
  });

  it("the MCP bridge runs the same check: a paused agent's tools/call is a deny envelope", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const token = await g.token();
    const client = new Client({ name: "state-test", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(g.client.mcpUrl("test")), { requestInit: { headers: g.client.sessionHeaders(token) } }));
    try {
      await repos.agents.setStatus(g.db, g.businessId, g.agentId, "paused");
      const result = await client.callTool({ name: "note", arguments: { text: "mcp" } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ outcome: "deny", policyIds: [AGENT_PAUSED_POLICY_ID] });
    } finally {
      await client.close();
      await repos.agents.setStatus(g.db, g.businessId, g.agentId, "healthy");
    }
  });

  it("session-token minting is refused for a paused agent and audited", async () => {
    await repos.agents.pauseAll(g.db, g.businessId);
    try {
      await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId, allowedTools: ["test:*"] })).rejects.toMatchObject({
        status: 403,
        code: "agent_paused",
      });
      const refused = await repos.audit.list(g.db, g.businessId, { action: "gateway.session_token.refused" });
      expect(refused.items.some((a) => (a.details as { policyIds?: string[] }).policyIds?.[0] === AGENT_PAUSED_POLICY_ID)).toBe(true);
    } finally {
      await repos.agents.setStatus(g.db, g.businessId, g.agentId, "healthy");
    }
    await expect(g.token()).resolves.toMatch(/\./);
  });
});

describe("club state (archive)", () => {
  it("an archived club: every call is business-archived + 403 + audit and no token can be minted", async () => {
    const g = await setupGateway();
    try {
      const token = await g.token();
      asAllow(await g.client.call(token, { connector: "test", tool: "note", args: {} }));
      await repos.businesses.archive(g.db, g.businessId);
      for (const tool of ["note", "send_message", "pay_out"]) {
        const res = await rawCall(g, token, { connector: "test", tool, args: tool === "pay_out" ? { amountMinor: 1 } : { to: "x@example.com" } });
        expect(res.status).toBe(403);
        const r = asDeny((await res.json()) as CallResponse);
        expect(r.policyIds).toEqual([BUSINESS_ARCHIVED_POLICY_ID]);
        const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
        expect(audit.details).toMatchObject({ outcome: "deny", policyIds: [BUSINESS_ARCHIVED_POLICY_ID] });
      }
      expect(g.seen).toHaveLength(1);
      await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId, allowedTools: ["test:*"] })).rejects.toMatchObject({ status: 403, code: "business_archived" });
    } finally {
      await g.close();
    }
  });
});

describe("BYOK key revoked", () => {
  let g: GatewayFixture;
  let clock = Date.now();
  const tick = (ms: number) => {
    clock += ms;
  };
  beforeAll(async () => {
    g = await setupGateway({ extraConnectorKeys: [ANTHROPIC_CONNECTOR_KEY], now: () => new Date(clock) });
    await repos.businesses.update(g.db, g.businessId, { modelBilling: "byok" });
  }, 120_000);
  afterAll(async () => {
    await g.close();
  });

  const anthropicTools = [`${ANTHROPIC_CONNECTOR_KEY}:*`, "test:*"];

  it("a BYOK club without a live Anthropic key: key-bearing tools are key-revoked, other connectors still run", async () => {
    const token = await g.token({ allowedTools: anthropicTools });
    const res = await rawCall(g, token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} });
    expect(res.status).toBe(403);
    const r = asDeny((await res.json()) as CallResponse);
    expect(r.policyIds).toEqual([KEY_REVOKED_POLICY_ID]);
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.details).toMatchObject({ outcome: "deny", policyIds: [KEY_REVOKED_POLICY_ID] });
    asAllow(await g.client.call(token, { connector: "test", tool: "note", args: {} }));
    expect(g.seen.map((s) => s.tool)).toEqual(["note"]);
  });

  it("the verdict is cached per session for at most 5 s: a stored key is seen after expiry, a revoked key is refused after expiry", async () => {
    const token = await g.token({ allowedTools: anthropicTools });
    asDeny(await g.client.call(token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} }));

    // Store a key the way apps/api keys.ts does: an `anthropic` integration with a live credential.
    const integration = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: ANTHROPIC_CONNECTOR_KEY, status: "connected", authKind: "api_key", accountLabel: "sk-ant-…1234" });
    const { credentialId } = await storeCredential(g.db, g.vault, g.businessId, integration.id, { kind: "api_key", secret: "sk-ant-test-0000" }, { kind: "api_key" });
    // Within the window the cached "no key" verdict still applies…
    tick(STATE_CACHE_TTL_MS - 1);
    asDeny(await g.client.call(token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} }));
    // …and after it the key is seen.
    tick(2);
    asAllow(await g.client.call(token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: { text: "with key" } }));

    // Revoke exactly as keys.revoke does: archive the credential rows and disconnect the integration.
    await repos.credentials.revoke(g.db, g.businessId, credentialId);
    await repos.integrations.disconnect(g.db, g.businessId, integration.id);
    tick(1_000);
    asAllow(await g.client.call(token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: { text: "cached" } })); // ≤ 5 s staleness by design
    tick(STATE_CACHE_TTL_MS);
    const res = await rawCall(g, token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} });
    expect(res.status).toBe(403);
    expect(asDeny((await res.json()) as CallResponse).policyIds).toEqual([KEY_REVOKED_POLICY_ID]);

    // A fresh session has no cached verdict: refused at once.
    const fresh = await g.token({ allowedTools: anthropicTools, sessionId: await g.newSession() });
    asDeny(await g.client.call(fresh, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} }));
  });

  it("a credits club never needs the key", async () => {
    await repos.businesses.update(g.db, g.businessId, { modelBilling: "credits" });
    try {
      const token = await g.token({ allowedTools: anthropicTools, sessionId: await g.newSession() });
      asAllow(await g.client.call(token, { connector: ANTHROPIC_CONNECTOR_KEY, tool: "note", args: {} }));
    } finally {
      await repos.businesses.update(g.db, g.businessId, { modelBilling: "byok" });
    }
  });
});

describe("state helpers", () => {
  const live = { archivedAt: null };
  const agent = { name: "A", status: "healthy" as const, archivedAt: null };

  it("stateDenial orders club > release > pause and allows a working agent", () => {
    expect(stateDenial(live, agent)).toBeNull();
    expect(stateDenial(live, { ...agent, status: "idle" })).toBeNull();
    expect(stateDenial(live, { ...agent, status: "paused" })?.policyId).toBe(AGENT_PAUSED_POLICY_ID);
    expect(stateDenial(live, { ...agent, status: "paused", archivedAt: new Date() })?.policyId).toBe(AGENT_ARCHIVED_POLICY_ID);
    expect(stateDenial({ archivedAt: new Date() }, { ...agent, status: "paused", archivedAt: new Date() })?.policyId).toBe(BUSINESS_ARCHIVED_POLICY_ID);
  });

  it("toolNeedsByokKey is true only for a BYOK club on the key-bearing connector", () => {
    expect(toolNeedsByokKey({ modelBilling: "byok" }, ANTHROPIC_CONNECTOR_KEY)).toBe(true);
    expect(toolNeedsByokKey({ modelBilling: "byok" }, "test")).toBe(false);
    expect(toolNeedsByokKey({ modelBilling: "credits" }, ANTHROPIC_CONNECTOR_KEY)).toBe(false);
  });

  it("SessionStateCache expires on the caller's clock, is bounded and never exceeds 5 s", () => {
    const cache = new SessionStateCache(1_000, 4);
    cache.set("a", true, 0);
    expect(cache.get("a", 999)).toBe(true);
    expect(cache.get("a", 1_000)).toBeUndefined();
    for (const k of ["b", "c", "d", "e", "f"]) cache.set(k, false, 2_000);
    expect(cache.size).toBeLessThanOrEqual(4);
    cache.invalidate("f");
    expect(cache.get("f", 2_001)).toBeUndefined();
    cache.invalidate();
    expect(cache.size).toBe(0);
    expect(() => new SessionStateCache(STATE_CACHE_TTL_MS + 1)).toThrow(RangeError);
    const off = new SessionStateCache(0);
    off.set("x", true, 0);
    expect(off.get("x", 0)).toBeUndefined();
  });
});
