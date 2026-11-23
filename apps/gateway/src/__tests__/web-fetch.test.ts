/**
 * The Source Watcher's read (`web.fetch`) through the production gateway over PGlite with the default registry in mock
 * mode: a token minted outside an agent session (the orchestrator mints one per read) is allowed to read a public page,
 * the page comes back as the untrusted envelope the orchestrator parses, the read is metered, and a page the mock
 * refuses comes back as a tool error, not an exception.
 */
import { spendAllCredits } from "@foundmill/db/testing/credits";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "@foundmill/shared";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { includedCreditsMinor } from "@foundmill/config";
import { periodOf, repos, type Db } from "@foundmill/db";
import { meter, MODELS, resolveModel, WEB_SEARCH_FEE_MICRO_MINOR } from "@foundmill/models";
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
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: null, allowedTools: ["web:fetch"], ttlSeconds: 300 });
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
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: null, allowedTools: ["web:fetch"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://blocked.example/pricing" } });
    expect(r.outcome).toBe("allow");
    if (r.outcome !== "allow") return;
    expect(r.result).toMatchObject({ ok: false, error: { code: "robots_disallowed" } });
  });

  it("a token for another tool cannot read pages", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId: null, allowedTools: ["ecb_rates:*"], ttlSeconds: 300 });
    const r = await client.call(token, { connector: "web", tool: "fetch", args: { url: "https://example.com/competitor-pricing" } });
    expect(r.outcome).toBe("deny");
  });
});

/**
 * WP-09 T3 (A7-03, A7-17): `search_web` live runs on the platform's model client (`LiveModelClient.searchWeb`), so it asks
 * the business's credits first and books what it cost: the tokens and the per-search fee, one `tokens` row on the
 * `webSearch` route. Every live model client the gateway builds sends through `modelFetch`: no request leaves the test.
 */
describe("web.search_web live (LIVE_CONNECTORS=web, MODEL_MODE=live)", () => {
  let lh: TestHarness;
  let ldb: Db;
  let live: RunningGateway;
  let liveClient: GatewayClient;
  const requests: { apiKey: string | null; body: { model?: string; tools?: { type: string; max_uses?: number }[] } }[] = [];
  const modelFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    requests.push({ apiKey: new Headers(init?.headers as HeadersInit).get("x-api-key"), body });
    return Response.json({
      id: "msg_search",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 2_500, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 1 } },
      content: [
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "q" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://cups.example/wholesale", title: "Cups", encrypted_content: "x" }] },
      ],
    });
  }) as unknown as typeof globalThis.fetch;

  /** Search runs on a paid plan's platform key; the free plan has no search until WP-13 T5. */
  async function researcher(name: string, planTier: "free" | "pro" = "pro") {
    const business = await repos.businesses.create(ldb, { name });
    await repos.businesses.update(ldb, business.id, { planTier });
    const agent = await repos.agents.create(ldb, business.id, { name: "Researcher", agentType: "researcher", modelKey: "sonnet" });
    const sessionId = (await repos.agents.createSession(ldb, business.id, { agentId: agent.id, modelKey: "sonnet" })).id;
    const { token } = await liveClient.mintSessionToken({ businessId: business.id, agentId: agent.id, sessionId, allowedTools: ["web:search_web"], ttlSeconds: 300 });
    return { businessId: business.id, agentId: agent.id, sessionId, token };
  }

  beforeAll(async () => {
    lh = await createTestDb();
    ldb = lh.db as unknown as Db;
    const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "web", MODEL_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-platform-test", SESSION_TOKEN_SECRET: TEST_SECRET, REDIS_URL: "redis://127.0.0.1:1" });
    live = await listenGateway(buildGateway({ env, db: ldb, vault: null, log: silentLog, modelFetch }).app, { port: 0, host: "127.0.0.1" });
    liveClient = createGatewayClient({ baseUrl: live.url, serviceSecret: TEST_SECRET, serviceName: "orchestrator" });
  }, 120_000);

  afterAll(async () => {
    await live?.stop();
    await lh?.close();
  });

  it("a search books one tokens row on the webSearch route: the tokens plus the per-search fee, on credits", async () => {
    requests.length = 0;
    const r = await researcher("Live Search Co");
    const out = await liveClient.call(r.token, { connector: "web", tool: "search_web", args: { query: "compostable cups wholesale" } });
    expect(out.outcome).toBe("allow");
    if (out.outcome !== "allow") return;
    expect(out.result.ok, JSON.stringify(out.result.error)).toBe(true);
    expect(out.result.data).toMatchObject({ untrusted: true, content: { results: [{ url: "https://cups.example/wholesale", title: "Cups", pageAge: null }] } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ apiKey: "sk-ant-platform-test", body: { model: resolveModel("webSearch").modelId, tools: [{ type: "web_search_20260209", max_uses: 2 }] } });
    const tokens = (await repos.usage.list(ldb, r.businessId, { sessionId: r.sessionId, kind: "tokens" })).items;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ agentId: r.agentId, billedTo: "credits", details: { service: "gateway", route: "webSearch" } });
    const tokenCost = meter({ inputTokens: 2_500, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, resolveModel("webSearch").modelId).costMicroMinor;
    expect(Number(tokens[0]!.costMicroMinor)).toBe(tokenCost + WEB_SEARCH_FEE_MICRO_MINOR);
  });

  it("a search at zero credits is refused before any request, and nothing is booked as tokens", async () => {
    requests.length = 0;
    const r = await researcher("Spent Search Co");
    const period = periodOf(new Date());
    await spendAllCredits(ldb, r.businessId, period);
    const out = await liveClient.call(r.token, { connector: "web", tool: "search_web", args: { query: "compostable cups wholesale" } });
    expect(out.outcome).toBe("allow");
    if (out.outcome !== "allow") return;
    expect(out.result).toMatchObject({ ok: false, error: { code: "credits_exhausted" } });
    expect(requests).toHaveLength(0);
    expect((await repos.usage.list(ldb, r.businessId, { sessionId: r.sessionId, kind: "tokens" })).items).toHaveLength(0);
  });

  it("a free business's search runs on Haiku 5.5, called directly, booked at its tokens and the per-search fee on credits (WP-13)", async () => {
    requests.length = 0;
    const r = await researcher("Free Search Co", "free");
    const out = await liveClient.call(r.token, { connector: "web", tool: "search_web", args: { query: "compostable cups wholesale" } });
    expect(out.outcome).toBe("allow");
    if (out.outcome !== "allow") return;
    expect(out.result.ok, JSON.stringify(out.result.error)).toBe(true);
    expect(requests).toEqual([{ apiKey: "sk-ant-platform-test", body: expect.objectContaining({ model: MODELS.haiku, tools: [expect.objectContaining({ type: "web_search_20260209", allowed_callers: ["direct"] })] }) }]);
    const tokens = (await repos.usage.list(ldb, r.businessId, { sessionId: r.sessionId, kind: "tokens" })).items;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ billedTo: "credits", modelKey: "haiku", details: { route: "webSearch" } });
    const tokenCost = meter({ inputTokens: 2_500, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, MODELS.haiku).costMicroMinor;
    expect(Number(tokens[0]!.costMicroMinor)).toBe(tokenCost + WEB_SEARCH_FEE_MICRO_MINOR);
  });

  it("a free business on its own Anthropic key searches on the platform's Haiku 5.5 too: search is a platform tool, charged to credits", async () => {
    requests.length = 0;
    const r = await researcher("Own Key Search Co", "free");
    await repos.businesses.update(ldb, r.businessId, { modelBilling: "byok" });
    const out = await liveClient.call(r.token, { connector: "web", tool: "search_web", args: { query: "compostable cups wholesale" } });
    expect(out.outcome).toBe("allow");
    if (out.outcome !== "allow") return;
    expect(out.result.ok, JSON.stringify(out.result.error)).toBe(true);
    expect(requests[0]).toMatchObject({ apiKey: "sk-ant-platform-test", body: { model: MODELS.haiku } });
  });
});
