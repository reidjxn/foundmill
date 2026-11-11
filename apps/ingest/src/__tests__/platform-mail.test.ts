/**
 * What comes back to a project's Foundmill sending address (package 1.5; SECURITY_REVIEW N2): one platform endpoint each
 * for replies and delivery events, and the unsubscribe link. A reply to project A's address lands only in A; a reply for
 * an unknown local part writes nothing; a delivery event whose business id is forged is ignored; bounces, spam reports
 * and unsubscribes suppress the address for that project only. With the domain unset, none of it exists.
 */
import { MOCK_NOW, platformMailCustomArgs, platformUnsubscribeToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PRIVATE_KEY_PEM, MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { signSendgridBody } from "@foundmill/connectors/connectors/sendgrid/mock";
import { repos } from "@foundmill/db";
import { UNSUBSCRIBE_CONFIRM_BODY, UNSUBSCRIBE_DONE_BODY, UNSUBSCRIBE_INVALID_BODY } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
async function reply(fields: Record<string, string>, token: string | null = TOKEN, base = hz.base) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ from: "Maja Berg <maja@customer.example>", subject: "Re: Thanks for joining", text: "Sounds good, can we book a call?", headers: `Message-ID: <reply-${++n}@customer.example>`, ...fields })) form.set(k, v);
  const res = await fetch(`${base}/mail/inbound${token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST", body: form });
  return { status: res.status, body: await json(res) };
}
async function events(list: Record<string, unknown>[], opts: { privateKeyPem?: string; timestamp?: number; base?: string; signature?: string } = {}) {
  const body = JSON.stringify(list);
  const ts = String(opts.timestamp ?? T);
  const res = await fetch(`${opts.base ?? hz.base}/mail/events`, { method: "POST", headers: { "content-type": "application/json", "x-twilio-email-event-webhook-timestamp": ts, "x-twilio-email-event-webhook-signature": opts.signature ?? signSendgridBody(body, ts, opts.privateKeyPem ?? MOCK_SENDGRID_PRIVATE_KEY_PEM) }, body });
  return { status: res.status, body: await json(res) };
}
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
});

describe("POST /mail/events", () => {
  const ref = "6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("binds each event by its signed custom args; a forged business id is ignored", async () => {
    const argsA = platformMailCustomArgs(SECRET, hz.A.businessId, ref);
    const r = await events([
      { email: "bounced@customer.example", event: "bounce", type: "bounce", timestamp: T, sg_event_id: "ev-1", ...argsA },
      { email: "spam@customer.example", event: "spamreport", timestamp: T, sg_event_id: "ev-2", ...argsA },
      { email: "anna@customer.example", event: "delivered", timestamp: T, sg_event_id: "ev-3", ...argsA },
      // A's valid signature with B's id swapped in, and an unsigned business id: both ignored.
      { email: "victim@customer.example", event: "unsubscribe", timestamp: T, sg_event_id: "ev-4", ...argsA, fm_b: hz.B.businessId },
      { email: "victim2@customer.example", event: "spamreport", timestamp: T, sg_event_id: "ev-5", fm_b: hz.B.businessId, business_id: hz.B.businessId },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, ignored: 2, suppressed: 2, written: 1 });
    expect(await suppressed(hz.A.businessId, "bounced@customer.example")).toBe(true);
    expect(await suppressed(hz.A.businessId, "spam@customer.example")).toBe(true);
    expect(await suppressed(hz.B.businessId, "victim@customer.example")).toBe(false);
    expect(await suppressed(hz.B.businessId, "victim2@customer.example")).toBe(false);
    expect(await suppressed(hz.A.businessId, "victim@customer.example")).toBe(false);
  });

  it("refuses a delivery not signed by the platform's SendGrid account, a stale one and a replay", async () => {
    const other = (await import("node:crypto")).generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const list = [{ email: "x@customer.example", event: "bounce", timestamp: T, ...platformMailCustomArgs(SECRET, hz.A.businessId, ref) }];
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

describe("with the domain unset", () => {
  it("none of the three endpoints exists", async () => {
    const off = hz.build({ platformMail: { domain: null, signingSecret: SECRET, inboundToken: TOKEN, eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY } });
    const at = (path: string, init?: RequestInit) => off.app.fetch(new Request(`http://ingest.local${path}`, init));
    expect((await at(`/mail/inbound?token=${TOKEN}`, { method: "POST", body: new FormData() })).status).toBe(404);
    expect((await at("/mail/events", { method: "POST", body: "[]" })).status).toBe(404);
    expect((await at("/mail/unsubscribe?t=x")).status).toBe(404);
  });
});
