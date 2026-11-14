/**
 * Following a project from its public page, the gateway's part (package 1.6, double opt-in; SECURITY_REVIEW Nov 11):
 *   - `POST /v1/platform-mail/confirm-follow`: the api only; one email with fixed words from the project's Foundmill
 *     address, with a signed link that names the business, the record and the address hash; only for the pending record
 *     the api reserved; never to a suppressed address; counted on the confirmations' own day for the project and their
 *     own ceiling for the deployment, never the project's mail day or the outbound ceiling (security audit 2026-11-13,
 *     finding 10); nothing when platform mail is off; no `mail.sent`.
 *   - an agent's send to a contact whose only basis is an unconfirmed signup is refused like an address first seen in
 *     untrusted content.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformMailMock, followConfirmNonceHash, readFollowConfirmToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos, suppressionHash } from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { builtOnWords, FOLLOW_CONFIRM_EMAIL } from "@foundmill/shared";
import {
  DEV_PLATFORM_MAIL_SECRET,
  FOLLOW_CONFIRM_CEILING_KEY,
  FOLLOW_CONFIRM_DAILY_CAP,
  FOLLOW_CONFIRM_DAILY_CEILING,
  followConfirmDayKey,
  platformMailDayKey,
  PLATFORM_MAIL_CEILING_KEY,
  preparePlatformMail,
  type PlatformMailConfig,
} from "../platform-mail";
import { loadEnv } from "@foundmill/shared";
import { CONFIRM_FOLLOW_ROUTE } from "../follow-confirm";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";
import type { DenyResponse } from "../types";

const DOMAIN = "mail.foundmill.test";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", ...over });

describe("follow confirmation (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformMailMock();
  let n = 0;

  beforeAll(async () => {
    g = await setupGateway({ businessMode: "automated", connectors: [mock] });
    g.deps.appEnv = "test";
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
  });

  /** What the api writes before it asks: a pending record for a new follower, with the nonce reserved on it. */
  async function pendingFollower(email = `f${++n}@example.com`) {
    const page = await repos.pages.get(g.db, g.businessId).then((p) => p ?? repos.pages.saveDraft(g.db, g.businessId, { draft: { pitch: "Candles", about: "Poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true }, slug: "gateway-test-page", userId: null }));
    const recorded = await g.db.transaction((tx) => repos.followers.record(tx, g.businessId, { pageId: page.id, slug: page.slug, email, consentText: "I agree." }));
    if (recorded.status === "nothing") throw new Error("expected a record");
    const nonce = createHash("sha256").update(`nonce-${n}-${Math.random()}`).digest("base64url");
    expect(await repos.followers.reserveConfirmation(g.db, g.businessId, recorded.consentId, { tokenHash: followConfirmNonceHash(nonce) })).toBe(true);
    return { email, consentId: recorded.consentId, entityId: recorded.entityId, nonce };
  }

  async function ask(body: Record<string, unknown>, svc: string | null = "api") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
    const res = await fetch(`${g.server.url}${CONFIRM_FOLLOW_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; simulated?: boolean; reason?: string; error?: { code: string } } };
  }

  it("sends one email with fixed words from the project's address, with a link signed for this record and address", async () => {
    const f = await pendingFollower("Maya@Example.com");
    const before = mock.sentFor(g.businessId).length;
    const r = await ask({ businessId: g.businessId, consentId: f.consentId, email: "maya@example.com", nonce: f.nonce });
    expect(r).toEqual({ status: 200, body: { sent: true, simulated: true } });
    const sent = mock.sentFor(g.businessId).slice(before);
    expect(sent).toHaveLength(1);
    const row = await repos.projectMail.get(g.db, g.businessId);
    const body = sent[0]!.body as { from: { email: string; name: string }; subject: string; text: string; headers: Record<string, string> };
    expect(sent[0]!.to).toBe("maya@example.com");
    expect(body.from).toEqual({ email: `${row!.localPart}@${DOMAIN}`, name: `Gateway Test Club via ${APP_NAME}` });
    expect(body.subject).toBe(FOLLOW_CONFIRM_EMAIL.subject("Gateway Test Club"));
    const link = body.text.match(/http:\/\/localhost:4005\/mail\/confirm\?t=(\S+)/);
    expect(link).not.toBeNull();
    expect(body.text.startsWith(FOLLOW_CONFIRM_EMAIL.text("Gateway Test Club", APP_NAME, link![0]))).toBe(true);
    // A project on the free plan: the mark as one sentence after the body, words only (the confirm link stays the only link of the body).
    expect(body.text).toContain(`\n\nGateway Test Club is built on ${APP_NAME}.`);
    expect(FOLLOW_CONFIRM_EMAIL.text("Gateway Test Club", APP_NAME, link![0], builtOnWords(APP_NAME).foot("Gateway Test Club")).match(/https?:\/\//g)).toHaveLength(1);
    // The unsubscribe footer and header are there like on every message from the address.
    expect(body.headers["List-Unsubscribe"]).toMatch(/\/mail\/unsubscribe\?t=/);
    const claims = readFollowConfirmToken(DEV_PLATFORM_MAIL_SECRET, decodeURIComponent(link![1]!), Date.now());
    expect(claims).toMatchObject({ businessId: g.businessId, consentId: f.consentId, emailHash: suppressionHashOfEmail("maya@example.com"), nonce: f.nonce });
    // Seven days.
    expect(claims!.expiresAt * 1000 - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(claims!.expiresAt * 1000 - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    // Counted on the confirmations' own day, not the project's mail day; no mail.sent (not the project's outreach);
    // audited without the address.
    expect(g.rateLimits.peek(followConfirmDayKey(g.businessId), Date.now())).toBeGreaterThanOrEqual(1);
    expect(g.rateLimits.peek(platformMailDayKey(g.businessId), Date.now())).toBe(0);
    expect((await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items).toHaveLength(0);
    const audit = (await repos.audit.list(g.db, g.businessId, { action: "gateway.platform_mail.follow_confirmation" })).items;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain("maya@");
  });

  it("a project on a paid plan sends the confirmation without the 'Built on' sentence", async () => {
    await repos.businesses.update(g.db, g.businessId, { planTier: "pro" });
    try {
      const f = await pendingFollower("paid-plan@example.com");
      const before = mock.sentFor(g.businessId).length;
      expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: "paid-plan@example.com", nonce: f.nonce })).status).toBe(200);
      const text = (mock.sentFor(g.businessId).slice(before)[0]!.body as { text: string }).text;
      expect(text).not.toContain("is built on");
    } finally {
      await repos.businesses.update(g.db, g.businessId, { planTier: "free" });
    }
  });

  it("only for the pending record the api reserved, for exactly its address", async () => {
    const f = await pendingFollower();
    const before = mock.sentFor(g.businessId).length;
    for (const body of [
      { businessId: g.businessId, consentId: f.consentId, email: "someone.else@example.com", nonce: f.nonce },
      { businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: "x".repeat(43) },
      { businessId: "00000000-0000-4000-8000-000000000001", consentId: f.consentId, email: f.email, nonce: f.nonce },
    ]) {
      expect((await ask(body)).body).toEqual({ sent: false, reason: "not_pending" });
    }
    // Confirmed already: nothing more.
    await g.h.pg.query("update contact_consents set confirmed_at = now() where id = $1", [f.consentId]);
    expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce })).body).toEqual({ sent: false, reason: "not_pending" });
    expect(mock.sentFor(g.businessId).length).toBe(before);
  });

  it("never to a suppressed address, and never while platform mail is off", async () => {
    const gone = await pendingFollower();
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: suppressionHash("email", gone.email), reason: "unsubscribed" });
    const before = mock.sentFor(g.businessId).length;
    expect((await ask({ businessId: g.businessId, consentId: gone.consentId, email: gone.email, nonce: gone.nonce })).body).toEqual({ sent: false, reason: "suppressed" });
    const off = await pendingFollower();
    g.deps.platformMail = config({ domain: null });
    expect((await ask({ businessId: g.businessId, consentId: off.consentId, email: off.email, nonce: off.nonce })).body).toEqual({ sent: false, reason: "off" });
    expect(mock.sentFor(g.businessId).length).toBe(before);
  });

  it("confirmations never take the project's mail day or the outbound ceiling: an outreach send still goes out after a flood", async () => {
    // The project's day has room for exactly one more message, and so has the deployment's outbound ceiling.
    const now = Date.now();
    const used = g.rateLimits.peek(platformMailDayKey(g.businessId), now);
    const usedAll = g.rateLimits.peek(PLATFORM_MAIL_CEILING_KEY, now);
    g.deps.platformMail = config({ dailyCap: used + 1, ceiling: usedAll + 1 });
    for (let i = 0; i < 3; i++) {
      const f = await pendingFollower();
      expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce })).body).toEqual({ sent: true, simulated: true });
    }
    // Neither count moved: the confirmations were counted on their own keys.
    expect(g.rateLimits.peek(platformMailDayKey(g.businessId), Date.now())).toBe(used);
    expect(g.rateLimits.peek(PLATFORM_MAIL_CEILING_KEY, Date.now())).toBe(usedAll);
    expect(g.rateLimits.peek(followConfirmDayKey(g.businessId), Date.now())).toBeGreaterThanOrEqual(3);
    expect(g.rateLimits.peek(FOLLOW_CONFIRM_CEILING_KEY, Date.now())).toBeGreaterThanOrEqual(3);
    // The founders' own send from the project's address still has its day.
    const business = (await repos.businesses.get(g.db, g.businessId))!;
    const decision = await preparePlatformMail(
      { db: g.db, rateLimits: g.rateLimits, config: g.deps.platformMail, appEnv: "test" },
      { business, args: { to: { email: "customer@example.com" }, subject: "Hello", text: "A real note." }, mode: "mock", now: Date.now() },
    );
    expect(decision).toMatchObject({ ok: true });
    if (decision.ok) await decision.prepared.release();
  });

  it("their own ceilings stop a flood: past the project's confirmations for the day, or the deployment's, nothing goes out", async () => {
    const defaults = loadEnv({ APP_ENV: "test" });
    expect(FOLLOW_CONFIRM_DAILY_CAP).toBeGreaterThan(defaults.PLATFORM_MAIL_DAILY_CAP);
    expect(FOLLOW_CONFIRM_DAILY_CEILING).toBeLessThan(defaults.PLATFORM_MAIL_DAILY_CEILING);
    const before = mock.sentFor(g.businessId).length;
    const used = g.rateLimits.peek(followConfirmDayKey(g.businessId), Date.now());
    g.deps.platformMail = config({ followCap: used + 2 });
    const flood = [];
    for (let i = 0; i < 5; i++) {
      const f = await pendingFollower();
      flood.push((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce })).body);
    }
    expect(flood).toEqual([{ sent: true, simulated: true }, { sent: true, simulated: true }, { sent: false, reason: "daily_cap" }, { sent: false, reason: "daily_cap" }, { sent: false, reason: "daily_cap" }]);
    expect(mock.sentFor(g.businessId).length).toBe(before + 2);
    // A refused one is given back.
    expect(g.rateLimits.peek(followConfirmDayKey(g.businessId), Date.now())).toBe(used + 2);
    // The deployment's own ceiling for confirmations.
    g.deps.platformMail = config({ followCeiling: 0 });
    const late = await pendingFollower();
    expect((await ask({ businessId: g.businessId, consentId: late.consentId, email: late.email, nonce: late.nonce })).body).toEqual({ sent: false, reason: "ceiling" });
    expect(mock.sentFor(g.businessId).length).toBe(before + 2);
  });

  it("a simulated email is never sent for a person's project on staging or production", async () => {
    const f = await pendingFollower();
    g.deps.appEnv = "staging";
    try {
      g.deps.platformMail = config({ signingSecret: "s".repeat(40), unsubscribeBase: "https://ingest.example" });
      expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce })).body).toEqual({ sent: false, reason: "simulated" });
    } finally {
      g.deps.appEnv = "test";
    }
  });

  it("only the api may ask, and a malformed body says nothing about the address", async () => {
    const f = await pendingFollower();
    expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce }, "orchestrator")).status).toBe(403);
    expect((await ask({ businessId: g.businessId, consentId: f.consentId, email: f.email, nonce: f.nonce }, null)).status).toBe(401);
    const bad = await ask({ businessId: g.businessId, consentId: f.consentId, email: "not an address", nonce: f.nonce });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain("not an address");
  });

  it("an agent's send to a follower who never confirmed is refused like an address first seen in untrusted content", async () => {
    const f = await pendingFollower("unconfirmed@example.com");
    const token = await g.token({ allowedTools: ["platform_mail:*"] });
    const message = (to: string) => ({ connector: "platform_mail", tool: "send_mail", args: { to: { email: to }, subject: "News", text: "Hello from the project." } });
    const r = (await g.client.call(token, message("Unconfirmed@Example.com"))) as DenyResponse;
    expect(r.outcome).toBe("deny");
    expect(r.policyIds).toContain("untrusted-recipient");
    // Once the person confirmed, the same send goes through (automated mode).
    await g.db.transaction((tx) => repos.followers.confirm(tx, { businessId: g.businessId, consentId: f.consentId, emailHash: suppressionHashOfEmail(f.email), tokenHash: followConfirmNonceHash(f.nonce) }));
    expect((await g.client.call(token, message("unconfirmed@example.com"))).outcome).toBe("allow");
    // A contact that had a basis of its own before signing up is not held back by a pending signup.
    await repos.entities.create(g.db, g.businessId, { kind: "person", displayName: "Kim Customer", identifiers: { email: "kim@example.com" }, source: "manual", lawfulBasis: "contract" });
    await pendingFollower("kim@example.com");
    expect((await g.client.call(token, message("kim@example.com"))).outcome).toBe("allow");
  });
});
