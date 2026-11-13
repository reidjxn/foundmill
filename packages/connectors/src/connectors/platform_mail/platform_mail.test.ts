/**
 * `platform_mail` (package 1.5): the sender is never an argument, every message carries the unsubscribe headers and the
 * signed custom args, content is plain text and simple HTML only, and what comes back is bound to the project by a
 * signature an outsider cannot make.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { routedFetch } from "../../http";
import { makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { uuidFromSeed } from "../../mock-utils";
import { APP_NAME } from "@foundmill/config";
import { createPlatformMailConnector, createPlatformMailMock, dkimPassedDomains, domainsAligned, inboundSenderVerified, normalisePlatformMailEvents, replyOwnText, platformInboundLocalParts, platformMailContentProblem, platformMailCustomArgs, platformMailSenderName, platformUnsubscribeToken, platformUnsubscribeUrl, readPlatformUnsubscribeToken, suppressionHashOfEmail, verifyPlatformMailArgs } from "./index";

const SECRET = "test-platform-mail-signing-secret-0123456789";
const OTHER_BUSINESS = uuidFromSeed("test", "business", "other");
const ref = uuidFromSeed("test", "mail", "1");
const ANNA = suppressionHashOfEmail("anna@example.com");
const argsFor = (email: string, businessId = TEST_BUSINESS_ID) => platformMailCustomArgs(SECRET, businessId, ref, suppressionHashOfEmail(email));
const envelope = (businessId = TEST_BUSINESS_ID) => ({
  from: { email: "northwind@mail.foundmill.test", name: `Northwind via ${APP_NAME}` },
  projectName: "Northwind",
  messageRef: ref,
  unsubscribeUrl: platformUnsubscribeUrl("https://ingest.foundmill.test", platformUnsubscribeToken(SECRET, businessId, ANNA)),
  customArgs: platformMailCustomArgs(SECRET, businessId, ref, ANNA),
  commercial: true,
  postalAddress: POSTAL,
});
const POSTAL = "PO Box 1234, Springfield, IL 62701, USA";
const mail = { to: { email: "Anna@Example.com", name: "Anna" }, subject: "Thanks for joining the list", text: "Hi Anna, thanks for signing up." };

describe("platform_mail content", () => {
  it("takes plain text and simple HTML, and refuses anything else", () => {
    expect(platformMailContentProblem(mail)).toBeNull();
    expect(platformMailContentProblem({ ...mail, html: '<p>Hi <strong>Anna</strong>,<br>see <a href="https://northwind.example/notes">the notes</a> or <a href="mailto:hi@northwind.example">write</a>.</p><ul><li>One</li></ul>' })).toBeNull();
    for (const html of ["<script>alert(1)</script>", '<img src="https://x.example/p.png">', '<p onclick="x()">Hi</p>', '<a href="javascript:alert(1)">x</a>', '<a href="https://x.example" onclick="y()">x</a>', "<!-- hidden -->", "<iframe src=x></iframe>", "<style>p{}</style>", "<form action=x>", '<p style="color:red">x</p>', "<scr<script>ipt>", '<a href="https://x.example">x</a href="https://y.example">', '<p>x</p onclick="y()">', "<b>x</b style=x>"]) {
      expect(platformMailContentProblem({ ...mail, html }), html).not.toBeNull();
    }
    expect(platformMailContentProblem({ ...mail, subject: "Two\nlines" })).not.toBeNull();
    expect(platformMailContentProblem({ ...mail, text: "   " })).not.toBeNull();
  });

  it("has no attachments and no sender among its arguments", async () => {
    const mock = createPlatformMailMock();
    const ctx = makeToolContext(mock, { platformMail: envelope() });
    for (const extra of [{ attachments: [{ filename: "a.pdf", content: "x" }] }, { from: { email: "ceo@bank.example" } }, { replyTo: { email: "x@evil.example" } }, { cc: [{ email: "b@example.com" }] }, { to: { email: "anna@example.com", name: "Anna\r\nBcc: x@evil.example" } }]) {
      const r = await mock.callTool("send_mail", { ...mail, ...extra }, ctx);
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      expect(r.error?.code).toBe("invalid_args");
    }
    expect(mock.sentFor(TEST_BUSINESS_ID)).toHaveLength(0);
  });
});

describe("platform_mail sender name", () => {
  it(`is "<project name> via ${APP_NAME}", on one line, and never a name that contains ${APP_NAME}`, () => {
    expect(platformMailSenderName("Northwind", "northwind")).toEqual({ projectName: "Northwind", fromName: `Northwind via ${APP_NAME}` });
    expect(platformMailSenderName('Evil "Co"\r\nBcc: x@evil.example <x>', "evil-co").fromName).toBe(`Evil Co Bcc: x@evil.example x via ${APP_NAME}`);
    for (const name of [`${APP_NAME} Support`, `${APP_NAME.toUpperCase()} billing`, `my${APP_NAME.toLowerCase()}`]) expect(platformMailSenderName(name, "acme-shop"), name).toEqual({ projectName: "acme-shop", fromName: `acme-shop via ${APP_NAME}` });
    expect(platformMailSenderName("   ", "acme-shop").projectName).toBe("acme-shop");
  });
});

describe("platform_mail mock", () => {
  it("sends from the gateway's envelope with the unsubscribe headers, the footer and the signed custom args", async () => {
    const mock = createPlatformMailMock();
    const r = await mock.callTool("send_mail", { ...mail, html: "<p>Hi Anna</p>" }, makeToolContext(mock, { platformMail: envelope() }));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ messageRef: ref, from: "northwind@mail.foundmill.test", to: "anna@example.com" });
    const [sent] = mock.sentFor(TEST_BUSINESS_ID);
    const body = sent!.body as { from: unknown; replyTo: unknown; headers: Record<string, string>; text: string; html: string; personalizations: { customArgs: Record<string, string> }[]; trackingSettings: unknown };
    expect(body.from).toEqual({ email: "northwind@mail.foundmill.test", name: `Northwind via ${APP_NAME}` });
    expect(body.replyTo).toEqual(body.from);
    expect(body.text).toContain(`Sent by Northwind with ${APP_NAME}.`);
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/ingest\.foundmill\.test\/mail\/unsubscribe\?t=/);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.text).toContain("To stop getting these emails: https://ingest.foundmill.test/mail/unsubscribe?t=");
    expect(body.html).toContain(">Unsubscribe</a>");
    expect(verifyPlatformMailArgs(SECRET, { ...body.personalizations[0]!.customArgs, email: "anna@example.com" })).toEqual({ businessId: TEST_BUSINESS_ID, messageRef: ref });
  });

  it("puts the founders' postal address in a commercial message's footer, on the footer's one line (US CAN-SPAM)", async () => {
    const mock = createPlatformMailMock();
    await mock.callTool("send_mail", { ...mail, html: "<p>Hi Anna</p>" }, makeToolContext(mock, { platformMail: envelope() }));
    const body = mock.sentFor(TEST_BUSINESS_ID)[0]!.body as { text: string; html: string };
    const footer = body.text.split("\n").at(-1)!;
    expect(footer).toBe(`Sent by Northwind with ${APP_NAME}. Postal address: ${POSTAL}. To stop getting these emails: ${envelope().unsubscribeUrl}`);
    expect(body.html).toContain(`<br>Postal address: ${POSTAL}.<br><a href=`);
  });

  it("escapes the address in the HTML part", async () => {
    const mock = createPlatformMailMock();
    await mock.callTool("send_mail", { ...mail, html: "<p>Hi</p>" }, makeToolContext(mock, { platformMail: { ...envelope(), postalAddress: "12 Main & Elm St, Springfield" } }));
    expect((mock.sentFor(TEST_BUSINESS_ID)[0]!.body as { html: string }).html).toContain("Postal address: 12 Main &amp; Elm St, Springfield.");
  });

  it("sends no commercial message without the postal address; a transactional one goes without it", async () => {
    const mock = createPlatformMailMock();
    const { postalAddress: _omit, ...bare } = envelope();
    await expect(mock.callTool("send_mail", mail, makeToolContext(mock, { platformMail: bare }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(mock.callTool("send_mail", mail, makeToolContext(mock, { platformMail: { ...bare, postalAddress: "  " } }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(mock.sentFor(TEST_BUSINESS_ID)).toHaveLength(0);
    const r = await mock.callTool("send_mail", { ...mail, purpose: "reply" }, makeToolContext(mock, { platformMail: { ...bare, commercial: false } }));
    expect(r.ok).toBe(true);
    const text = (mock.sentFor(TEST_BUSINESS_ID)[0]!.body as { text: string }).text;
    expect(text).not.toContain("Postal address");
    expect(text).toContain("To stop getting these emails:");
  });

  it("sends nothing without the gateway's envelope, or with another business's", async () => {
    const mock = createPlatformMailMock();
    await expect(mock.callTool("send_mail", mail, makeToolContext(mock))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(mock.callTool("send_mail", mail, makeToolContext(mock, { platformMail: envelope(OTHER_BUSINESS) }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(mock.sentFor(TEST_BUSINESS_ID)).toHaveLength(0);
  });
});

describe("platform_mail live (canned SendGrid)", () => {
  it("posts one message on the platform key, from the project's address, and returns SendGrid's message id", async () => {
    const seen: { auth: string | null; body: Record<string, unknown> }[] = [];
    const connector = createPlatformMailConnector({
      secrets: { sendgridApiKey: "SG.platform-test-key" },
      isSuppressed: async () => false,
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          seen.push({ auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> });
          return new Response(null, { status: 202, headers: { "x-message-id": "sg-msg-1" } });
        },
      }),
    });
    const r = await connector.callTool("send_mail", mail, makeToolContext(connector, { mode: "live", platformMail: envelope() }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ messageId: "sg-msg-1", messageRef: ref, from: "northwind@mail.foundmill.test", to: "anna@example.com" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe("Bearer SG.platform-test-key");
    const body = seen[0]!.body as { from: { email: string }; reply_to: { email: string }; headers: Record<string, string>; personalizations: { to: { email: string }[]; custom_args: Record<string, string> }[]; attachments?: unknown };
    expect(body.from.email).toBe("northwind@mail.foundmill.test");
    expect(body.reply_to.email).toBe("northwind@mail.foundmill.test");
    expect(body.personalizations[0]!.to).toEqual([{ email: "Anna@Example.com", name: "Anna" }]);
    expect(verifyPlatformMailArgs(SECRET, { ...body.personalizations[0]!.custom_args, email: "Anna@Example.com" })).toEqual({ businessId: TEST_BUSINESS_ID, messageRef: ref });
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.attachments).toBeUndefined();
  });

  it("refuses a suppressed recipient before SendGrid, and needs the platform key", async () => {
    let calls = 0;
    const connector = createPlatformMailConnector({ secrets: { sendgridApiKey: "SG.k" }, isSuppressed: async () => true, fetch: async () => (calls++, new Response(null, { status: 202 })) });
    const r = await connector.callTool("send_mail", mail, makeToolContext(connector, { mode: "live", platformMail: envelope() }));
    expect(r.error?.code).toBe("recipient_suppressed");
    expect(calls).toBe(0);
    const keyless = createPlatformMailConnector({ secrets: {} });
    await expect(keyless.callTool("send_mail", mail, makeToolContext(keyless, { mode: "live", platformMail: envelope() }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe("platform_mail signatures", () => {
  it("custom args verify only as signed: another business, another message, another address or another secret is refused", () => {
    const args = { ...argsFor("anna@example.com"), email: "anna@example.com" };
    expect(verifyPlatformMailArgs(SECRET, args)).toEqual({ businessId: TEST_BUSINESS_ID, messageRef: ref });
    // The signature covers the recipient: Anna's args copied onto an event about someone else do not verify, nor without one.
    expect(verifyPlatformMailArgs(SECRET, { ...args, email: "victim@example.com" })).toBeNull();
    expect(verifyPlatformMailArgs(SECRET, { ...args, email: undefined })).toBeNull();
    expect(verifyPlatformMailArgs(SECRET, { ...args, fm_b: OTHER_BUSINESS })).toBeNull();
    expect(verifyPlatformMailArgs(SECRET, { ...args, fm_m: uuidFromSeed("x") })).toBeNull();
    expect(verifyPlatformMailArgs("another-secret-0123456789abcdef", args)).toBeNull();
    expect(verifyPlatformMailArgs(SECRET, { fm_b: TEST_BUSINESS_ID, fm_m: ref })).toBeNull();
    expect(verifyPlatformMailArgs(SECRET, { business_id: TEST_BUSINESS_ID })).toBeNull();
  });

  it("an unsubscribe token names the business and the address hash, and nothing else verifies", () => {
    const hash = suppressionHashOfEmail(" Anna@Example.com ");
    expect(hash).toBe(createHash("sha256").update("anna@example.com").digest("hex"));
    const token = platformUnsubscribeToken(SECRET, TEST_BUSINESS_ID, hash);
    expect(readPlatformUnsubscribeToken(SECRET, token)).toEqual({ businessId: TEST_BUSINESS_ID, emailHash: hash });
    expect(readPlatformUnsubscribeToken(SECRET, token.replace(TEST_BUSINESS_ID, OTHER_BUSINESS))).toBeNull();
    expect(readPlatformUnsubscribeToken(SECRET, `${token}.x`)).toBeNull();
    expect(readPlatformUnsubscribeToken("another-secret-0123456789abcdef", token)).toBeNull();
  });
});

describe("platform_mail: what comes back", () => {
  it("reads SendGrid's SPF and DKIM results for the From domain only", () => {
    const from = "Maja <maja@customer.example>";
    expect(dkimPassedDomains("{@customer.example : pass, @sendgrid.net : fail}")).toEqual(["customer.example"]);
    expect(inboundSenderVerified({ from, envelope: { from: "bounce@em1.customer.example" }, spf: "pass", dkim: null })).toEqual({ verified: true, by: "spf" });
    expect(inboundSenderVerified({ from, envelope: null, spf: "softfail", dkim: "{@mail.customer.example : pass}" })).toEqual({ verified: true, by: "dkim" });
    expect(inboundSenderVerified({ from, envelope: { from: "x@attacker.example" }, spf: "pass", dkim: "{@attacker.example : pass}" })).toEqual({ verified: false, reason: "failed" });
    expect(inboundSenderVerified({ from, envelope: null, spf: null, dkim: null })).toEqual({ verified: false, reason: "no_results" });
    expect(domainsAligned("example", "customer.example")).toBe(false);
    expect(domainsAligned("evilcustomer.example", "customer.example")).toBe(false);
  });

  it("classifies a reply on its own words: quotes and the footer's lines are left out", () => {
    expect(replyOwnText("Yes\n\nOn Wed, Nov 11, 2026, Acme wrote:\n> To stop getting these emails: https://x/mail/unsubscribe?t=1")).toBe("Yes");
    expect(replyOwnText("Yes\nSent by Acme. To stop getting these emails: https://x/mail/unsubscribe?t=1", ["/mail/unsubscribe"])).toBe("Yes");
    expect(replyOwnText("please unsubscribe me\n> quoted")).toBe("please unsubscribe me");
  });

  it("finds the local parts at the platform domain, envelope first", () => {
    expect(platformInboundLocalParts({ to: "Northwind <northwind@mail.foundmill.test>, other@elsewhere.example", envelope: null }, "mail.foundmill.test")).toEqual(["northwind"]);
    expect(platformInboundLocalParts({ to: "spoofed@mail.foundmill.test", envelope: { to: ["Northwind+thread@Mail.Foundmill.test"] } }, "mail.foundmill.test")).toEqual(["northwind"]);
    expect(platformInboundLocalParts({ to: "a@mail.foundmill.test.evil.example", envelope: null }, "mail.foundmill.test")).toEqual([]);
  });

  it("binds delivery events by their signed args; a forged business id is ignored; bounces, spam reports and unsubscribes suppress", () => {
    const { batches, ignored } = normalisePlatformMailEvents(
      [
        { email: "anna@example.com", event: "unsubscribe", timestamp: 1_790_000_000, sg_event_id: "e1", ...argsFor("anna@example.com") },
        { email: "bounced@example.com", event: "bounce", type: "bounce", timestamp: 1_790_000_001, sg_event_id: "e2", ...argsFor("bounced@example.com") },
        { email: "slow@example.com", event: "bounce", type: "blocked", timestamp: 1_790_000_002, sg_event_id: "e3", ...argsFor("slow@example.com") },
        { email: "anna@example.com", event: "delivered", timestamp: 1_790_000_003, sg_event_id: "e4", ...argsFor("anna@example.com") },
        // Someone posts an event naming another business with A's signature, or an unsigned business id.
        { email: "victim@example.com", event: "spamreport", timestamp: 1_790_000_004, sg_event_id: "e5", ...argsFor("victim@example.com"), fm_b: OTHER_BUSINESS },
        { email: "victim@example.com", event: "unsubscribe", timestamp: 1_790_000_005, sg_event_id: "e6", fm_b: OTHER_BUSINESS, business_id: OTHER_BUSINESS },
        // Or copies the args of a message to Anna onto an event about someone else.
        { email: "victim@example.com", event: "unsubscribe", timestamp: 1_790_000_006, sg_event_id: "e7", ...argsFor("anna@example.com") },
      ],
      SECRET,
    );
    expect(ignored).toBe(3);
    expect(batches.map((b) => b.businessId)).toEqual([TEST_BUSINESS_ID]);
    expect(batches[0]!.events.map((e) => [e.type, e.businessId])).toEqual([["lead.replied", TEST_BUSINESS_ID]]);
    expect(batches[0]!.suppress.map((s) => s.reason).sort()).toEqual(["bounced", "unsubscribed"]);
    expect(batches[0]!.suppress.map((s) => s.emailHash)).toContain(suppressionHashOfEmail("bounced@example.com"));
  });
});
