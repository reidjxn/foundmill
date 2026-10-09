/**
 * The pipeline over HTTP on an ephemeral port with PGlite, the test connector and the in-memory rate limiter.
 * Policy outcomes are asserted end to end: audit rows, approvals + outbox events, usage_ledger metering.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_MODES, ForbiddenError } from "@foundmill/shared";
import { mockIntegrationRecord } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { GatewayClientError } from "../client";
import { createGatewayApp, MAX_CALL_BODY_BYTES, MAX_MCP_BODY_BYTES, MAX_SERVICE_BODY_BYTES } from "../app";
import { guardGithubWrite, modeFor } from "../pipeline";
import { signServiceToken } from "../tokens";
import { hashRecipient } from "../recipients";
import { SAFE_EMAIL, setupGateway, TEST_CONNECTOR, TEST_SECRET, UNTRUSTED_EMAIL, type GatewayFixture } from "./harness";
import type { AllowResponse, AskResponse, CallResponse, DenyResponse } from "../types";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(async () => {
  g.seen.length = 0;
  await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
});

const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome).toBe("deny");
  return r as DenyResponse;
};
const asAsk = (r: CallResponse): AskResponse => {
  expect(r.outcome).toBe("ask");
  return r as AskResponse;
};
const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

describe("health and catalogue", () => {
  it("GET /health reports the mode, the connectors and the policy set", async () => {
    const health = await g.client.health();
    expect(health).toMatchObject({ ok: true, db: true, service: "gateway", mode: "mock", connectors: 1, vault: "local", rateLimitStore: "memory" });
    expect(health.policy.policies).toBeGreaterThanOrEqual(15);
  });

  it("GET /health reports ok:false with db:false when the database did not answer at boot", async () => {
    const { createGatewayApp } = await import("../app");
    const app = createGatewayApp(g.deps, { sessionTokenSecret: "x".repeat(32), dbReady: () => false });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, db: false, service: "gateway" });
  });

  it("GET /v1/connectors lists phase, auth kind, tools and policyHints", async () => {
    const { connectors } = await g.client.listConnectors();
    expect(connectors).toHaveLength(1);
    const c = connectors[0]!;
    expect(c).toMatchObject({ key: TEST_CONNECTOR, phase: 1, auth: { kind: "api_key" }, mode: "mock" });
    expect(c.tools.map((t) => t.name)).toContain("send_message");
    expect(c.policyHints["pay_out"]).toMatchObject({ hardGate: true });
  });
});

describe("session tokens", () => {
  it("requires a service token to mint", async () => {
    const res = await fetch(`${g.server.url}/v1/session-tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(401);
    const bad = await fetch(`${g.server.url}/v1/session-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken("wrong-secret-0123456789abcdef", "x")}` },
      body: JSON.stringify({ businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId }),
    });
    expect(bad.status).toBe(401);
  });

  it("mints a scoped session token for a real agent of a real club and audits it", async () => {
    const minted = await g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId, allowedTools: ["test:note"], ttlSeconds: 120 });
    expect(minted.token.split(".")).toHaveLength(3);
    expect(new Date(minted.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const audit = await repos.audit.list(g.db, g.businessId, { action: "gateway.session_token.minted" });
    expect(audit.items.some((a) => (a.details as { tokenId?: string }).tokenId === minted.jti)).toBe(true);
  });

  it("refuses to mint for an unknown agent", async () => {
    await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: "99999999-9999-4999-8999-999999999999", sessionId: g.sessionId })).rejects.toMatchObject({ status: 404, code: "agent_not_found" });
  });

  it("a session token cannot be used without Bearer and a tampered token is rejected", async () => {
    const res = await fetch(`${g.server.url}/v1/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connector: "test", tool: "note", args: {} }) });
    expect(res.status).toBe(401);
    const token = await g.token();
    await expect(g.client.call(`${token}x`, { connector: "test", tool: "note" })).rejects.toBeInstanceOf(GatewayClientError);
  });
});

describe("hard gates (Gate 0)", () => {
  it.each(BUSINESS_MODES)("denies the hard-gated tool in %s mode, audits it and queues a founder task", async (mode) => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
    const token = await g.token();
    const r = asDeny(await g.client.call(token, { connector: "test", tool: "pay_out", args: { amountMinor: 100 }, context: { amountMinor: 100, currency: "EUR" } }));
    expect(r.policyIds).toContain("hard-gate");
    expect(r.reasons.join(" ")).toMatch(/Hard gate/);
    expect(g.seen).toHaveLength(0);
    // The founder sees it: an approvals row + approval.requested with hardGate true through the outbox.
    expect(r.approvalId).toBeDefined();
    const approval = await repos.approvals.get(g.db, g.businessId, r.approvalId!);
    expect(approval).toMatchObject({ connectorKey: "test", tool: "pay_out", agentId: g.agentId, resolvedAt: null });
    const events = await repos.events.list(g.db, g.businessId, { type: "approval.requested" });
    const ev = events.items.find((e) => (e.payload as { approvalId?: string }).approvalId === r.approvalId);
    expect(ev?.payload).toMatchObject({ hardGate: true, connectorKey: "test", tool: "pay_out", amount: { amountMinor: 100, currency: "EUR" } });
    expect(r.humanAction).toMatchObject({ connector: "test", tool: "pay_out", reason: "hard_gate", url: "https://vendor.example/payouts" });
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.action).toBe("tool.call");
    expect(audit.details).toMatchObject({ outcome: "deny", policyIds: ["hard-gate"], approvalId: r.approvalId });
  });
});

describe("business modes", () => {
  it("augmented: an external action asks (approvals row + approval.requested event), nothing runs", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "augmented");
    const token = await g.token();
    const r = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "hi" } }));
    expect(r.policyIds).toContain("augmented-ask-external");
    expect(g.seen).toHaveLength(0);
    const approval = await repos.approvals.get(g.db, g.businessId, r.approvalId);
    expect(approval).toMatchObject({ connectorKey: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "hi" }, sessionId: g.sessionId });
    const events = await repos.events.list(g.db, g.businessId, { type: "approval.requested" });
    const ev = events.items.find((e) => (e.payload as { approvalId?: string }).approvalId === r.approvalId);
    expect(ev?.payload).toMatchObject({ hardGate: false, decisionType: "message_customers", policyIds: ["augmented-ask-external"] });
    // Written through the outbox: the relay (apps/api) will publish it to ev:{businessId}.
    const pending = await repos.events.outboxPending(g.db, g.businessId);
    expect(pending.some((o) => o.eventId === ev?.id)).toBe(true);
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.details).toMatchObject({ outcome: "ask", approvalId: r.approvalId });
  });

  it("augmented: internal work is allowed", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "augmented");
    const r = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: { text: "draft" } }));
    expect(r.policyIds).toEqual(["augmented-allow-internal"]);
    expect(g.seen.map((s) => s.tool)).toEqual(["note"]);
  });

  it("assisted: spends under the approval threshold run, above it ask", async () => {
    const token = await g.token();
    const under = asAllow(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 1000 }, context: { amountMinor: 1000, currency: "EUR" } }));
    expect(under.policyIds).toEqual(["assisted-allow-within-caps"]);
    expect(under.result.data).toEqual({ charged: 1000 });
    const over = asAsk(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 999_999 }, context: { amountMinor: 999_999, currency: "EUR" } }));
    expect(over.policyIds).toEqual(["assisted-ask-above-threshold"]);
    const ev = (await repos.events.list(g.db, g.businessId, { type: "approval.requested" })).items.find((e) => (e.payload as { approvalId?: string }).approvalId === over.approvalId);
    expect(ev?.payload).toMatchObject({ decisionType: "spend_above_threshold", amount: { amountMinor: 999_999, currency: "EUR" } });
    expect(g.seen.map((s) => s.tool)).toEqual(["spend"]);
  });

  it("per-agent autonomy overrides the business mode and the spend cap denies above the founder's ceiling", async () => {
    await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, { mode: "augmented", spendCapMinor: 500 });
    try {
      const token = await g.token();
      const ask = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL } }));
      expect(ask.policyIds).toContain("augmented-ask-external");
      const capped = asDeny(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 600 }, context: { amountMinor: 600 } }));
      expect(capped.policyIds).toEqual(["spend-cap-exceeded"]);
      expect(capped.approvalId).toBeUndefined();
    } finally {
      await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, {});
    }
  });

  it("automated: within caps everything non-gated runs; a holiday budget ceiling tightens the cap", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    const token = await g.token();
    const r = asAllow(await g.client.call(token, { connector: "test", tool: "delete_everything", args: {} }));
    expect(r.policyIds).toEqual(["automated-allow-within-caps"]);
    const holiday = await repos.holidays.start(g.db, g.businessId, { untilAt: new Date(Date.now() + 86_400_000), budgetCeilingMinor: 50 });
    try {
      const capped = asDeny(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 100 }, context: { amountMinor: 100 } }));
      expect(capped.policyIds).toEqual(["spend-cap-exceeded"]);
    } finally {
      await repos.holidays.end(g.db, g.businessId, holiday.id);
    }
  });
});

describe("recipients", () => {
  it("suppression list blocks a contact in every mode", async () => {
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: hashRecipient("email", "Unsubscribed@Example.com"), reason: "unsubscribed" });
    for (const mode of BUSINESS_MODES) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      const r = asDeny(await g.client.call(await g.token(), { connector: "test", tool: "send_message", args: { to: "unsubscribed@example.com", body: "offer" } }));
      expect(r.policyIds).toEqual(["suppressed-recipient"]);
    }
    expect(g.seen).toHaveLength(0);
    // The explicit context.recipient is checked too, whatever the args carry.
    const r = asDeny(await g.client.call(await g.token(), { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL }, context: { recipient: "unsubscribed@example.com" } }));
    expect(r.policyIds).toEqual(["suppressed-recipient"]);
  });

  it("a recipient first seen in untrusted content is blocked for that session only", async () => {
    const sessionA = await g.newSession();
    const sessionB = await g.newSession();
    const tokenA = await g.token({ sessionId: sessionA });
    const read = asAllow(await g.client.call(tokenA, { connector: "test", tool: "read_inbox", args: { id: "m-7" } }));
    expect(read.result.untrusted).toBe(true);
    expect(read.result.data).toMatchObject({ untrusted: true, source: { connector: "test", kind: "email", ref: "message:m-7" } });
    expect((read.result.data as { content: { from: string } }).content.from).toBe(UNTRUSTED_EMAIL);
    expect(g.recipients.size(sessionA)).toBeGreaterThanOrEqual(2);

    const blocked = asDeny(await g.client.call(tokenA, { connector: "test", tool: "send_message", args: { to: UNTRUSTED_EMAIL, body: "reorder" } }));
    expect(blocked.policyIds).toEqual(["untrusted-recipient"]);
    const blockedUrl = asDeny(await g.client.call(tokenA, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "see https://untrusted.example/order-form/" } }));
    expect(blockedUrl.policyIds).toEqual(["untrusted-recipient"]);

    // The same recipient from a session that never read the content is a normal contact (assisted → allowed).
    const other = asAllow(await g.client.call(await g.token({ sessionId: sessionB }), { connector: "test", tool: "send_message", args: { to: UNTRUSTED_EMAIL } }));
    expect(other.result.data).toEqual({ sent: true, to: UNTRUSTED_EMAIL });
    expect(g.seen.filter((s) => s.tool === "send_message")).toHaveLength(1);
  });

  it("recipients seeded at mint (files an earlier session left) are untrusted from the first call, in that session only", async () => {
    const restored = await g.newSession();
    const fresh = await g.newSession();
    const tooMany = await g.newSession();
    const seededToken = (await g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: restored, allowedTools: ["test:*"], untrusted: { emails: ["Ops@Evil.Example"], urls: ["https://evil.example/drop/"] } })).token;
    const before = g.seen.filter((s) => s.tool === "send_message").length;
    expect(asDeny(await g.client.call(seededToken, { connector: "test", tool: "send_message", args: { to: "ops@evil.example", body: "build notes" } })).policyIds).toEqual(["untrusted-recipient"]);
    expect(asDeny(await g.client.call(seededToken, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "see https://evil.example/drop" } })).policyIds).toEqual(["untrusted-recipient"]);
    asAllow(await g.client.call(seededToken, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "hello" } }));
    asAllow(await g.client.call(await g.token({ sessionId: fresh }), { connector: "test", tool: "send_message", args: { to: "ops@evil.example" } }));

    // Too many to list: every recipient of the session is treated as untrusted.
    const allToken = (await g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: tooMany, allowedTools: ["test:*"], untrusted: { all: true } })).token;
    expect(asDeny(await g.client.call(allToken, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL } })).policyIds).toEqual(["untrusted-recipient"]);
    expect(g.seen.filter((s) => s.tool === "send_message").length - before).toBe(2);

    // The register is per process: after a restart (or on another replica) the seed is gone, and the token's
    // untrustedSeeded claim makes that session fail closed, while an unseeded session is unaffected.
    g.recipients.clear(restored);
    expect(asDeny(await g.client.call(seededToken, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "hello" } })).policyIds).toEqual(["untrusted-recipient"]);
    asAllow(await g.client.call(await g.token({ sessionId: fresh }), { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL } }));
    // Tools that contact nobody still work.
    asAllow(await g.client.call(seededToken, { connector: "test", tool: "note", args: { text: "x" } }));
    expect(g.seen.filter((s) => s.tool === "send_message").length - before).toBe(3);

    const audit = await repos.audit.list(g.db, g.businessId, { action: "gateway.session_token.minted" });
    const seeds = audit.items.map((a) => a.details as { untrustedSeeded?: number; untrustedAll?: boolean }).filter((d) => d.untrustedSeeded !== undefined);
    expect(seeds).toEqual(expect.arrayContaining([expect.objectContaining({ untrustedSeeded: 2, untrustedAll: false }), expect.objectContaining({ untrustedSeeded: 0, untrustedAll: true })]));
  });
});

describe("allow path", () => {
  it("calls the mock connector, meters the cost into usage_ledger and audits", async () => {
    const before = await repos.usage.totals(g.db, g.businessId, { agentId: g.agentId });
    const token = await g.token();
    const r = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "hello" } }));
    expect(r).toMatchObject({ costMinor: 7, result: { ok: true, data: { sent: true, to: SAFE_EMAIL }, untrusted: false, costMinor: 7 } });
    expect(g.seen.at(-1)).toMatchObject({ tool: "send_message", args: { to: SAFE_EMAIL, body: "hello" }, mode: "mock", integrationStatus: "connected" });
    const note = asAllow(await g.client.call(token, { connector: "test", tool: "note", args: { text: "x" } }));
    expect(note.costMinor).toBe(3); // connector.costModel
    const after = await repos.usage.totals(g.db, g.businessId, { agentId: g.agentId });
    expect(after.costMinor - before.costMinor).toBe(10);
    expect(after.byKind.tool.quantity - before.byKind.tool.quantity).toBe(2);
    const entries = await repos.usage.list(g.db, g.businessId, { sessionId: g.sessionId, kind: "tool" });
    expect(entries.items[0]?.details).toMatchObject({ connector: "test", label: "Estimate" });
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit).toMatchObject({ actorKind: "agent", actorId: g.agentId, action: "tool.call", target: { connector: "test", tool: "send_message" } });
    expect(audit.details).toMatchObject({ outcome: "allow", costMinor: 7, resultOk: true, sessionId: g.sessionId, policyIds: ["assisted-allow-within-caps"] });
    expect((await repos.audit.verify(g.db, g.businessId)).ok).toBe(true);
  });

  it("decrypts the stored credential in memory for the call and never writes it anywhere", async () => {
    const secret = "sk-test-very-secret-value-4242";
    await storeCredential(g.db, g.vault, g.businessId, g.integrationId, { kind: "api_key", secret, accountId: "acct_1" });
    const r = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: { text: "with credential" } }));
    expect(g.seen.at(-1)?.credentialSecret).toBe(secret);
    expect(JSON.stringify(r)).not.toContain(secret);
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(JSON.stringify(audit)).not.toContain(secret);
    const usage = await repos.usage.list(g.db, g.businessId, { sessionId: g.sessionId });
    expect(JSON.stringify(usage)).not.toContain(secret);
  });

  it("invalid arguments are a tool error inside an allow outcome (nothing metered)", async () => {
    const before = await repos.usage.totals(g.db, g.businessId, { agentId: g.agentId });
    const r = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "spend", args: { amountMinor: "lots" } }));
    expect(r.result.ok).toBe(false);
    expect(r.result.error?.code).toBe("invalid_args");
    const after = await repos.usage.totals(g.db, g.businessId, { agentId: g.agentId });
    expect(after.entries).toBe(before.entries);
  });
});

describe("scope, unknown tools and rate limits", () => {
  it("a tool outside the session's allowedTools is denied before the connector is touched", async () => {
    const token = await g.token({ allowedTools: ["test:note"] });
    const r = asDeny(await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL } }));
    expect(r.policyIds).toEqual(["session-scope"]);
    expect(r.reasons[0]).toMatch(/not in this session's allowed tools/);
    expect(g.seen).toHaveLength(0);
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.details).toMatchObject({ outcome: "deny", policyIds: ["session-scope"] });
    asAllow(await g.client.call(token, { connector: "test", tool: "note", args: {} }));
  });

  it("unknown connectors and tools are 404s", async () => {
    const token = await g.token({ allowedTools: ["*"] });
    await expect(g.client.call(token, { connector: "nope", tool: "x" })).rejects.toMatchObject({ status: 404, code: "unknown_connector" });
    await expect(g.client.call(token, { connector: "test", tool: "nope" })).rejects.toMatchObject({ status: 404, code: "unknown_tool" });
  });

  it("rate limits per connector per business with 429 + Retry-After", async () => {
    const limited = await setupGateway({ connector: { perMinute: 2 } });
    try {
      const token = await limited.token();
      asAllow(await limited.client.call(token, { connector: "test", tool: "note", args: {} }));
      asAllow(await limited.client.call(token, { connector: "test", tool: "note", args: {} }));
      const res = await fetch(`${limited.server.url}/v1/call`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ connector: "test", tool: "note", args: {} }),
      });
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      const body = (await res.json()) as CallResponse;
      expect(body).toMatchObject({ outcome: "rate_limited", scope: "minute", limit: 2 });
      expect(limited.seen).toHaveLength(2);
      // Another club is not affected.
      const other = await repos.businesses.create(limited.db, { name: "Other Club" });
      const otherAgent = await repos.agents.create(limited.db, other.id, { name: "Other", agentType: "developer" });
      const otherSession = await repos.agents.createSession(limited.db, other.id, { agentId: otherAgent.id });
      const otherToken = (await limited.client.mintSessionToken({ businessId: other.id, agentId: otherAgent.id, sessionId: otherSession.id, allowedTools: ["test:*"] })).token;
      asAllow(await limited.client.call(otherToken, { connector: "test", tool: "note", args: {} }));
    } finally {
      await limited.close();
    }
  });
});

describe("live mode", () => {
  it("refuses a connector that needs a credential when none is stored, and runs when one is", async () => {
    const live = await setupGateway({ mode: "live" });
    try {
      const token = await live.token();
      await expect(live.client.call(token, { connector: "test", tool: "note", args: {} })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
      await storeCredential(live.db, live.vault, live.businessId, live.integrationId, { kind: "api_key", secret: "live-key-123456" });
      const r = asAllow(await live.client.call(token, { connector: "test", tool: "note", args: {} }));
      expect(r.result.ok).toBe(true);
      expect(live.seen.at(-1)).toMatchObject({ mode: "live", credentialSecret: "live-key-123456" });
    } finally {
      await live.close();
    }
  });
});

describe("LIVE_CONNECTORS", () => {
  it("runs the named connectors live while every other connector stays mock", async () => {
    const mixed = await setupGateway({ mode: "mock", liveConnectors: ["test"], connector: { authKind: "app" }, extraConnectorKeys: ["other"] });
    try {
      await repos.integrations.upsert(mixed.db, mixed.businessId, { connectorKey: TEST_CONNECTOR, status: "connected", authKind: "app", settings: { externalAccountId: "1", config: {} } });
      await repos.integrations.recordVerifiedInstallation(mixed.db, mixed.businessId, { connectorKey: TEST_CONNECTOR, installationId: "1", accountLabel: "acme", verifiedBy: "founder-login", verifiedAt: new Date() });
      asAllow(await mixed.client.call(await mixed.token({ allowedTools: ["test:*", "other:*"] }), { connector: "test", tool: "note", args: {} }));
      expect(mixed.seen.at(-1)).toMatchObject({ mode: "live" });
      asAllow(await mixed.client.call(await mixed.token({ allowedTools: ["test:*", "other:*"] }), { connector: "other", tool: "note", args: {} }));
      expect(mixed.seen.at(-1)).toMatchObject({ mode: "mock" });
    } finally {
      await mixed.close();
    }
    expect(modeFor({ mode: "mock", liveConnectors: ["github"] }, "github")).toBe("live");
    expect(modeFor({ mode: "mock", liveConnectors: ["github"] }, "stripe")).toBe("mock");
    expect(modeFor({ mode: "live" }, "stripe")).toBe("live");
  });
});

describe("live mode: App connectors (GitHub)", () => {
  it("run only for the installation the gateway verified, without a stored secret, and stop once disconnected", async () => {
    const live = await setupGateway({ mode: "live", connector: { authKind: "app" } });
    try {
      const token = await live.token();
      const call = () => live.client.call(token, { connector: "test", tool: "note", args: {} });
      const setRow = (status: "connected" | "mock" | "expired", externalAccountId: string, config: Record<string, unknown> = {}) => repos.integrations.upsert(live.db, live.businessId, { connectorKey: TEST_CONNECTOR, status, authKind: "app", settings: { externalAccountId, config } });

      // A connected row whose installation the gateway never verified is not enough, whatever its settings claim: a
      // business could write its own integration row directly.
      await setRow("connected", "48213377", { verifiedBy: "forged", verifiedAt: "2026-10-09T00:00:00Z" });
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });

      // The gateway verified installation 111 for this business; the row pointing anywhere else is refused.
      await repos.integrations.recordVerifiedInstallation(live.db, live.businessId, { connectorKey: TEST_CONNECTOR, installationId: "111", accountLabel: "acme", verifiedBy: "founder-login", verifiedAt: new Date() });
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
      await setRow("mock", "111");
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
      await setRow("expired", "111");
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });

      await setRow("connected", "111");
      const r = asAllow(await call());
      expect(r.result.ok).toBe(true);
      expect(live.seen.at(-1)).toMatchObject({ mode: "live", credentialSecret: null, integrationStatus: "connected" });
      await repos.integrations.disconnect(live.db, live.businessId, live.integrationId);
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
      // Disconnecting forgets the verification: writing the row back to connected does not bring the installation back.
      expect(await repos.integrations.verifiedInstallation(live.db, live.businessId, TEST_CONNECTOR)).toBeNull();
      await setRow("connected", "111");
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    } finally {
      await live.close();
    }
  });

  it("connect and health run in the gateway for a service caller, and only for App connectors", async () => {
    const inputs: unknown[] = [];
    const live = await setupGateway({
      mode: "live",
      connector: {
        authKind: "app",
        connect: async (businessId, input) => {
          inputs.push(input);
          if ((input as { code?: string }).code === "stolen") throw new ForbiddenError("GitHub installation 1 is not one you can manage");
          return { ...mockIntegrationRecord(TEST_CONNECTOR, businessId, { status: "connected" }), externalAccountId: "1", config: { verifiedBy: "founder-login", verifiedAt: "2026-10-09T00:00:00Z" }, credentialToStore: { kind: "app", secret: "never-leaves" } };
        },
      },
    });
    try {
      const post = async (path: string, body: unknown, token?: string) => {
        const res = await fetch(`${live.server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };
      const service = await signServiceToken(TEST_SECRET, "api");
      // Only the api connects installations; another service's token is refused.
      expect(await post("/v1/integrations/connect", { businessId: live.businessId, connector: TEST_CONNECTOR, input: { installationId: 1, code: "c0de" } }, await signServiceToken(TEST_SECRET, "orchestrator"))).toMatchObject({ status: 403, body: { error: { code: "forbidden_service" } } });

      expect((await post("/v1/integrations/connect", { businessId: live.businessId, connector: TEST_CONNECTOR, input: { installationId: 1, code: "c0de" } })).status).toBe(401);
      expect((await post("/v1/integrations/connect", { businessId: live.businessId, connector: TEST_CONNECTOR, input: {} }, await live.token())).status).toBe(401);

      const ok = await post("/v1/integrations/connect", { businessId: live.businessId, connector: TEST_CONNECTOR, input: { installationId: 1, code: "c0de" } }, service);
      expect(ok).toMatchObject({ status: 200, body: { mode: "live", record: { status: "connected", externalAccountId: "1", config: { verifiedBy: "founder-login" } } } });
      expect(JSON.stringify(ok.body)).not.toContain("never-leaves");
      expect(inputs.at(-1)).toEqual({ installationId: 1, code: "c0de" });
      expect((await repos.audit.list(live.db, live.businessId, { limit: 5 })).items.map((a) => a.action)).toContain("gateway.integration.connected");

      expect(await post("/v1/integrations/connect", { businessId: live.businessId, connector: TEST_CONNECTOR, input: { installationId: 1, code: "stolen" } }, service)).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
      expect(await post("/v1/integrations/connect", { businessId: "00000000-0000-4000-8000-000000000000", connector: TEST_CONNECTOR, input: {} }, service)).toMatchObject({ status: 404, body: { error: { code: "business_not_found" } } });
      expect(await post("/v1/integrations/connect", { businessId: live.businessId, connector: "nope", input: {} }, service)).toMatchObject({ status: 404, body: { error: { code: "unknown_connector" } } });

      // Connect recorded the verified installation, so the row the api writes next is trusted.
      expect(await repos.integrations.verifiedInstallation(live.db, live.businessId, TEST_CONNECTOR)).toMatchObject({ installationId: "1", verifiedBy: "founder-login" });
      // Health checks only a verified installation: a row naming another id gets no vendor call.
      await repos.integrations.upsert(live.db, live.businessId, { connectorKey: TEST_CONNECTOR, status: "connected", authKind: "app", settings: { externalAccountId: "999", config: {} } });
      expect(await post("/v1/integrations/health", { businessId: live.businessId, connector: TEST_CONNECTOR }, service)).toMatchObject({ status: 200, body: { health: { ok: false, status: "disconnected" } } });
      await repos.integrations.upsert(live.db, live.businessId, { connectorKey: TEST_CONNECTOR, status: "connected", authKind: "app", settings: { externalAccountId: "1", config: {} } });
      expect(await post("/v1/integrations/health", { businessId: live.businessId, connector: TEST_CONNECTOR }, service)).toMatchObject({ status: 200, body: { health: { ok: true } } });
      await repos.integrations.archive(live.db, live.businessId, live.integrationId);
      expect(await post("/v1/integrations/health", { businessId: live.businessId, connector: TEST_CONNECTOR }, service)).toMatchObject({ status: 409, body: { error: { code: "integration_not_connected" } } });
    } finally {
      await live.close();
    }
    const apiKeyed = await setupGateway({ mode: "live" });
    try {
      const res = await fetch(`${apiKeyed.server.url}/v1/integrations/connect`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, "api")}` }, body: JSON.stringify({ businessId: apiKeyed.businessId, connector: TEST_CONNECTOR, input: {} }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "not_app_connector" } });
    } finally {
      await apiKeyed.close();
    }
  });
});

describe("GitHub writes follow the founder's push settings", () => {
  it("change only the chosen repository, only while pushing is on, and commits always say [skip ci]; reads are free", () => {
    const row = (settings: Record<string, unknown>) => ({ id: "i1", status: "connected", archivedAt: null, settings }) as unknown as Parameters<typeof guardGithubWrite>[1];
    const on = row({ repo: "acme/shop", writeEnabled: true });
    const args = { owner: "Acme", repo: "Shop", branch: "agent/t1", message: "Code saved", files: [] };
    expect(guardGithubWrite("commit_files", null, args)).toEqual({ reason: "Pushing to GitHub is not turned on for this business (Development › Code)" });
    expect(guardGithubWrite("commit_files", row({ repo: "acme/shop" }), args)).toMatchObject({ reason: expect.stringContaining("not turned on") });
    expect(guardGithubWrite("commit_files", row({ repo: "acme/other", writeEnabled: true }), args)).toEqual({ reason: "Agents change only acme/other, the repository chosen on Development › Code" });
    expect(guardGithubWrite("commit_files", on, args)).toEqual({ args: { ...args, message: "Code saved\n\n[skip ci]" } });
    expect(guardGithubWrite("commit_files", on, { ...args, message: "x [skip ci]" })).toEqual({ args: { ...args, message: "x [skip ci]" } });
    // An upper-case marker is not GitHub's: the real one is still added.
    expect(guardGithubWrite("commit_files", on, { ...args, message: "x [SKIP CI]" })).toEqual({ args: { ...args, message: "x [SKIP CI]\n\n[skip ci]" } });
    for (const tool of ["create_branch", "open_pr", "merge_pr"]) {
      expect(guardGithubWrite(tool, on, { owner: "evil", repo: "other" }), tool).toMatchObject({ reason: expect.any(String) });
      expect(guardGithubWrite(tool, row({ repo: "acme/shop" }), { owner: "acme", repo: "shop" }), tool).toMatchObject({ reason: expect.any(String) });
      expect(guardGithubWrite(tool, on, { owner: "acme", repo: "shop", title: "t" }), tool).toEqual({ args: { owner: "acme", repo: "shop", title: "t" } });
    }
    expect(guardGithubWrite("read_file", null, { owner: "anyone", repo: "anything" })).toEqual({ args: { owner: "anyone", repo: "anything" } });
  });
});

describe("request bodies are bounded", () => {
  it("refuses a body past the route's limit before reading it, whoever sends it", async () => {
    // In-process: a server that answers 413 before reading a body drops that connection, which would upset the
    // shared fixture's pooled connections.
    const app = createGatewayApp(g.deps, { sessionTokenSecret: TEST_SECRET });
    const token = await g.token();
    const post = async (path: string, bytes: number, auth: string) => (await app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify({ connector: "test", tool: "note", args: { text: "x".repeat(bytes) } }) })).status;
    expect(await post("/v1/call", MAX_CALL_BODY_BYTES + 1, token)).toBe(413);
    expect(await post("/mcp/test", MAX_MCP_BODY_BYTES + 1, token)).toBe(413);
    expect(await post("/v1/integrations/connect", MAX_SERVICE_BODY_BYTES + 1, "anything")).toBe(413);
    expect(await post("/v1/call", 1000, "not-a-token")).toBe(401);
  });
});

describe("tokens stay honest", () => {
  it("a session token for one club cannot reach another club's data", async () => {
    const other = await repos.businesses.create(g.db, { name: "Rival Club" });
    const token = await g.token();
    // The token is bound to g.businessId; a call runs inside that club only. Audit rows land in the right chain.
    const r = asAllow(await g.client.call(token, { connector: "test", tool: "note", args: {} }));
    const audit = await repos.audit.get(g.db, g.businessId, r.auditId);
    expect(audit.businessId).toBe(g.businessId);
    await expect(repos.audit.get(g.db, other.id, r.auditId)).rejects.toThrow(/not found/);
    expect(TEST_SECRET.length).toBeGreaterThan(16);
  });
});
