import { describe, expect, it } from "vitest";
import { PANEL_MODELS } from "@foundmill/models/routing";
import { jsonResponse, routedFetch } from "../../http";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import type { DecryptedCredential } from "../../contract";
import { OPENAI_FIXTURE_CITATIONS, OPENAI_MODEL_FIXTURE, OPENAI_RESPONSE_FIXTURE, OPENAI_UNAUTHORIZED_FIXTURE } from "./fixtures/panel";
import { createOpenaiConnector } from "./index";
import { openaiMock } from "./mock";

const KEY = "sk-proj-founderOwnKey1234567890";
const credential = (secret = KEY): DecryptedCredential => ({ kind: "api_key", secret });
const QUESTION = "best invoicing app for freelancers?";
const RESPONSES = "POST https://api.openai.com/v1/responses";
const MODEL = `GET https://api.openai.com/v1/models/${PANEL_MODELS.openai}`;
const platformSecrets = { openaiApiKey: "platform", sendgridApiKey: "platform" };

describeConnectorContract("openai (mock)", {
  connector: openaiMock,
  mode: "mock",
  calls: [
    {
      tool: "ask_panel",
      args: { question: QUESTION },
      check: (r) => {
        expect(r.untrusted).toBe(true);
        const text = JSON.stringify(r.data);
        expect(text).toContain("mock answer");
        expect(text).toContain(PANEL_MODELS.openai);
        for (const c of OPENAI_FIXTURE_CITATIONS) expect(text).toContain(c.url);
      },
    },
    { tool: "ask_panel", args: { question: "no" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("openai connector shape", () => {
  it("is the founder's own key: no platform key, phase 3, no hints", () => {
    const c = createOpenaiConnector({ secrets: {} });
    expect(c.auth).toEqual({ kind: "api_key" });
    expect(c.phase).toBe(3);
    expect(c.connectFields).toEqual([expect.objectContaining({ name: "apiKey", secret: true, required: true })]);
    expect(c.policyHints.ask_panel).toEqual({});
  });
});

describe("openai live (canned)", () => {
  it("sends the founder's key, turns on web_search and maps the answer and http(s) citations", async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | undefined;
    const connector = createOpenaiConnector({
      secrets: platformSecrets,
      fetch: routedFetch({
        [RESPONSES]: async (req) => {
          seen = { auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> };
          return jsonResponse(OPENAI_RESPONSE_FIXTURE);
        },
      }),
    });
    const result = await connector.callTool("ask_panel", { question: QUESTION }, makeToolContext(connector, { mode: "live", credential: credential() }));
    expect(result.ok).toBe(true);
    expect(result.untrusted).toBe(true);
    expect(result.costMinor).toBeGreaterThan(0);
    expect(seen?.auth).toBe(`Bearer ${KEY}`);
    expect(seen?.body).toMatchObject({ model: PANEL_MODELS.openai, input: QUESTION, tools: [{ type: "web_search" }] });
    const text = JSON.stringify(result.data);
    expect(text).toContain("Popular picks");
    expect(text).toContain("gpt-6-astra-2026-10-01");
    expect(text).toContain(OPENAI_FIXTURE_CITATIONS[0].url);
    expect(text).toContain(OPENAI_FIXTURE_CITATIONS[1].url);
    expect(text).not.toContain("javascript:");
    // The repeated citation is listed once.
    expect(text.split(OPENAI_FIXTURE_CITATIONS[1].url)).toHaveLength(2);
  });

  it("caps the answer and the citations", async () => {
    const annotations = Array.from({ length: 30 }, (_, i) => ({ type: "url_citation", url: `https://example.test/${i}`, title: null }));
    const body = { model: "m", output: [{ type: "message", content: [{ type: "output_text", text: "x".repeat(20_000), annotations }] }] };
    const connector = createOpenaiConnector({ secrets: {}, fetch: routedFetch({ [RESPONSES]: () => jsonResponse(body) }) });
    const result = await connector.callTool("ask_panel", { question: QUESTION }, makeToolContext(connector, { mode: "live", credential: credential() }));
    const data = (result.data as unknown as { content: { answer: string; citations: unknown[] } }).content;
    expect(data.answer.length).toBeLessThanOrEqual(8_001);
    expect(data.citations).toHaveLength(20);
  });

  it("maps 401 and 429 and keeps the key out of errors and logs", async () => {
    const log = collectingLogger();
    const c401 = createOpenaiConnector({ secrets: {}, fetch: routedFetch({ [RESPONSES]: () => jsonResponse({ error: { ...OPENAI_UNAUTHORIZED_FIXTURE.error, message: `Incorrect API key provided: ${KEY}` } }, { status: 401 }) }) });
    const bad = await c401.callTool("ask_panel", { question: QUESTION }, makeToolContext(c401, { mode: "live", credential: credential(), log }));
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("unauthorized");
    const c429 = createOpenaiConnector({ secrets: {}, fetch: routedFetch({ [RESPONSES]: () => jsonResponse({ error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, { status: 429 }) }) });
    const slow = await c429.callTool("ask_panel", { question: QUESTION }, makeToolContext(c429, { mode: "live", credential: credential(), log }));
    expect(slow.error?.code).toBe("rate_limited");
    expect(slow.error?.retryable).toBe(true);
    const everything = JSON.stringify([bad, slow, log.entries]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("founderOwnKey");
  });

  it("without a credential rejects as unconfigured and makes no request, even with platform keys", async () => {
    let calls = 0;
    const connector = createOpenaiConnector({ secrets: platformSecrets, fetch: routedFetch({ "*": () => (calls++, jsonResponse({})) }) });
    await expect(connector.callTool("ask_panel", { question: QUESTION }, makeToolContext(connector, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(calls).toBe(0);
  });

  it("connect() refuses blank input before any request, and with a key validates it for free and stores it", async () => {
    let calls = 0;
    let auth: string | null = null;
    const connector = createOpenaiConnector({
      secrets: platformSecrets,
      fetch: routedFetch({
        [MODEL]: (req) => {
          calls++;
          auth = req.headers.get("authorization");
          return jsonResponse(OPENAI_MODEL_FIXTURE);
        },
      }),
    });
    await expect(connector.connect(TEST_BUSINESS_ID, {})).rejects.toMatchObject({ name: "ConnectInputError" });
    await expect(connector.connect(TEST_BUSINESS_ID, { apiKey: "   " })).rejects.toMatchObject({ name: "ConnectInputError" });
    expect(calls).toBe(0);
    const record = await connector.connect(TEST_BUSINESS_ID, { apiKey: ` ${KEY} ` });
    expect(auth).toBe(`Bearer ${KEY}`);
    expect(record.credentialToStore).toEqual({ kind: "api_key", secret: KEY });
    expect(JSON.stringify({ ...record, credentialToStore: undefined })).not.toContain(KEY);
  });

  it("connect() with a rejected key fails without echoing it", async () => {
    const connector = createOpenaiConnector({ secrets: {}, fetch: routedFetch({ [MODEL]: () => jsonResponse({ error: { message: `Incorrect API key provided: ${KEY}`, type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 }) }) });
    const err = await connector.connect(TEST_BUSINESS_ID, { apiKey: KEY }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify([(err as Error).message, (err as { body?: unknown }).body])).not.toContain("founderOwnKey");
    expect((err as { httpStatus?: number }).httpStatus).toBe(401);
  });

  it("healthcheck is disconnected without a credential and uses the passed one otherwise", async () => {
    let auth: string | null = null;
    const connector = createOpenaiConnector({ secrets: platformSecrets, fetch: routedFetch({ [MODEL]: (req) => ((auth = req.headers.get("authorization")), jsonResponse(OPENAI_MODEL_FIXTURE)) }) });
    const integration = makeToolContext(connector, { mode: "live" }).integration;
    expect((await connector.healthcheck(integration)).status).toBe("disconnected");
    expect(auth).toBeNull();
    expect((await connector.healthcheck(integration, credential())).status).toBe("connected");
    expect(auth).toBe(`Bearer ${KEY}`);
    const rejecting = createOpenaiConnector({ secrets: {}, fetch: routedFetch({ [MODEL]: () => jsonResponse(OPENAI_UNAUTHORIZED_FIXTURE, { status: 401 }) }) });
    const health = await rejecting.healthcheck(integration, credential());
    expect(health.ok).toBe(false);
    expect(JSON.stringify(health)).not.toContain("abcd");
  });
});

describe.skipIf(!envKeysPresent("OPENAI_PANEL_TEST_KEY"))("openai (live)", () => {
  const secret = process.env.OPENAI_PANEL_TEST_KEY ?? "";
  describeConnectorContract("openai live", { connector: createOpenaiConnector({ secrets: {} }), mode: "live", credential: credential(secret), connectInput: { apiKey: secret }, deterministic: false, calls: [{ tool: "ask_panel", args: { question: "What is a good free invoicing tool for freelancers?" } }] });
});
