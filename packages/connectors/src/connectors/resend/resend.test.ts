import { describe, expect, it } from "vitest";
import { ConnectInputError } from "../../contract";
import { jsonResponse, routedFetch } from "../../http";
import { collectingLogger, describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { DOMAINS_NONE_VERIFIED, DOMAINS_OK, IDEMPOTENCY_CONFLICT, INVALID_KEY, QUOTA_EXCEEDED, RATE_LIMITED, RESTRICTED_KEY, SEND_OK } from "./fixtures/responses";
import { createResendConnector, createResendMock, redactKeys, resendMock } from "./index";
import { idempotencyKeyFor } from "./tools";

const KEY = "re_test_secret_key_123456";
const credential = { kind: "api_key" as const, secret: KEY };
const UNSUB = "https://ingest.foundmill.test/mail/unsubscribe?t=abc";
const mail = {
  from: { email: "hello@northwindskincare.com", name: "Northwind Skincare" },
  to: { email: "anna.lind@example.com", name: "Anna" },
  subject: "Your order has shipped",
  text: "Hi Anna, your order is on its way.",
};

describeConnectorContract("resend (mock)", {
  connector: resendMock,
  mode: "mock",
  calls: [
    { tool: "list_domains", args: {}, check: (r) => expect((r.data as { items: { status: string }[] }).items.map((d) => d.status)).toEqual(["verified", "not_started"]) },
    { tool: "send_mail", args: { ...mail, unsubscribeUrl: UNSUB }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "send_mail", args: { ...mail, cc: [{ email: "x@example.com" }] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "send_mail", args: { ...mail, to: { email: "x@example.com", name: "Bob, eve@x.com" } }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

const withLink = { unsubscribeUrl: UNSUB };

describe("resend mock", () => {
  it("applies the same refusals as the live side, with the gateway's link in the context", async () => {
    const mock = createResendMock();
    const ctx = makeToolContext(mock, withLink);
    expect((await mock.callTool("send_mail", mail, ctx)).data).toMatchObject({ to: "anna.lind@example.com", from: "hello@northwindskincare.com", simulated: true });
    const code = async (args: unknown) => (await mock.callTool("send_mail", args, ctx)).error?.code;
    expect(await code({ ...mail, from: { email: "news@news.northwindskincare.com" } })).toBe("sender_domain_not_verified");
    expect(await code({ ...mail, replyTo: "help@news.northwindskincare.com" })).toBe("sender_domain_not_verified");
    expect(await code({ ...mail, to: { email: "unsub@example.com" } })).toBe("recipient_suppressed");
    expect(await code({ ...mail, html: "<script>alert(1)</script>" })).toBe("content_refused");
  });
  it("refuses without the gateway's link (missing or not https) and records nothing", async () => {
    const mock = createResendMock();
    for (const unsubscribeUrl of [undefined, "http://ingest.foundmill.test/u", "not a url"]) {
      const r = await mock.callTool("send_mail", mail, makeToolContext(mock, unsubscribeUrl === undefined ? {} : { unsubscribeUrl }));
      expect(r.error).toMatchObject({ code: "unsubscribe_unavailable", status: 409 });
      expect(r.error?.message).toBe("Nothing was sent: this message needs an unsubscribe link, and one is not available here yet.");
    }
    expect(mock.sentFor(TEST_BUSINESS_ID)).toHaveLength(0);
  });
  it("records sends per business, with the unsubscribe headers and footer, and sends a retry once", async () => {
    const mock = createResendMock();
    const a = makeToolContext(mock, { businessId: "biz-a", ...withLink });
    const b = makeToolContext(mock, { businessId: "biz-b", ...withLink });
    const first = await mock.callTool("send_mail", { ...mail, html: "<p>Hi</p>" }, a);
    const again = await mock.callTool("send_mail", { ...mail, html: "<p>Hi</p>" }, a);
    expect((first.data as { id: string }).id).toBe((again.data as { id: string }).id);
    expect(mock.sentFor("biz-a")).toHaveLength(1);
    expect(mock.sentFor("biz-b")).toHaveLength(0);
    expect(mock.sentFor("biz-a")[0]!.body).toMatchObject({ headers: { "List-Unsubscribe": `<${UNSUB}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(String(mock.sentFor("biz-a")[0]!.body.text)).toContain(UNSUB);
    expect(String(mock.sentFor("biz-a")[0]!.body.html)).toContain(`href="${UNSUB}"`);
    // Another business's opt-out does not block this one.
    mock.suppressionsFor("biz-b").add("anna.lind@example.com");
    expect((await mock.callTool("send_mail", mail, b)).error?.code).toBe("recipient_suppressed");
    expect((await mock.callTool("send_mail", { ...mail, subject: "Another" }, a)).ok).toBe(true);
    expect(mock.sentFor("biz-b")).toHaveLength(0);
  });
  it("declares the hints and the founder's own key", () => {
    expect(resendMock.policyHints.send_mail).toEqual({ contactsThirdParty: true });
    expect(resendMock.policyHints.list_domains).toEqual({});
    expect(resendMock.auth).toEqual({ kind: "api_key" });
  });
});

describe("resend live (canned)", () => {
  interface Seen {
    method: string;
    path: string;
    authorization: string | null;
    idempotencyKey: string | null;
    body: Record<string, unknown> | null;
  }
  const connectorWith = (opts: { domains?: () => Response; send?: () => Response; isSuppressed?: (b: string, a: string) => Promise<boolean> } = {}, seen: Seen[] = []) =>
    createResendConnector({
      ...(opts.isSuppressed ? { isSuppressed: opts.isSuppressed } : {}),
      fetch: routedFetch({
        "GET https://api.resend.com/domains": (req) => {
          seen.push({ method: "GET", path: "/domains", authorization: req.headers.get("authorization"), idempotencyKey: null, body: null });
          if (req.headers.get("authorization") !== `Bearer ${KEY}`) return jsonResponse(INVALID_KEY, { status: 401 });
          return opts.domains ? opts.domains() : jsonResponse(DOMAINS_OK);
        },
        "POST https://api.resend.com/emails": async (req) => {
          seen.push({ method: "POST", path: "/emails", authorization: req.headers.get("authorization"), idempotencyKey: req.headers.get("idempotency-key"), body: (await req.json()) as Record<string, unknown> });
          return opts.send ? opts.send() : jsonResponse(SEND_OK);
        },
      }),
    });
  const run = (c: ReturnType<typeof connectorWith>, args: unknown = mail, log?: ReturnType<typeof collectingLogger>, link: string | undefined = UNSUB) =>
    c.callTool("send_mail", args, makeToolContext(c, { mode: "live", credential, ...(link ? { unsubscribeUrl: link } : {}), ...(log ? { log } : {}) }));

  it("lists domains with the founder's key", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    const r = await c.callTool("list_domains", {}, makeToolContext(c, { mode: "live", credential }));
    expect(r.data).toEqual({ items: [{ id: DOMAINS_OK.data[0]!.id, name: "northwindskincare.com", status: "verified", region: "us-east-1" }, { id: DOMAINS_OK.data[1]!.id, name: "news.northwindskincare.com", status: "not_started", region: "eu-west-1" }] });
    expect(seen).toEqual([{ method: "GET", path: "/domains", authorization: `Bearer ${KEY}`, idempotencyKey: null, body: null }]);
  });

  it("sends the documented request: bearer key, idempotency key, unsubscribe headers and footer; maps the answer", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    const r = await run(c, { ...mail, html: "<p>Hi <a href=\"https://northwindskincare.com\">shop</a></p>", replyTo: "support@northwindskincare.com" });
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual({ id: SEND_OK.id, to: "anna.lind@example.com", from: "hello@northwindskincare.com", subject: "Your order has shipped" });
    expect(r.costMinor).toBe(1);
    const post = seen.find((s) => s.method === "POST")!;
    expect(post.authorization).toBe(`Bearer ${KEY}`);
    expect(post.idempotencyKey).toMatch(/^fm-[0-9a-f]{48}$/);
    expect(post.body).toMatchObject({ from: '"Northwind Skincare" <hello@northwindskincare.com>', to: ['"Anna" <anna.lind@example.com>'], subject: "Your order has shipped", reply_to: "support@northwindskincare.com", headers: { "List-Unsubscribe": `<${UNSUB}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(String(post.body!.text)).toContain(`To stop getting these emails: ${UNSUB}`);
    expect(String(post.body!.html)).toContain(`<a href="${UNSUB}">Unsubscribe</a>`);
    expect(post.body).not.toHaveProperty("cc");
    expect(post.body).not.toHaveProperty("attachments");
  });

  it("refuses an unverified from-domain before any send request, naming the domain", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    const r = await run(c, { ...mail, from: { email: "news@news.northwindskincare.com" } });
    expect(r.error).toMatchObject({ code: "sender_domain_not_verified" });
    expect(r.error?.message).toContain("news.northwindskincare.com");
    const none = connectorWith({ domains: () => jsonResponse(DOMAINS_NONE_VERIFIED) }, seen);
    expect((await run(none, { ...mail, from: { email: "x@elsewhere.example" } })).error?.code).toBe("sender_domain_not_verified");
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);
  });

  it("refuses a suppressed recipient before any send request, using the host's hook per business", async () => {
    const seen: Seen[] = [];
    const asked: [string, string][] = [];
    const c = connectorWith({ isSuppressed: async (b, a) => (asked.push([b, a]), a === "anna.lind@example.com") }, seen);
    const r = await run(c);
    expect(r.error?.code).toBe("recipient_suppressed");
    expect(asked).toEqual([[TEST_BUSINESS_ID, "anna.lind@example.com"]]);
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);
  });

  it("refuses refused content before any send request", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    expect((await run(c, { ...mail, html: "<img src=x>" })).error?.code).toBe("content_refused");
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);
  });

  it("refuses without the gateway's unsubscribe link (missing or not https) before any request, and refuses one passed as an argument", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    for (const link of [undefined, "http://ingest.foundmill.test/u", "javascript:alert(1)"]) {
      const r = await c.callTool("send_mail", mail, makeToolContext(c, { mode: "live", credential, ...(link ? { unsubscribeUrl: link } : {}) }));
      expect(r.error).toMatchObject({ code: "unsubscribe_unavailable", status: 409 });
    }
    expect((await run(c, { ...mail, unsubscribeUrl: "https://evil.example/u" })).error?.code).toBe("invalid_args");
    expect(seen).toHaveLength(0);
  });

  it("carries exactly the context's link in the header and the footer", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    await run(c, { ...mail, html: "<p>Hi</p>" }, undefined, "https://ingest.foundmill.test/mail/unsubscribe?t=zzz");
    const post = seen.find((s) => s.method === "POST")!;
    expect((post.body!.headers as Record<string, string>)["List-Unsubscribe"]).toBe("<https://ingest.foundmill.test/mail/unsubscribe?t=zzz>");
    expect(String(post.body!.text)).toContain("To stop getting these emails: https://ingest.foundmill.test/mail/unsubscribe?t=zzz");
    expect(String(post.body!.html)).toContain('<a href="https://ingest.foundmill.test/mail/unsubscribe?t=zzz">');
    expect(JSON.stringify(post.body)).not.toContain(UNSUB);
  });

  it("refuses display names that smuggle a second recipient and quotes a normal name", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    for (const name of ["Bob, eve@x.com", "a;b", "x:y", "a@b", "(Bob)", "[Bob]", "Bob\\"]) expect((await run(c, { ...mail, to: { email: "anna.lind@example.com", name } })).error?.code).toBe("invalid_args");
    expect((await run(c, { ...mail, from: { email: "hello@northwindskincare.com", name: "Pay, pal@x.com" } })).error?.code).toBe("invalid_args");
    expect(seen).toHaveLength(0);
    await run(c);
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ from: '"Northwind Skincare" <hello@northwindskincare.com>', to: ['"Anna" <anna.lind@example.com>'] });
  });

  it("refuses a replyTo outside the account's verified domains before any send request", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    for (const replyTo of ["boss@elsewhere.example", "help@news.northwindskincare.com"]) {
      const r = await run(c, { ...mail, replyTo });
      expect(r.error).toMatchObject({ code: "sender_domain_not_verified" });
    }
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);
  });

  it("derives a stable idempotency key: same for the same message, different for another", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    await run(c);
    await run(c);
    await run(c, { ...mail, subject: "Something else" });
    await run(c, { ...mail, to: { email: "omar@example.com" } });
    const keys = seen.filter((s) => s.method === "POST").map((s) => s.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
    expect(idempotencyKeyFor("b1", mail)).not.toBe(idempotencyKeyFor("b2", mail));
    expect(idempotencyKeyFor("b1", mail)).toBe(idempotencyKeyFor("b1", { ...mail, to: { email: "ANNA.LIND@example.com" } }));
  });

  it("maps 401, 429 and 409 by status and machine code only, never echoing a key", async () => {
    const send = (body: unknown, status: number) => run(connectorWith({ send: () => jsonResponse(body, { status }) }));
    expect((await send(INVALID_KEY, 401)).error).toMatchObject({ code: "unauthorized", status: 401 });
    expect((await send(RATE_LIMITED, 429)).error).toMatchObject({ code: "rate_limited", status: 429, retryable: true });
    expect((await send(QUOTA_EXCEEDED, 429)).error?.message).toContain("daily_quota_exceeded");
    expect((await send(IDEMPOTENCY_CONFLICT, 409)).error).toMatchObject({ code: "vendor_error", status: 409 });
    const echoed = await send({ statusCode: 401, name: "validation_error", message: `API key ${KEY} is invalid (re_other_0000)` }, 401);
    expect(JSON.stringify(echoed)).not.toContain("secret_key");
    expect(JSON.stringify(echoed)).not.toContain("other_0000");
    const odd = await send({ statusCode: 401, name: `Bad ${KEY}`, message: "x" }, 401);
    expect(JSON.stringify(odd)).not.toContain(KEY);
  });

  it("explains a sending-only key in plain words when listing domains", async () => {
    const c = connectorWith({ domains: () => jsonResponse(RESTRICTED_KEY, { status: 401 }) });
    const r = await c.callTool("list_domains", {}, makeToolContext(c, { mode: "live", credential }));
    expect(r.error).toMatchObject({ code: "restricted_api_key", status: 401 });
    expect(r.error?.message).toContain("Full access");
  });

  it("throws ConfigError without a credential, even when platform keys exist, and calls nothing", async () => {
    const seen: Seen[] = [];
    const base = connectorWith({}, seen);
    const c = createResendConnector({ secrets: { openaiApiKey: "platform", sendgridApiKey: "platform" }, fetch: routedFetch({ "GET https://api.resend.com/domains": () => (seen.push({ method: "GET", path: "", authorization: null, idempotencyKey: null, body: null }), jsonResponse(DOMAINS_OK)) }) });
    await expect(c.callTool("send_mail", mail, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(c.callTool("list_domains", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(seen).toHaveLength(0);
    expect(base).toBeDefined();
  });

  it("connect() rejects blank input without a request, sends exactly the entered key, and labels the account", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    for (const input of [{}, { apiKey: "" }, { apiKey: "   " }, undefined]) await expect(c.connect("b1", input)).rejects.toBeInstanceOf(ConnectInputError);
    expect(seen).toHaveLength(0);
    const rec = await c.connect("b1", { apiKey: ` ${KEY} ` });
    expect(seen).toEqual([{ method: "GET", path: "/domains", authorization: `Bearer ${KEY}`, idempotencyKey: null, body: null }]);
    expect(rec).toMatchObject({ status: "connected", accountLabel: "northwindskincare.com", scopes: ["mail.send", "domains.read"], credentialToStore: { kind: "api_key", secret: KEY } });
    expect(JSON.stringify({ ...rec, credentialToStore: undefined })).not.toContain(KEY);
    await expect(c.connect("b1", { apiKey: "re_wrong" })).rejects.toMatchObject({ httpStatus: 401 });
    const none = await connectorWith({ domains: () => jsonResponse(DOMAINS_NONE_VERIFIED) }).connect("b1", { apiKey: KEY });
    expect(none).toMatchObject({ status: "degraded", accountLabel: "Resend" });
  });

  it("connect() asks for a full-access key when the key can only send", async () => {
    const c = connectorWith({ domains: () => jsonResponse(RESTRICTED_KEY, { status: 401 }) });
    const e = await c.connect("b1", { apiKey: KEY }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectInputError);
    expect((e as Error).message).toContain("Full access");
  });

  it("healthcheck is disconnected without a credential and lists domains with one", async () => {
    const seen: Seen[] = [];
    const c = connectorWith({}, seen);
    const integration = makeToolContext(c, { mode: "live" }).integration;
    expect((await c.healthcheck(integration)).status).toBe("disconnected");
    expect(seen).toHaveLength(0);
    expect(await c.healthcheck(integration, credential)).toMatchObject({ ok: true, status: "connected", details: { verifiedDomains: 1 } });
    expect(seen).toEqual([{ method: "GET", path: "/domains", authorization: `Bearer ${KEY}`, idempotencyKey: null, body: null }]);
    const bad = await c.healthcheck(integration, { kind: "api_key", secret: "re_wrong_key_9999" });
    expect(bad.status).toBe("degraded");
    expect(JSON.stringify(bad)).not.toContain("wrong_key");
  });

  it("keeps the key out of logs and thrown errors", async () => {
    const log = collectingLogger();
    const c = connectorWith({ send: () => jsonResponse({ statusCode: 401, name: "validation_error", message: `bad ${KEY}` }, { status: 401 }) });
    const r = await run(c, mail, log);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(log.entries)).not.toContain(KEY);
  });

  it("masks key-shaped text", () => {
    expect(redactKeys("Invalid re_abc123.", "re_abc123")).toBe("Invalid re_….");
    expect(redactKeys("no key")).toBe("no key");
  });
});

describe.skipIf(!envKeysPresent("RESEND_API_KEY"))("resend (live)", () => {
  // Read-only: lists domains. Sending is not exercised against a real account.
  describeConnectorContract("resend live", {
    connector: createResendConnector(),
    mode: "live",
    deterministic: false,
    skipConnect: true,
    credential: { kind: "api_key", secret: process.env.RESEND_API_KEY ?? "" },
    calls: [{ tool: "list_domains", args: {} }],
  });
});
