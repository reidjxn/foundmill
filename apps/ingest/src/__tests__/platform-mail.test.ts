/**
 * What comes back to a project's Foundmill sending address (package 1.5; SECURITY_REVIEW N2): one platform endpoint each
 * for replies and delivery events, and the unsubscribe link. A reply to project A's address lands only in A; a reply for
 * an unknown local part writes nothing; a delivery event whose business id is forged is ignored; bounces, spam reports
 * and unsubscribes suppress the address for that project only. With the domain unset, none of it exists.
 */
import { createRegistry, MOCK_NOW, platformMailCustomArgs, platformMailFooter, platformUnsubscribeToken, platformUnsubscribeUrl, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PRIVATE_KEY_PEM, MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { signSendgridBody } from "@foundmill/connectors/connectors/sendgrid/mock";
import { repos } from "@foundmill/db";
import { UNSUBSCRIBE_CONFIRM_BODY, UNSUBSCRIBE_DONE_BODY, UNSUBSCRIBE_INVALID_BODY } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noFollowups } from "../followups";
import { buildIngest, type BuiltIngest } from "../index";
import { MemoryNonceStore } from "../nonce-store";
import { PLATFORM_MAIL_EVENTS_MAX_BYTES, PLATFORM_MAIL_INBOUND_MAX_BYTES } from "../platform-mail";
import { silentLogger } from "../types";
import { createIngestHarness, json, type IngestHarness } from "./harness";

const DOMAIN = "mail.foundmill.test";
const SECRET = "ingest-test-platform-mail-signing-secret";
const TOKEN = "ingest-test-platform-inbound-token";
const T = Math.floor(MOCK_NOW.getTime() / 1000);
const platformMail = { domain: DOMAIN, signingSecret: SECRET, inboundToken: TOKEN, eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY };

let hz: IngestHarness;
let localA: string;
let localB: string;
beforeAll(async () => {
  hz = await createIngestHarness("pmail", { platformMail });
  localA = (await repos.projectMail.ensure(hz.db, hz.A.businessId)).localPart;
  localB = (await repos.projectMail.ensure(hz.db, hz.B.businessId)).localPart;
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
/** A reply as SendGrid posts it; by default its DKIM signature passed for the sender's domain (customer.example). */
async function reply(fields: Record<string, string>, token: string | null = TOKEN, base = hz.base) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ from: "Maja Berg <maja@customer.example>", subject: "Re: Thanks for joining", text: "Sounds good, can we book a call?", headers: `Message-ID: <reply-${++n}@customer.example>`, dkim: "{@customer.example : pass}", SPF: "none", ...fields })) if (v !== "") form.set(k, v);
  const res = await fetch(`${base}/mail/inbound${token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST", body: form });
  return { status: res.status, body: await json(res) };
}
async function events(list: Record<string, unknown>[], opts: { privateKeyPem?: string; timestamp?: number; base?: string; signature?: string } = {}) {
  const body = JSON.stringify(list);
  const ts = String(opts.timestamp ?? T);
  const res = await fetch(`${opts.base ?? hz.base}/mail/events`, { method: "POST", headers: { "content-type": "application/json", "x-twilio-email-event-webhook-timestamp": ts, "x-twilio-email-event-webhook-signature": opts.signature ?? signSendgridBody(body, ts, opts.privateKeyPem ?? MOCK_SENDGRID_PRIVATE_KEY_PEM) }, body });
  return { status: res.status, body: await json(res) };
}
/** The args the gateway signs into a message to `email` from business A. */
const argsFor = (email: string, businessId = hz.A.businessId, messageRef = "6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b") => platformMailCustomArgs(SECRET, businessId, messageRef, suppressionHashOfEmail(email));
const replies = async (businessId: string) => (await hz.events(businessId, "lead.replied")).filter((e) => (e.payload as { summary?: string }).summary !== undefined);
const suppressed = (businessId: string, email: string) => repos.channels.isSuppressed(hz.db, businessId, { emailHash: suppressionHashOfEmail(email) });

describe("POST /mail/inbound", () => {
  it("a reply to project A's address lands only in A, as the CRM's reply event without the body", async () => {
    const beforeB = (await replies(hz.B.businessId)).length;
    const r = await reply({ to: `Project A <${localA}@${DOMAIN}>`, envelope: JSON.stringify({ to: [`${localA}@${DOMAIN}`], from: "maja@customer.example" }) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, written: 1, projects: 1 });
    const [event] = await replies(hz.A.businessId);
    expect(event?.businessId).toBe(hz.A.businessId);
    expect(event?.payload).toMatchObject({ channelKey: "email_automation", requestsMeeting: true });
    expect(JSON.stringify(event?.payload)).not.toContain("book a call");
    expect((await replies(hz.B.businessId)).length).toBe(beforeB);
  });

  it("the envelope decides, not the To header the sender wrote", async () => {
    const beforeA = (await replies(hz.A.businessId)).length;
    const beforeB = (await replies(hz.B.businessId)).length;
    const r = await reply({ to: `${localA}@${DOMAIN}`, envelope: JSON.stringify({ to: [`${localB}@${DOMAIN}`] }) });
    expect(r.body).toMatchObject({ written: 1, projects: 1 });
    expect((await replies(hz.A.businessId)).length).toBe(beforeA);
    expect((await replies(hz.B.businessId)).length).toBe(beforeB + 1);
  });

  it("a reply for an unknown local part, or another domain, writes nothing", async () => {
    const beforeA = (await replies(hz.A.businessId)).length;
    const beforeB = (await replies(hz.B.businessId)).length;
    expect((await reply({ to: `nobody-here@${DOMAIN}` })).body).toMatchObject({ ok: true, written: 0, projects: 0 });
    expect((await reply({ to: `${localA}@elsewhere.example` })).body).toMatchObject({ ok: true, written: 0, projects: 0 });
    expect((await reply({ to: `${localA}@${DOMAIN}`, spam_score: "9.2" })).body).toMatchObject({ ok: true, written: 0, spam: true });
    // A sender that is not an ordinary address (markup, quotes, an overlong value) is never read.
    for (const from of ["[[ent:6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b|Boss]]@customer.example", `${"a".repeat(300)}@customer.example`, '"odd name"@customer.example', "no-address"]) {
      expect((await reply({ to: `${localA}@${DOMAIN}`, from })).body, from).toMatchObject({ ok: true, written: 0 });
    }
    expect((await replies(hz.A.businessId)).length).toBe(beforeA);
    expect((await replies(hz.B.businessId)).length).toBe(beforeB);
  });

  it("refuses a delivery without the platform token, or with the businesses' token, in constant time", async () => {
    expect((await reply({ to: `${localA}@${DOMAIN}` }, null)).status).toBe(401);
    expect((await reply({ to: `${localA}@${DOMAIN}` }, "mock-inbound-parse-token")).status).toBe(401);
    expect((await reply({ to: `${localA}@${DOMAIN}` }, `${TOKEN}x`)).status).toBe(401);
  });

  it("a replayed delivery is refused, and a reply asking to stop suppresses its sender for that project only", async () => {
    const fields = { to: `${localA}@${DOMAIN}`, from: "stop@customer.example", text: "Please unsubscribe me.", headers: "Message-ID: <stop-1@customer.example>" };
    expect((await reply(fields)).status).toBe(200);
    expect((await reply(fields)).status).toBe(409);
    expect(await suppressed(hz.A.businessId, "stop@customer.example")).toBe(true);
    expect(await suppressed(hz.B.businessId, "stop@customer.example")).toBe(false);
  });

  // The message every reply quotes: its footer carries the unsubscribe link (and the word "Unsubscribe" in HTML).
  const original = () => {
    const footer = platformMailFooter("Project A", platformUnsubscribeUrl("https://ingest.foundmill.test", platformUnsubscribeToken(SECRET, hz.A.businessId, suppressionHashOfEmail("talk@customer.example"))));
    return { text: `Hi, thanks for joining the list. Reply any time.${footer.text}`, html: `<p>Hi, thanks for joining the list.</p>${footer.html}` };
  };
  const sentimentOf = async (businessId: string, from: string) => ((await replies(businessId)).find((e) => (e.payload as { summary: string }).summary.includes(`from ${from} `))?.payload as { sentiment?: string } | undefined)?.sentiment;

  it("a reply that quotes the original (and its unsubscribe link) is a reply, not a request to stop", async () => {
    const quoted = original().text.split("\n").map((l) => `> ${l}`).join("\n");
    const shapes: Record<string, string>[] = [
      // Gmail and Apple Mail: "On … wrote:" then the original quoted with ">".
      { text: `Yes, let's talk\n\nOn Wed, Nov 11, 2026 at 3:45 PM Project A <${localA}@${DOMAIN}> wrote:\n${quoted}` },
      // Wrapped over two lines.
      { text: `Yes, let's talk\n\nOn Wed, Nov 11, 2026 at 3:45 PM Project A <\n${localA}@${DOMAIN}> wrote:\n\n${original().text}` },
      // Outlook: no ">" at all, the original pasted under a separator or a From/Sent block.
      { text: `Yes, let's talk\n\n-----Original Message-----\nFrom: Project A\nSent: Wednesday, November 11, 2026 3:45 PM\n\n${original().text}` },
      { text: `Yes, let's talk\n\nFrom: Project A <${localA}@${DOMAIN}>\nSent: Wednesday, November 11, 2026 3:45 PM\nSubject: Thanks for joining\n\n${original().text}` },
      // The footer's lines left in without any quoting at all.
      { text: `Yes, let's talk\n${original().text}` },
      // HTML only: the original in a blockquote, or not quoted at all.
      { text: "", html: `<div>Yes, let's talk</div><blockquote>${original().html}</blockquote>` },
      { text: "", html: `<div>Yes, let's talk</div>${original().html}` },
    ];
    for (const [i, shape] of shapes.entries()) {
      const from = `talk-${i}@customer.example`;
      const r = await reply({ to: `${localA}@${DOMAIN}`, from, ...shape, headers: `Message-ID: <talk-${i}@customer.example>` });
      expect(r.body, JSON.stringify(shape)).toMatchObject({ ok: true, written: 1 });
      expect(await sentimentOf(hz.A.businessId, from), JSON.stringify(shape)).toBe("neutral");
      expect(await suppressed(hz.A.businessId, from), JSON.stringify(shape)).toBe(false);
    }
  });

  it("a top line asking to stop still suppresses, whatever is quoted below it", async () => {
    const r = await reply({ to: `${localA}@${DOMAIN}`, from: "leave-now@customer.example", text: `please unsubscribe me\n\nOn Wed, Nov 11, 2026 at 3:45 PM Project A wrote:\n> ${original().text}`, headers: "Message-ID: <leave-now@customer.example>" });
    expect(r.body).toMatchObject({ ok: true, written: 1 });
    expect(await sentimentOf(hz.A.businessId, "leave-now@customer.example")).toBe("unsubscribe");
    expect(await suppressed(hz.A.businessId, "leave-now@customer.example")).toBe(true);
  });
});

describe("POST /mail/inbound: the sender must be verified (SPF or DKIM)", () => {
  const stop = (from: string, extra: Record<string, string>) => reply({ to: `${localA}@${DOMAIN}`, from, text: "Please unsubscribe me.", headers: `Message-ID: <auth-${++n}@customer.example>`, ...extra });

  it("SPF passed for an aligned envelope sender, or DKIM passed for the From domain: read and acted on", async () => {
    expect((await stop("spf-pass@customer.example", { dkim: "", SPF: "pass", envelope: JSON.stringify({ to: [`${localA}@${DOMAIN}`], from: "bounces@mail.customer.example" }) })).body).toMatchObject({ written: 1 });
    expect(await suppressed(hz.A.businessId, "spf-pass@customer.example")).toBe(true);
    expect((await stop("dkim-pass@customer.example", { dkim: "{@customer.example : pass, @sendgrid.net : fail}", SPF: "softfail" })).body).toMatchObject({ written: 1 });
    expect(await suppressed(hz.A.businessId, "dkim-pass@customer.example")).toBe(true);
  });

  it("failed, missing, or passing only for another domain: nothing written, nobody suppressed, no reply counted", async () => {
    const before = (await replies(hz.A.businessId)).length;
    const cases: [string, Record<string, string>][] = [
      ["fail@customer.example", { dkim: "{@customer.example : fail}", SPF: "fail", envelope: JSON.stringify({ to: [`${localA}@${DOMAIN}`], from: "fail@customer.example" }) }],
      ["missing@customer.example", { dkim: "", SPF: "" }],
      // An attacker's own domain passes; the From names the victim's.
      ["victim@customer.example", { dkim: "{@attacker.example : pass}", SPF: "pass", envelope: JSON.stringify({ to: [`${localA}@${DOMAIN}`], from: "x@attacker.example" }) }],
      // SPF passed, but SendGrid sent no envelope sender to tie it to the From.
      ["no-envelope@customer.example", { dkim: "none", SPF: "pass" }],
    ];
    for (const [from, extra] of cases) {
      const r = await stop(from, extra);
      expect(r.status, from).toBe(200);
      expect(r.body, from).toMatchObject({ ok: true, written: 0, projects: 0, unverified: true });
      expect(await suppressed(hz.A.businessId, from), from).toBe(false);
    }
    expect((await replies(hz.A.businessId)).length).toBe(before);
  });
});

describe("body limits", () => {
  it(`/mail/events refuses a body over ${PLATFORM_MAIL_EVENTS_MAX_BYTES} bytes before reading it`, async () => {
    const big = JSON.stringify([{ email: "x@customer.example", event: "bounce", pad: "x".repeat(PLATFORM_MAIL_EVENTS_MAX_BYTES) }]);
    const res = await hz.built.app.fetch(new Request("http://ingest.local/mail/events", { method: "POST", headers: { "content-type": "application/json", "x-twilio-email-event-webhook-timestamp": String(T), "x-twilio-email-event-webhook-signature": signSendgridBody(big, String(T)) }, body: big }));
    expect(res.status).toBe(413);
  });

  it(`/mail/inbound refuses a body over ${PLATFORM_MAIL_INBOUND_MAX_BYTES} bytes, even without a Content-Length`, async () => {
    const at = (body: BodyInit, headers: Record<string, string> = {}) => hz.built.app.fetch(new Request(`http://ingest.local/mail/inbound?token=${TOKEN}`, { method: "POST", body, headers, duplex: "half" } as RequestInit));
    expect((await at("x".repeat(PLATFORM_MAIL_INBOUND_MAX_BYTES + 1), { "content-type": "application/x-www-form-urlencoded" })).status).toBe(413);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > PLATFORM_MAIL_INBOUND_MAX_BYTES) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    expect((await at(stream, { "content-type": "application/x-www-form-urlencoded", "transfer-encoding": "chunked" })).status).toBe(413);
  });
});

describe("POST /mail/events", () => {
  const ref = "6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("binds each event by its signed custom args; a forged business id, or args moved onto another address, is ignored", async () => {
    const r = await events([
      { email: "bounced@customer.example", event: "bounce", type: "bounce", timestamp: T, sg_event_id: "ev-1", ...argsFor("bounced@customer.example") },
      { email: "spam@customer.example", event: "spamreport", timestamp: T, sg_event_id: "ev-2", ...argsFor("spam@customer.example") },
      { email: "anna@customer.example", event: "delivered", timestamp: T, sg_event_id: "ev-3", ...argsFor("anna@customer.example") },
      // A's valid signature with B's id swapped in, and an unsigned business id: both ignored.
      { email: "victim@customer.example", event: "unsubscribe", timestamp: T, sg_event_id: "ev-4", ...argsFor("victim@customer.example"), fm_b: hz.B.businessId },
      { email: "victim2@customer.example", event: "spamreport", timestamp: T, sg_event_id: "ev-5", fm_b: hz.B.businessId, business_id: hz.B.businessId },
      // The args of A's message to Anna, copied onto an event about someone else: ignored.
      { email: "victim3@customer.example", event: "unsubscribe", timestamp: T, sg_event_id: "ev-6", ...argsFor("anna@customer.example") },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, ignored: 3, suppressed: 2, written: 1 });
    expect(await suppressed(hz.A.businessId, "victim3@customer.example")).toBe(false);
    expect(await suppressed(hz.A.businessId, "bounced@customer.example")).toBe(true);
    expect(await suppressed(hz.A.businessId, "spam@customer.example")).toBe(true);
    expect(await suppressed(hz.B.businessId, "victim@customer.example")).toBe(false);
    expect(await suppressed(hz.B.businessId, "victim2@customer.example")).toBe(false);
    expect(await suppressed(hz.A.businessId, "victim@customer.example")).toBe(false);
  });

  it("refuses a delivery not signed by the platform's SendGrid account, a stale one and a replay", async () => {
    const other = (await import("node:crypto")).generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const list = [{ email: "x@customer.example", event: "bounce", timestamp: T, ...argsFor("x@customer.example", hz.A.businessId, ref) }];
    expect((await events(list, { privateKeyPem: other })).status).toBe(401);
    expect((await events(list, { timestamp: T - 3_600 })).status).toBe(401);
    // The same delivery (bytes and signature) twice: the second is a replay.
    const signature = signSendgridBody(JSON.stringify(list), String(T));
    expect((await events(list, { signature })).status).toBe(200);
    expect((await events(list, { signature })).status).toBe(409);
  });
});

describe("/mail/unsubscribe", () => {
  it("opening the link asks; the one-click POST suppresses the address for that project only", async () => {
    const token = platformUnsubscribeToken(SECRET, hz.A.businessId, suppressionHashOfEmail("leave@customer.example"));
    const url = `${hz.base}/mail/unsubscribe?t=${encodeURIComponent(token)}`;
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(UNSUBSCRIBE_CONFIRM_BODY);
    expect(await suppressed(hz.A.businessId, "leave@customer.example")).toBe(false);
    const done = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain(UNSUBSCRIBE_DONE_BODY);
    expect(await suppressed(hz.A.businessId, "leave@customer.example")).toBe(true);
    expect(await suppressed(hz.B.businessId, "leave@customer.example")).toBe(false);
  });

  it("a token for another business, or signed with another secret, does nothing", async () => {
    const hash = suppressionHashOfEmail("keep@customer.example");
    const forged = platformUnsubscribeToken(SECRET, hz.A.businessId, hash).replace(hz.A.businessId, hz.B.businessId);
    const wrong = platformUnsubscribeToken("another-secret-0123456789abcdef", hz.A.businessId, hash);
    for (const t of [forged, wrong, "garbage"]) {
      const res = await fetch(`${hz.base}/mail/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(UNSUBSCRIBE_INVALID_BODY);
    }
    expect(await suppressed(hz.A.businessId, "keep@customer.example")).toBe(false);
    expect(await suppressed(hz.B.businessId, "keep@customer.example")).toBe(false);
  });
});

describe("at boot", () => {
  const boot = (env: Record<string, string>): BuiltIngest =>
    buildIngest({ env: { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "", MODEL_MODE: "mock", ...env } as unknown as BuiltIngest["env"], db: hz.db, registry: createRegistry([]), vault: null, nonces: new MemoryNonceStore(), log: silentLogger, followups: noFollowups, simulateEnabled: false, simulateTokenSecret: null });

  it("refuses to start with the domain set and no real signing secret, outside development and test", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(() => boot({ APP_ENV, PLATFORM_MAIL_DOMAIN: DOMAIN }), APP_ENV).toThrow(/PLATFORM_MAIL_SIGNING_SECRET/);
      expect(() => boot({ APP_ENV, PLATFORM_MAIL_DOMAIN: DOMAIN, PLATFORM_MAIL_SIGNING_SECRET: "too-short-secret" }), APP_ENV).toThrow(/at least 32/);
      expect(boot({ APP_ENV, PLATFORM_MAIL_DOMAIN: DOMAIN, PLATFORM_MAIL_SIGNING_SECRET: SECRET.padEnd(32, "x") }).deps.platformMail?.signingSecret).toBe(SECRET.padEnd(32, "x"));
      expect(boot({ APP_ENV }).deps.platformMail?.domain).toBeNull();
    }
  });

  it("starts on development and test without one (the development secret stands in there only)", () => {
    for (const APP_ENV of ["development", "test"]) expect(boot({ APP_ENV, PLATFORM_MAIL_DOMAIN: DOMAIN }).deps.platformMail).toMatchObject({ domain: DOMAIN, signingSecret: null });
  });
});

describe("with the domain unset", () => {
  it("none of the three endpoints exists", async () => {
    const off = hz.build({ platformMail: { domain: null, signingSecret: SECRET, inboundToken: TOKEN, eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY } });
    const at = (path: string, init?: RequestInit) => off.app.fetch(new Request(`http://ingest.local${path}`, init));
    expect((await at(`/mail/inbound?token=${TOKEN}`, { method: "POST", body: new FormData() })).status).toBe(404);
    expect((await at("/mail/events", { method: "POST", body: "[]" })).status).toBe(404);
    expect((await at("/mail/unsubscribe?t=x")).status).toBe(404);
  });
});
