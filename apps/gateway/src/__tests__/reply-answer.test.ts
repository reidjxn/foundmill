/**
 * `POST /v1/platform-mail/answer-reply` (WP-08 T2): the api only; the address is read here from the kept reply's record
 * and never returned; a reply only while the person wrote in the last 30 days (transactional, so no postal address);
 * a simulated answer is never recorded as sent, and a person's project on production in mock mode is refused; live, it
 * writes `mail.sent` (actor: the member) and the answer on the record.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformMailConnector, createPlatformMailMock, emailEntityId, routedFetch, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { REPLY_ANSWER_WINDOW_DAYS } from "@foundmill/shared";
import { DAY_MS, RedisRateLimitStore, type RedisCounter } from "../rate-limit";
import { writeGatewayEvent } from "../events";
import { type PlatformMailConfig } from "../platform-mail";
import { ANSWER_REPLY_ROUTE } from "../reply-answer";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", ...over });
const USER = "6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

/** What ingest leaves behind for a verified reply: `lead.replied` on the address's derived id, and the kept row. */
async function keptReply(g: GatewayFixture, email: string, at = new Date()) {
  const interactionId = randomUUID();
  await g.db.transaction((tx) =>
    writeGatewayEvent(tx, { businessId: g.businessId, type: "lead.replied", actor: { kind: "webhook", id: "platform_mail" }, entityIds: [emailEntityId(email)], occurredAt: at, payload: { entityId: emailEntityId(email), channelKey: "email_automation", campaignId: null, interactionId, sentiment: "neutral", summary: "Email reply", requestsMeeting: false } }),
  );
  const stored = await repos.replies.storeInbound(g.db, g.businessId, { interactionId, email, subject: "Question about the candles", body: "Do you ship to Ohio?", occurredAt: at, dailyCap: 200 });
  return { interactionId, entityId: stored.entityId! };
}

async function ask(g: GatewayFixture, body: Record<string, unknown>, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await fetch(`${g.server.url}${ANSWER_REPLY_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as { sent?: boolean; simulated?: boolean; reason?: string; error?: { code: string } }, text };
}

describe("answer a reply (mock)", () => {
  let g: GatewayFixture;
  const mock = createPlatformMailMock();
  beforeAll(async () => {
    g = await setupGateway({ businessMode: "automated", connectors: [mock] });
    g.deps.appEnv = "test";
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
    g.deps.appEnv = "test";
  });

  it("only the api may ask, and a malformed request echoes nothing", async () => {
    expect((await ask(g, { businessId: g.businessId, interactionId: randomUUID(), userId: USER, text: "Hi" }, null)).status).toBe(401);
    expect((await ask(g, { businessId: g.businessId, interactionId: randomUUID(), userId: USER, text: "Hi" }, "orchestrator")).status).toBe(403);
    const bad = await ask(g, { businessId: g.businessId, interactionId: randomUUID(), userId: USER, text: "secret words", to: "x@example.com" });
    expect(bad.status).toBe(400);
    expect(bad.text).not.toContain("secret words");
  });

  it("sends one message to the address on the record, as a reply with no postal address needed, and records nothing when simulated", async () => {
    const r = await keptReply(g, "reader@example.com");
    const before = mock.sentFor(g.businessId).length;
    const res = await ask(g, { businessId: g.businessId, interactionId: r.interactionId, userId: USER, text: "Yes, we ship everywhere in the US." });
    expect(res).toMatchObject({ status: 200, body: { sent: true, simulated: true } });
    // The answer names no address.
    expect(res.text).not.toContain("reader@example.com");
    const sent = mock.sentFor(g.businessId).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("reader@example.com");
    expect((sent[0]!.body as { subject: string }).subject).toBe("Re: Question about the candles");
    expect(await repos.postalAddress.addressOf(g.db, g.businessId)).toBeNull();
    // Simulated: no answer on the record, no mail.sent.
    const thread = await repos.replies.list(g.db, g.businessId, { entityId: r.entityId, limit: 50 });
    expect(thread.map((m) => m.direction)).toEqual(["inbound"]);
    expect(((await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items).length).toBe(0);
  });

  it("refuses when the person last wrote more than 30 days ago, an unknown id and an unknown business", async () => {
    const old = await keptReply(g, "old@example.com", new Date(Date.now() - (REPLY_ANSWER_WINDOW_DAYS + 1) * DAY_MS));
    expect((await ask(g, { businessId: g.businessId, interactionId: old.interactionId, userId: USER, text: "Hello again" })).body).toEqual({ sent: false, reason: "not_recent" });
    expect((await ask(g, { businessId: g.businessId, interactionId: randomUUID(), userId: USER, text: "Hello" })).body).toEqual({ sent: false, reason: "not_found" });
    // A business that does not exist (another business's reply is not found either: repos.replies.forAnswer's test).
    const r = await keptReply(g, "mine@example.com");
    expect((await ask(g, { businessId: randomUUID(), interactionId: r.interactionId, userId: USER, text: "Hello" })).body).toEqual({ sent: false, reason: "not_found" });
  });

  it("refuses a suppressed address and a person's project on production in mock mode, and with mail off", async () => {
    const r = await keptReply(g, "stopped@example.com");
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: suppressionHashOfEmail("stopped@example.com"), reason: "test", scope: "business", source: "test" });
    expect((await ask(g, { businessId: g.businessId, interactionId: r.interactionId, userId: USER, text: "Hi" })).body).toEqual({ sent: false, reason: "suppressed" });
    const ok = await keptReply(g, "prod@example.com");
    g.deps.appEnv = "production";
    expect((await ask(g, { businessId: g.businessId, interactionId: ok.interactionId, userId: USER, text: "Hi" })).body).toMatchObject({ sent: false });
    g.deps.appEnv = "test";
    g.deps.platformMail = undefined;
    expect((await ask(g, { businessId: g.businessId, interactionId: ok.interactionId, userId: USER, text: "Hi" })).body).toEqual({ sent: false, reason: "off" });
  });
});

describe("answer a reply (live)", () => {
  const SECRET = "live-platform-mail-signing-secret-0123456789";
  const posted: Record<string, unknown>[] = [];
  let g: GatewayFixture;
  const counts = new Map<string, number>();
  const redis: RedisCounter = { incr: async (k) => (counts.set(k, (counts.get(k) ?? 0) + 1), counts.get(k)!), pexpire: async () => 1, decr: async (k) => (counts.set(k, (counts.get(k) ?? 0) - 1), counts.get(k)!) };

  beforeAll(async () => {
    const live = createPlatformMailConnector({
      secrets: { sendgridApiKey: "SG.platform-key-test" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          posted.push((await req.json()) as Record<string, unknown>);
          return new Response(null, { status: 202, headers: { "x-message-id": `sg-${posted.length}` } });
        },
      }),
    });
    g = await setupGateway({ businessMode: "automated", connectors: [live], liveConnectors: ["sendgrid"] });
    g.deps.appEnv = "production";
    g.deps.rateLimits = new RedisRateLimitStore(redis);
    g.deps.platformMail = config({ signingSecret: SECRET, unsubscribeBase: "https://ingest.foundmill.test" });
  }, 120_000);
  afterAll(async () => g.close());

  it("sends for real, writes mail.sent as the member and the answer on the record", async () => {
    const r = await keptReply(g, "buyer@example.com");
    const res = await ask(g, { businessId: g.businessId, interactionId: r.interactionId, userId: USER, text: "Thanks, here is the link." });
    expect(res).toMatchObject({ status: 200, body: { sent: true, simulated: false } });
    expect(posted).toHaveLength(1);
    const [event] = (await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items;
    expect(event).toMatchObject({ actor: { kind: "user", id: USER }, payload: expect.objectContaining({ simulated: false, agentId: null }) });
    expect(JSON.stringify(event)).not.toContain("buyer@example.com");
    const thread = await repos.replies.list(g.db, g.businessId, { entityId: r.entityId, limit: 50 });
    expect(thread.map((m) => [m.direction, m.answered])).toEqual([["outbound", false], ["inbound", true]]);
    expect(thread[0]!.text).toBe("Thanks, here is the link.");
  });
});
