/**
 * A Customer Update shared as a card (services/update-cards.ts; migration 0136; WP-14 T9; docs/DESIGN.md §9f).
 *
 * Nothing is public until an owner or an admin presses, one Customer Update at a time; a member, a viewer and another
 * business's people cannot. Only a Customer Update from a real payment can be shared (not a signup, not a simulated
 * payment), only while the page is published, never on a sample business. The public read gives the project's public
 * facts, the day, the lead channel, the standout agent and the founder's own line: no customer, no amount, no count,
 * no journey id. Stopping deletes the card; a page taken down hides it. The reads are limited like the milestone card.
 */
import { repos } from "@foundmill/db";
import type { ProjectPageContent } from "@foundmill/shared";
import { UPDATE_CARD_NEEDS_PAGE_MESSAGE, UPDATE_CARD_NOT_REAL_MESSAGE, UPDATE_CARD_SAMPLE_MESSAGE, updateCardPath } from "@foundmill/shared/update-cards";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_STORY_LIMITS, publicUpdateCardLimitKeys } from "../services/milestones";
import { publicUpdateCardById } from "../services/update-cards";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ucard" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "", stage: "building", showFounders: false, followForm: true });
const CUSTOMER = "Marguerite Okonkwo-Bell";
const CUSTOMER_EMAIL = "marguerite@customer.example";

let n = 0;
async function project(name: string, options: { demo?: boolean; publish?: boolean } = {}) {
  n += 1;
  const [ownerId, adminId, memberId, viewerId] = await Promise.all(["owner", "admin", "member", "viewer"].map((r) => hz.h.createUser(`ucard-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [adminId, "admin"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const owner = hz.caller({ userId: ownerId! });
  const slug = options.publish === false ? null : (await owner.page.publish({ businessId: b.id, content: page() })).page.slug;
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  return { id: b.id, name: b.name, slug, ownerId: ownerId!, owner, admin: hz.caller({ userId: adminId! }), member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }) };
}

/** A win as ingest records it: a customer, a touch an agent worked, the payment's event, the conversion and its journey. */
async function win(businessId: string, opts: { kind?: "payment" | "signup"; actor?: { kind: "webhook" | "system"; id: string }; simulated?: boolean; platformSigned?: boolean; firstPayment?: boolean; at?: string } = {}) {
  const kind = opts.kind ?? "payment";
  const at = new Date(opts.at ?? "2026-11-12T15:30:00Z");
  const entity = await repos.entities.create(hz.db, businessId, { kind: "person", displayName: CUSTOMER, identifiers: { email: CUSTOMER_EMAIL } });
  const agent = await repos.agents.create(hz.db, businessId, { name: "Search Writer", agentType: "seo_writer", layer: "worker" } as never);
  const touch = await repos.journeys.recordTouch(hz.db, businessId, { entityId: entity.id, channelKey: "seo", occurredAt: new Date(at.getTime() - 86_400_000), source: { agentId: agent.id } });
  const event = await repos.events.write(hz.db, businessId, {
    type: kind === "payment" ? "payment.received" : "customer.converted",
    actor: opts.actor ?? { kind: "webhook", id: "stripe" },
    entityIds: [entity.id],
    payload: { entityId: entity.id, amount: { amountMinor: 4_900, currency: "USD" }, provider: "stripe", externalId: `in_${n}_${Math.random().toString(36).slice(2)}`, firstPayment: opts.firstPayment ?? true, ...(opts.simulated ? { simulated: true } : {}), ...(opts.platformSigned ? { platformSigned: true } : {}) },
    occurredAt: at,
  } as never);
  const conversion = await repos.journeys.recordConversion(hz.db, businessId, { entityId: entity.id, kind, amountMinor: 4_900, occurredAt: at, sourceEventId: event.id, firstPayment: opts.firstPayment ?? true });
  const journey = await repos.journeys.create(hz.db, businessId, { conversionId: conversion.id, touchIds: [touch.id], weights: { [touch.id]: 1 }, agents: [{ agentId: agent.id, name: "Search Writer", role: null, departmentId: null, contribution: 1, touchIds: [touch.id], rating: 9 }], matchdayLevel: "league" });
  return { journeyId: journey.id, conversionId: conversion.id, entityId: entity.id, agentId: agent.id };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");
const message = (p: Promise<unknown>) => p.then(() => "ok", (err: Error) => err.message);
const cardEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type.startsWith("customer_update.")).map((o) => ({ type: o.event.type, payload: o.event.payload as Record<string, unknown> }));
const pub = (id: string) => publicUpdateCardById({ db: hz.db, env: hz.deps.env, limits: hz.limits }, id);

describe("sharing a Customer Update", () => {
  it("nothing is public by default; an owner's press makes a card with the day, the lead channel and the standout agent, and nothing of the customer", async () => {
    const b = await project("Northwind");
    const w = await win(b.id);
    const before = await b.owner.journey.updateCard({ businessId: b.id, journeyId: w.journeyId });
    expect(before).toMatchObject({ canShare: true, refusal: null, card: null, facts: { headline: "new_customer", occurredOn: "2026-11-12", leadChannelKey: "seo", standoutAgent: "Search Writer" } });
    expect(await hz.db.execute(sql`select 1 from customer_update_cards where business_id = ${b.id}`).then((r) => (r as unknown as { rows: unknown[] }).rows)).toEqual([]);
    expect(await cardEvents(b.id)).toEqual([]);

    const shared = await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId, note: "  Thank you for\n trusting us.  " });
    const card = shared.card!;
    expect(card.note).toBe("Thank you for trusting us.");
    expect(card.url).toBe(`${hz.deps.env.APP_URL.replace(/\/+$/, "")}${updateCardPath(card.id)}`);
    // The card's address is its own id, never the journey's or the conversion's.
    expect([w.journeyId, w.conversionId, w.entityId]).not.toContain(card.id);

    const seen = (await pub(card.id))!;
    expect(seen).toMatchObject({ slug: b.slug, name: b.name, mark: true, card: { id: card.id, headline: "new_customer", occurredOn: "2026-11-12", leadChannelKey: "seo", standoutAgent: "Search Writer", note: "Thank you for trusting us." } });
    const everything = JSON.stringify(seen);
    for (const hidden of [CUSTOMER, "Marguerite", CUSTOMER_EMAIL, "4900", "49.00", w.journeyId, w.conversionId, w.entityId, w.agentId, b.id, b.ownerId]) expect(everything, hidden).not.toContain(hidden);
    // No count of any kind: the public card has no number but its date.
    expect(Object.keys(seen.card).sort()).toEqual(["headline", "id", "leadChannelKey", "note", "occurredOn", "standoutAgent", "url", "verified"]);

    expect(await cardEvents(b.id)).toEqual([{ type: "customer_update.shared", payload: { cardId: card.id, journeyId: w.journeyId, slug: b.slug, url: card.url, hasNote: true } }]);
    const audits = await repos.audit.list(hz.db, b.id, { action: "customer_update.shared" } as never);
    expect(JSON.stringify(audits)).not.toContain("Thank you");
  });

  it("only a payment signed with Foundmill's own secret (Sign in with Stripe) is verified; a pasted-key payment is shared as recorded, not verified (founder, Nov 22, 2026)", async () => {
    const b = await project("Verified");
    const connect = await win(b.id, { platformSigned: true });
    const pasted = await win(b.id, { at: "2026-11-13T15:30:00Z" });
    expect((await b.owner.journey.updateCard({ businessId: b.id, journeyId: connect.journeyId })).facts?.verified).toBe(true);
    expect((await b.owner.journey.updateCard({ businessId: b.id, journeyId: pasted.journeyId })).facts?.verified).toBe(false);
    const a = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: connect.journeyId })).card!;
    const c = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: pasted.journeyId })).card!;
    expect((await pub(a.id))!.card.verified).toBe(true);
    expect((await pub(c.id))!.card.verified).toBe(false);
    expect(c.facts.verified).toBe(false);
  });

  it("each Customer Update needs its own press, and pressing twice changes nothing twice", async () => {
    const b = await project("Twice");
    const [first, second] = [await win(b.id), await win(b.id, { firstPayment: false, at: "2026-11-14T02:00:00Z" })];
    const one = await b.admin.journey.shareUpdate({ businessId: b.id, journeyId: first.journeyId });
    const again = await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: first.journeyId, note: "A second note" });
    expect(again.card).toEqual(one.card);
    expect(one.card!.note).toBeNull();
    expect((await cardEvents(b.id)).length).toBe(1);
    // The other Customer Update is still private.
    expect((await b.owner.journey.updateCard({ businessId: b.id, journeyId: second.journeyId })).card).toBeNull();
    const other = await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: second.journeyId });
    expect(other.card!.facts.headline).toBe("returning_customer");
    expect(other.card!.id).not.toBe(one.card!.id);
  });

  it("a member, a viewer and another project's owner cannot share or stop; the state says why", async () => {
    const [a, b] = [await project("Alpha"), await project("Bravo")];
    const w = await win(a.id);
    for (const who of [a.member, a.viewer]) {
      expect(await code(who.journey.shareUpdate({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
      expect(await code(who.journey.unshareUpdate({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
    }
    expect(await a.member.journey.updateCard({ businessId: a.id, journeyId: w.journeyId })).toMatchObject({ canShare: false, refusal: "role", card: null });
    // B's owner, in A and in their own project with A's journey.
    expect(await code(b.owner.journey.shareUpdate({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
    expect(await code(b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId }))).toBe("NOT_FOUND");
    expect(await code(b.owner.journey.updateCard({ businessId: b.id, journeyId: w.journeyId }))).toBe("NOT_FOUND");
    expect(await code(b.owner.journey.updateCard({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
    // Once A shares it, B still cannot stop it.
    const shared = await a.owner.journey.shareUpdate({ businessId: a.id, journeyId: w.journeyId });
    // In their own project A's journey names nothing: nothing is stopped.
    expect(await b.owner.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId })).toEqual({ journeyId: w.journeyId, stopped: false });
    expect(await code(b.owner.journey.unshareUpdate({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
    expect(await code(a.member.journey.unshareUpdate({ businessId: a.id, journeyId: w.journeyId }))).toBe("FORBIDDEN");
    expect(await pub(shared.card!.id)).not.toBeNull();
  });

  it("only a real payment: a signup, a simulated payment and a payment no webhook wrote are refused", async () => {
    const b = await project("Real Only");
    const cases = [await win(b.id, { kind: "signup" }), await win(b.id, { simulated: true }), await win(b.id, { actor: { kind: "system", id: "simulate" } })];
    for (const w of cases) {
      expect(await b.owner.journey.updateCard({ businessId: b.id, journeyId: w.journeyId })).toMatchObject({ canShare: false, refusal: "not_real", facts: null });
      expect(await message(b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId }))).toBe(UPDATE_CARD_NOT_REAL_MESSAGE);
    }
    expect(await cardEvents(b.id)).toEqual([]);
  });

  it("needs a published page, and a sample business shares nothing and shows none", async () => {
    const draft = await project("No Page", { publish: false });
    const w = await win(draft.id);
    expect(await draft.owner.journey.updateCard({ businessId: draft.id, journeyId: w.journeyId })).toMatchObject({ canShare: false, refusal: "needs_page" });
    expect(await message(draft.owner.journey.shareUpdate({ businessId: draft.id, journeyId: w.journeyId }))).toBe(UPDATE_CARD_NEEDS_PAGE_MESSAGE);

    const sample = await project("Sample", { demo: true });
    const sw = await win(sample.id);
    expect(await sample.owner.journey.updateCard({ businessId: sample.id, journeyId: sw.journeyId })).toMatchObject({ canShare: false, refusal: "sample", card: null });
    expect(await message(sample.owner.journey.shareUpdate({ businessId: sample.id, journeyId: sw.journeyId }))).toBe(UPDATE_CARD_SAMPLE_MESSAGE);
  });

  it("a note longer than the limit is refused, and an empty one is no note", async () => {
    const b = await project("Notes");
    const w = await win(b.id);
    expect(await code(b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId, note: "x".repeat(141) }))).toBe("BAD_REQUEST");
    expect((await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId, note: "   " })).card!.note).toBeNull();
    // Invisible and direction-changing characters never reach public text.
    await b.owner.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId });
    expect((await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId, note: "Thank\u202E you\u200B all\u0007" })).card!.note).toBe("Thank you all");
  });
});

describe("stopping, and what hides a card", () => {
  it("stopping deletes the card: its address answers nothing, and sharing again makes a new address", async () => {
    const b = await project("Stop");
    const w = await win(b.id);
    const first = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId })).card!;
    expect(await b.admin.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId })).toEqual({ journeyId: w.journeyId, stopped: true });
    expect(await b.owner.journey.updateCard({ businessId: b.id, journeyId: w.journeyId })).toMatchObject({ card: null, canShare: true });
    expect(await pub(first.id)).toBeNull();
    expect((await cardEvents(b.id)).map((e) => e.type)).toEqual(["customer_update.shared", "customer_update.unshared"]);
    // Stopping twice changes nothing twice.
    expect((await b.owner.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId })).stopped).toBe(false);
    expect((await cardEvents(b.id)).length).toBe(2);
    const second = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId })).card!;
    expect(second.id).not.toBe(first.id);
    expect(await pub(first.id)).toBeNull();
    expect(await pub(second.id)).not.toBeNull();
  });

  it("a page taken down hides the card at once; stopping still works then", async () => {
    const b = await project("Down");
    const w = await win(b.id);
    const card = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId })).card!;
    await b.owner.page.unpublish({ businessId: b.id });
    expect(await pub(card.id)).toBeNull();
    expect((await b.owner.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId })).stopped).toBe(true);
  });

  it("stopping reads nothing of the Customer Update: it works after the standout agent is gone", async () => {
    const b = await project("Always Stops");
    const w = await win(b.id);
    const card = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId })).card!;
    await hz.db.execute(sql`delete from agents where id = ${w.agentId}`);
    expect((await b.admin.journey.unshareUpdate({ businessId: b.id, journeyId: w.journeyId })).stopped).toBe(true);
    expect(await pub(card.id)).toBeNull();
  });

  it("an unknown id, a malformed id and a milestone's id answer nothing", async () => {
    const b = await project("Unknown");
    const w = await win(b.id);
    expect(await pub("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await pub("not-an-id")).toBeNull();
    expect(await pub("' or 1=1 --")).toBeNull();
    expect(await pub(w.journeyId)).toBeNull();
  });
});

describe("the public read is limited like the milestone card", () => {
  it("a card's own ceiling refuses the next read; a lookup that finds nothing draws from the unknown ceiling instead", async () => {
    const b = await project("Limits");
    const w = await win(b.id);
    const card = (await b.owner.journey.shareUpdate({ businessId: b.id, journeyId: w.journeyId })).card!;
    for (let i = 0; i < PUBLIC_STORY_LIMITS.perKey.limit; i++) await hz.limits.take([{ key: publicUpdateCardLimitKeys.key(card.id), rule: PUBLIC_STORY_LIMITS.perKey }]);
    expect(await code(pub(card.id))).not.toBe("ok");
    hz.limits.reset();
    for (let i = 0; i < PUBLIC_STORY_LIMITS.unknown.limit; i++) await hz.limits.take([{ key: publicUpdateCardLimitKeys.unknown, rule: PUBLIC_STORY_LIMITS.unknown }]);
    expect(await code(pub("00000000-0000-4000-8000-000000000001"))).not.toBe("ok");
    // Real cards still read while probing is refused.
    expect(await pub(card.id)).not.toBeNull();
  });
});
