import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { MOCK_NOW } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { MOCK_SENDER_EMAIL, MOCK_SENDGRID_PUBLIC_KEY, SG_STATS, SG_VERIFIED_SENDERS } from "./fixtures/sendgrid";
import { createSendgridConnector } from "./index";
import { createSendgridMock, inboundParseRequest, MOCK_NOW_UNIX, sendgridMock, sgEvent, signedEventRequest } from "./mock";

const from = { email: MOCK_SENDER_EMAIL, name: "Northwind Skincare" };
const to = [{ email: "anna.lind@example.com", name: "Anna" }];
const base = { from, to, subject: "Your order has shipped", text: "Hi Anna, your order is on its way. Sent on behalf of Northwind Skincare." };

let deliveries = 0;
const inbound = (fields: Record<string, string>, token?: string | null) => inboundParseRequest(TEST_BUSINESS_ID, { from: "Maja Berg <maja@sensitiveskinclub.se>", to: MOCK_SENDER_EMAIL, subject: "Re: Your autumn routine", text: "Sounds great — can we book a call next week?", headers: `Message-ID: <m${++deliveries}@example.com>`, dkim: "{@sensitiveskinclub.se : pass}", SPF: "pass", ...fields }, token);

describeConnectorContract("sendgrid (mock)", {
  connector: sendgridMock,
  mode: "mock",
  calls: [
    { tool: "list_verified_senders", args: {}, check: (r) => expect((r.data as { items: { verified: boolean }[] }).items.filter((s) => s.verified)).toHaveLength(2) },
    { tool: "check_suppression", args: { emails: ["unsub@example.com", "anna.lind@example.com", "angry@example.com"] }, check: (r) => expect(r.data).toEqual({ suppressed: [{ email: "unsub@example.com", kinds: ["global_unsubscribe"] }, { email: "angry@example.com", kinds: ["spam_report", "global_unsubscribe"] }], clear: ["anna.lind@example.com"] }) },
    { tool: "send_mail", args: { ...base, kind: "transactional" }, check: (r) => expect(r.data).toMatchObject({ accepted: ["anna.lind@example.com"], rejected: [], scheduledFor: null }) },
    { tool: "send_mail", args: { ...base, kind: "marketing", unsubscribeUrl: "https://northwindskincare.com/u/abc" }, check: (r) => expect(r.ok).toBe(true) },
    { tool: "send_mail", args: { ...base, kind: "marketing" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("unsubscribe_missing") },
    { tool: "send_mail", args: { ...base, kind: "transactional", from: { email: "news@northwindskincare.com" } }, expectOk: false, check: (r) => expect(r.error?.code).toBe("sender_not_verified") },
    { tool: "send_mail", args: { ...base, kind: "transactional", from: { email: "someone@elsewhere.example" } }, expectOk: false, check: (r) => expect(r.error?.code).toBe("sender_not_verified") },
    { tool: "send_mail", args: { ...base, kind: "transactional", to: [{ email: "unsub@example.com" }] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("recipient_suppressed") },
    { tool: "send_mail", args: { ...base, kind: "transactional", bcc: [{ email: "bounced@example.com" }] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("recipient_suppressed") },
    { tool: "list_campaigns", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { status: string }[] }).items.map((c) => c.status)).toEqual(["draft", "triggered"]) },
    { tool: "create_campaign", args: { name: "Winter", subject: "Winter care", html: "<p>Hi {{{unsubscribe}}}</p>", text: "Hi", senderId: 4_411_902, listIds: ["list_subscribers"], suppressionGroupId: 21_904 }, check: (r) => expect(r.data).toMatchObject({ status: "draft", suppressionGroupId: 21_904 }) },
    { tool: "create_campaign", args: { name: "Bad sender", subject: "x", html: "<p>x</p>", text: "x", senderId: 4_411_904, listIds: ["l"], suppressionGroupId: 1 }, expectOk: false, check: (r) => expect(r.error?.status).toBe(400) },
    { tool: "get_stats", args: { startDate: "2026-09-28", endDate: "2026-10-04" }, check: (r) => expect(r.data).toMatchObject({ spamRatePercent: expect.any(Number), bounceRatePercent: expect.any(Number) }) },
  ],
  webhooks: [
    {
      name: "event webhook: unsubscribe + spamreport (+ ignored delivered/open)",
      valid: () => signedEventRequest(TEST_BUSINESS_ID, [sgEvent("delivered", "anna.lind@example.com", { timestamp: MOCK_NOW_UNIX + deliveries++ }), sgEvent("unsubscribe", "omar.haddad@example.com", { campaignId: "11111111-2222-4333-8444-555555555555" }), sgEvent("spamreport", "angry@example.com"), sgEvent("open", "anna.lind@example.com")]),
      tampered: () => signedEventRequest(TEST_BUSINESS_ID, [sgEvent("unsubscribe", "omar.haddad@example.com")], { signature: "MEUCIQDnotarealsignature0000000000000000000000000000000000000000AiEA000000000000000000000000000000000000000000000000000000000000" }),
      replay: true,
      expectEvents: 2,
      expectTypes: ["lead.replied", "lead.replied"],
    },
    {
      name: "inbound parse: reply asking for a call",
      index: 1,
      valid: () => inbound({}),
      tampered: () => inbound({}, "wrong-token"),
      replay: true,
      expectEvents: 1,
      expectTypes: ["lead.replied"],
    },
  ],
});

describe("sendgrid mock: mail composition and signals", () => {
  it("writes List-Unsubscribe headers and ASM groups into the v3 payload", async () => {
    const mock = createSendgridMock();
    const ctx = makeToolContext(mock);
    await mock.callTool("send_mail", { ...base, kind: "marketing", unsubscribeUrl: "https://northwindskincare.com/u/abc", text: "Hello {{{unsubscribe}}}", categories: ["lifecycle"] }, ctx);
    expect(mock.sent[0]!.body).toMatchObject({ headers: { "List-Unsubscribe": "<https://northwindskincare.com/u/abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, text: "Hello https://northwindskincare.com/u/abc", categories: ["lifecycle"], trackingSettings: { subscriptionTracking: { enable: true } } });
    await mock.callTool("send_mail", { ...base, kind: "marketing", unsubscribeGroupId: 21_904 }, ctx);
    expect(mock.sent[1]!.body).toMatchObject({ asm: { groupId: 21_904 } });
    expect(mock.policyHints.send_mail).toEqual({ contactsThirdParty: true, irreversible: true });
    expect(mock.policyHints.schedule_campaign).toEqual({ contactsThirdParty: true, irreversible: true });
  });
  it("add_suppression blocks later sends (opt-out received elsewhere)", async () => {
    const mock = createSendgridMock();
    const ctx = makeToolContext(mock);
    await mock.callTool("add_suppression", { emails: ["Anna.Lind@example.com"] }, ctx);
    const r = await mock.callTool("send_mail", { ...base, kind: "transactional" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("recipient_suppressed");
  });
  it("schedules a draft campaign once", async () => {
    const mock = createSendgridMock();
    const ctx = makeToolContext(mock);
    const r = await mock.callTool("schedule_campaign", { campaignId: "ss_mock_autumn_draft" }, ctx);
    expect(r.data).toMatchObject({ status: "triggered", sendAt: MOCK_NOW.toISOString() });
    expect((await mock.callTool("schedule_campaign", { campaignId: "ss_mock_autumn_draft" }, ctx)).error?.status).toBe(400);
  });
  it("spam-rate stats expose the AC-11.7.4 breach day", async () => {
    const r = await sendgridMock.callTool("get_stats", { startDate: "2026-10-02", endDate: "2026-10-02" }, makeToolContext(sendgridMock));
    expect((r.data as { spamRatePercent: number }).spamRatePercent).toBeGreaterThan(0.3);
    const quiet = await sendgridMock.callTool("get_stats", { startDate: "2026-09-28", endDate: "2026-09-29" }, makeToolContext(sendgridMock));
    expect((quiet.data as { spamRatePercent: number }).spamRatePercent).toBeLessThan(0.3);
  });
  it("inbound replies carry typed signals only, never the body", async () => {
    const webhook = sendgridMock.webhooks![1]!;
    const [reply] = await webhook.normalise(inbound({}));
    expect(reply!.payload).toMatchObject({ channelKey: "email_automation", sentiment: "neutral", requestsMeeting: true });
    expect((reply!.payload as { summary: string }).summary).not.toContain("book a call");
    const [unsub] = await webhook.normalise(inbound({ text: "Please remove me from your list." }));
    expect(unsub!.payload).toMatchObject({ sentiment: "unsubscribe", requestsMeeting: false });
    const [ooo] = await webhook.normalise(inbound({ subject: "Automatic reply: Re: Your autumn routine", text: "I am out of office until 12 October." }));
    expect(ooo!.payload).toMatchObject({ sentiment: "out_of_office" });
  });
  it("event webhook rejects stale timestamps and unknown keys", async () => {
    const webhook = sendgridMock.webhooks![0]!;
    expect(await webhook.verify(signedEventRequest(TEST_BUSINESS_ID, [sgEvent("unsubscribe", "x@example.com")], { timestamp: MOCK_NOW_UNIX - 1000 }))).toBe(false);
    const other = createSendgridConnector({ secrets: { sendgridWebhookPublicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnotthekey0000000000000000000000000000000000000000000000000000000000000000000000000==" }, now: () => MOCK_NOW });
    expect(await other.webhooks![0]!.verify(signedEventRequest(TEST_BUSINESS_ID, [sgEvent("unsubscribe", "x@example.com", { timestamp: 5 })]))).toBe(false);
  });
  it("simulations are deterministic", async () => {
    const a = await sendgridMock.simulate("lead.replied", { businessId: TEST_BUSINESS_ID, seed: "q", sentiment: "unsubscribe" });
    const b = await sendgridMock.simulate("lead.replied", { businessId: TEST_BUSINESS_ID, seed: "q", sentiment: "unsubscribe" });
    expect(a).toEqual(b);
    expect(a[0]!.payload).toMatchObject({ sentiment: "unsubscribe" });
    const spike = await sendgridMock.simulate("spam.spike", { businessId: TEST_BUSINESS_ID });
    expect(spike[0]!.payload).toMatchObject({ metric: "spam_rate", action: "paused", channelKey: "email_automation" });
  });
});

describe("sendgrid live (canned responses)", () => {
  it("sends through the fetch transport with Bearer auth after the sender, unsubscribe and suppression checks", async () => {
    const calls: string[] = [];
    let mailBody: Record<string, unknown> = {};
    const connector = createSendgridConnector({
      secrets: { sendgridApiKey: "SG.platform", sendgridWebhookPublicKey: MOCK_SENDGRID_PUBLIC_KEY },
      isSuppressed: async (_b, email) => email === "blocked@example.com",
      fetch: routedFetch({
        "GET https://api.sendgrid.com/v3/verified_senders": (req) => (calls.push(req.headers.get("authorization") ?? ""), jsonResponse({ results: SG_VERIFIED_SENDERS })),
        "GET https://api.sendgrid.com/v3/asm/suppressions/global/*": () => jsonResponse({}, { status: 404 }),
        "GET https://api.sendgrid.com/v3/suppression/*": () => jsonResponse([]),
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => ((mailBody = (await req.json()) as Record<string, unknown>), calls.push(req.headers.get("authorization") ?? ""), new Response(null, { status: 202, headers: { "x-message-id": "abc123" } })),
        "GET https://api.sendgrid.com/v3/stats": () => jsonResponse(SG_STATS),
      }),
      now: () => MOCK_NOW,
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const r = await connector.callTool("send_mail", { ...base, kind: "marketing", unsubscribeUrl: "https://northwindskincare.com/u/abc", customArgs: { campaignId: "c1" } }, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data).toMatchObject({ messageId: "abc123", accepted: ["anna.lind@example.com"] });
    expect(calls.every((a) => a === "Bearer SG.platform")).toBe(true);
    expect(mailBody).toMatchObject({ from: { email: MOCK_SENDER_EMAIL }, personalizations: [{ to: [{ email: "anna.lind@example.com" }], custom_args: { campaignId: "c1" } }], headers: { "List-Unsubscribe": "<https://northwindskincare.com/u/abc>" } });
    const blocked = await connector.callTool("send_mail", { ...base, kind: "transactional", to: [{ email: "blocked@example.com" }] }, ctx);
    expect(blocked.error?.code).toBe("recipient_suppressed");
    const stats = await connector.callTool("get_stats", { startDate: "2026-09-28" }, ctx);
    expect((stats.data as { rows: unknown[] }).rows).toHaveLength(7);
    expect(await connector.webhooks![0]!.verify(signedEventRequest(TEST_BUSINESS_ID, [sgEvent("unsubscribe", "x@example.com")]))).toBe(true);
  });
  it("throws ConfigError without a key and refuses inbound parse without a token", async () => {
    const c = createSendgridConnector({ secrets: {} });
    await expect(c.callTool("list_verified_senders", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(await c.webhooks![1]!.verify(inbound({}))).toBe(false);
    expect(await c.webhooks![0]!.verify(signedEventRequest(TEST_BUSINESS_ID, [sgEvent("unsubscribe", "x@example.com")]))).toBe(false);
  });
});

describe.skipIf(!envKeysPresent("SENDGRID_API_KEY"))("sendgrid (live)", () => {
  const connector = createSendgridConnector({ secrets: { sendgridApiKey: process.env.SENDGRID_API_KEY, sendgridWebhookPublicKey: process.env.SENDGRID_WEBHOOK_PUBLIC_KEY } });
  describeConnectorContract("sendgrid live", { connector, mode: "live", deterministic: false, calls: [{ tool: "list_verified_senders", args: {} }, { tool: "get_stats", args: { startDate: "2026-09-01" } }] });
});
