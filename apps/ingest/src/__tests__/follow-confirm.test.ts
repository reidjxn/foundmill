/**
 * Following a project from its public page, ingest's part (package 1.6, double opt-in; SECURITY_REVIEW Nov 11):
 *   - `/mail/confirm?t=`: opening the link asks (a button), the POST confirms: the record is confirmed, the contact's
 *     lawful basis becomes `consent` when it had none, and `page.followed` is written through the outbox, once. A link
 *     that is expired, edited, for another business, superseded by a newer email, or for an address that unsubscribed
 *     since, changes nothing.
 *   - whatever suppresses an address for a project in the platform-mail flows (the unsubscribe link, a reply asking to
 *     stop, a bounce or a spam report) withdraws that project's consent for it, and the person no longer counts.
 */
import { createHash } from "node:crypto";
import { followConfirmNonceHash, followConfirmToken, MOCK_NOW, platformMailCustomArgs, platformUnsubscribeToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PRIVATE_KEY_PEM, MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { signSendgridBody } from "@foundmill/connectors/connectors/sendgrid/mock";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { builtOnWords, FOLLOW_CONFIRM_PAGE } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIngestHarness, type IngestHarness } from "./harness";

const DOMAIN = "mail.foundmill.test";
const SECRET = "ingest-test-platform-mail-signing-secret";
const T = Math.floor(MOCK_NOW.getTime() / 1000);
const platformMail = { domain: DOMAIN, signingSecret: SECRET, inboundToken: "ingest-test-platform-inbound-token", eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY };

let hz: IngestHarness;
let pageA: { id: string; slug: string };
beforeAll(async () => {
  hz = await createIngestHarness("pfollow", { platformMail });
  pageA = await repos.pages.saveDraft(hz.db, hz.A.businessId, { draft: { pitch: "Candles", about: "Poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true }, slug: "ingest-follow-a", userId: null });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
/** A pending signup as the api writes it, with the nonce reserved, and the link the gateway would send. */
async function signup(email = `f${++n}@example.com`, businessId = hz.A.businessId) {
  const recorded = await hz.db.transaction((tx) => repos.followers.record(tx, businessId, { pageId: pageA.id, slug: pageA.slug, email, consentText: "I agree.", at: new Date(MOCK_NOW.getTime() - 60_000) }));
  if (recorded.status === "nothing") throw new Error("expected a record");
  const nonce = createHash("sha256").update(`n-${n}-${Math.random()}`).digest("base64url");
  await repos.followers.reserveConfirmation(hz.db, businessId, recorded.consentId, { tokenHash: followConfirmNonceHash(nonce), at: new Date(MOCK_NOW.getTime() - 60_000) });
  const token = (over: { expiresAt?: number; businessId?: string; email?: string; nonce?: string } = {}) =>
    followConfirmToken(SECRET, { businessId: over.businessId ?? businessId, consentId: recorded.consentId, emailHash: suppressionHashOfEmail(over.email ?? email), expiresAt: over.expiresAt ?? T + 7 * 86_400, nonce: over.nonce ?? nonce });
  return { email, consentId: recorded.consentId, entityId: recorded.entityId, nonce, token };
}

const confirmUrl = (token: string) => `${hz.base}/mail/confirm?t=${encodeURIComponent(token)}`;
const followed = async (businessId = hz.A.businessId) => (await repos.events.list(hz.db, businessId, { type: "page.followed", limit: 500 })).items;
const consent = async (consentId: string) => (await hz.h.pg.query<{ confirmed_at: Date | null; withdrawn_at: Date | null }>("select confirmed_at, withdrawn_at from contact_consents where id = $1", [consentId])).rows[0]!;

describe("/mail/confirm", () => {
  it("opening the link asks; the button confirms, gives the lawful basis and writes page.followed once", async () => {
    const f = await signup("maya@example.com");
    const before = (await followed()).length;
    const page = await fetch(confirmUrl(f.token()));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<form method="post" action="/mail/confirm?t=`);
    expect(html).toContain(">Confirm</button>");
    expect(page.headers.get("cache-control")).toBe("no-store");
    // Opening it changed nothing (link scanners open links).
    expect((await consent(f.consentId)).confirmed_at).toBeNull();
    expect((await followed()).length).toBe(before);

    const done = await fetch(confirmUrl(f.token()), { method: "POST" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("You're following");
    expect((await consent(f.consentId)).confirmed_at).not.toBeNull();
    expect((await repos.entities.get(hz.db, hz.A.businessId, f.entityId)).lawfulBasis).toBe("consent");
    const events = (await followed()).slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "page.followed", actor: { kind: "system", id: "public-page" }, payload: { pageId: pageA.id, entityId: f.entityId, consentId: f.consentId }, entityIds: [f.entityId] });
    expect(JSON.stringify(events[0])).not.toContain("maya@");
    expect((await repos.events.outboxPending(hz.db, hz.A.businessId)).some((o) => o.event.id === events[0]!.id)).toBe(true);
    expect(await repos.followers.count(hz.db, hz.A.businessId)).toBeGreaterThanOrEqual(1);

    // The same link again: the same page, nothing more.
    const again = await fetch(confirmUrl(f.token()), { method: "POST" });
    expect(again.status).toBe(200);
    expect((await followed()).length).toBe(before + 1);
  });

  it("says the visitor's words: who they now follow, and how to stop", async () => {
    const f = await signup();
    const html = await (await fetch(confirmUrl(f.token()), { method: "POST" })).text();
    const name = (await repos.businesses.get(hz.db, hz.A.businessId)).name;
    const escaped = FOLLOW_CONFIRM_PAGE.done(name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    expect(html).toContain(escaped);
    expect(FOLLOW_CONFIRM_PAGE.done(name)).toBe(`You're following ${name}. You can unsubscribe from any email it sends.`);
    // A project on the free plan: the mark as one small line under the answer, words only (docs/NETWORK.md F2).
    const foot = builtOnWords(APP_NAME).foot(name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    expect(html).toContain(`<p class="foot">${foot}</p>`);
    expect(html).not.toContain("<a ");
  });

  it("the 'Built on' line is only on the confirmed page, and never for a project on a paid plan", async () => {
    const asked = await (await fetch(confirmUrl((await signup()).token()))).text();
    expect(asked).not.toContain('class="foot"');
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "pro" });
    try {
      const html = await (await fetch(confirmUrl((await signup()).token()), { method: "POST" })).text();
      expect(html).toContain("You're following");
      expect(html).not.toContain('class="foot"');
      expect(html).not.toContain("is built on");
    } finally {
      await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free" });
    }
  });

  it("an expired, edited, superseded or foreign link changes nothing", async () => {
    const f = await signup();
    const before = (await followed()).length;
    const bad = [
      f.token({ expiresAt: T - 1 }),
      f.token({ businessId: hz.B.businessId }),
      f.token({ email: "someone.else@example.com" }),
      f.token({ nonce: "z".repeat(43) }),
      followConfirmToken("another-secret-of-at-least-32-characters!", { businessId: hz.A.businessId, consentId: f.consentId, emailHash: suppressionHashOfEmail(f.email), expiresAt: T + 3600, nonce: f.nonce }),
      platformUnsubscribeToken(SECRET, hz.A.businessId, suppressionHashOfEmail(f.email)),
      "garbage",
    ];
    for (const t of bad) {
      const res = await fetch(confirmUrl(t), { method: "POST" });
      expect(res.status, t.slice(0, 40)).toBe(400);
      expect(await res.text()).toContain(FOLLOW_CONFIRM_PAGE.invalid);
    }
    expect((await consent(f.consentId)).confirmed_at).toBeNull();
    expect((await followed()).length).toBe(before);
  });

  it("an address that unsubscribed since (from the confirmation's own footer) cannot be confirmed", async () => {
    const f = await signup();
    const unsubscribe = platformUnsubscribeToken(SECRET, hz.A.businessId, suppressionHashOfEmail(f.email));
    expect((await fetch(`${hz.base}/mail/unsubscribe?t=${encodeURIComponent(unsubscribe)}`, { method: "POST" })).status).toBe(200);
    expect((await consent(f.consentId)).withdrawn_at).not.toBeNull();
    expect((await fetch(confirmUrl(f.token()), { method: "POST" })).status).toBe(400);
    expect((await consent(f.consentId)).confirmed_at).toBeNull();
  });
});

describe("unsubscribing withdraws consent", () => {
  async function confirmed(email: string) {
    const f = await signup(email);
    expect((await fetch(confirmUrl(f.token()), { method: "POST" })).status).toBe(200);
    return f;
  }

  it("the unsubscribe link ends the follower's consent for that project, and they no longer count", async () => {
    const f = await confirmed("leaving@example.com");
    const count = await repos.followers.count(hz.db, hz.A.businessId);
    const res = await fetch(`${hz.base}/mail/unsubscribe?t=${encodeURIComponent(platformUnsubscribeToken(SECRET, hz.A.businessId, suppressionHashOfEmail("Leaving@Example.com")))}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await consent(f.consentId)).withdrawn_at).not.toBeNull();
    expect(await repos.followers.count(hz.db, hz.A.businessId)).toBe(count - 1);
    expect((await repos.followers.consentStates(hz.db, hz.A.businessId, [f.entityId])).size).toBe(0);
  });

  it("a bounce or a spam report does the same, for that project only", async () => {
    const bounced = await confirmed("bounced.follower@example.com");
    const spam = await confirmed("spam.follower@example.com");
    const ref = "6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const args = (email: string) => platformMailCustomArgs(SECRET, hz.A.businessId, ref, suppressionHashOfEmail(email));
    const body = JSON.stringify([
      { email: bounced.email, event: "bounce", type: "bounce", timestamp: T, sg_event_id: "fb-1", ...args(bounced.email) },
      { email: spam.email, event: "spamreport", timestamp: T, sg_event_id: "fb-2", ...args(spam.email) },
    ]);
    const res = await fetch(`${hz.base}/mail/events`, { method: "POST", headers: { "content-type": "application/json", "x-twilio-email-event-webhook-timestamp": String(T), "x-twilio-email-event-webhook-signature": signSendgridBody(body, String(T), MOCK_SENDGRID_PRIVATE_KEY_PEM) }, body });
    expect(res.status).toBe(200);
    expect((await consent(bounced.consentId)).withdrawn_at).not.toBeNull();
    expect((await consent(spam.consentId)).withdrawn_at).not.toBeNull();
  });

  it("a reply asking to stop does the same", async () => {
    const f = await confirmed("stop.follower@customer.example");
    const local = (await repos.projectMail.ensure(hz.db, hz.A.businessId)).localPart;
    const form = new FormData();
    for (const [k, v] of Object.entries({ from: `Stop <${f.email}>`, to: `${local}@${DOMAIN}`, subject: "Re: News", text: "Please unsubscribe me.", headers: "Message-ID: <stop-follower@customer.example>", dkim: "{@customer.example : pass}", SPF: "none" })) form.set(k, v);
    const res = await fetch(`${hz.base}/mail/inbound?token=${encodeURIComponent(platformMail.inboundToken)}`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect((await consent(f.consentId)).withdrawn_at).not.toBeNull();
  });
});
