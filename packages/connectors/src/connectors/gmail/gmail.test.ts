import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { extractCandidateRecipients, isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { fromBase64Url } from "../_shared/mime";
import { GMAIL_MESSAGES } from "./fixtures/mailbox";
import { createGmailConnector } from "./index";
import { createGmailMock, gmailMock } from "./mock";
import { GMAIL_READ_SCOPE } from "./tools";

describeConnectorContract("gmail (mock)", {
  connector: gmailMock,
  mode: "mock",
  calls: [
    { tool: "list_messages", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(4) },
    { tool: "list_messages", args: { q: "from:maja is:unread" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["18f1a0001"]) },
    { tool: "get_message", args: { id: "18f1a0001" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ threadId: "t-lead-maja", inReplyTo: "<outbound-maja-1@northwindskincare.com>" }) },
    { tool: "send_message", args: { to: ["maja@sensitiveskinclub.se"], subject: "Re: call", text: "Tuesday 14:00 works. — Sent on behalf of Northwind Skincare by its AI assistant." }, check: (r) => expect(r.data).toMatchObject({ to: ["maja@sensitiveskinclub.se"] }) },
    { tool: "send_message", args: { to: ["jonas.berg@example.org"], subject: "Hi", text: "x" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("recipient_suppressed") },
    { tool: "send_message", args: { to: ["not-an-email"], subject: "Hi", text: "x" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "create_draft", args: { to: ["someone@example.com"], subject: "Draft", text: "For review" } },
    { tool: "list_labels", args: {} },
  ],
});

describe("gmail quarantine", () => {
  it("wraps an inbound supplier email containing injected instructions and exposes its recipients for policy", async () => {
    const r = await gmailMock.callTool("get_message", { id: "18f1a0003" }, makeToolContext(gmailMock));
    if (!isUntrusted(r.data)) throw new Error("expected untrusted");
    expect(r.data.source).toEqual({ connector: "gmail", kind: "email", ref: "message:18f1a0003" });
    expect(extractCandidateRecipients(r.data.content).emails).toContain("audit@hallbergs-compliance.example");
  });
  it("records sends in the mock outbox", async () => {
    const mock = createGmailMock();
    const ctx = makeToolContext(mock);
    await mock.callTool("send_message", { to: ["a@example.com"], subject: "s", text: "t" }, ctx);
    expect(mock.sentFor(ctx.businessId)).toHaveLength(1);
    const listed = await mock.callTool("list_messages", { q: "label:sent" }, makeToolContext(mock));
    expect(isUntrusted(listed.data) && (listed.data.content as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe("gmail live (canned)", () => {
  it("builds an RFC 5322 raw message, checks suppression via the host hook, and sends", async () => {
    let rawSent = "";
    const connector = createGmailConnector({
      secrets: {},
      isSuppressed: async (_b, email) => email === "blocked@example.com",
      fetch: routedFetch({
        "POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send": async (req) => {
          expect(req.headers.get("authorization")).toBe("Bearer tok");
          rawSent = ((await req.json()) as { raw: string }).raw;
          return jsonResponse({ id: "m1", threadId: "t1" });
        },
        "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/18f1a0001": () => jsonResponse(GMAIL_MESSAGES[0]),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "tok" }, integration: { ...makeToolContext(connector, { mode: "live" }).integration, config: { email: "reid@northwindskincare.com" } } });
    const ok = await connector.callTool("send_message", { to: ["maja@sensitiveskinclub.se"], subject: "Hej Maja", text: "Tuesday works.", inReplyToMessageId: "<abc@mail>" }, ctx);
    expect(ok.ok).toBe(true);
    const mime = fromBase64Url(rawSent);
    expect(mime).toContain("From: reid@northwindskincare.com");
    expect(mime).toContain("To: maja@sensitiveskinclub.se");
    expect(mime).toContain("In-Reply-To: <abc@mail>");
    expect(mime).toContain("Subject: Hej Maja");
    const blocked = await connector.callTool("send_message", { to: ["blocked@example.com"], subject: "x", text: "y" }, ctx);
    expect(blocked.error?.code).toBe("recipient_suppressed");
    const off = await connector.callTool("get_message", { id: "18f1a0001" }, ctx);
    expect(off.ok).toBe(false);
    expect(off.error?.status).toBe(403);
    const reading = { ...ctx, integration: { ...ctx.integration, scopes: [GMAIL_READ_SCOPE] } };
    const msg = await connector.callTool("get_message", { id: "18f1a0001" }, reading);
    expect(isUntrusted(msg.data) && (msg.data.content as { text: string }).text).toContain("20-minute call");
  });

  it("asks Google for gmail.readonly only when the founder turns reading on", async () => {
    const connector = createGmailConnector({ secrets: { googleClientId: "cid" } });
    const start = { state: "abc.def", redirectUri: "https://app.example.com/integrations/oauth/callback" };
    const scopeOf = async (input: object) => new URL(String((await connector.connect("b", { ...start, ...input })).config.authorizeUrl)).searchParams.get("scope") ?? "";
    expect(await scopeOf({})).not.toContain("gmail.readonly");
    expect(await scopeOf({})).toContain("gmail.send");
    expect(await scopeOf({ readMail: true })).toContain("gmail.readonly");
  });
});
