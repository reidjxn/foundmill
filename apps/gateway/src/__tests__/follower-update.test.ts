/**
 * `POST /v1/platform-mail/send-update` (WP-08 T3): only the api; nothing without the consent rule (T10's check);
 * pending and withdrawn followers are skipped by construction, a basis other than consent is skipped; a second press
 * sends nobody twice; the answer, the events and the audit carry no address; no postal address refuses the whole send
 * and raises the note; the project's cap leaves `remaining` for "Send the rest"; mock mode on a person's project on
 * production is refused and records nothing; a simulated send records nothing; the AI line names the checker (D2).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformMailConnector, createPlatformMailMock, routedFetch } from "@foundmill/connectors";
import { contactConsents, repos, suppressionHash } from "@foundmill/db";
import { FOLLOW_CONSENT_PURPOSE, FOLLOW_SOURCE } from "@foundmill/shared";
import { RedisRateLimitStore, type RedisCounter } from "../rate-limit";
import { SEND_UPDATE_ROUTE } from "../follower-update";
import type { RecipientBasis } from "@foundmill/shared";
import { createDbPlatformHost } from "../platform-host";
import { type PlatformMailConfig } from "../platform-mail";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const POSTAL = "PO Box 1234, Springfield, IL 62701, USA";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", ...over });

let n = 0;
async function follower(g: GatewayFixture, opts: { pending?: boolean; withdrawn?: boolean; email?: string } = {}) {
  const email = opts.email ?? `follower${++n}@example.com`;
  const entity = await repos.entities.create(g.db, g.businessId, { kind: "person", displayName: "Follower", identifiers: { email } });
  await g.db.insert(contactConsents).values({ businessId: g.businessId, entityId: entity.id, purpose: FOLLOW_CONSENT_PURPOSE, source: FOLLOW_SOURCE, sourceRef: "test-page", consentText: "I agree.", confirmedAt: opts.pending ? null : new Date(), withdrawnAt: opts.withdrawn ? new Date() : null, emailHash: suppressionHash("email", email) });
  return { email, entityId: entity.id };
}
const mailSent = (g: GatewayFixture) => repos.events.list(g.db, g.businessId, { type: "mail.sent" }).then((p) => p.items);

async function ask(g: GatewayFixture, body: Record<string, unknown>, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await fetch(`${g.server.url}${SEND_UPDATE_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as { sent: number; skipped: number; remaining: number; simulated: boolean; refusal: string | null }, text };
}

describe("send an update to followers (mock)", () => {
  let g: GatewayFixture;
  const mock = createPlatformMailMock();
  let userId: string;
  beforeAll(async () => {
    g = await setupGateway({ businessMode: "automated", connectors: [mock] });
    userId = await g.h.createUser("checker@test.local");
    await repos.memberships.add(g.db, g.businessId, { userId, role: "owner" });
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
    g.deps.appEnv = "test";
    g.deps.recipientBasis = async () => "consent";
  });

  it("only the api may ask", async () => {
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "News", body: "Hi" });
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId }, null)).status).toBe(401);
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId }, "orchestrator")).status).toBe(403);
  });

  it("sends nothing without a postal address; without a test override the real consent rule (T10) decides", async () => {
    await follower(g);
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "News", body: "Hi" });
    g.deps.recipientBasis = async () => "consent";
    const before = mock.sentFor(g.businessId).length;
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId })).body).toMatchObject({ sent: 0, refusal: "no_postal_address" });
    expect(mock.sentFor(g.businessId).length).toBe(before);
  });

  it("a simulated send goes to confirmed followers only and records nothing", async () => {
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null });
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "Simulated news", body: "Hi" });
    await follower(g, { pending: true, email: "pending@example.com" });
    await follower(g, { withdrawn: true, email: "withdrawn@example.com" });
    const before = mock.sentFor(g.businessId).length;
    const r = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    expect(r.body).toMatchObject({ simulated: true, refusal: null });
    const sent = mock.sentFor(g.businessId).slice(before).map((m) => m.to);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent).not.toContain("pending@example.com");
    expect(sent).not.toContain("withdrawn@example.com");
    expect((await repos.updates.get(g.db, g.businessId, draft.id))!.status).toBe("draft");
    expect(await mailSent(g)).toHaveLength(0);
  });

  it("a member who is not an owner or an admin is refused, and a draft edited since the preview is not sent", async () => {
    const member = await g.h.createUser("member-press@test.local");
    await repos.memberships.add(g.db, g.businessId, { userId: member, role: "member" });
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "Seen", body: "First words" });
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId: member })).body).toMatchObject({ sent: 0, refusal: "not_found" });
    // A real press (live mode is needed for the version check): covered on the live side below.
  });

  it("an agent's draft_follower_update writes a draft naming the agent, and sends nothing", async () => {
    const host = createDbPlatformHost({ db: g.db, log: g.deps.log });
    const before = mock.sentFor(g.businessId).length;
    const out = await host.draftFollowerUpdate({ businessId: g.businessId, agentId: g.agentId, sessionId: null }, { subject: "Our first batch", body: "It shipped today." });
    const row = await repos.updates.get(g.db, g.businessId, out.updateId);
    expect(row).toMatchObject({ status: "draft", draftedByAgentId: g.agentId, subject: "Our first batch" });
    expect(mock.sentFor(g.businessId).length).toBe(before);
    expect((await repos.events.list(g.db, g.businessId, { type: "update.drafted" })).items.map((e) => e.payload)).toContainEqual({ updateId: row!.id, agentId: g.agentId });
  });

  it("with the real consent rule (T10), a confirmed follower gets the update", async () => {
    g.deps.recipientBasis = undefined;
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null }).catch(() => undefined);
    const f = await follower(g, { email: "real-rule@example.com" });
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "Real rule", body: "Hi" });
    const before = mock.sentFor(g.businessId).length;
    const r = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    expect(r.body).toMatchObject({ simulated: true, refusal: null });
    expect(mock.sentFor(g.businessId).slice(before).map((m) => m.to)).toContain(f.email);
  });

  it("a person's project on production in mock mode is refused, and nothing is recorded", async () => {
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "Prod news", body: "Hi" });
    g.deps.appEnv = "production";
    g.deps.platformMail = config({ signingSecret: "mock-on-production-signing-secret-0123456789", unsubscribeBase: "https://ingest.foundmill.test" });
    const before = mock.sentFor(g.businessId).length;
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId })).body).toMatchObject({ sent: 0, refusal: "simulated" });
    expect(mock.sentFor(g.businessId).length).toBe(before);
  });
});

describe("send an update to followers (live)", () => {
  const SECRET = "live-platform-mail-signing-secret-0123456789";
  const posted: { to: string; text: string }[] = [];
  let g: GatewayFixture;
  let userId: string;
  const counts = new Map<string, number>();
  const redis: RedisCounter = { incr: async (k) => (counts.set(k, (counts.get(k) ?? 0) + 1), counts.get(k)!), pexpire: async () => 1, decr: async (k) => (counts.set(k, (counts.get(k) ?? 0) - 1), counts.get(k)!) };
  const bases = new Map<string, RecipientBasis>();
  let vendorDown = false;

  beforeAll(async () => {
    const live = createPlatformMailConnector({
      secrets: { sendgridApiKey: "SG.platform-key-test" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          const body = (await req.json()) as { personalizations: { to: { email: string }[] }[]; content: { type: string; value: string }[] };
          if (vendorDown) return new Response(JSON.stringify({ errors: [{ message: "unavailable" }] }), { status: 503, headers: { "content-type": "application/json" } });
          posted.push({ to: body.personalizations[0]!.to[0]!.email, text: body.content.find((c) => c.type === "text/plain")!.value });
          return new Response(null, { status: 202, headers: { "x-message-id": `sg-${posted.length}` } });
        },
      }),
    });
    g = await setupGateway({ businessMode: "automated", connectors: [live], liveConnectors: ["sendgrid"] });
    g.deps.appEnv = "production";
    g.deps.rateLimits = new RedisRateLimitStore(redis);
    g.deps.platformMail = config({ signingSecret: SECRET, unsubscribeBase: "https://ingest.foundmill.test", dailyCap: 2 });
    g.deps.recipientBasis = async (_db, _b, email) => bases.get(email) ?? "consent";
    userId = await g.h.createUser("maya@test.local");
    await repos.memberships.add(g.db, g.businessId, { userId, role: "owner" });
    await repos.founders.upsert(g.db, userId, { displayName: "Maya Lopez" } as never);
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null });
  }, 120_000);
  afterAll(async () => g.close());

  it("sends up to the day's cap, skips a basis other than consent, leaves the rest, never twice, and names no address", async () => {
    const a = await follower(g, { email: "a@example.com" });
    await follower(g, { email: "b@example.com" });
    await follower(g, { email: "c@example.com" });
    await follower(g, { email: "recorded@example.com" });
    bases.set("recorded@example.com", "recorded");
    const draft = await repos.updates.draftByAgent(g.db, g.businessId, { subject: "Our first update", body: "We shipped the first batch.", agentId: g.agentId });

    const first = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    expect(first.body).toMatchObject({ sent: 2, refusal: "daily_cap", simulated: false });
    expect(first.body.remaining).toBeGreaterThan(0);
    for (const email of ["a@example.com", "b@example.com", "c@example.com", "recorded@example.com"]) expect(first.text).not.toContain(email);
    // Founder D2: the team drafted it, so the AI line names the member who checked it.
    expect(posted[0]!.text).toContain("We shipped the first batch.\n\nWritten with help from AI and checked by Maya.");
    expect((await repos.updates.get(g.db, g.businessId, draft.id))!.status).toBe("sending");

    // The next day (a new count), "Send the rest" reaches the rest and nobody twice.
    counts.clear();
    const rest = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    expect(rest.body).toMatchObject({ refusal: null, remaining: 0 });
    const to = posted.map((p) => p.to);
    expect(new Set(to).size).toBe(to.length);
    expect(to).not.toContain("recorded@example.com");
    expect(rest.body.skipped).toBe(1);
    expect((await repos.updates.get(g.db, g.businessId, draft.id))!).toMatchObject({ status: "sent", approvedBy: userId });

    // A third press sends nothing.
    const again = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    expect(again.body).toMatchObject({ refusal: "not_draft" });
    const events = await mailSent(g);
    expect(events).toHaveLength(posted.length);
    expect(events.every((e) => (e.payload as { updateId: string }).updateId === draft.id && e.actor.kind === "user")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("@example.com");
    const sent = (await repos.events.list(g.db, g.businessId, { type: "update.sent" })).items;
    expect(sent.at(0)!.payload).toMatchObject({ updateId: draft.id, remaining: 0 });
    expect(a.entityId).toBeTruthy();
  });

  it("a draft edited after the founder's preview is not sent; a vendor 5xx stops the press and offers nobody again twice", async () => {
    counts.clear();
    for (const email of ["v1@example.com", "v2@example.com", "v3@example.com"]) await follower(g, { email });
    const draft = await repos.updates.saveDraft(g.db, g.businessId, { subject: "Second update", body: "More news." });
    const seen = draft.updatedAt.toISOString();
    // The preview is compared to the millisecond: let the clock move past it, so a fast machine cannot save the edit in
    // the same millisecond and make it look unchanged (CI run 45678809236).
    while (Date.now() <= draft.updatedAt.getTime() + 1) await new Promise((r) => setTimeout(r, 1));
    await repos.updates.saveDraft(g.db, g.businessId, { id: draft.id, subject: "Second update", body: "Changed after the preview." });
    const before = posted.length;
    expect((await ask(g, { businessId: g.businessId, updateId: draft.id, userId, seenUpdatedAt: seen })).body).toMatchObject({ sent: 0, refusal: "changed" });
    expect(posted.length).toBe(before);

    const fresh = (await repos.updates.get(g.db, g.businessId, draft.id))!;
    vendorDown = true;
    const down = await ask(g, { businessId: g.businessId, updateId: draft.id, userId, seenUpdatedAt: fresh.updatedAt.toISOString() });
    vendorDown = false;
    expect(down.body).toMatchObject({ refusal: "vendor" });
    // One person was tried and may have it; the press stopped there, so the rest wait for the next press.
    expect(down.body.skipped).toBeGreaterThanOrEqual(1);
    expect(down.body.remaining).toBeGreaterThan(0);
    counts.clear();
    const rest = await ask(g, { businessId: g.businessId, updateId: draft.id, userId });
    const to = posted.slice(before).map((p) => p.to);
    expect(new Set(to).size).toBe(to.length);
  });
});
