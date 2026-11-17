/**
 * The quarantined reader (BUILD §9.8 step 2; audit SECX-8): a session that holds tools which contact people, spend money or
 * cannot be undone never receives third-party text raw. A model with no tools reads it and the agent gets typed fields
 * only; if the reader fails the agent gets nothing; a session with no such tools still reads the content itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { includedCreditsMinor } from "@foundmill/config";
import { periodOf, repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createModelClient, meter, resolveModel } from "@foundmill/models";
import { loadEnv } from "@foundmill/shared";
import { generateMasterKey, LocalVault } from "@foundmill/shared/crypto";
import { createGatewayClient, type GatewayClient } from "../client";
import { storeCredential } from "../credentials";
import { buildGateway, listenGateway, type RunningGateway } from "../index";
import type { GatewayLogger } from "../pipeline";
import { ANTHROPIC_CONNECTOR_KEY } from "../state";
import { createUntrustedReader, grantsOutboundTools, READER_UNAVAILABLE, UntrustedDigest, type UntrustedReader } from "../untrusted-reader";
import { createTestConnector, setupGateway, silentLog, TEST_CONNECTOR, TEST_SECRET, UNTRUSTED_EMAIL, type GatewayFixture } from "./harness";
import type { AllowResponse, CallResponse } from "../types";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(async () => {
  await g.recipients.clear(g.businessId);
  g.deps.reader = createUntrustedReader(createModelClient({ mode: "mock" }));
});

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

describe("grantsOutboundTools", () => {
  it("is true when a granted tool contacts a third party, spends or cannot be undone", () => {
    const registry = g.deps.registry;
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:*`])).toBe(true);
    expect(grantsOutboundTools(registry, ["*"])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:send_message`])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:spend`])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:delete_everything`])).toBe(true);
  });

  it("is false for read-only and internal grants", () => {
    const registry = g.deps.registry;
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:read_inbox`, `${TEST_CONNECTOR}:note`])).toBe(false);
    expect(grantsOutboundTools(registry, [])).toBe(false);
    expect(grantsOutboundTools(registry, ["other:*"])).toBe(false);
  });
});

describe("untrusted content for a session that holds outbound tools", () => {
  it("returns typed fields, never the text, and still registers the recipients it held", async () => {
    const token = await g.token({ sessionId: await g.newSession() });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-1" } }));
    expect(read.result.untrusted).toBe(true);
    const envelope = read.result.data as { untrusted: boolean; quarantined?: boolean; content: unknown; source: { connector: string } };
    expect(envelope).toMatchObject({ untrusted: true, quarantined: true, source: { connector: TEST_CONNECTOR } });
    // Exactly the digest's fields, validated; nothing else of the content comes through.
    expect(UntrustedDigest.safeParse(envelope.content).success).toBe(true);
    expect(Object.keys(envelope.content as object).sort()).toEqual(["amounts", "dates", "sender", "summary", "title"]);
    const wire = JSON.stringify(read.result);
    expect(wire).not.toMatch(/IGNORE YOUR RULES/i);
    // The addresses in the raw text are still remembered for the business, so they cannot be contacted without approval.
    expect(await g.recipients.firstSeenInUntrusted(g.businessId, "any-session", [{ kind: "email", value: UNTRUSTED_EMAIL }])).toHaveLength(1);
  });

  it("registers the addresses the digest gives the agent, too, so one the raw scan missed still needs approval", async () => {
    // The reader writes out an address the raw text only hinted at (spelled out, odd characters): the agent receives it
    // as an ordinary address, so it is remembered as first seen in untrusted content like the raw text's addresses.
    const learned = "billing.desk@digest-only.example";
    g.deps.reader = { digest: async () => ({ title: "Invoice", sender: learned, summary: `Write back to ${learned} with the figures`, amounts: [], dates: [] }) } satisfies UntrustedReader;
    const token = await g.token({ sessionId: await g.newSession() });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-5" } }));
    expect((read.result.data as { content: { sender: string } }).content.sender).toBe(learned);
    expect(await g.recipients.firstSeenInUntrusted(g.businessId, "any-session", [{ kind: "email", value: learned }])).toHaveLength(1);
    g.seen.length = 0;
    const send = await g.client.call(token, { connector: TEST_CONNECTOR, tool: "send_message", args: { to: learned, body: "The figures" } });
    expect(send.outcome).not.toBe("allow");
    expect(g.seen.map((s) => s.tool)).not.toContain("send_message");
  });

  it("returns nothing at all when the reader fails", async () => {
    g.deps.reader = { digest: async () => Promise.reject(new Error("model unavailable")) } satisfies UntrustedReader;
    const token = await g.token({ sessionId: await g.newSession() });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-2" } }));
    expect(read.result.data).toMatchObject({ untrusted: true, quarantined: true, content: null });
    expect((read.result.data as { unavailable: string }).unavailable).toMatch(/could not be checked safely/);
    expect(JSON.stringify(read.result)).not.toMatch(/IGNORE YOUR RULES|untrusted\.example/i);
    // The recipients are remembered even though the agent saw nothing.
    expect(await g.recipients.size(g.businessId)).toBeGreaterThan(0);
  });

  it("is booked to the business's usage ledger as the reader's model call would be", async () => {
    // The gateway's own usage sink (builtins.ts `gatewayUsageSink`) books the row; here the mock client reports usage.
    const events: string[] = [];
    g.deps.reader = createUntrustedReader(createModelClient({ mode: "mock", onUsage: (e) => void events.push(`${e.route}:${e.attribution?.businessId}:${e.attribution?.kind}`) }));
    const token = await g.token({ sessionId: await g.newSession() });
    asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-3" } }));
    expect(events).toEqual([`quarantinedReader:${g.businessId}:quarantined_reader`]);
  });
});

/**
 * WP-09 T3 (A7-03): the reader the pipeline runs is the production one from `buildGateway`: it asks the business's
 * credits before a call on the platform key, books the exact cost, and runs on a business's own key when it has one.
 * Every live model client the gateway builds sends through `modelFetch`, so no request leaves the test.
 */
describe("the pipeline's reader asks first and books the exact cost (buildGateway, MODEL_MODE=live)", () => {
  let h: TestHarness;
  let db: Db;
  let server: RunningGateway;
  let client: GatewayClient;
  let vault: LocalVault;
  const warnings: string[] = [];
  const requests: { apiKey: string | null; model: string }[] = [];
  /** The digest's usage: 6,000 input tokens on Haiku 4.5 at $1/MTok is 0.6 of a cent, booked as 600,000 micro-cents. */
  const READER_USAGE = { input_tokens: 6_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const modelFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model: string };
    requests.push({ apiKey: new Headers(init?.headers as HeadersInit).get("x-api-key"), model: body.model });
    const digest = { title: "Invoice", sender: null, summary: "An invoice.", amounts: [], dates: [] };
    return Response.json({ id: "msg_reader", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null, usage: READER_USAGE, content: [{ type: "text", text: JSON.stringify(digest) }] });
  }) as unknown as typeof globalThis.fetch;
  const log: GatewayLogger = { ...silentLog, warn: (obj: unknown) => void warnings.push(JSON.stringify(obj)), child: () => log };

  interface Desk {
    businessId: string;
    agentId: string;
    sessionId: string;
  }
  async function desk(name: string): Promise<Desk> {
    const business = await repos.businesses.create(db, { name, businessMode: "assisted" });
    const agent = await repos.agents.create(db, business.id, { name: "Reader Worker", agentType: "developer", modelKey: "sonnet", initialVersion: { instructions: { role: "worker" }, tools: [] } });
    await repos.integrations.upsert(db, business.id, { connectorKey: TEST_CONNECTOR, status: "connected", authKind: "api_key", accountLabel: "test account" });
    const session = await repos.agents.createSession(db, business.id, { agentId: agent.id, modelKey: "sonnet" });
    return { businessId: business.id, agentId: agent.id, sessionId: session.id };
  }
  const read = async (d: Desk, id: string) => {
    const { token } = await client.mintSessionToken({ businessId: d.businessId, agentId: d.agentId, sessionId: d.sessionId, allowedTools: [`${TEST_CONNECTOR}:*`] });
    return asAllow(await client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id } }));
  };
  /** This month's credits set to exactly zero (the row is created with the tier's included credits first). */
  async function spendAll(businessId: string) {
    const period = periodOf(new Date());
    await repos.usage.ensurePeriodCredits(db, businessId, period, includedCreditsMinor("free"));
    const balance = (await repos.usage.creditBalance(db, businessId, period))!;
    await repos.usage.chargeCredits(db, businessId, period, Number(balance.balanceMinor));
  }
  const readerRows = async (d: Desk) => (await repos.usage.list(db, d.businessId, { sessionId: d.sessionId, kind: "tokens" })).items.filter((u) => (u.details as { route?: string }).route === "quarantinedReader");

  beforeAll(async () => {
    h = await createTestDb();
    db = h.db as unknown as Db;
    vault = new LocalVault(generateMasterKey());
    const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-platform-test", SESSION_TOKEN_SECRET: TEST_SECRET, REDIS_URL: "redis://127.0.0.1:1" });
    server = await listenGateway(buildGateway({ env, db, vault, log, registry: createTestConnector().registry, modelFetch }).app, { port: 0, host: "127.0.0.1" });
    client = createGatewayClient({ baseUrl: server.url, serviceSecret: TEST_SECRET, serviceName: "orchestrator" });
  }, 120_000);
  afterAll(async () => {
    await server?.stop();
    await h?.close();
  });
  beforeEach(() => {
    requests.length = 0;
    warnings.length = 0;
  });

  it("a business at zero credits is refused before any request, and the content is withheld", async () => {
    const d = await desk("Spent Reader Co");
    await spendAll(d.businessId);
    const r = await read(d, "m-6");
    expect(r.result.data).toMatchObject({ untrusted: true, quarantined: true, content: null, unavailable: READER_UNAVAILABLE });
    expect(requests).toHaveLength(0);
    expect(warnings.join("\n")).toMatch(/credits are used up/);
    expect(await readerRows(d)).toHaveLength(0);
  });

  it("a 6,000-token digest books its fractional cost exactly, not 0 or 1 cent, on the platform's credits", async () => {
    const d = await desk("Fractional Reader Co");
    const r = await read(d, "m-7");
    expect((r.result.data as { content: { title: string } }).content.title).toBe("Invoice");
    expect(requests).toEqual([{ apiKey: "sk-ant-platform-test", model: resolveModel("quarantinedReader").modelId }]);
    const [row] = await readerRows(d);
    expect(row).toMatchObject({ billedTo: "credits", agentId: d.agentId, details: { service: "gateway", kind: "quarantined_reader" } });
    expect(Number(row!.costMicroMinor)).toBe(meter({ inputTokens: 6_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, resolveModel("quarantinedReader").modelId).costMicroMinor);
    expect(Number(row!.costMicroMinor)).toBe(60_000); // 6,000 tokens at Haiku 5.5's $0.10 per 1M: 0.06 cents
  });

  it("a business on its own key pays for the pipeline's reader on that key, even with no credits left", async () => {
    const d = await desk("Own Key Reader Co");
    await repos.businesses.update(db, d.businessId, { modelBilling: "byok" });
    const integration = await repos.integrations.upsert(db, d.businessId, { connectorKey: ANTHROPIC_CONNECTOR_KEY, status: "connected", authKind: "api_key", accountLabel: "sk-ant-…own" });
    await storeCredential(db, vault, d.businessId, integration.id, { kind: "api_key", secret: "sk-ant-own-key-0000" });
    await spendAll(d.businessId);
    const r = await read(d, "m-8");
    expect((r.result.data as { content: { title: string } }).content.title).toBe("Invoice");
    expect(requests.map((q) => q.apiKey)).toEqual(["sk-ant-own-key-0000"]);
    const [row] = await readerRows(d);
    expect(row).toMatchObject({ billedTo: "byok" });
  });
});

describe("untrusted content for a session with no outbound tools", () => {
  it("still reads the content itself", async () => {
    const token = await g.token({ sessionId: await g.newSession(), allowedTools: [`${TEST_CONNECTOR}:read_inbox`] });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-4" } }));
    const envelope = read.result.data as { quarantined?: boolean; content: { from: string; body: string } };
    expect(envelope.quarantined).toBeUndefined();
    expect(envelope.content.from).toBe(UNTRUSTED_EMAIL);
    expect(envelope.content.body).toMatch(/IGNORE YOUR RULES/);
  });
});
