/**
 * Real outcomes credited to the team post they came through, ingest's part (item 8; ../post-outcomes.ts,
 * ../platform-mail.ts `handleFollowConfirm`, ../ingest.ts):
 *   - `/mail/confirm` credits the follow to the post link the signup kept, once, with `post.outcome_attributed`;
 *     a signup that kept no link (an unconfirmed one, another business's code, a simulated link) credits nothing;
 *   - a `lead.replied` a vendor delivered (actor `webhook`), positive or neutral, from that follower within 30 days is
 *     credited once; a negative one, a `system:simulate` one, one that says it is simulated, one after 30 days and a
 *     second one are not;
 *   - a payment from the follower is credited the same way (the pay button's reference is a seam until the payment
 *     link ships: `paymentPostCode` reads nothing), and a simulated payment is not.
 */
import { createHash } from "node:crypto";
import { followConfirmNonceHash, followConfirmToken, MOCK_NOW, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { assets, postAttributions, repos } from "@foundmill/db";
import type { PlatformEvent } from "@foundmill/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestPlatformEvents, writeEventRow } from "../ingest";
import { creditPostOutcome, paymentPostCode } from "../post-outcomes";
import { createIngestHarness, type IngestHarness } from "./harness";

const DOMAIN = "mail.foundmill.test";
const SECRET = "ingest-test-platform-mail-signing-secret";
const T = Math.floor(MOCK_NOW.getTime() / 1000);
const DAY = 86_400_000;
const platformMail = { domain: DOMAIN, signingSecret: SECRET, inboundToken: "ingest-test-platform-inbound-token", eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY };

let hz: IngestHarness;
let page: { id: string; slug: string };
beforeAll(async () => {
  hz = await createIngestHarness("ppost", { platformMail });
  page = await repos.pages.saveDraft(hz.db, hz.A.businessId, { draft: { pitch: "Candles", about: "Poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true }, slug: "ingest-post-a", userId: null });
}, 120_000);
afterAll(() => hz?.close());

async function post(businessId = hz.A.businessId) {
  const [asset] = await hz.db.insert(assets).values({ businessId, kind: "post", title: "A post", body: "Candles, poured by hand." }).returning();
  const links = await repos.postLinks.mint(hz.db, businessId, asset!.id);
  return { assetId: asset!.id, x: links.find((l) => l.network === "x")! };
}

let n = 0;
/** A pending signup as the api writes it (the post link already checked), with its confirmation link. */
async function signup(postLinkId: string | null) {
  const email = `p${++n}@example.com`;
  const recorded = await hz.db.transaction((tx) => repos.followers.record(tx, hz.A.businessId, { pageId: page.id, slug: page.slug, email, consentText: "I agree.", at: new Date(MOCK_NOW.getTime() - 60_000), postLinkId }));
  if (recorded.status === "nothing") throw new Error("expected a record");
  const nonce = createHash("sha256").update(`n-${n}-${Math.random()}`).digest("base64url");
  await repos.followers.reserveConfirmation(hz.db, hz.A.businessId, recorded.consentId, { tokenHash: followConfirmNonceHash(nonce), at: new Date(MOCK_NOW.getTime() - 60_000) });
  const token = followConfirmToken(SECRET, { businessId: hz.A.businessId, consentId: recorded.consentId, emailHash: suppressionHashOfEmail(email), expiresAt: T + 7 * 86_400, nonce });
  return { consentId: recorded.consentId, entityId: recorded.entityId, confirm: () => fetch(`${hz.base}/mail/confirm?t=${encodeURIComponent(token)}`, { method: "POST" }) };
}

const credits = async (assetId: string) => (await hz.db.select().from(postAttributions)).filter((r) => r.assetId === assetId);
const creditEvents = async () => (await repos.events.list(hz.db, hz.A.businessId, { type: "post.outcome_attributed", limit: 500 })).items;

const reply = (entityId: string, over: { sentiment?: string; actor?: { kind: string; id: string }; at?: Date; simulated?: boolean } = {}): PlatformEvent =>
  ({
    id: crypto.randomUUID(),
    businessId: hz.A.businessId,
    type: "lead.replied",
    actor: over.actor ?? { kind: "webhook", id: "platform_mail" },
    payload: { entityId, channelKey: "email_automation", campaignId: null, interactionId: crypto.randomUUID(), sentiment: over.sentiment ?? "positive", summary: "Asked about prices.", requestsMeeting: false, ...(over.simulated === undefined ? {} : { simulated: over.simulated }) },
    entityIds: [entityId],
    occurredAt: (over.at ?? new Date(MOCK_NOW.getTime() + DAY)).toISOString(),
  }) as unknown as PlatformEvent;

describe("a follow through a shared post", () => {
  it("is credited when the person confirms, once, with post.outcome_attributed (ids only)", async () => {
    const p = await post();
    await repos.postLinks.visit(hz.db, p.x.code, new Date(MOCK_NOW.getTime() - 120_000));
    const f = await signup(p.x.id);
    expect(await credits(p.assetId)).toEqual([]);
    expect((await f.confirm()).status).toBe(200);
    const rows = await credits(p.assetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: hz.A.businessId, linkId: p.x.id, network: "x", outcomeKind: "follow", originId: f.consentId });
    const followed = (await repos.events.list(hz.db, hz.A.businessId, { type: "page.followed", limit: 500 })).items.find((e) => (e.payload as { consentId: string }).consentId === f.consentId)!;
    expect(rows[0]!.outcomeEventId).toBe(followed.id);
    const event = (await creditEvents()).find((e) => (e.payload as { outcomeEventId: string }).outcomeEventId === followed.id)!;
    expect(event.payload).toEqual({ linkId: p.x.id, assetId: p.assetId, network: "x", outcomeKind: "follow", outcomeEventId: followed.id });
    expect(JSON.stringify(event)).not.toContain(f.entityId);
    expect(event.narrated).toBe(false);
    // The same link again changes nothing.
    await f.confirm();
    expect(await credits(p.assetId)).toHaveLength(1);
  });

  it("a signup that kept no link credits nothing when it confirms", async () => {
    const before = (await hz.db.select().from(postAttributions)).length;
    const f = await signup(null);
    expect((await f.confirm()).status).toBe(200);
    expect((await hz.db.select().from(postAttributions)).length).toBe(before);
  });
});

describe("a reply and a payment from that follower", () => {
  it("count once each when a vendor delivered them for real within 30 days; nothing simulated, negative or late counts", async () => {
    const p = await post();
    await repos.postLinks.visit(hz.db, p.x.code, new Date(MOCK_NOW.getTime() - 120_000));
    const f = await signup(p.x.id);
    await f.confirm();
    const kinds = async () => (await credits(p.assetId)).map((r) => r.outcomeKind).sort();
    // None of these credits anything.
    await ingestPlatformEvents(hz.db, [reply(f.entityId, { actor: { kind: "system", id: "simulate" } })], { source: "sendgrid", actor: { kind: "system", id: "simulate" } });
    await ingestPlatformEvents(hz.db, [reply(f.entityId, { sentiment: "negative" })], { source: "sendgrid" });
    await ingestPlatformEvents(hz.db, [reply(f.entityId, { sentiment: "unsubscribe" })], { source: "sendgrid" });
    await ingestPlatformEvents(hz.db, [reply(f.entityId, { at: new Date(MOCK_NOW.getTime() + 31 * DAY) })], { source: "sendgrid" });
    expect(await kinds()).toEqual(["follow"]);
    // A real reply counts; a second does not.
    await ingestPlatformEvents(hz.db, [reply(f.entityId)], { source: "sendgrid" });
    await ingestPlatformEvents(hz.db, [reply(f.entityId, { sentiment: "neutral", at: new Date(MOCK_NOW.getTime() + 2 * DAY) })], { source: "sendgrid" });
    expect(await kinds()).toEqual(["follow", "reply"]);

    // A payment from the follower: a simulated one credits nothing, a real one counts once.
    expect(paymentPostCode({ id: crypto.randomUUID(), businessId: hz.A.businessId, type: "payment.received", actor: { kind: "webhook", id: "stripe" }, payload: { externalId: "cs_1" }, occurredAt: MOCK_NOW })).toBeNull();
    const payment = (actor: { kind: string; id: string }) => ({ id: crypto.randomUUID(), businessId: hz.A.businessId, type: "payment.received", actor, payload: { entityId: f.entityId }, occurredAt: new Date(MOCK_NOW.getTime() + 3 * DAY) });
    await hz.db.transaction((tx) => creditPostOutcome(writeEventRow, tx, payment({ kind: "system", id: "simulate" })));
    await hz.db.transaction((tx) => creditPostOutcome(writeEventRow, tx, { ...payment({ kind: "webhook", id: "stripe" }), payload: { entityId: f.entityId, simulated: true } }));
    expect(await kinds()).toEqual(["follow", "reply"]);
    await hz.db.transaction((tx) => creditPostOutcome(writeEventRow, tx, payment({ kind: "webhook", id: "stripe" })));
    await hz.db.transaction((tx) => creditPostOutcome(writeEventRow, tx, payment({ kind: "webhook", id: "stripe" })));
    expect(await kinds()).toEqual(["follow", "payment", "reply"]);
  });

  it("a reply from someone else in the project credits nothing", async () => {
    const before = (await hz.db.select().from(postAttributions)).length;
    await ingestPlatformEvents(hz.db, [reply(hz.A.entity2Id)], { source: "sendgrid" });
    expect((await hz.db.select().from(postAttributions)).length).toBe(before);
  });
});
