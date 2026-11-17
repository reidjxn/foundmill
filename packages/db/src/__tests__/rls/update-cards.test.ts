/**
 * 0136 `customer_update_cards` and the view `public_customer_update_cards` (WP-14 T9), tenancy by hand:
 *   - members of A read A's cards; nobody of A reads B's; no client role, of any role, writes a card (the api's
 *     service connection does, after its checks), so a "Verified" card cannot be written by hand;
 *   - the view exposes exactly its seven columns, to the service connection only, and lists a card only while its
 *     project's page is public: a page taken down or a sample business removes it at once;
 *   - deleting the journey deletes its card.
 */
import type { ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { PUBLIC_CUSTOMER_UPDATE_CARD_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
let aCardId: string;
let aJourneyId: string;
let bCardId: string;
let bJourneyId: string;

const content = (): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "", stage: "building", showFounders: false, followForm: true });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const publicRows = () => h.service().execute<Record<string, unknown> & { id: string }>(sql`select * from public_customer_update_cards order by id`);
const listed = async (id: string) => (await publicRows()).some((r) => r.id === id);

async function expectRefused(p: Promise<unknown>) {
  try {
    const out = await p;
    if (Array.isArray(out)) expect(out).toHaveLength(0);
    else expect(out).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

/** A committed business with a live page and one shared Customer Update, written on the service connection. */
async function withCard(slug: string, note: string | null) {
  const f = await createBusinessFixture(h, slug);
  await h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, f.businessId));
  return h.service().run(async (tx) => {
    await repos.pages.publish(tx, f.businessId, { content: content(), slug, userId: f.ownerId, at: new Date("2026-11-01T09:00:00Z") });
    const journey = await repos.journeys.create(tx, f.businessId, { conversionId: f.conversionIds[0]!, matchdayLevel: "friendly" });
    const card = (await repos.updateCards.create(tx, f.businessId, { journeyId: journey.id, headline: "new_customer", occurredOn: "2026-11-12", leadChannelKey: "seo", standoutAgent: "Search Writer", note, createdBy: f.ownerId }))!;
    return { f, journeyId: journey.id, cardId: card.id };
  });
}

beforeAll(async () => {
  h = await createTestDb();
  const a = await withCard("uc-alpha", "Thank you for trusting us.");
  const b = await withCard("uc-bravo", null);
  A = a.f;
  B = b.f;
  aCardId = a.cardId;
  aJourneyId = a.journeyId;
  bCardId = b.cardId;
  bJourneyId = b.journeyId;
  outsiderId = await h.createUser("uc-outsider@test.local");
}, 120_000);
afterAll(() => h?.close());

describe("customer_update_cards: tenancy", () => {
  it("every member of A reads A's card and none of B's; an outsider and anon read nothing", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      const seen = await h.asUser(userId).run((tx) => tx.select({ id: s.customerUpdateCards.id }).from(s.customerUpdateCards));
      expect(seen.map((r) => r.id)).toEqual([aCardId]);
      expect(await h.asUser(userId).run((tx) => repos.updateCards.forJourney(tx, B.businessId, bJourneyId))).toBeNull();
    }
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.customerUpdateCards))).toEqual([]);
    // A collaborator reads no payment (0094, 0107), so no card either, shared or not.
    const collaboratorId = await h.createUser("uc-collaborator@test.local");
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: collaboratorId, role: "collaborator", expiresAt: new Date(Date.now() + 14 * 86_400_000) });
    expect(await h.asUser(collaboratorId).run((tx) => tx.select().from(s.customerUpdateCards))).toEqual([]);
    await expectRefused(h.anon().run((tx) => tx.select().from(s.customerUpdateCards)));
  });

  it("no client role writes a card, in its own business or another's: not an insert, an edit or a delete", async () => {
    const spare = await h.service().run((tx) => repos.journeys.create(tx, A.businessId, { conversionId: A.conversionIds[1]!, matchdayLevel: "friendly" }));
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId, outsiderId]) {
      for (const businessId of [A.businessId, B.businessId]) {
        await expect(h.asUser(userId).run((tx) => tx.insert(s.customerUpdateCards).values({ businessId, journeyId: spare.id, headline: "new_customer", occurredOn: "2026-11-12", note: "Typed in", createdBy: userId }))).rejects.toThrow(RLS_DENIED);
      }
      await expect(h.asUser(userId).run((tx) => tx.update(s.customerUpdateCards).set({ note: "Changed by hand" }))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.delete(s.customerUpdateCards))).rejects.toThrow(RLS_DENIED);
    }
    const kept = await h.db.select().from(s.customerUpdateCards);
    expect(kept.map((c) => [c.id, c.note]).sort()).toEqual([[aCardId, "Thank you for trusting us."], [bCardId, null]].sort());
  });

  it("one card per Customer Update: sharing twice changes nothing twice", async () => {
    const again = await h.service().run((tx) => repos.updateCards.create(tx, A.businessId, { journeyId: aJourneyId, headline: "returning_customer", occurredOn: "2026-11-13", leadChannelKey: null, standoutAgent: null, note: "Second", createdBy: A.ownerId }));
    expect(again).toBeNull();
    expect((await h.service().run((tx) => repos.updateCards.forJourney(tx, A.businessId, aJourneyId)))?.note).toBe("Thank you for trusting us.");
  });

  it("the row's own limits hold on the service connection too", async () => {
    const spare = await h.service().run((tx) => repos.journeys.create(tx, B.businessId, { conversionId: B.conversionIds[1]!, matchdayLevel: "friendly" }));
    const make = (over: Record<string, unknown>) => h.service().run((tx) => tx.insert(s.customerUpdateCards).values({ businessId: B.businessId, journeyId: spare.id, headline: "new_customer", occurredOn: "2026-11-12", createdBy: B.ownerId, ...over } as never));
    await expect(make({ headline: "customer_number_7" })).rejects.toThrow();
    await expect(make({ note: "x".repeat(141) })).rejects.toThrow();
    await expect(make({ standoutAgent: "x".repeat(81) })).rejects.toThrow();
    await expect(make({ leadChannelKey: "Not a key" })).rejects.toThrow();
  });
});

describe("public_customer_update_cards: what anyone may read", () => {
  it("exposes exactly its seven columns, with nothing of the business, the journey or the customer", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_customer_update_cards' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_CUSTOMER_UPDATE_CARD_COLUMNS]);
    expect(columns).toEqual(["id", "slug", "headline", "occurred_on", "lead_channel_key", "standout_agent", "note"]);
    const row = (await publicRows()).find((r) => r.id === aCardId)!;
    expect(row).toMatchObject({ slug: "uc-alpha", headline: "new_customer", lead_channel_key: "seo", standout_agent: "Search Writer", note: "Thank you for trusting us." });
    expect(String(row.occurred_on)).toContain("2026-11-12");
    const everything = JSON.stringify(await publicRows());
    for (const hidden of [A.businessId, B.businessId, aJourneyId, bJourneyId, A.entityId, B.entityId, A.ownerId, ...A.conversionIds, ...B.conversionIds]) expect(everything).not.toContain(hidden);
  });

  it("the service connection reads it; anon and signed-in clients are refused, and nobody writes through it", async () => {
    for (const runner of [h.anon(), h.asUser(outsiderId), h.asUser(A.ownerId), h.asUser(A.memberId)]) {
      await expect(runner.execute(sql`select id from public_customer_update_cards`)).rejects.toThrow(/permission denied/);
    }
    const grants = await rows<{ grantee: string; privilege_type: string }>(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'public_customer_update_cards' and grantee <> 'postgres'`);
    expect(grants).toEqual([{ grantee: "service_role", privilege_type: "SELECT" }]);
    await expect(h.service().execute(sql`update public_customer_update_cards set note = 'x'`)).rejects.toThrow();
    expect(await h.service().run((tx) => repos.updateCards.public.byId(tx, aCardId))).toMatchObject({ id: aCardId, slug: "uc-alpha" });
  });

  it("a page taken down removes the card at once, and putting it back up returns it; a sample business lists none", async () => {
    expect(await listed(bCardId)).toBe(true);
    await h.service().run((tx) => repos.pages.unpublish(tx, B.businessId, { userId: B.ownerId }));
    expect(await listed(bCardId)).toBe(false);
    expect(await h.service().run((tx) => repos.updateCards.public.byId(tx, bCardId))).toBeNull();
    await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: content(), slug: "uc-bravo", userId: B.ownerId }));
    expect(await listed(bCardId)).toBe(true);
    await h.db.execute(sql`update businesses set is_demo = true where id = ${B.businessId}`);
    expect(await listed(bCardId)).toBe(false);
    await h.db.execute(sql`update businesses set is_demo = false where id = ${B.businessId}`);
    expect(await listed(bCardId)).toBe(true);
  });

  it("stopping removes the card, and deleting the journey deletes its card", async () => {
    expect((await h.service().run((tx) => repos.updateCards.remove(tx, B.businessId, bJourneyId)))?.id).toBe(bCardId);
    expect(await listed(bCardId)).toBe(false);
    expect(await h.service().run((tx) => repos.updateCards.remove(tx, B.businessId, bJourneyId))).toBeNull();
    // A's journey goes (as when the customer's record is erased): the card goes with it.
    await h.db.delete(s.journeys).where(eq(s.journeys.id, aJourneyId));
    expect(await listed(aCardId)).toBe(false);
    expect(await h.db.select().from(s.customerUpdateCards).where(eq(s.customerUpdateCards.id, aCardId))).toEqual([]);
  });
});
