import { describe, expect, it } from "vitest";
import { ConnectInputError } from "../../contract";
import { routedFetch } from "../../http";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { mockIntegrationRecord } from "../../mock-utils";
import { IN_HOST, IN_KEY, IN_KEY_FILE, IN_KEY_FILE_BODY, IN_NESTED_KEY_FILE, IN_URLS } from "./fixtures/indexnow";
import { createIndexNowConnector } from "./index";
import { indexNowMock } from "./mock";
import { indexNowKeyFileUrl, INDEXNOW_KEY_RE, isIndexNowKey, normalizeIndexNowHost, urlCoveredByKeyLocation } from "./tools";

const API = "POST https://api.indexnow.org/indexnow";
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });
const credential = { kind: "api_key" as const, secret: IN_KEY };
const integration = (config: Record<string, unknown> = { host: IN_HOST, keyLocation: IN_KEY_FILE, key: IN_KEY }) => mockIntegrationRecord("indexnow", "b", { status: "connected", config });

describeConnectorContract("indexnow (mock)", {
  connector: indexNowMock,
  mode: "mock",
  integration: integration(),
  credential,
  calls: [
    { tool: "submit_urls", args: { urls: IN_URLS }, check: (r) => expect(r.data).toEqual({ submitted: 3, host: IN_HOST, status: "received", urls: IN_URLS }) },
    { tool: "submit_urls", args: { urls: ["https://evil.example.org/x"] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("pure helpers", () => {
  it("validates keys by the protocol's rule", () => {
    expect(INDEXNOW_KEY_RE.test("abcdefgh")).toBe(true);
    expect(isIndexNowKey("A-b-1-2-3-4")).toBe(true);
    expect(isIndexNowKey("a".repeat(128))).toBe(true);
    expect(isIndexNowKey("a".repeat(129))).toBe(false);
    expect(isIndexNowKey("short")).toBe(false);
    expect(isIndexNowKey("has space 123")).toBe(false);
    expect(isIndexNowKey("under_score1")).toBe(false);
    expect(isIndexNowKey("abcdefgh\n")).toBe(false);
    expect(isIndexNowKey(42)).toBe(false);
  });
  it("builds the default key file address", () => {
    expect(indexNowKeyFileUrl("northwindskincare.com", "abcd1234")).toBe("https://northwindskincare.com/abcd1234.txt");
  });
  it("covers URLs under the key file's directory only", () => {
    const root = "https://a.com/key12345.txt";
    expect(urlCoveredByKeyLocation("https://a.com/", root)).toBe(true);
    expect(urlCoveredByKeyLocation("https://a.com/x/y?z=1", root)).toBe(true);
    expect(urlCoveredByKeyLocation("https://b.com/", root)).toBe(false);
    expect(urlCoveredByKeyLocation("http://a.com/", root)).toBe(false);
    const nested = "https://a.com/blog/key12345.txt";
    expect(urlCoveredByKeyLocation("https://a.com/blog/post", nested)).toBe(true);
    expect(urlCoveredByKeyLocation("https://a.com/blog/", nested)).toBe(true);
    expect(urlCoveredByKeyLocation("https://a.com/blog", nested)).toBe(false);
    expect(urlCoveredByKeyLocation("https://a.com/blogger/x", nested)).toBe(false);
    expect(urlCoveredByKeyLocation("https://a.com/blog/../x", nested)).toBe(false);
    expect(urlCoveredByKeyLocation("not a url", nested)).toBe(false);
  });
  it("reduces a pasted address to a public multi-label host", () => {
    expect(normalizeIndexNowHost("  https://NorthwindSkincare.com/shop?a=1 ")).toBe("northwindskincare.com");
    expect(normalizeIndexNowHost("www.Northwind.co.uk")).toBe("www.northwind.co.uk");
    for (const bad of ["localhost", "127.0.0.1", "http://10.0.0.1/", "[::1]", "intranet", "a.local", "foo.internal", "https://user:pw@a.com", "a.com:8080", "", "a b.com", "a.123", "ftp://a.com", "-a.com"]) expect(normalizeIndexNowHost(bad), bad).toBeNull();
  });
});

describe("indexnow live (canned)", () => {
  const live = (routes: Parameters<typeof routedFetch>[0], log = collectingLogger()) => {
    const connector = createIndexNowConnector({ secrets: {}, fetch: routedFetch(routes) });
    return { connector, ctx: makeToolContext(connector, { mode: "live", integration: integration(), credential, log }), log };
  };

  it("posts host, key and urlList as JSON and maps 200 and 202", async () => {
    let seen: { body: unknown; type: string | null } | undefined;
    const { connector, ctx } = live({ [API]: async (req) => ((seen = { body: await req.json(), type: req.headers.get("content-type") }), new Response(null, { status: 200 })) });
    const ok = await connector.callTool("submit_urls", { urls: IN_URLS }, ctx);
    expect(ok.data).toEqual({ submitted: 3, host: IN_HOST, status: "received", urls: IN_URLS });
    expect(ok.costMinor).toBe(0);
    expect(seen?.type).toBe("application/json; charset=utf-8");
    expect(seen?.body).toEqual({ host: IN_HOST, key: IN_KEY, urlList: IN_URLS });
    const { connector: c2, ctx: ctx2 } = live({ [API]: () => new Response(null, { status: 202 }) });
    expect((await c2.callTool("submit_urls", { urls: [IN_URLS[0]] }, ctx2)).data).toMatchObject({ status: "pending_key_validation", submitted: 1 });
  });

  it("sends keyLocation only when the key file is not at the root, and checks URLs against its folder", async () => {
    let body: Record<string, unknown> = {};
    const connector = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [API]: async (req) => ((body = (await req.json()) as Record<string, unknown>), new Response(null, { status: 200 })) }) });
    const ctx = makeToolContext(connector, { mode: "live", integration: integration({ host: IN_HOST, keyLocation: IN_NESTED_KEY_FILE }), credential });
    const outside = await connector.callTool("submit_urls", { urls: [`https://${IN_HOST}/blog/a`] }, ctx);
    expect(outside).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(outside.error?.message).toContain(`https://${IN_HOST}/blog/a`);
    expect(body).toEqual({});
    expect((await connector.callTool("submit_urls", { urls: [`https://${IN_HOST}/seo/faq`] }, ctx)).ok).toBe(true);
    expect(body).toMatchObject({ keyLocation: IN_NESTED_KEY_FILE });
  });

  it("refuses other hosts, subdomains and non-https before any request", async () => {
    const { connector, ctx } = live({});
    for (const url of ["https://evil.com/", `https://sub.${IN_HOST}/`, `https://${IN_HOST}.evil.com/`, `https://${IN_HOST}:8443/`, `http://${IN_HOST}/`]) {
      const r = await connector.callTool("submit_urls", { urls: [IN_URLS[0], url] }, ctx);
      expect(r.ok, url).toBe(false);
      expect(r.error?.code).toBe("invalid_args");
    }
    expect((await connector.callTool("submit_urls", { urls: [] }, ctx)).error?.code).toBe("invalid_args");
  });

  it("maps 403, 422, 429 and 400 to clear errors", async () => {
    const answer = async (status: number) => {
      const { connector, ctx } = live({ [API]: () => new Response(`echo ${IN_KEY}`, { status }) });
      return connector.callTool("submit_urls", { urls: IN_URLS }, ctx);
    };
    expect((await answer(403)).error).toMatchObject({ code: "key_not_valid", status: 403 });
    expect((await answer(422)).error).toMatchObject({ code: "url_not_on_host", status: 422 });
    expect((await answer(429)).error).toMatchObject({ code: "rate_limited", retryable: true });
    expect((await answer(400)).error).toMatchObject({ code: "vendor_error", status: 400 });
    const down = await answer(503);
    expect(down.error?.code).toBe("vendor_error");
    expect(JSON.stringify(down)).not.toContain("echo");
  });

  it("throws ConfigError without a credential, even with platform keys, and makes no request", async () => {
    let calls = 0;
    const connector = createIndexNowConnector({ secrets: { openaiApiKey: "platform", sendgridApiKey: "platform" }, fetch: routedFetch({ "*": () => (calls++, new Response(null, { status: 200 })) }) });
    const ctx = makeToolContext(connector, { mode: "live", integration: integration() });
    await expect(connector.callTool("submit_urls", { urls: IN_URLS }, ctx)).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(calls).toBe(0);
  });

  it("connect() checks the key file and stores the key as the credential", async () => {
    const requested: string[] = [];
    const connector = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [`GET ${IN_KEY_FILE}`]: (req) => (requested.push(req.url), text(IN_KEY_FILE_BODY)) }) });
    const record = await connector.connect("b1", { host: "https://NorthwindSkincare.com/pricing", key: ` ${IN_KEY} ` });
    expect(requested).toEqual([IN_KEY_FILE]);
    expect(record).toMatchObject({ status: "connected", externalAccountId: IN_HOST, accountLabel: IN_HOST, config: { host: IN_HOST, keyLocation: IN_KEY_FILE, key: IN_KEY }, credentialToStore: { kind: "api_key", secret: IN_KEY } });
  });

  it("connect() uses keyLocation when given and follows a same-host redirect only", async () => {
    const connector = createIndexNowConnector({
      secrets: {},
      fetch: routedFetch({
        [`GET ${IN_NESTED_KEY_FILE}`]: () => new Response(null, { status: 301, headers: { location: `https://${IN_HOST}/moved.txt` } }),
        [`GET https://${IN_HOST}/moved.txt`]: () => text(IN_KEY),
      }),
    });
    expect((await connector.connect("b", { host: IN_HOST, key: IN_KEY, keyLocation: IN_NESTED_KEY_FILE })).config).toMatchObject({ keyLocation: IN_NESTED_KEY_FILE });
    const away = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [`GET ${IN_KEY_FILE}`]: () => new Response(null, { status: 302, headers: { location: "https://evil.com/key.txt" } }) }) });
    await expect(away.connect("b", { host: IN_HOST, key: IN_KEY })).rejects.toBeInstanceOf(ConnectInputError);
  });

  it("connect() explains where the file must be when it is missing, wrong or too big", async () => {
    for (const res of [() => text("nope", 404), () => text("some-other-key-123"), () => text(`${IN_KEY}${" ".repeat(2000)}`), () => text(`<html>${IN_KEY}</html>`)]) {
      const connector = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [`GET ${IN_KEY_FILE}`]: res }) });
      const err = await connector.connect("b", { host: IN_HOST, key: IN_KEY }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectInputError);
      expect((err as Error).message).toContain(IN_KEY_FILE);
      expect((err as Error).message).toContain("only your IndexNow key");
    }
  });

  it("connect() refuses blank or invalid fields without any request", async () => {
    let calls = 0;
    const connector = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ "*": () => (calls++, text(IN_KEY)) }) });
    for (const input of [{}, { host: IN_HOST }, { key: IN_KEY }, { host: "  ", key: IN_KEY }, { host: "localhost", key: IN_KEY }, { host: "10.0.0.1", key: IN_KEY }, { host: IN_HOST, key: "short" }, { host: IN_HOST, key: "bad key bad key" }, { host: IN_HOST, key: IN_KEY, keyLocation: "https://other.com/k.txt" }, { host: IN_HOST, key: IN_KEY, keyLocation: `http://${IN_HOST}/k.txt` }]) {
      await expect(connector.connect("b", input), JSON.stringify(input)).rejects.toBeInstanceOf(ConnectInputError);
    }
    expect(calls).toBe(0);
  });

  it("the key-file fetch never dials a host that resolves to a private address", async () => {
    // No injected fetch: the real guarded transport runs, and its own lookup refuses before any connection.
    const connector = createIndexNowConnector({ secrets: {}, resolveHost: async () => ["10.0.0.5"] });
    const err = await connector.connect("b", { host: "sneaky.example.com", key: IN_KEY }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectInputError);
    const health = await connector.healthcheck(integration({ host: "sneaky.example.com", keyLocation: "https://sneaky.example.com/x.txt" }), credential);
    expect(health.status).toBe("degraded");
  });

  it("healthcheck: disconnected without a credential, connected or degraded by the key file", async () => {
    const good = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [`GET ${IN_KEY_FILE}`]: () => text(IN_KEY_FILE_BODY) }) });
    expect((await good.healthcheck(integration())).status).toBe("disconnected");
    expect((await good.healthcheck(integration(), credential)).status).toBe("connected");
    const bad = createIndexNowConnector({ secrets: {}, fetch: routedFetch({ [`GET ${IN_KEY_FILE}`]: () => text("", 404) }) });
    const health = await bad.healthcheck(integration(), credential);
    expect(health).toMatchObject({ status: "degraded", ok: false });
    expect(health.message).toContain(IN_KEY_FILE);
  });

  it("the key never reaches a collected log line", async () => {
    const { connector, ctx, log } = live({ [API]: () => new Response("", { status: 503 }) });
    await connector.callTool("submit_urls", { urls: IN_URLS }, ctx);
    expect(JSON.stringify(log.entries)).not.toContain(IN_KEY);
  });
});

describe.skipIf(!envKeysPresent("INDEXNOW_TEST_HOST", "INDEXNOW_TEST_KEY"))("indexnow (live)", () => {
  it("connects to a real site that serves its key file", async () => {
    const connector = createIndexNowConnector({ secrets: {} });
    const record = await connector.connect("b", { host: process.env.INDEXNOW_TEST_HOST, key: process.env.INDEXNOW_TEST_KEY });
    expect(record.status).toBe("connected");
  });
});
