import { describe, expect, it } from "vitest";
import { ConnectInputError } from "../../contract";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { mockIntegrationRecord } from "../../mock-utils";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { BAD_QUERY, BUDGET_EXCEEDED, HOSTILE_URL, PAGEVIEWS_BY_DAY_OK, SELECT_1_OK, TOP_PAGES_OK, UNAUTHORIZED, WEIRD_CODE } from "./fixtures/insights";
import { createPosthogConnector, posthogMock } from "./index";
import { MAX_CELL_CHARS, MAX_ROWS, prepareQuery } from "./tools";

const KEY = "phx_test_secret_key_123456";
const credential = { kind: "api_key" as const, secret: KEY };
const US = "https://us.posthog.com/api/projects/12345/query/";
const EU = "https://eu.posthog.com/api/projects/777/query/";
const integrationFor = (config: Record<string, unknown>) => mockIntegrationRecord("posthog", "b1", { status: "connected", config });
const usIntegration = integrationFor({ projectId: "12345", region: "us" });
const refused = (q: string) => expect(() => prepareQuery(q), q).toThrow(/PostHog query refused/);

describeConnectorContract("posthog (mock)", {
  connector: posthogMock,
  mode: "mock",
  calls: [
    {
      tool: "query_insights",
      args: { query: "SELECT toDate(timestamp) AS day, count() FROM events WHERE event = '$pageview' GROUP BY day ORDER BY day" },
      check: (r) => {
        expect(r.untrusted).toBe(true);
        expect(r.costMinor).toBe(0);
        const json = JSON.stringify(r.data);
        expect(json).toContain("pageviews");
        expect(json).toContain("Simulated");
      },
    },
    { tool: "query_insights", args: { query: "SELECT properties.utm_source AS source, count() FROM events WHERE event = 'signed_up' GROUP BY source" }, check: (r) => expect(JSON.stringify(r.data)).toContain("newsletter") },
    { tool: "query_insights", args: { query: "SELECT properties.$pathname, count() FROM events GROUP BY 1" }, check: (r) => expect(JSON.stringify(r.data)).toContain("/products/barrier-cream") },
    { tool: "query_insights", args: { query: "SELECT event, count() FROM events GROUP BY event", name: "events" } },
    { tool: "query_insights", args: { query: "DELETE FROM events" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_query") },
    { tool: "query_insights", args: { query: "SELECT 1; SELECT 2" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_query") },
    { tool: "query_insights", args: { query: "SELECT 1".padEnd(4001, " ") + "x" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("posthog mock", () => {
  it("is deterministic, honors the limit, and declares no hints", async () => {
    const ctx = makeToolContext(posthogMock);
    const a = await posthogMock.callTool("query_insights", { query: "SELECT event FROM events LIMIT 2" }, ctx);
    const b = await posthogMock.callTool("query_insights", { query: "SELECT event FROM events LIMIT 2" }, ctx);
    expect(a).toEqual(b);
    expect(JSON.stringify(a.data)).toContain('"rowCount":2');
    expect(posthogMock.policyHints.query_insights).toEqual({});
    expect(posthogMock.auth).toEqual({ kind: "api_key" });
  });
});

describe("posthog query guard", () => {
  it("accepts SELECT and WITH, strips comments and a trailing semicolon, and appends LIMIT 200", () => {
    expect(prepareQuery("  select 1 ;  ").sql).toBe("select 1\nLIMIT 200");
    expect(prepareQuery("-- hi\nSELECT 1 /* c */ FROM t").sql).toBe("SELECT 1   FROM t\nLIMIT 200");
    expect(prepareQuery("WITH a AS (SELECT 1) SELECT * FROM a").limit).toBe(200);
    expect(prepareQuery("SELECT ';' AS semi, '-- not a comment' FROM t").sql).toContain("';'");
  });
  it("keeps a LIMIT up to 200, lowers a bigger one, and does not trust a LIMIT inside a subquery or a string", () => {
    expect(prepareQuery("SELECT 1 LIMIT 50")).toEqual({ sql: "SELECT 1 LIMIT 50", limit: 50 });
    expect(prepareQuery("SELECT 1 LIMIT 5000 OFFSET 0")).toEqual({ sql: "SELECT 1 LIMIT 200 OFFSET 0", limit: 200 });
    expect(prepareQuery("SELECT * FROM (SELECT 1 LIMIT 5)").sql).toMatch(/\nLIMIT 200$/);
    expect(prepareQuery("SELECT 'a LIMIT 5'").sql).toMatch(/\nLIMIT 200$/);
  });
  it("refuses other statements, several statements, hidden semicolons and unclosed text", () => {
    for (const q of ["DELETE FROM events", "DROP TABLE x", "INSERT INTO t VALUES (1)", "(SELECT 1)", "SELECT 1; DROP TABLE x", "SELECT 1; -- x\nSELECT 2", "SELECT 'abc", "SELECT 1 /* open", "SELECT (1", "SELECT 1 # LIMIT 5", "-- only a comment", "", "SELECTx 1", "selectfoo"]) refused(q);
  });
});

describe("posthog live (canned)", () => {
  interface Seen {
    url: string;
    authorization: string | null;
    body: { query?: { kind?: string; query?: string }; name?: string };
  }
  const connectorWith = (respond: (req: Request) => Response, seen: Seen[] = []) => {
    const handler = async (req: Request) => {
      seen.push({ url: req.url, authorization: req.headers.get("authorization"), body: await req.json() });
      return respond(req);
    };
    return createPosthogConnector({ fetch: routedFetch({ [`POST ${US}`]: handler, [`POST ${EU}`]: handler }) });
  };
  const ctxFor = (c: ReturnType<typeof connectorWith>, extra = {}) => makeToolContext(c, { mode: "live", credential, integration: usIntegration, ...extra });

  it("sends the documented request with the founder's key to the region host, and maps the answer", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(PAGEVIEWS_BY_DAY_OK), seen);
    const r = await c.callTool("query_insights", { query: "SELECT 1 FROM events; ", name: "daily" }, ctxFor(c));
    expect(r.error).toBeUndefined();
    expect(seen).toEqual([{ url: US, authorization: `Bearer ${KEY}`, body: { query: { kind: "HogQLQuery", query: "SELECT 1 FROM events\nLIMIT 200" }, name: "daily" } }]);
    expect(r.untrusted).toBe(true);
    expect(isUntrusted(r.data)).toBe(true);
    expect(r.costMinor).toBe(0);
    const json = JSON.stringify(r.data);
    expect(json).toContain('"columns":["day","pageviews"]');
    expect(json).toContain('"rowCount":3');
    expect(json).toContain('"2026-11-08","52"');
    expect(json).not.toContain("simulated");
  });

  it("uses the EU host for an EU project, from the stored config only", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(SELECT_1_OK), seen);
    await c.callTool("query_insights", { query: "SELECT 1" }, ctxFor(c, { integration: integrationFor({ projectId: "777", region: "eu" }) }));
    expect(seen.map((s) => s.url)).toEqual([EU]);
    // Anything else in the config is refused before a request, so no stored value can pick another host.
    for (const config of [{ projectId: "777", region: "https://evil.example" }, { projectId: "777", region: "constructor" }, { projectId: "../1", region: "us" }, { projectId: "12345" }, {}]) {
      const c2 = connectorWith(() => jsonResponse(SELECT_1_OK), seen);
      await expect(c2.callTool("query_insights", { query: "SELECT 1" }, ctxFor(c2, { integration: integrationFor(config) }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    }
    expect(seen).toHaveLength(1);
  });

  it("stringifies and truncates cells, caps rows at 200 and flags truncation", async () => {
    const c = connectorWith(() => jsonResponse(TOP_PAGES_OK));
    const r = await c.callTool("query_insights", { query: "SELECT url FROM events" }, ctxFor(c));
    const json = JSON.stringify(r.data);
    expect(json).toContain(HOSTILE_URL.slice(0, 40));
    expect(json).not.toContain("x".repeat(MAX_CELL_CHARS + 1));
    expect(json).toContain('"truncated":true');
    const many = connectorWith(() => jsonResponse({ columns: ["n"], results: Array.from({ length: 500 }, (_, i) => [i]) }));
    const big = await many.callTool("query_insights", { query: "SELECT n FROM t LIMIT 1000" }, ctxFor(many));
    expect(JSON.stringify(big.data)).toContain('"rowCount":200');
    expect(JSON.stringify(big.data)).toContain('"truncated":true');
    expect(MAX_ROWS).toBe(200);
  });

  it("refuses an unsafe query before any request", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(SELECT_1_OK), seen);
    const r = await c.callTool("query_insights", { query: "SELECT 1; DROP TABLE events" }, ctxFor(c));
    expect(r.error?.code).toBe("invalid_query");
    expect(seen).toHaveLength(0);
  });

  it("maps 401 and the budget 429, forwards only status, a fixed sentence and a plain code, and never echoes the key or the query", async () => {
    const call = async (body: unknown, status: number) => {
      const c = connectorWith(() => jsonResponse(body, { status }));
      return c.callTool("query_insights", { query: "SELECT secret_column FROM events" }, ctxFor(c));
    };
    const budget = await call(BUDGET_EXCEEDED, 429);
    expect(budget.error).toMatchObject({ code: "rate_limited", status: 429, retryable: true });
    expect(budget.error?.message).toContain("api_queries_budget_exceeded");
    expect(budget.error?.details).toBeUndefined();
    const unauth = await call(UNAUTHORIZED, 401);
    expect(unauth.error).toMatchObject({ code: "unauthorized", status: 401 });
    const bad = await call(BAD_QUERY, 400);
    expect(bad.error).toMatchObject({ code: "vendor_error", status: 400 });
    const weird = await call(WEIRD_CODE, 500);
    for (const r of [budget, unauth, bad, weird]) {
      const s = JSON.stringify(r);
      for (const leak of [KEY, "secret_column", "evnts", "a@b.c", "boom", "spaces", "Invalid personal"]) expect(s, leak).not.toContain(leak);
    }
  });

  it("reports an answer without results as a vendor failure", async () => {
    const c = connectorWith(() => jsonResponse({ detail: "ok?" }));
    const r = await c.callTool("query_insights", { query: "SELECT 1" }, ctxFor(c));
    expect(r.error).toMatchObject({ code: "vendor_error", status: 502 });
  });

  it("throws ConfigError without a credential, even when platform keys exist, and calls nothing", async () => {
    const seen: string[] = [];
    const c = createPosthogConnector({ secrets: { openaiApiKey: "platform", sendgridApiKey: "platform" }, fetch: routedFetch({ [`POST ${US}`]: () => (seen.push("x"), jsonResponse(SELECT_1_OK)) }) });
    await expect(c.callTool("query_insights", { query: "SELECT 1" }, makeToolContext(c, { mode: "live", integration: usIntegration }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(seen).toHaveLength(0);
  });

  it("connect() rejects blank or invalid input without a request, and sends exactly the entered key", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(SELECT_1_OK), seen);
    const ok = { apiKey: ` ${KEY} `, projectId: "12345", region: "us" };
    for (const input of [undefined, {}, { ...ok, apiKey: "  " }, { ...ok, projectId: "" }, { ...ok, projectId: "12a" }, { ...ok, projectId: "1/../2" }, { ...ok, region: "" }, { ...ok, region: "US" }, { ...ok, region: "https://x.example" }, { ...ok, region: "ap" }]) {
      await expect(c.connect("b1", input)).rejects.toBeInstanceOf(ConnectInputError);
    }
    expect(seen).toHaveLength(0);
    const rec = await c.connect("b1", ok);
    expect(seen).toEqual([{ url: US, authorization: `Bearer ${KEY}`, body: { query: { kind: "HogQLQuery", query: "SELECT 1" } } }]);
    expect(rec).toMatchObject({ status: "connected", config: { projectId: "12345", region: "us" }, credentialToStore: { kind: "api_key", secret: KEY } });
    expect(JSON.stringify({ ...rec, credentialToStore: undefined })).not.toContain(KEY);
    const bad = connectorWith(() => jsonResponse(UNAUTHORIZED, { status: 401 }));
    await expect(bad.connect("b1", ok)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("healthcheck is disconnected without a credential; with one it runs SELECT 1 and reports region and project only", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(SELECT_1_OK), seen);
    expect((await c.healthcheck(usIntegration)).status).toBe("disconnected");
    expect(seen).toHaveLength(0);
    const ok = await c.healthcheck(usIntegration, credential);
    expect(ok).toMatchObject({ ok: true, status: "connected", details: { region: "us", projectId: "12345" } });
    expect(seen[0]).toMatchObject({ url: US, authorization: `Bearer ${KEY}`, body: { query: { query: "SELECT 1" } } });
    const bad = await connectorWith(() => jsonResponse(UNAUTHORIZED, { status: 401 })).healthcheck(usIntegration, credential);
    expect(bad.status).toBe("degraded");
    expect(JSON.stringify(bad)).not.toContain("phx_");
  });

  it("keeps the key out of logs and thrown errors", async () => {
    const log = collectingLogger();
    const c = connectorWith(() => jsonResponse({ code: "x", detail: `bad ${KEY}` }, { status: 401 }));
    const r = await c.callTool("query_insights", { query: "SELECT 1" }, ctxFor(c, { log }));
    await c.connect("b1", { apiKey: "phx_wrong_key_999", projectId: "12345", region: "us" }).catch((e: Error) => expect(e.message).not.toContain("phx_wrong"));
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(log.entries)).not.toContain(KEY);
  });
});

describe.skipIf(!envKeysPresent("POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID", "POSTHOG_REGION"))("posthog (live)", () => {
  // Read-only SELECT against the account in the environment; runs only when a key is present.
  describeConnectorContract("posthog live", {
    connector: createPosthogConnector(),
    mode: "live",
    deterministic: false,
    skipConnect: true,
    credential: { kind: "api_key", secret: process.env.POSTHOG_PERSONAL_API_KEY ?? "" },
    integration: integrationFor({ projectId: process.env.POSTHOG_PROJECT_ID, region: process.env.POSTHOG_REGION }),
    calls: [{ tool: "query_insights", args: { query: "SELECT 1" } }],
  });
});
