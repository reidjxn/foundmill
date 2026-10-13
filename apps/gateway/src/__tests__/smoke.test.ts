/**
 * The production dependency graph (`buildGateway`) over PGlite with the real default registry in mock mode:
 * every one of the 19 connectors and the built-ins (platform, web, quarantine) is catalogued, a real read tool runs,
 * and a real hard-gated tool is denied in every business mode (Gate 0: "gateway denies a hard-gate tool").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUSINESS_MODES, loadEnv } from "@foundmill/shared";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { BUILTIN_CONNECTOR_KEYS, CONNECTOR_KEYS } from "@foundmill/connectors";
import { buildGateway, createGatewayClient, listenGateway, type GatewayClient, type RunningGateway } from "../index";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let server: RunningGateway;
let client: GatewayClient;
let businessId: string;
let agentId: string;
let sessionId: string;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", SESSION_TOKEN_SECRET: TEST_SECRET, REDIS_URL: "redis://127.0.0.1:1" });
  const built = buildGateway({ env, db, vault: null, log: silentLog });
  expect(built.rateLimitStoreKind).toBe("memory"); // APP_ENV=test never touches Redis
  server = await listenGateway(built.app, { port: 0, host: "127.0.0.1" });
  client = createGatewayClient({ baseUrl: server.url, serviceSecret: TEST_SECRET, serviceName: "smoke" });
  const business = await repos.businesses.create(db, { name: "Smoke Club" });
  businessId = business.id;
  const agent = await repos.agents.create(db, businessId, { name: "Treasurer", agentType: "finance_lead", modelKey: "opus" });
  agentId = agent.id;
  sessionId = (await repos.agents.createSession(db, businessId, { agentId, modelKey: "opus" })).id;
}, 120_000);

afterAll(async () => {
  await server.stop();
  await h.close();
});

describe("gateway over the default registry (mock mode)", () => {
  it("catalogues every connector with its tools and hints", async () => {
    const { mode, connectors } = await client.listConnectors();
    expect(mode).toBe("mock");
    expect(connectors.map((c) => c.key).sort()).toEqual([...CONNECTOR_KEYS, ...BUILTIN_CONNECTOR_KEYS].sort());
    const stripe = connectors.find((c) => c.key === "stripe")!;
    expect(stripe.policyHints["create_payout"]).toMatchObject({ hardGate: true });
    expect(stripe.tools.some((t) => t.name === "get_balance")).toBe(true);
  });

  it("runs a real mock connector tool without a stored integration (mock integration record) and meters it", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId, allowedTools: ["stripe:get_balance", "ecb_rates:*"] });
    const r = await client.call(token, { connector: "stripe", tool: "get_balance", args: {} });
    expect(r.outcome).toBe("allow");
    if (r.outcome !== "allow") return;
    expect(r.result.ok).toBe(true);
    expect(r.result.data).toMatchObject({ available: expect.any(Array) });
    const usage = await repos.usage.list(db, businessId, { sessionId, kind: "tool" });
    expect(usage.items).toHaveLength(1);
    expect(usage.items[0]?.details).toMatchObject({ connector: "stripe", tool: "get_balance" });
  });

  it.each(BUSINESS_MODES)("Gate 0: stripe.create_payout is denied in %s mode and queued for the founder", async (mode) => {
    await repos.businesses.setBusinessMode(db, businessId, mode);
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId, allowedTools: ["stripe:*"] });
    const r = await client.call(token, { connector: "stripe", tool: "create_payout", args: { amountMinor: 10_000, currency: "EUR" }, context: { amountMinor: 10_000, currency: "EUR" } });
    expect(r.outcome).toBe("deny");
    if (r.outcome !== "deny") return;
    expect(r.policyIds).toEqual(["hard-gate"]);
    expect(r.humanAction).toMatchObject({ connector: "stripe", tool: "create_payout", reason: "hard_gate" });
    const approval = await repos.approvals.get(db, businessId, r.approvalId!);
    expect(approval.resolvedAt).toBeNull();
  });

  it("the Finance module never spends: a finance connector's tools carry finance=true", async () => {
    const { token } = await client.mintSessionToken({ businessId, agentId, sessionId, allowedTools: ["tink:*"] });
    const r = await client.call(token, { connector: "tink", tool: "start_consent", args: {} });
    expect(r.outcome).toBe("deny");
    if (r.outcome === "deny") expect(r.policyIds).toContain("hard-gate");
  });
});
