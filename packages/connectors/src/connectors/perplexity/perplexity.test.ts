import { describe, expect, it } from "vitest";
import { PANEL_MODELS } from "@foundmill/models/routing";
import { jsonResponse, routedFetch } from "../../http";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { PERPLEXITY_FIXTURE_CITATIONS, PERPLEXITY_MODELS_FIXTURE, PERPLEXITY_RESPONSE_FIXTURE, PERPLEXITY_UNAUTHORIZED_FIXTURE } from "./fixtures/panel";
import { createPerplexityConnector } from "./index";
import { perplexityMock } from "./mock";

const KEY = "pplx-founder-secret-1234";
const credential = { kind: "api_key" as const, secret: KEY };
const BASE = "https://api.perplexity.ai";
const PLATFORM = { openaiApiKey: "platform", sendgridApiKey: "platform" };

const live = (routes: Parameters<typeof routedFetch>[0], seen: Request[] = []) =>
  createPerplexityConnector({ secrets: PLATFORM, fetch: routedFetch(Object.fromEntries(Object.entries(routes).map(([k, h]) => [k, (req: Request, url: URL) => (seen.push(req.clone()), h(req, url))]))) });

describeConnectorContract("perplexity (mock)", {
  connector: perplexityMock,
  mode: "mock",
  calls: [
    {
      tool: "ask_panel",
      args: { question: "best invoicing app for freelancers?" },
      check: (r) => {
        const d = (r.data as { content: { citations: unknown[]; model: string } }).content;
        expect(r.untrusted).toBe(true);
        expect(JSON.stringify(r.data)).toContain("mock answer");
        expect(d.citations).toHaveLength(2);
        expect(d.model).toBe(PANEL_MODELS.perplexity);
      },
    },
    { tool: "ask_panel", args: { question: "no" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("perplexity live (canned)", () => {
  it("asks the Agent API with the founder's key and maps answer and sources", async () => {
    const seen: Request[] = [];
    const c = live({ [`POST ${BASE}/v1/agent`]: () => jsonResponse(PERPLEXITY_RESPONSE_FIXTURE) }, seen);
    const r = await c.callTool("ask_panel", { question: "best invoicing app for freelancers?" }, makeToolContext(c, { mode: "live", credential }));
    expect(r.ok).toBe(true);
    expect(r.untrusted).toBe(true);
    expect(r.costMinor).toBeGreaterThan(0);
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const sent = (await seen[0]!.json()) as { model: string; input: string; tools: { type: string }[] };
    expect(sent).toMatchObject({ model: PANEL_MODELS.perplexity, input: "best invoicing app for freelancers?", tools: [{ type: "web_search" }] });
    const text = JSON.stringify(r.data);
    expect(text).toContain("Popular picks are Northwind Invoices");
    expect(text).toContain(PERPLEXITY_FIXTURE_CITATIONS[0].url);
    expect(text).toContain("https://untitled.example/page");
    expect(text).not.toContain("javascript:");
    expect(text.split(PERPLEXITY_FIXTURE_CITATIONS[1].url)).toHaveLength(2); // the repeat is dropped
  });
  it("caps a long answer", async () => {
    const big = { ...PERPLEXITY_RESPONSE_FIXTURE, output: [{ type: "message", content: [{ type: "output_text", text: "x".repeat(20_000) }] }] };
    const c = live({ [`POST ${BASE}/v1/agent`]: () => jsonResponse(big) });
    const r = await c.callTool("ask_panel", { question: "a long answer please" }, makeToolContext(c, { mode: "live", credential }));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data).length).toBeLessThan(9_500);
  });
  it.each([
    [401, "unauthorized"],
    [429, "rate_limited"],
  ])("maps a vendor %i to %s without leaking the key", async (status, code) => {
    const log = collectingLogger();
    const c = live({ [`POST ${BASE}/v1/agent`]: () => jsonResponse({ error: { message: `Invalid API key ${KEY}`, type: "invalid_api_key", code: status } }, { status }) });
    const r = await c.callTool("ask_panel", { question: "best invoicing app for freelancers?" }, makeToolContext(c, { mode: "live", credential, log }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(code);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(log.entries)).not.toContain(KEY);
  });
  it("redacts a key-shaped value in a transport failure", async () => {
    const c = createPerplexityConnector({ fetch: (async () => { throw new Error(`socket closed for ${KEY}`); }) as typeof fetch });
    const r = await c.callTool("ask_panel", { question: "best invoicing app for freelancers?" }, makeToolContext(c, { mode: "live", credential }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe("perplexity live (no credential)", () => {
  it("rejects with connector_unconfigured and makes no request, even with platform keys", async () => {
    const seen: Request[] = [];
    const c = live({ [`POST ${BASE}/v1/agent`]: () => jsonResponse(PERPLEXITY_RESPONSE_FIXTURE) }, seen);
    await expect(c.callTool("ask_panel", { question: "best invoicing app for freelancers?" }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(seen).toHaveLength(0);
  });
});

describe("perplexity connect and healthcheck", () => {
  it("connect rejects blank input before any request", async () => {
    const seen: Request[] = [];
    const c = live({ [`GET ${BASE}/v1/models`]: () => jsonResponse(PERPLEXITY_MODELS_FIXTURE) }, seen);
    for (const input of [undefined, {}, { apiKey: "   " }]) await expect(c.connect!("6a1f4b2c-0d9e-5f3a-8b7c-1d2e3f4a5b6c", input)).rejects.toMatchObject({ name: "ConnectInputError" });
    expect(seen).toHaveLength(0);
  });
  it("connect validates with the free models list using exactly the entered key", async () => {
    const seen: Request[] = [];
    const c = live({ [`GET ${BASE}/v1/models`]: () => jsonResponse(PERPLEXITY_MODELS_FIXTURE) }, seen);
    const rec = await c.connect!("6a1f4b2c-0d9e-5f3a-8b7c-1d2e3f4a5b6c", { apiKey: ` ${KEY} ` });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(rec.status).toBe("connected");
    expect(rec.credentialToStore).toEqual({ kind: "api_key", secret: KEY });
    expect(JSON.stringify({ ...rec, credentialToStore: undefined })).not.toContain(KEY);
  });
  it("connect with a bad key fails without echoing it", async () => {
    const c = live({ [`GET ${BASE}/v1/models`]: () => jsonResponse({ error: { ...PERPLEXITY_UNAUTHORIZED_FIXTURE.error, message: `bad key ${KEY}` } }, { status: 401 }) });
    const err = await c.connect!("6a1f4b2c-0d9e-5f3a-8b7c-1d2e3f4a5b6c", { apiKey: KEY }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify({ m: (err as Error).message, d: (err as { details?: unknown }).details })).not.toContain(KEY);
  });
  it("healthcheck is disconnected without a credential and calls the vendor with one", async () => {
    const seen: Request[] = [];
    const c = live({ [`GET ${BASE}/v1/models`]: () => jsonResponse(PERPLEXITY_MODELS_FIXTURE) }, seen);
    const ctx = makeToolContext(c, { mode: "live" });
    expect((await c.healthcheck(ctx.integration)).status).toBe("disconnected");
    expect(seen).toHaveLength(0);
    expect((await c.healthcheck(ctx.integration, credential)).status).toBe("connected");
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });
  it("healthcheck reports expired on 401", async () => {
    const c = live({ [`GET ${BASE}/v1/models`]: () => jsonResponse(PERPLEXITY_UNAUTHORIZED_FIXTURE, { status: 401 }) });
    const h = await c.healthcheck(makeToolContext(c, { mode: "live" }).integration, credential);
    expect(h.status).toBe("expired");
  });
});

describe.skipIf(!envKeysPresent("PERPLEXITY_API_KEY"))("perplexity (live)", () => {
  describeConnectorContract("perplexity live", {
    connector: createPerplexityConnector(),
    mode: "live",
    credential: { kind: "api_key", secret: process.env.PERPLEXITY_API_KEY ?? "" },
    connectInput: { apiKey: process.env.PERPLEXITY_API_KEY },
    deterministic: false,
    calls: [{ tool: "ask_panel", args: { question: "What is a good invoicing app for freelancers?" } }],
  });
});
