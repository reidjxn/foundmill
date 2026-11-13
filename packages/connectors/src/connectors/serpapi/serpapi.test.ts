import { describe, expect, it } from "vitest";
import { isUntrusted } from "../../quarantine";
import { jsonResponse, routedFetch } from "../../http";
import type { collectingLogger } from "../../testing/contract-suite";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { ACCOUNT, ACCOUNT_KEY_ECHO, followUp, searchInline, searchWithToken, SKINCARE_AI_OVERVIEW_TEXT, SKINCARE_QUERY } from "./fixtures/serp";
import { createSerpapiConnector, scrub } from "./index";
import { mockSearch, serpapiMock } from "./mock";

const KEY = "founder-own-serpapi-key-0123456789abcdef";
const credential = { kind: "api_key" as const, secret: KEY };
const live = (fetch: typeof globalThis.fetch, secrets: Record<string, string> = {}) => createSerpapiConnector({ fetch, secrets: secrets as never });
const liveCtx = (c: ReturnType<typeof live>) => makeToolContext(c, { mode: "live", credential });

interface Seen { url: URL }
/** Answers /search and /account.json, recording every request. */
function vendor(search: (url: URL, n: number) => Response, seen: Seen[] = []) {
  let n = 0;
  return {
    seen,
    fetch: routedFetch({
      "GET https://serpapi.com/search": (_req, url) => { seen.push({ url }); return search(url, n++); },
      "GET https://serpapi.com/account.json": (_req, url) => { seen.push({ url }); return url.searchParams.get("api_key") === KEY ? jsonResponse(ACCOUNT) : jsonResponse({ error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" }, { status: 401 }); },
    }),
  };
}

describeConnectorContract("serpapi (mock)", {
  connector: serpapiMock,
  mode: "mock",
  calls: [
    {
      tool: "search_google",
      args: { query: SKINCARE_QUERY },
      check: (r) => {
        expect(r.untrusted).toBe(true);
        expect(isUntrusted(r.data)).toBe(true);
        expect(r.costMinor).toBeGreaterThan(0);
      },
    },
    { tool: "search_google", args: { query: "x" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("serpapi mock results", () => {
  it("returns the skincare fixture with an AI Overview, and none for other queries", async () => {
    const mod = { mockSearch };
    const skin = mod.mockSearch(SKINCARE_QUERY, true);
    expect(skin.organic).toHaveLength(5);
    expect(skin.aiOverview?.text).toBe(SKINCARE_AI_OVERVIEW_TEXT);
    expect(skin.aiOverview?.references).toHaveLength(3);
    expect(mod.mockSearch(SKINCARE_QUERY, false).aiOverview).toBeNull();
    const other = mod.mockSearch("invoice software for freelancers", true);
    expect(other.aiOverview).toBeNull();
    expect(other.organic).toHaveLength(3);
    expect((await serpapiMock.callTool("search_google", { query: "invoice software" }, makeToolContext(serpapiMock))).ok).toBe(true);
  });
});

describe("serpapi live (canned)", () => {
  it("sends the founder's key as api_key, with the search parameters, and maps an inline AI Overview", async () => {
    const v = vendor(() => jsonResponse(searchInline()));
    const c = live(v.fetch);
    const r = await c.callTool("search_google", { query: SKINCARE_QUERY, location: "Austin, Texas", country: "US", language: "en" }, liveCtx(c));
    expect(r.error).toBeUndefined();
    expect(v.seen).toHaveLength(1);
    const p = v.seen[0]!.url.searchParams;
    expect(Object.fromEntries(p)).toEqual({ engine: "google", q: SKINCARE_QUERY, location: "Austin, Texas", gl: "us", hl: "en", api_key: KEY });
    expect(r.untrusted).toBe(true);
    const data = JSON.stringify(r.data);
    expect(data).toContain(SKINCARE_QUERY);
    expect(data).toContain("66f0c0ffee0000000000abcd");
    expect(data).toContain("Humectants: Glycerin");
    expect(data).not.toContain(KEY);
    expect(r.costMinor).toBe(5);
  });

  it("follows up with the page token inside the same call and flattens the overview", async () => {
    const v = vendor((url) => (url.searchParams.get("engine") === "google_ai_overview" ? jsonResponse(followUp()) : jsonResponse(searchWithToken())));
    const c = live(v.fetch);
    const r = await c.callTool("search_google", { query: SKINCARE_QUERY }, liveCtx(c));
    expect(r.ok).toBe(true);
    expect(v.seen).toHaveLength(2);
    expect(Object.fromEntries(v.seen[1]!.url.searchParams)).toEqual({ engine: "google_ai_overview", page_token: "PAGE_TOKEN_123", api_key: KEY });
    expect(JSON.stringify(r.data)).toContain("Apply within three minutes of washing.");
  });

  it("treats a failed follow-up as no overview, not a failed call", async () => {
    for (const bad of [() => jsonResponse({ error: "expired" }, { status: 400 }), () => jsonResponse({ ai_overview: { error: "Can't generate an AI overview right now." } }), () => { throw new Error(`socket hang up GET https://serpapi.com/search?api_key=${KEY}`); }]) {
      const v = vendor((url) => (url.searchParams.get("engine") === "google_ai_overview" ? bad() : jsonResponse(searchWithToken())));
      const c = live(v.fetch);
      const r = await c.callTool("search_google", { query: SKINCARE_QUERY }, liveCtx(c));
      expect(r.ok).toBe(true);
      expect(v.seen).toHaveLength(2);
      expect(JSON.stringify(r.data)).toContain("Northwind Barrier Cream");
      expect(JSON.stringify(r.data)).toContain('"aiOverview":null');
    }
  });

  it("makes no follow-up and returns no overview when includeAiOverview is false", async () => {
    const v = vendor(() => jsonResponse(searchWithToken()));
    const c = live(v.fetch);
    const r = await c.callTool("search_google", { query: SKINCARE_QUERY, includeAiOverview: false }, liveCtx(c));
    expect(v.seen).toHaveLength(1);
    expect(r.costMinor).toBe(3);
    expect(JSON.stringify(r.data)).toContain('"aiOverview":null');
  });

  it("caps result count and text sizes and drops non-http addresses", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ position: i + 1, title: "T".repeat(900), link: i === 2 ? "javascript:alert(1)" : `https://e.example/${i}`, snippet: "S".repeat(2000) }));
    const v = vendor(() => jsonResponse({ organic_results: many, ai_overview: { text_blocks: [{ type: "paragraph", snippet: "W ".repeat(9000) }], references: [] } }));
    const c = live(v.fetch);
    const r = await c.callTool("search_google", { query: "long things" }, liveCtx(c));
    expect(r.ok).toBe(true);
    const inner = JSON.stringify(r.data);
    expect(inner).not.toContain("javascript:");
    expect(inner.length).toBeLessThan(20_000);
  });

  it("returns an empty result when Google had none, and fails on other 200-with-error answers", async () => {
    let c = live(vendor(() => jsonResponse({ error: "Google hasn't returned any results for this query." })).fetch);
    expect((await c.callTool("search_google", { query: "zzzz qqqq" }, liveCtx(c))).ok).toBe(true);
    c = live(vendor(() => jsonResponse({ error: `Your account has run out of searches (${KEY}).` })).fetch);
    const r = await c.callTool("search_google", { query: "zzzz qqqq" }, liveCtx(c));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("maps 401 to unauthorized and 429 to rate_limited without the key anywhere", async () => {
    for (const [status, code] of [[401, "unauthorized"], [429, "rate_limited"]] as const) {
      const v = vendor(() => jsonResponse({ error: `Invalid API key ${KEY}` }, { status }));
      const c = live(v.fetch);
      const ctx = liveCtx(c);
      const r = await c.callTool("search_google", { query: SKINCARE_QUERY }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe(code);
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect(JSON.stringify((ctx.log as ReturnType<typeof collectingLogger>).entries)).not.toContain(KEY);
      expect(r.error?.message).not.toContain("api_key");
    }
  });

  it("keeps the key out of errors and logs on a network failure, even when the network error quotes the URL", async () => {
    const fetch = (async (input: RequestInfo | URL) => { throw new TypeError(`fetch failed: ${String(input)}`); }) as typeof globalThis.fetch;
    const c = live(fetch);
    const ctx = liveCtx(c);
    const r = await c.callTool("search_google", { query: SKINCARE_QUERY }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("vendor_error");
    expect(r.error?.retryable).toBe(true);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain("api_key");
    expect(JSON.stringify((ctx.log as ReturnType<typeof collectingLogger>).entries)).not.toContain(KEY);
    const health = await c.healthcheck(ctx.integration, credential);
    expect(health.status).toBe("degraded");
    expect(JSON.stringify(health)).not.toContain(KEY);
    await expect(c.connect(ctx.businessId, { apiKey: KEY })).rejects.toSatisfy((e: Error) => !JSON.stringify({ m: e.message, d: (e as { details?: unknown }).details, b: (e as { body?: unknown }).body }).includes(KEY));
  });

  it("scrub masks the key, its encoded form and api_key parameters", () => {
    expect(scrub(`x https://serpapi.com/search?q=a&api_key=${KEY}&z=1 k e/y ${encodeURIComponent("k e/y")}`, "k e/y")).toBe("x https://serpapi.com/search?q=a&api_key=…&z=1 … …");
  });

  it("rejects without a credential, even when platform keys exist, and calls nothing", async () => {
    const seen: Seen[] = [];
    const v = vendor(() => jsonResponse(searchInline()), seen);
    const c = live(v.fetch, { openaiApiKey: "platform", sendgridApiKey: "platform", serpapiApiKey: "platform" });
    await expect(c.callTool("search_google", { query: SKINCARE_QUERY }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(seen).toHaveLength(0);
  });
});

describe("serpapi connect and healthcheck (canned)", () => {
  it("connect rejects blank input before any request", async () => {
    const seen: Seen[] = [];
    const c = live(vendor(() => jsonResponse({}), seen).fetch);
    for (const input of [{}, { apiKey: "   " }, undefined]) await expect(c.connect("b1", input)).rejects.toMatchObject({ code: "connect_input_required" });
    expect(seen).toHaveLength(0);
  });

  it("connect validates the key on the free Account API and stores only the key, never the echoed key or email", async () => {
    const v = vendor(() => jsonResponse({}));
    const c = live(v.fetch);
    const record = await c.connect("b1", { apiKey: `  ${KEY}  ` });
    expect(v.seen).toHaveLength(1);
    expect(v.seen[0]!.url.pathname).toBe("/account.json");
    expect(v.seen[0]!.url.searchParams.get("api_key")).toBe(KEY);
    expect(record).toMatchObject({ status: "connected", accountLabel: "SerpApi (Free Plan)", credentialToStore: { kind: "api_key", secret: KEY } });
    const rest = JSON.stringify({ ...record, credentialToStore: undefined });
    for (const secret of [KEY, ACCOUNT_KEY_ECHO, "founder@example.com"]) expect(rest).not.toContain(secret);
  });

  it("connect with a bad key fails as unauthorized-shaped vendor error without the key", async () => {
    const c = live(vendor(() => jsonResponse({})).fetch);
    const err = await c.connect("b1", { apiKey: "wrong-key-value" }).catch((e: unknown) => e as Error & { httpStatus?: number });
    expect(err).toMatchObject({ httpStatus: 401 });
    expect(JSON.stringify({ m: (err as Error).message, d: (err as { details?: unknown }).details })).not.toContain("wrong-key-value");
  });

  it("healthcheck without a credential is disconnected and calls nothing", async () => {
    const seen: Seen[] = [];
    const c = live(vendor(() => jsonResponse({}), seen).fetch);
    const h = await c.healthcheck(makeToolContext(c, { mode: "live" }).integration);
    expect(h.status).toBe("disconnected");
    expect(seen).toHaveLength(0);
  });

  it("healthcheck with a credential calls the Account API with it and reports non-secret details", async () => {
    const v = vendor(() => jsonResponse({}));
    const c = live(v.fetch);
    const h = await c.healthcheck(makeToolContext(c, { mode: "live" }).integration, credential);
    expect(h).toMatchObject({ ok: true, status: "connected", details: { searchesLeft: 231, searchesPerHourLimit: 50 } });
    expect(v.seen[0]!.url.searchParams.get("api_key")).toBe(KEY);
    expect(JSON.stringify(h)).not.toContain(ACCOUNT_KEY_ECHO);
  });
});

describe.skipIf(!envKeysPresent("SERPAPI_TEST_API_KEY"))("serpapi (live)", () => {
  const c = createSerpapiConnector();
  describeConnectorContract("serpapi live", {
    connector: c,
    mode: "live",
    credential: { kind: "api_key", secret: process.env.SERPAPI_TEST_API_KEY! },
    connectInput: { apiKey: process.env.SERPAPI_TEST_API_KEY },
    deterministic: false,
    calls: [{ tool: "search_google", args: { query: "best moisturizer for dry skin", includeAiOverview: false } }],
  });
});
