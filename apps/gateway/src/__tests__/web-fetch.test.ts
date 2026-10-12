/**
 * The Source Watcher's read (`web.fetch`) through the production gateway over PGlite with the default registry in mock
 * mode: a token minted outside an agent session (the orchestrator mints one per read) is allowed to read a public page,
 * the page comes back as the untrusted envelope the orchestrator parses, the read is metered, and a page the mock
 * refuses comes back as a tool error, not an exception.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv, uuid } from "@foundmill/shared";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { buildGateway, createGatewayClient, listenGateway, type GatewayClient, type RunningGateway } from "../index";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let server: RunningGateway;
let client: GatewayClient;
let businessId: string;
let agentId: string;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", SESSION_TOKEN_SECRET: TEST_SECRET, REDIS_URL: "redis://127.0.0.1:1" });
  server = await listenGateway(buildGateway({ env, db, vault: null, log: silentLog }).app, { port: 0, host: "127.0.0.1" });
  client = createGatewayClient({ baseUrl: server.url, serviceSecret: TEST_SECRET, serviceName: "orchestrator" });
  businessId = (await repos.businesses.create(db, { name: "Web Reader" })).id;
  agentId = (await repos.agents.create(db, businessId, { name: "Product lead", agentType: "product_lead", modelKey: "opus" })).id;
}, 120_000);

afterAll(async () => {
  await server?.stop();
  await h?.close();
});

describe("web.fetch through the gateway (mock mode)", () => {
  it("reads a public page with a per-read token and meters it to the agent (no agent session row)", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: uuid(), allowedTools: ["web:fetch"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://example.com/competitor-pricing", maxChars: 12_000 } });
    expect(r.outcome).toBe("allow");
    if (r.outcome !== "allow") return;
    expect(r.result).toMatchObject({ ok: true, untrusted: true });
    expect(r.result.data).toMatchObject({ untrusted: true, content: { text: expect.stringContaining("$29"), title: expect.any(String) } });
    const usage = await repos.usage.list(db, businessId, { kind: "tool" });
    expect(usage.items.find((u) => (u.details as { connector?: string }).connector === "web")).toMatchObject({ agentId, sessionId: null });
  });

  it("a call inside a real agent session is still booked to that session", async () => {
    const sessionId = (await repos.agents.createSession(db, businessId, { agentId, modelKey: "opus" })).id;
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId, allowedTools: ["web:fetch"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://example.com/another-page" } });
    expect(r.outcome === "allow" && r.result.ok).toBe(true);
    expect((await repos.usage.list(db, businessId, { sessionId, kind: "tool" })).items).toHaveLength(1);
  });

  it("a page the site refuses comes back as a tool error the orchestrator can read", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: uuid(), allowedTools: ["web:fetch"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://blocked.example/pricing" } });
    expect(r.outcome).toBe("allow");
    if (r.outcome !== "allow") return;
    expect(r.result).toMatchObject({ ok: false, error: { code: "robots_disallowed" } });
  });

  it("a token for another tool cannot read pages", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: uuid(), allowedTools: ["ecb_rates:*"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://example.com/competitor-pricing" } });
    expect(r.outcome).toBe("deny");
  });
});
