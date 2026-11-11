/**
 * The api's vendor calls moved into the gateway (SEC-14): `POST /v1/keys/validate`, `POST /v1/registry/lookup`, and
 * `POST /v1/integrations/connect` / `health` for connectors that are not App installations. Each is the api's alone
 * (a token for another service is 403), limited per business, audited without secrets; the key is never echoed or
 * logged; the registry route is an allow-list; a connect seals the vendor's secret with the gateway's vault.
 */
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLiveConnector, buildMockConnector, ConnectInputError, connectInputValue, createAnthropicConnector, createCompaniesHouseConnector, createDefaultRegistry, createRegistry, defineTool, jsonResponse, mockHealth, mockIntegrationRecord, routedFetch, type Connector, type ConnectorRegistry, type HealthResult } from "@foundmill/connectors";
import { INTEGRATION_CREDENTIAL_KIND, repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { MODELS, validateApiKey } from "@foundmill/models";
import { buildAad, decryptJson, generateMasterKey, LocalVault } from "@foundmill/shared/crypto";
import { createGatewayApp } from "../app";
import { INTEGRATIONS_LIMITS, INTEGRATIONS_SCOPE } from "../integrations";
import { KEY_VALIDATION_LIMITS } from "../keys";
import type { GatewayDeps, GatewayLogger } from "../pipeline";
import { MemoryRateLimitStore, MINUTE_MS, rateLimitKey } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { REGISTRY_LOOKUP_TOOLS } from "../registry-lookup";
import { signServiceToken } from "../tokens";
import { TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let businessId: string;
beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  businessId = (await repos.businesses.create(db, { name: "Service Routes Co" })).id;
}, 120_000);
afterAll(() => h?.close());

const KEY = "sk-ant-api03-founder-own-key-0123456789abcdef";
const VENDOR_SECRET = "SG.founder-own-sendgrid-key-0123456789";

/** Every log line the gateway wrote, so a test can say the key is in none of them. */
function recordingLog(lines: unknown[]): GatewayLogger {
  const log = (level: string) => (...args: unknown[]) => void lines.push({ level, args });
  const l: GatewayLogger = { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error"), child: () => l };
  return l;
}

/** Anthropic as the live connector and the one-token check see it: messages answer per `messages`, models list them all. */
function anthropicFetch(messages: () => Response) {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    calls.push(new URL(req.url).pathname);
    if (req.url.includes("/v1/messages")) return messages();
    return jsonResponse({ data: Object.values(MODELS).map((id) => ({ type: "model", id, display_name: id, created_at: "2026-01-01T00:00:00Z" })), has_more: false, first_id: null, last_id: null });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const messageOk = () => jsonResponse({ id: "msg_1", type: "message", role: "assistant", model: MODELS.haiku, content: [{ type: "text", text: "p" }], stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 8, output_tokens: 1 } }, { headers: { "request-id": "req_1" } });
const refused = (status: number, type: string, message: string) => () => jsonResponse({ type: "error", error: { type, message } }, { status });

/** A live connect that needs the founder's own key and hands it back to be sealed (SendGrid, Dropbox Sign, Cloudflare). */
function keyedConnector(healthChecks: string[] = []): Connector {
  const key = "keyed";
  const tools = [defineTool({ name: "ping", description: "Checks the account answers.", input: z.object({}), output: z.object({ ok: z.literal(true) }), hints: {} })] as const;
  const spec = { key, displayName: "Keyed vendor", phase: 1 as const, auth: { kind: "api_key" as const }, tools, rateLimits: {}, handlers: { ping: async () => ({ ok: true as const }) } };
  const mock = buildMockConnector({ ...spec, connect: async (b: string) => mockIntegrationRecord(key, b), healthcheck: async () => mockHealth(key) });
  return buildLiveConnector(
    {
      ...spec,
      connect: async (b: string, input: unknown) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(key, "apiKey", "Enter your Keyed vendor API key to connect it");
        return { ...mockIntegrationRecord(key, b, { status: "connected", accountLabel: "founder@northwind.example", scopes: ["mail.send"] }), config: { verifiedSenders: ["founder@northwind.example"] }, credentialToStore: { kind: "api_key" as const, secret: apiKey } };
      },
      healthcheck: async (integration): Promise<HealthResult> => {
        healthChecks.push(integration.id);
        return { ok: true, status: "connected", checkedAt: new Date().toISOString(), latencyMs: 3 };
      },
    },
    mock,
  );
}

interface AppOptions {
  registry?: ConnectorRegistry;
  mode?: "mock" | "live";
  liveConnectors?: string[];
  vault?: LocalVault | null;
  rateLimits?: MemoryRateLimitStore;
  validateModelKey?: GatewayDeps["validateModelKey"];
  logs?: unknown[];
  now?: () => Date;
}

function appFor(opts: AppOptions = {}) {
  const deps: GatewayDeps = {
    db,
    registry: opts.registry ?? createDefaultRegistry({ secrets: {} }),
    vault: opts.vault === undefined ? null : opts.vault,
    mode: opts.mode ?? "mock",
    liveConnectors: opts.liveConnectors,
    rateLimits: opts.rateLimits ?? new MemoryRateLimitStore(),
    recipients: new UntrustedRecipientRegistry(),
    log: recordingLog(opts.logs ?? []),
    ...(opts.validateModelKey ? { validateModelKey: opts.validateModelKey } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

async function post(app: ReturnType<typeof appFor>, path: string, body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> & { error?: { code: string; message: string } } };
}

const auditRows = async (action: string) => (await repos.audit.list(db, businessId, { action, limit: 100 })).items;

describe("only the api may ask", () => {
  it("answers 401 without a service token and 403 for a token whose svc is not api, on every moved route", async () => {
    const app = appFor();
    const routes: [string, unknown][] = [
      ["/v1/keys/validate", { businessId, apiKey: KEY }],
      ["/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "12345678" } }],
      ["/v1/integrations/connect", { businessId, connector: "sendgrid", input: {} }],
      ["/v1/integrations/health", { businessId, connector: "sendgrid" }],
    ];
    for (const [path, body] of routes) {
      expect((await post(app, path, body, null)).status).toBe(401);
      for (const svc of ["orchestrator", "ingest", "composer"]) {
        const r = await post(app, path, body, svc);
        expect(r.status).toBe(403);
        expect(r.body.error?.code).toBe("forbidden_service");
        expect(r.text).not.toContain(KEY);
      }
    }
  });
});

describe("POST /v1/keys/validate", () => {
  const liveApp = (messages: () => Response, extra: AppOptions = {}) => {
    const anthropic = anthropicFetch(messages);
    const app = appFor({ registry: createRegistry([createAnthropicConnector({ secrets: {}, fetch: anthropic.fetch })]), validateModelKey: (k) => validateApiKey(k, { mode: "live", fetch: anthropic.fetch }), ...extra });
    return { app, calls: anthropic.calls };
  };

  it("refuses a look-alike key with a real call and stops there (audit BILL-04)", async () => {
    const { app, calls } = liveApp(refused(401, "authentication_error", "invalid x-api-key"));
    const r = await post(app, "/v1/keys/validate", { businessId, apiKey: "sk-ant-not-a-real-key-0000" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "live", valid: false, routedModels: [] });
    expect(calls).toEqual(["/v1/messages"]);
  });

  it("refuses an account with no credit in words the founder can act on", async () => {
    const { app } = liveApp(refused(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."));
    const r = await post(app, "/v1/keys/validate", { businessId, apiKey: KEY });
    expect(r.body).toMatchObject({ valid: false });
    expect(String(r.body.reason)).toMatch(/no credit left\. Add credit in the Anthropic Console/);
  });

  it("checks a working key's routed models, and never logs, audits or echoes the key", async () => {
    const logs: unknown[] = [];
    const { app, calls } = liveApp(messageOk, { logs });
    const before = (await auditRows("gateway.keys.validated")).length;
    const r = await post(app, "/v1/keys/validate", { businessId, apiKey: KEY });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "live", valid: true, reason: null });
    expect((r.body.routedModels as { available: boolean }[]).length).toBeGreaterThan(0);
    expect((r.body.routedModels as { available: boolean }[]).every((m) => m.available)).toBe(true);
    expect(calls[0]).toBe("/v1/messages");
    expect(calls).toContain("/v1/models");
    expect(r.text).not.toContain(KEY);
    const rows = await auditRows("gateway.keys.validated");
    expect(rows).toHaveLength(before + 1);
    expect(rows[0]!.details).toEqual({ service: "api", validated: "ok" });
    expect(JSON.stringify(await repos.audit.list(db, businessId, { limit: 200 }))).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY.slice(0, 12));
  });

  it("refuses a malformed request without echoing what was sent", async () => {
    const { app } = liveApp(messageOk);
    const long = `${KEY}${"x".repeat(400)}`;
    const r = await post(app, "/v1/keys/validate", { businessId, apiKey: long });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(KEY);
    expect((await post(app, "/v1/keys/validate", { businessId: "00000000-0000-4000-8000-000000000000", apiKey: KEY })).body.error?.code).toBe("business_not_found");
  });

  it("is limited per business, apart from the agents' own anthropic calls", async () => {
    const rateLimits = new MemoryRateLimitStore();
    const { app } = liveApp(messageOk, { rateLimits });
    for (let i = 0; i < KEY_VALIDATION_LIMITS.perMinute; i++) expect((await post(app, "/v1/keys/validate", { businessId, apiKey: KEY })).status).toBe(200);
    const over = await post(app, "/v1/keys/validate", { businessId, apiKey: KEY });
    expect(over.status).toBe(429);
    expect(over.body.error?.code).toBe("rate_limited");
    expect(rateLimits.peek(rateLimitKey(businessId, "anthropic", "minute"), Date.now())).toBe(0);
  });
});

describe("POST /v1/registry/lookup", () => {
  it("runs only the registries' lookups: anything else is 403", async () => {
    const app = appFor();
    expect(Object.keys(REGISTRY_LOOKUP_TOOLS).sort()).toEqual(["bolagsverket", "companies_house", "opencorporates"]);
    for (const [connector, tool] of [
      ["stripe", "create_checkout_session"],
      ["sendgrid", "send_mail"],
      ["companies_house", "search_companies"],
      ["opencorporates", "search_companies"],
      ["companies_house", "constructor"],
      ["toString", "get_company"],
    ] as const) {
      const r = await post(app, "/v1/registry/lookup", { businessId, connector, tool, args: {} });
      expect(r.status, `${connector}:${tool}`).toBe(403);
      expect(r.body.error?.code).toBe("lookup_not_allowed");
    }
  });

  it("mock mode: the registry's mock answers inside the untrusted envelope, labeled simulated, audited without the arguments", async () => {
    const app = appFor();
    const r = await post(app, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "12345678" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "mock", ok: true, simulated: true, data: { untrusted: true, content: { name: "EXAMPLE TRADING LTD" } } });
    const row = (await auditRows("gateway.registry.lookup"))[0]!;
    expect(row.details).toMatchObject({ service: "api", mode: "mock", ok: true, untrusted: true });
    expect(JSON.stringify(row)).not.toContain("12345678");
    const missing = await post(app, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "99999999" } });
    expect(missing.body).toMatchObject({ ok: false });
  });

  it("live mode: the gateway's own platform key reaches the registry; a 404 comes back as data, not a failure", async () => {
    const seen: { auth: string | null; path: string }[] = [];
    const fetch = routedFetch({
      "GET https://api.company-information.service.gov.uk/company/15432198": (req, url) => (seen.push({ auth: req.headers.get("authorization"), path: url.pathname }), jsonResponse({ company_number: "15432198", company_name: "NORTHWIND SKINCARE LTD", company_status: "active", type: "ltd" })),
      "GET https://api.company-information.service.gov.uk/company/00000001": () => jsonResponse({ errors: [{ error: "company-profile-not-found" }] }, { status: 404 }),
    });
    const app = appFor({ registry: createRegistry([createCompaniesHouseConnector({ secrets: { companiesHouseApiKey: "ch-platform-key" }, fetch })]), liveConnectors: ["companies_house"] });
    const r = await post(app, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "15432198" } });
    expect(r.body).toMatchObject({ mode: "live", ok: true, data: { untrusted: true, content: { name: "NORTHWIND SKINCARE LTD" } } });
    expect(r.body).not.toHaveProperty("simulated");
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from("ch-platform-key:").toString("base64")}`);
    expect(r.text).not.toContain("ch-platform-key");
    const missing = await post(app, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "00000001" } });
    expect(missing.status).toBe(200);
    expect(missing.body).toMatchObject({ ok: false, error: { status: 404 } });
    // Without the platform key the registry is not set up here: a clear 503, not a guess.
    const unconfigured = appFor({ registry: createRegistry([createCompaniesHouseConnector({ secrets: {}, fetch })]), liveConnectors: ["companies_house"] });
    expect((await post(unconfigured, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "15432198" } })).body.error?.code).toBe("registry_unconfigured");
  });

  it("counts against the business's window on the connector", async () => {
    const rateLimits = new MemoryRateLimitStore();
    const at = new Date("2026-11-11T12:00:30.000Z");
    const app = appFor({ rateLimits, now: () => at });
    const perMinute = createDefaultRegistry({ secrets: {} }).get("companies_house", "mock").rateLimits?.perMinute ?? 0;
    for (let i = 0; i < perMinute; i++) await rateLimits.hit(rateLimitKey(businessId, "companies_house", "minute"), MINUTE_MS, at.getTime());
    const r = await post(app, "/v1/registry/lookup", { businessId, connector: "companies_house", tool: "get_company", args: { companyNumber: "12345678" } });
    expect(r.status).toBe(429);
    expect(r.body.error?.code).toBe("rate_limited");
  });
});

describe("POST /v1/integrations/connect and /health beyond App connectors", () => {
  it("seals the vendor's secret with the gateway's vault under the row-bound AAD, and answers without it", async () => {
    const vault = new LocalVault(generateMasterKey());
    const logs: unknown[] = [];
    const app = appFor({ registry: createRegistry([keyedConnector()]), vault, liveConnectors: ["keyed"], logs });
    const r = await post(app, "/v1/integrations/connect", { businessId, connector: "keyed", input: { apiKey: VENDOR_SECRET } });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(VENDOR_SECRET);
    expect(r.body).toMatchObject({ mode: "live", record: { status: "connected", accountLabel: "founder@northwind.example", config: { verifiedSenders: ["founder@northwind.example"] } }, credential: { stored: true, hint: "SG.f***" } });
    expect(r.body.record).not.toHaveProperty("credentialToStore");
    const integrationId = r.body.integrationId as string;
    const row = await repos.integrations.get(db, businessId, integrationId);
    expect(row).toMatchObject({ connectorKey: "keyed", status: "connected", authKind: "api_key" });
    const metas = await repos.credentials.listMetadata(db, businessId, { integrationId });
    expect(metas.map((m) => m.kind)).toEqual([INTEGRATION_CREDENTIAL_KIND]);
    expect(metas[0]!.id).toBe((r.body.credential as { credentialId: string }).credentialId);
    const loaded = (await repos.credentials.latest(db, businessId, integrationId))!;
    expect(await decryptJson(vault, loaded.record, buildAad(businessId, "credentials", loaded.meta.id))).toEqual({ kind: "api_key", secret: VENDOR_SECRET });
    const audit = (await auditRows("gateway.integration.connect"))[0]!;
    expect(audit.details).toMatchObject({ service: "api", mode: "live", secretStored: true, integrationId });
    expect(JSON.stringify(await repos.audit.list(db, businessId, { limit: 200 }))).not.toContain(VENDOR_SECRET);
    expect(JSON.stringify(logs)).not.toContain(VENDOR_SECRET);
  });

  it("passes the connector's own refusal on, stores nothing without a vault, and never seals a mock's answer", async () => {
    const live = appFor({ registry: createRegistry([keyedConnector()]), vault: new LocalVault(generateMasterKey()), liveConnectors: ["keyed"] });
    expect(await post(live, "/v1/integrations/connect", { businessId, connector: "keyed", input: {} })).toMatchObject({ status: 400, body: { error: { code: "connect_input_required", message: "Enter your Keyed vendor API key to connect it" } } });
    const noVault = appFor({ registry: createRegistry([keyedConnector()]), vault: null, liveConnectors: ["keyed"] });
    const other = (await repos.businesses.create(db, { name: "No Vault Co" })).id;
    expect(await post(noVault, "/v1/integrations/connect", { businessId: other, connector: "keyed", input: { apiKey: VENDOR_SECRET } })).toMatchObject({ status: 503, body: { error: { code: "vault_unconfigured" } } });
    expect(await repos.integrations.getByKey(db, other, "keyed")).toBeNull();
    const mock = appFor({ registry: createRegistry([keyedConnector()]), vault: new LocalVault(generateMasterKey()) });
    expect(await post(mock, "/v1/integrations/connect", { businessId: other, connector: "keyed", input: { apiKey: VENDOR_SECRET } })).toMatchObject({ status: 200, body: { mode: "mock", integrationId: null, credential: null } });
    expect(await repos.integrations.getByKey(db, other, "keyed")).toBeNull();
  });

  it("refuses the Anthropic key, the platform's own connectors and the built-ins", async () => {
    const app = appFor();
    expect((await post(app, "/v1/integrations/connect", { businessId, connector: "anthropic", input: { apiKey: KEY } })).body.error?.code).toBe("manage_in_keys");
    for (const connector of ["openai_images", "onesignal"]) expect((await post(app, "/v1/integrations/connect", { businessId, connector, input: {} })).body.error?.code).toBe("service_only_connector");
  });

  it("health runs the connector's check on the stored row, audited", async () => {
    const checks: string[] = [];
    const app = appFor({ registry: createRegistry([keyedConnector(checks)]), liveConnectors: ["keyed"] });
    const row = (await repos.integrations.getByKey(db, businessId, "keyed"))!;
    const r = await post(app, "/v1/integrations/health", { businessId, connector: "keyed" });
    expect(r).toMatchObject({ status: 200, body: { health: { ok: true, status: "connected" } } });
    expect(checks).toEqual([row.id]);
    expect((await auditRows("gateway.integration.health_checked"))[0]!.details).toMatchObject({ service: "api", mode: "live", ok: true, status: "connected" });
    const other = (await repos.businesses.create(db, { name: "Nothing Connected Co" })).id;
    expect(await post(app, "/v1/integrations/health", { businessId: other, connector: "keyed" })).toMatchObject({ status: 409, body: { error: { code: "integration_not_connected" } } });
  });

  it("writes the account settings with the credential, so a failed write after it never pairs a new key with the old account", async () => {
    const vault = new LocalVault(generateMasterKey());
    const app = appFor({ registry: createRegistry([keyedConnector()]), vault, liveConnectors: ["keyed"] });
    const biz = (await repos.businesses.create(db, { name: "Settings With Credential Co" })).id;
    const r = await post(app, "/v1/integrations/connect", { businessId: biz, connector: "keyed", input: { apiKey: VENDOR_SECRET } });
    expect(r.status).toBe(200);
    const row = (await repos.integrations.getByKey(db, biz, "keyed"))!;
    expect(row.settings).toMatchObject({ config: { verifiedSenders: ["founder@northwind.example"] } });
  });

  it("a live step that hands back no usable secret stores nothing and still answers (Tink's first step)", async () => {
    const key = "steps";
    const tools = [defineTool({ name: "ping", description: "Checks.", input: z.object({}), output: z.object({ ok: z.literal(true) }), hints: {} })] as const;
    const spec = { key, displayName: "Stepped vendor", phase: 1 as const, auth: { kind: "oauth" as const, scopes: [] }, tools, rateLimits: {}, handlers: { ping: async () => ({ ok: true as const }) } };
    const mock = buildMockConnector({ ...spec, connect: async (b: string) => mockIntegrationRecord(key, b), healthcheck: async () => mockHealth(key) });
    const stepped = buildLiveConnector({ ...spec, connect: async (b: string) => ({ ...mockIntegrationRecord(key, b, { status: "disconnected", externalAccountId: "user-1" }), config: { linkUrl: "https://link.example/start" }, credentialToStore: { kind: "oauth" as const, secret: "", extra: { userId: "user-1" } } }), healthcheck: async () => mockHealth(key) }, mock);
    const app = appFor({ registry: createRegistry([stepped]), vault: new LocalVault(generateMasterKey()), liveConnectors: [key] });
    const biz = (await repos.businesses.create(db, { name: "Stepped Co" })).id;
    const r = await post(app, "/v1/integrations/connect", { businessId: biz, connector: key, input: {} });
    expect(r).toMatchObject({ status: 200, body: { mode: "live", credential: null, record: { config: { linkUrl: "https://link.example/start" } } } });
  });

  it("Tink's second step is refused for a user this business was not given", async () => {
    const app = appFor({ liveConnectors: ["tink"], vault: new LocalVault(generateMasterKey()) });
    const biz = (await repos.businesses.create(db, { name: "Tink Binding Co" })).id;
    await repos.integrations.upsert(db, biz, { connectorKey: "tink", status: "disconnected", authKind: "oauth", settings: { externalAccountId: "tink-user-of-this-business" } });
    const r = await post(app, "/v1/integrations/connect", { businessId: biz, connector: "tink", input: { userId: "tink-user-of-another-business" } });
    expect(r).toMatchObject({ status: 403, body: { error: { code: "account_mismatch" } } });
  });

  it("the Anthropic key's health may be checked here; it is still never connected here", async () => {
    const app = appFor();
    const r = await post(app, "/v1/integrations/health", { businessId, connector: "anthropic" });
    expect(r.body.error?.code).not.toBe("manage_in_keys");
  });

  it("both are limited per business", async () => {
    const rateLimits = new MemoryRateLimitStore();
    const at = new Date("2026-11-11T12:00:30.000Z");
    const app = appFor({ registry: createRegistry([keyedConnector()]), liveConnectors: ["keyed"], rateLimits, now: () => at });
    for (let i = 0; i < INTEGRATIONS_LIMITS.perMinute; i++) await rateLimits.hit(rateLimitKey(businessId, INTEGRATIONS_SCOPE, "minute"), MINUTE_MS, at.getTime());
    expect((await post(app, "/v1/integrations/health", { businessId, connector: "keyed" })).status).toBe(429);
    expect((await post(app, "/v1/integrations/connect", { businessId, connector: "keyed", input: { apiKey: VENDOR_SECRET } })).status).toBe(429);
  });
});
