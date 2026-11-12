import { describe, expect, it } from "vitest";
import { PANEL_MODELS } from "@foundmill/models/routing";
import type { Untrusted } from "../../quarantine";
import { jsonResponse, routedFetch } from "../../http";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { INTERACTION_ANSWER, INTERACTION_RESPONSE, KEY_REJECTED, MODEL_RESPONSE, PANEL_CITATIONS } from "./fixtures/panel";
import { createGeminiConnector } from "./index";
import { geminiMock } from "./mock";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const KEY = "AIzaSyFOUNDERKEY0123456789abcdefghij";
const Q = "which serum is best for sensitive skin?";
const credential = { kind: "api_key" as const, secret: KEY };
const unwrap = (data: unknown) => (data as Untrusted).content;
const platform = { openaiApiKey: "platform", sendgridApiKey: "platform" };

describeConnectorContract("gemini (mock)", {
  connector: geminiMock,
  mode: "mock",
  calls: [
    {
      tool: "ask_panel",
      args: { question: Q },
      check: (r) => {
        const d = (r.data as Untrusted<{ answer: string; citations: unknown[]; model: string }>).content;
        expect(d.answer).toContain("mock answer");
        expect(d.citations).toHaveLength(2);
        expect(d.model).toBe(PANEL_MODELS.gemini);
        expect(r.untrusted).toBe(true);
      },
    },
    { tool: "ask_panel", args: { question: "no" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("gemini live (canned)", () => {
  it("sends the founder's key in the header, turns grounding on, and maps citations", async () => {
    let seen: { url: string; key: string | null; revision: string | null; body: unknown } | undefined;
    const connector = createGeminiConnector({
      fetch: routedFetch({
        [`POST ${BASE}/interactions`]: async (req) => {
          seen = { url: req.url, key: req.headers.get("x-goog-api-key"), revision: req.headers.get("api-revision"), body: await req.json() };
          return jsonResponse(INTERACTION_RESPONSE);
        },
      }),
    });
    const r = await connector.callTool("ask_panel", { question: Q }, makeToolContext(connector, { mode: "live", credential }));
    expect(r.ok).toBe(true);
    expect(seen?.key).toBe(KEY);
    expect(seen?.url).not.toContain("AIza");
    expect(seen?.revision).toBeTruthy();
    expect(seen?.body).toEqual({ model: PANEL_MODELS.gemini, input: Q, tools: [{ type: "google_search" }] });
    expect(unwrap(r.data)).toEqual({
      question: Q,
      answer: INTERACTION_ANSWER,
      citations: [PANEL_CITATIONS[0], PANEL_CITATIONS[1], { url: "https://example.org/untitled", title: null }],
      model: PANEL_MODELS.gemini,
    });
    expect(r.untrusted).toBe(true);
    expect((r.data as Untrusted).source).toEqual({ connector: "gemini", kind: "api", ref: `panel:${Q}` });
  });
  it("caps the answer and citations", async () => {
    const annotations = Array.from({ length: 30 }, (_, i) => ({ type: "url_citation", url: `https://example.com/${i}`, title: `T${i}` }));
    const connector = createGeminiConnector({ fetch: routedFetch({ [`POST ${BASE}/interactions`]: () => jsonResponse({ steps: [{ type: "model_output", content: [{ type: "text", text: "x".repeat(20_000), annotations }] }] }) }) });
    const r = await connector.callTool("ask_panel", { question: Q }, makeToolContext(connector, { mode: "live", credential }));
    const d = unwrap(r.data) as { answer: string; citations: unknown[] };
    expect(d.answer.length).toBe(8_000);
    expect(d.citations).toHaveLength(20);
  });
  it.each([
    [401, "unauthorized"],
    [429, "rate_limited"],
  ])("maps a vendor %i to %s without echoing the key", async (status, code) => {
    const log = collectingLogger();
    const connector = createGeminiConnector({ fetch: routedFetch({ [`POST ${BASE}/interactions`]: () => jsonResponse({ error: { status: "X", message: `bad key ${KEY}` } }, { status }) }) });
    const r = await connector.callTool("ask_panel", { question: Q }, makeToolContext(connector, { mode: "live", credential, log }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(code);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(log.entries)).not.toContain(KEY);
  });
});

describe("gemini live (no founder key)", () => {
  it("rejects with connector_unconfigured and never uses a platform key", async () => {
    let calls = 0;
    const connector = createGeminiConnector({ secrets: platform, fetch: routedFetch({ "*": () => (calls++, jsonResponse({})) }) });
    await expect(connector.callTool("ask_panel", { question: Q }, makeToolContext(connector, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const health = await connector.healthcheck(makeToolContext(connector, { mode: "live" }).integration);
    expect(health.status).toBe("disconnected");
    expect(calls).toBe(0);
  });
});

describe("gemini connect and healthcheck", () => {
  it("declares an apiKey field and no platform key", () => {
    const c = createGeminiConnector();
    expect(c.auth).toEqual({ kind: "api_key" });
    expect(c.connectFields).toEqual([expect.objectContaining({ name: "apiKey", secret: true, required: true })]);
  });
  it("refuses blank input before any request", async () => {
    let calls = 0;
    const connector = createGeminiConnector({ fetch: routedFetch({ "*": () => (calls++, jsonResponse({})) }) });
    for (const input of [undefined, {}, { apiKey: "   " }]) await expect(connector.connect("b", input)).rejects.toMatchObject({ name: "ConnectInputError" });
    expect(calls).toBe(0);
  });
  it("validates with the free models lookup using exactly the given key", async () => {
    const keys: (string | null)[] = [];
    const connector = createGeminiConnector({ fetch: routedFetch({ [`GET ${BASE}/models/${PANEL_MODELS.gemini}`]: (req) => (keys.push(req.headers.get("x-goog-api-key")), jsonResponse(MODEL_RESPONSE)) }) });
    const rec = await connector.connect("b", { apiKey: ` ${KEY} ` });
    expect(keys).toEqual([KEY]);
    expect(rec.credentialToStore).toEqual({ kind: "api_key", secret: KEY });
    expect(JSON.stringify({ ...rec, credentialToStore: undefined })).not.toContain(KEY);
    const health = await connector.healthcheck(rec, credential);
    expect(health.status).toBe("connected");
    expect(keys).toEqual([KEY, KEY]);
  });
  it("a rejected key fails connect and health without leaking it", async () => {
    const connector = createGeminiConnector({ fetch: routedFetch({ [`GET ${BASE}/models/${PANEL_MODELS.gemini}`]: () => jsonResponse({ error: { ...KEY_REJECTED.error, message: `${KEY_REJECTED.error.message} ${KEY}` } }, { status: 400 }) }) });
    const err = await connector.connect("b", { apiKey: KEY }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
    const health = await connector.healthcheck(makeToolContext(connector, { mode: "live" }).integration, credential);
    expect(health.status).toBe("degraded");
    expect(JSON.stringify(health)).not.toContain(KEY);
  });
});

describe.skipIf(!envKeysPresent("GEMINI_API_KEY"))("gemini (live)", () => {
  describeConnectorContract("gemini live", {
    connector: createGeminiConnector(),
    mode: "live",
    credential: { kind: "api_key", secret: process.env.GEMINI_API_KEY ?? "" },
    connectInput: { apiKey: process.env.GEMINI_API_KEY },
    deterministic: false,
    calls: [{ tool: "ask_panel", args: { question: "What is a good CRM for a one-person business?" } }],
  });
});
