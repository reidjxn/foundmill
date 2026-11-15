/**
 * 0089 — milestones a founder chooses to show: the guard on `milestones` and the view `public_project_milestones`.
 *
 *   - a milestone the platform records (`ref.trophyKey`) is not written or changed by hand: a signed-in client can only
 *     award "Page live", and only when the business's page is published with that id and date (the api does it in the
 *     transaction that publishes the page); the service connection records the rest;
 *   - showing and hiding (and deleting or archiving a shown milestone) are an owner's or an admin's, whichever client
 *     wrote; a member, a viewer and another business's people cannot;
 *   - the view: exactly its five columns, the service role's only, words built from the key (never a customer's name),
 *     and no row for a private or archived milestone, a note someone typed in, a page taken down, an archived business
 *     or a sample business;
 *   - the early milestones: awarded once, with ids only, and given by the catch-up to a project that already reached
 *     them (never to a sample business);
 *   - 0090: a recorded milestone is not deleted by hand, and a signed-in owner cannot backdate a page or its "Page
 *     live" milestone by any route (the page's date, a re-insert, the nightly catch-up); deleting a business still
 *     removes its milestones.
 *
 * A fixture that needs a known date publishes its page on the service connection: for a signed-in client the database
 * records the date itself (0090).
 */
import { TROPHIES, TROPHY_KEYS, isShowableTrophyKey } from "@foundmill/journey";
import type { ProjectPageContent } from "@foundmill/shared";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awardFirstFollowerMilestone, awardPageLiveMilestone, catchUpMilestones } from "../../milestones";
import { readMigrations } from "../../migrations";
import { repos } from "../../repos";
import * as s from "../../schema";
import { PUBLIC_PROJECT_MILESTONE_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
/** B's "First customer", recorded on the service connection and shown before any test. */
let bShownId: string;

const content = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand.", forWhom: "", stage: "building", showFounders: false, followForm: true, ...over });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const commit = (businessId: string) => h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, businessId));
const db = () => h.db as never;
const visibilityOf = async (id: string) => (await h.db.select({ v: s.milestones.visibility }).from(s.milestones).where(eq(s.milestones.id, id)))[0]?.v;
const publicRows = async () => h.service().execute<{ id: string; slug: string; key: string; label: string; achieved_at: string }>(sql`select * from public_project_milestones order by achieved_at, id`);
const listed = async (id: string) => (await publicRows()).some((r) => r.id === id);
/** The fixture's businesses have a payment, so the catch-up also awards "First customer": these tests read the early two. */
const early = <T extends { ref: unknown }>(ms: T[]): T[] => ms.filter((m) => ["page_live", "first_follower"].includes(String((m.ref as { trophyKey?: string } | null)?.trophyKey)));

/** A committed business with a live page at `slug`, dated `at` on the service connection (the only one that chooses a date, 0090). */
async function withPage(slug: string, at = new Date("2026-11-12T09:00:00Z")) {
  const f = await createBusinessFixture(h, slug);
  await commit(f.businessId);
  const { page } = await h.service().run((tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug, userId: f.ownerId, at }));
  return { ...f, pageId: page.id, publishedAt: page.publishedAt! };
}

/** A milestone as the platform records it, on the service connection. */
const record = (businessId: string, key: string, label: string, at: string, ref: Record<string, unknown> = {}, kind: "customer" | "revenue" | "trophy" = "customer") =>
  h.service().run(async (tx) => (await repos.journeys.awardMilestone(tx, businessId, { kind, label, achievedAt: new Date(at), ref: { trophyKey: key, ...ref } }))!);

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const out = await p;
    if (Array.isArray(out)) expect(out).toHaveLength(0);
    else expect(out).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "ms-a");
  B = await createBusinessFixture(h, "ms-b");
  outsiderId = await h.createUser("ms-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: content({ pitch: "Bravo's page" }), slug: "ms-bravo", userId: B.ownerId, at: new Date("2026-11-01T09:00:00Z") }));
  bShownId = (await record(B.businessId, "customer_1", "First customer", "2026-11-05T10:00:00Z", { entityId: B.entityId, customerName: "Acme Corp" })).id;
  // A customer milestone cannot be shown by a client (below); the view's own rules are tested on rows the service made public.
  await repos.journeys.setMilestoneShown(db(), B.businessId, bShownId, true);
}, 120_000);
afterAll(() => h?.close());

describe("milestones: what the platform records is not written by hand", () => {
  it("no signed-in client writes a recorded milestone by hand, shown or not; a note without a key is still a member's to write", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId]) {
      for (const key of ["customer_1", "customer_1000", "mrr_100k", "first_follower", "first_enterprise_contract"]) {
        await expect(h.asUser(userId).run((tx) => tx.insert(s.milestones).values({ businessId: A.businessId, kind: "customer", label: "First customer", ref: { trophyKey: key } })), key).rejects.toThrow(/not written by hand/);
      }
      await expect(h.asUser(userId).run((tx) => repos.journeys.awardMilestone(tx, A.businessId, { kind: "customer", label: "1,000th customer", ref: { trophyKey: "customer_1000" }, visibility: "public" }))).rejects.toThrow(RLS_DENIED);
    }
    expect(await repos.journeys.awardedTrophyKeys(db(), A.businessId)).toEqual([]);
    const note = await h.asUser(A.memberId).run((tx) => repos.journeys.createMilestone(tx, A.businessId, { kind: "launch", label: "Opened the shop" }));
    expect(note).toMatchObject({ kind: "launch", visibility: "private" });
    // A note typed in is never made public by a member, and never becomes a recorded milestone.
    await expect(h.asUser(A.memberId).run((tx) => repos.journeys.createMilestone(tx, A.businessId, { kind: "launch", label: "Typed in", visibility: "public" }))).rejects.toThrow(/only an owner or an admin/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.milestones).set({ ref: { trophyKey: "customer_1" } }).where(eq(s.milestones.id, note.id)))).rejects.toThrow(/not changed by hand/);
  });

  it("\"Page live\" is the one a signed-in client awards, and only for a page that is published with that id and date", async () => {
    const at = new Date("2026-11-12T09:00:00.000Z");
    // No page yet, a draft only, a wrong id and a wrong date are all refused.
    await expect(h.asUser(A.ownerId).run((tx) => awardPageLiveMilestone(tx, A.businessId, { pageId: A.businessId, at }))).rejects.toThrow(/not written by hand/);
    const draft = await h.asUser(A.ownerId).run((tx) => repos.pages.saveDraft(tx, A.businessId, { draft: content(), slug: "ms-alpha", userId: A.ownerId }));
    await expect(h.asUser(A.ownerId).run((tx) => awardPageLiveMilestone(tx, A.businessId, { pageId: draft.id, at }))).rejects.toThrow(/not written by hand/);
    // The api's transaction: publish, then the award at the page's own date, which the database recorded (0090):
    // the date sent with the publish is not it.
    const { row, wentLive } = await h.asUser(A.adminId).run(async (tx) => {
      const { page } = await repos.pages.publish(tx, A.businessId, { content: content(), slug: "ms-alpha", userId: A.adminId, at });
      return { row: await awardPageLiveMilestone(tx, A.businessId, { pageId: page.id, at: page.publishedAt! }), wentLive: page.publishedAt! };
    });
    expect(wentLive).not.toEqual(at);
    expect(Math.abs(wentLive.getTime() - Date.now())).toBeLessThan(60_000);
    // A date that is not the page's own is refused, for a business that holds the milestone and for one that does not.
    await expect(h.asUser(A.ownerId).run((tx) => awardPageLiveMilestone(tx, A.businessId, { pageId: draft.id, at: new Date("2020-01-01T00:00:00Z") }))).rejects.toThrow(/not written by hand/);
    const bPage = (await repos.pages.get(db(), B.businessId))!;
    await expect(h.asUser(B.ownerId).run((tx) => awardPageLiveMilestone(tx, B.businessId, { pageId: bPage.id, at: new Date("2020-01-01T00:00:00Z") }))).rejects.toThrow(/not written by hand/);
    expect(row).toMatchObject({ kind: "trophy", label: "Page live", visibility: "private" });
    expect(row!.achievedAt).toEqual(wentLive);
    expect(row!.ref).toEqual({ trophyKey: "page_live", pageId: draft.id });
    // Another business's page proves nothing here, and a second award is a no-op.
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.milestones).values({ businessId: B.businessId, kind: "trophy", label: "Page live", achievedAt: bPage.publishedAt!, ref: { trophyKey: "page_live", pageId: draft.id } }))).rejects.toThrow(/not written by hand/);
    expect(await h.asUser(A.ownerId).run((tx) => awardPageLiveMilestone(tx, A.businessId, { pageId: draft.id, at: wentLive }))).toBeNull();
    // Publishing changes keeps the date and awards nothing new.
    await h.asUser(A.ownerId).run(async (tx) => {
      const { page, wasLive } = await repos.pages.publish(tx, A.businessId, { content: content({ stage: "live" }), slug: "ms-alpha", userId: A.ownerId, at: new Date("2026-11-20T09:00:00Z") });
      expect(wasLive).toBe(true);
      expect(page.publishedAt).toEqual(wentLive);
      expect(await awardPageLiveMilestone(tx, A.businessId, { pageId: page.id, at: page.publishedAt! })).toBeNull();
    });
    expect(await repos.journeys.awardedTrophyKeys(db(), A.businessId)).toEqual(["page_live"]);
  });

  it("nobody signed in changes a recorded milestone's words, date, key or business", async () => {
    const m = (await h.db.select().from(s.milestones).where(and(eq(s.milestones.businessId, A.businessId), sql`${s.milestones.ref} ->> 'trophyKey' = 'page_live'`)))[0]!;
    for (const userId of [A.ownerId, A.adminId, A.memberId]) {
      for (const change of [{ label: "First customer: Acme Corp" }, { achievedAt: new Date("2020-01-01T00:00:00Z") }, { ref: { trophyKey: "customer_1000" } }, { ref: null }, { kind: "customer" as const }]) {
        await expect(h.asUser(userId).run((tx) => tx.update(s.milestones).set(change).where(eq(s.milestones.id, m.id))), JSON.stringify(change)).rejects.toThrow(/not changed by hand/);
      }
    }
    expect((await h.db.select().from(s.milestones).where(eq(s.milestones.id, m.id)))[0]).toMatchObject({ label: "Page live", kind: "trophy", ref: m.ref });
  });
});

describe("milestones: only one recorded from a real outside event can be shown", () => {
  it("a customer or revenue milestone is counted or estimated: no client makes it public, an owner included; hiding one is never refused", async () => {
    const customer = await record(A.businessId, "customer_10", "10th customer", "2026-11-20T10:00:00Z");
    const revenue = await record(A.businessId, "mrr_1k", "First $1K MRR", "2026-11-21T10:00:00Z", {}, "revenue");
    for (const m of [customer, revenue]) {
      for (const userId of [A.ownerId, A.adminId]) {
        await expect(h.asUser(userId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, true))).rejects.toThrow(/cannot be shown yet/);
        await expect(h.asUser(userId).run((tx) => tx.update(s.milestones).set({ visibility: "public" }).where(eq(s.milestones.id, m.id)))).rejects.toThrow(/cannot be shown yet/);
      }
      expect((await h.db.select().from(s.milestones).where(eq(s.milestones.id, m.id)))[0]!.visibility).toBe("private");
    }
    // The journey package's rule and the trigger's list are the same two keys.
    expect(TROPHY_KEYS.filter(isShowableTrophyKey)).toEqual(["page_live", "first_follower"]);
    // 0090 replaced the guard's function: both definitions carry the same list.
    for (const tag of ["0089_public_milestones", "0090_page_dates_recorded"]) expect(readMigrations().find((m) => m.tag === tag)!.sql, tag).toContain("not in ('page_live', 'first_follower')");
    // One the service made public (an older row) can still be taken off the page by an owner.
    await repos.journeys.setMilestoneShown(db(), A.businessId, customer.id, true);
    expect(await h.asUser(A.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, customer.id, false))).not.toBeNull();
  });
});

describe("milestones: showing and hiding are an owner's or an admin's", () => {
  it("a member and a viewer cannot show or hide, through the repo or with a direct write; an admin shows and an owner hides", async () => {
    const m = (await h.db.select().from(s.milestones).where(and(eq(s.milestones.businessId, A.businessId), sql`${s.milestones.ref} ->> 'trophyKey' = 'page_live'`)))[0]!;
    await expect(h.asUser(A.memberId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, true))).rejects.toThrow(/only an owner or an admin/);
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.milestones).set({ visibility: "public" }).where(eq(s.milestones.id, m.id)))).rejects.toThrow(RLS_DENIED);
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, true)));
    expect(await visibilityOf(m.id)).toBe("private");

    const shown = await h.asUser(A.adminId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, true));
    expect(shown).toMatchObject({ id: m.id, visibility: "public" });
    // A second press changes nothing twice.
    expect(await h.asUser(A.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, true))).toBeNull();
    expect(await listed(m.id)).toBe(true);

    // Shown: a member cannot hide it, archive it or delete it.
    await expect(h.asUser(A.memberId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, false))).rejects.toThrow(/only an owner or an admin/);
    await expect(h.asUser(A.memberId).run((tx) => repos.journeys.archiveMilestone(tx, A.businessId, m.id))).rejects.toThrow(/only an owner or an admin/);
    await expect(h.asUser(A.memberId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, m.id)))).rejects.toThrow(/only an owner or an admin/);
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, m.id)).returning({ id: s.milestones.id })));
    expect(await listed(m.id)).toBe(true);

    const hidden = await h.asUser(A.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, false));
    expect(hidden).toMatchObject({ id: m.id, visibility: "private" });
    expect(await h.asUser(A.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, m.id, false))).toBeNull();
    expect(await listed(m.id)).toBe(false);
  });

  it("another business's owner, member and a stranger cannot show, hide, change or delete a milestone", async () => {
    const bPrivate = await record(B.businessId, "customer_10", "10th customer", "2026-11-08T10:00:00Z");
    for (const userId of [A.ownerId, A.adminId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => repos.journeys.setMilestoneShown(tx, B.businessId, bPrivate.id, true)));
      await expectNoEffect(h.asUser(userId).run((tx) => repos.journeys.setMilestoneShown(tx, B.businessId, bShownId, false)));
      // Asked for under their own business id, another business's row is not found either.
      await expectNoEffect(h.asUser(userId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, bPrivate.id, true)));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.milestones).set({ visibility: "public" }).where(eq(s.milestones.id, bPrivate.id)).returning({ id: s.milestones.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, bShownId)).returning({ id: s.milestones.id })));
      expect(await h.asUser(userId).run((tx) => repos.journeys.getMilestone(tx, B.businessId, bShownId))).toBeNull();
    }
    await expectNoEffect(h.anon().run((tx) => tx.update(s.milestones).set({ visibility: "public" }).where(eq(s.milestones.id, bPrivate.id)).returning({ id: s.milestones.id })));
    expect(await visibilityOf(bPrivate.id)).toBe("private");
    expect(await visibilityOf(bShownId)).toBe("public");
  });

  it("a note without a key cannot be shown through the repo", async () => {
    const note = await h.asUser(A.ownerId).run((tx) => repos.journeys.createMilestone(tx, A.businessId, { kind: "release", label: "Version 2" }));
    expect(await h.asUser(A.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, A.businessId, note.id, true))).toBeNull();
    expect(await visibilityOf(note.id)).toBe("private");
  });
});

describe("milestones: what the platform recorded stays recorded (0090)", () => {
  const pageLive = async (businessId: string) => (await h.db.select().from(s.milestones).where(and(eq(s.milestones.businessId, businessId), sql`${s.milestones.ref} ->> 'trophyKey' = 'page_live'`)))[0];
  /** A project whose owner published the page through the api's own path: the database dated it, and "Page live" with it. */
  async function published(slug: string) {
    const f = await createBusinessFixture(h, slug);
    await commit(f.businessId);
    const { page, milestone } = await h.asUser(f.ownerId).run(async (tx) => {
      const { page } = await repos.pages.publish(tx, f.businessId, { content: content(), slug, userId: f.ownerId });
      return { page, milestone: (await awardPageLiveMilestone(tx, f.businessId, { pageId: page.id, at: page.publishedAt! }))! };
    });
    return { ...f, pageId: page.id, wentLive: page.publishedAt!, milestoneId: milestone.id };
  }

  it("no signed-in client deletes a recorded milestone, private or shown; a note without a key is still deleted", async () => {
    const f = await published("ms-keep");
    const customer = await record(f.businessId, "customer_1", "First customer", "2026-11-19T10:00:00Z");
    for (const userId of [f.ownerId, f.adminId, f.memberId]) {
      for (const id of [f.milestoneId, customer.id]) {
        await expect(h.asUser(userId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, id)))).rejects.toThrow(/not deleted by hand/);
      }
      await expect(h.asUser(userId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.businessId, f.businessId)))).rejects.toThrow(/not deleted by hand/);
    }
    await expectNoEffect(h.asUser(f.viewerId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)).returning({ id: s.milestones.id })));
    // Shown: an owner hides it or archives it; deleting it is refused like any other recorded milestone.
    await h.asUser(f.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, f.milestoneId, true));
    await expect(h.asUser(f.ownerId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)))).rejects.toThrow(/not deleted by hand/);
    await expect(h.asUser(f.memberId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)))).rejects.toThrow(/only an owner or an admin/);
    expect(await listed(f.milestoneId)).toBe(true);
    expect(await h.asUser(f.adminId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, f.milestoneId, false))).toMatchObject({ visibility: "private" });
    expect((await repos.journeys.awardedTrophyKeys(db(), f.businessId)).sort()).toEqual(["customer_1", "page_live"]);

    // Another business's people reach nothing.
    for (const userId of [A.ownerId, A.memberId, outsiderId]) await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)).returning({ id: s.milestones.id })));
    // A note someone typed in is theirs to delete, as before; the service connection is not limited.
    const note = await h.asUser(f.memberId).run((tx) => repos.journeys.createMilestone(tx, f.businessId, { kind: "launch", label: "Opened the shop" }));
    expect(await h.asUser(f.memberId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, note.id)).returning({ id: s.milestones.id }))).toHaveLength(1);
    expect(await h.service().run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, customer.id)).returning({ id: s.milestones.id }))).toHaveLength(1);
  });

  it("a signed-in owner cannot backdate a page or its \"Page live\" milestone, by any route", async () => {
    const f = await published("ms-honest");
    const typed = new Date("2020-01-01T00:00:00Z");
    expect(Math.abs(f.wentLive.getTime() - Date.now())).toBeLessThan(60_000);
    const backdate = (userId: string) => h.asUser(userId).execute(sql`update project_pages set published_at = '2020-01-01T00:00:00Z' where business_id = ${f.businessId}`);
    const holds = async () => {
      expect((await repos.pages.get(db(), f.businessId))!.publishedAt).toEqual(f.wentLive);
      expect((await pageLive(f.businessId))?.achievedAt).toEqual(f.wentLive);
    };

    for (const userId of [f.ownerId, f.adminId]) {
      // 1. The page's own date, straight through the table: nothing moves.
      await backdate(userId);
      // 2. The milestone's date: refused. 3. Deleting it to record it again: refused.
      await expect(h.asUser(userId).run((tx) => tx.update(s.milestones).set({ achievedAt: typed }).where(eq(s.milestones.id, f.milestoneId)))).rejects.toThrow(/not changed by hand/);
      await expect(h.asUser(userId).run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)))).rejects.toThrow(/not deleted by hand/);
      await holds();
    }

    // Had the milestone gone anyway (an older database, before deletes were refused), no route brings it back with a
    // typed-in date: a re-insert must carry the page's date, and the page's date is the database's.
    await h.service().run((tx) => tx.delete(s.milestones).where(eq(s.milestones.id, f.milestoneId)));
    await backdate(f.ownerId);
    await expect(h.asUser(f.ownerId).run((tx) => awardPageLiveMilestone(tx, f.businessId, { pageId: f.pageId, at: typed }))).rejects.toThrow(/not written by hand/);
    await expect(h.asUser(f.ownerId).run((tx) => tx.insert(s.milestones).values({ businessId: f.businessId, kind: "trophy", label: "Page live", achievedAt: typed, ref: { trophyKey: "page_live", pageId: f.pageId } }))).rejects.toThrow(/not written by hand/);
    // The nightly catch-up reads the page: the real date again.
    const caught = early(await catchUpMilestones(db(), f.businessId));
    expect(caught.map((m) => [m.label, m.achievedAt])).toEqual([["Page live", f.wentLive]]);

    // Shown, the story says the day the page really went live.
    await h.asUser(f.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, caught[0]!.id, true));
    await backdate(f.ownerId);
    expect((await repos.pages.public.storyBySlug(db(), "ms-honest")).map((m) => [m.label, m.achievedAt])).toEqual([["Page live", f.wentLive]]);
    expect((await repos.pages.public.bySlug(db(), "ms-honest"))?.publishedAt).toEqual(f.wentLive);
  });

  it("a page that never went live earns nothing, whatever date its row was written with", async () => {
    const f = await createBusinessFixture(h, "ms-never");
    await commit(f.businessId);
    // A row with a date and no published copy, then the same date written onto it again.
    await h.asUser(f.ownerId).run((tx) => tx.insert(s.projectPages).values({ businessId: f.businessId, slug: "ms-never", draft: content(), publishedAt: new Date("2020-01-01T00:00:00Z") }));
    await h.asUser(f.ownerId).execute(sql`update project_pages set published_at = '2020-01-01T00:00:00Z', unpublished_at = '2020-02-01T00:00:00Z' where business_id = ${f.businessId}`);
    const row = (await repos.pages.get(db(), f.businessId))!;
    expect(row).toMatchObject({ published: null, publishedAt: null, unpublishedAt: null });
    expect(early(await catchUpMilestones(db(), f.businessId))).toEqual([]);
    await expect(h.asUser(f.ownerId).run((tx) => awardPageLiveMilestone(tx, f.businessId, { pageId: row.id, at: new Date("2020-01-01T00:00:00Z") }))).rejects.toThrow(/not written by hand/);
    expect(await pageLive(f.businessId)).toBeUndefined();
  });

  it("deleting a business still removes its milestones; no client role deletes a business", async () => {
    const f = await published("ms-purge");
    await record(f.businessId, "customer_1", "First customer", "2026-11-19T10:00:00Z");
    await h.asUser(f.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, f.milestoneId, true));
    const count = async () => (await h.db.select({ id: s.milestones.id }).from(s.milestones).where(eq(s.milestones.businessId, f.businessId))).length;
    expect(await count()).toBe(2);
    // A client's delete of the business reaches no row (0002: no delete policy), so no cascade starts under a client role.
    expect(await h.asUser(f.ownerId).run((tx) => tx.delete(s.businesses).where(eq(s.businesses.id, f.businessId)).returning({ id: s.businesses.id }))).toHaveLength(0);
    expect(await count()).toBe(2);
    // The scheduled deletion, as the orchestrator runs it on the service connection.
    expect(await h.service().run((tx) => repos.businesses.purge(tx, f.businessId))).toBe(true);
    expect(await count()).toBe(0);
    expect(await repos.pages.get(db(), f.businessId)).toBeNull();
  });
});

describe("public_project_milestones: what anyone may read", () => {
  it("exposes exactly its five columns, with nothing of the business or the customer", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_project_milestones' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_PROJECT_MILESTONE_COLUMNS]);
    expect(columns).toEqual(["id", "slug", "key", "label", "achieved_at"]);
    const row = (await publicRows()).find((r) => r.id === bShownId)!;
    expect(Object.keys(row).sort()).toEqual([...PUBLIC_PROJECT_MILESTONE_COLUMNS].sort());
    expect(row).toMatchObject({ slug: "ms-bravo", key: "customer_1", label: "First customer" });
    for (const leaked of ["business_id", "ref", "kind", "visibility", "created_at", "archived_at"]) expect(row).not.toHaveProperty(leaked);
    // The customer's record id and name sit in `ref`; neither leaves.
    const everything = JSON.stringify(await publicRows());
    expect(everything).not.toContain("Acme");
    expect(everything).not.toContain(B.entityId);
    expect(everything).not.toContain(B.businessId);
  });

  it("the service connection reads it; anon and signed-in clients are refused, and nobody writes through it", async () => {
    for (const runner of [h.anon(), h.asUser(outsiderId), h.asUser(B.ownerId), h.asUser(B.memberId)]) {
      await expect(runner.execute(sql`select id from public_project_milestones`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`select * from public_project_milestones where slug = 'ms-bravo'`)).rejects.toThrow(/permission denied/);
    }
    const grants = await rows<{ grantee: string; privilege_type: string }>(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'public_project_milestones' and grantee <> 'postgres'`);
    expect(grants).toEqual([{ grantee: "service_role", privilege_type: "SELECT" }]);
    await expect(h.service().execute(sql`update public_project_milestones set label = 'x'`)).rejects.toThrow();
    await expect(h.asUser(B.ownerId).execute(sql`delete from public_project_milestones`)).rejects.toThrow();
  });

  it("builds the words from the key: a label that names a customer never leaves, and a revenue milestone keeps only its threshold", async () => {
    const f = await withPage("ms-words");
    const show = (id: string) => repos.journeys.setMilestoneShown(db(), f.businessId, id, true);
    // Rows as an old writer or a seed might have left them, on the service connection.
    const named = await record(f.businessId, "customer_10", "10th customer: Acme Corp", "2026-11-13T10:00:00Z", { customerName: "Acme Corp" });
    const revenue = await record(f.businessId, "mrr_1k", "First £1K monthly revenue", "2026-11-14T10:00:00Z", {}, "revenue");
    const yen = await record(f.businessId, "mrr_10k", "First ¥10K MRR", "2026-11-15T10:00:00Z", {}, "revenue");
    const odd = await record(f.businessId, "mrr_100k", "First £100K MRR thanks to Acme Corp", "2026-11-16T10:00:00Z", {}, "revenue");
    const unknown = await record(f.businessId, "made_up_key", "Typed in", "2026-11-17T10:00:00Z", {}, "trophy");
    for (const m of [named, revenue, yen, odd, unknown]) await show(m.id);
    const story = await repos.pages.public.storyBySlug(db(), "ms-words");
    expect(story.map((m) => [m.key, m.label])).toEqual([
      ["customer_10", "10th customer"],
      ["mrr_1k", "First £1K monthly revenue"],
      ["mrr_10k", "First ¥10K MRR"],
      ["mrr_100k", "First 100K of monthly revenue"],
    ]);
    expect(JSON.stringify(story)).not.toContain("Acme");
    expect(await repos.pages.public.cardById(db(), unknown.id)).toBeNull();
  });

  it("the migration's keys and words are the journey package's", () => {
    const migration = readMigrations().find((m) => m.tag === "0089_public_milestones")!.sql;
    const view = migration.slice(migration.indexOf("create view public_project_milestones"));
    const inList = /trophyKey' in \(([\s\S]*?)\);/.exec(view)?.[1] ?? "";
    expect([...inList.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!).sort()).toEqual([...TROPHY_KEYS].sort());
    for (const t of TROPHIES.filter((x) => x.metric !== "mrrMinor")) expect(view, t.key).toContain(`when '${t.key}' then '${t.label("USD")}'`);
    // A revenue label in any money matches the view's pattern for its key, and no other key's.
    for (const t of TROPHIES.filter((x) => x.metric === "mrrMinor")) {
      const k = t.key.replace("mrr_", "").toUpperCase();
      expect(view, t.key).toContain(`when '${t.key}' then case when m.label ~ '^First .{1,8}${k} (MRR|monthly revenue)$'`);
      for (const currency of ["USD", "GBP", "EUR", "JPY", "CHF", "KWD", "BRL", "SEK", "INR", "XOF"]) {
        for (const recurring of [true, false]) {
          const label = t.label(currency, recurring);
          for (const other of ["1K", "10K", "100K"]) expect(new RegExp(`^First .{1,8}${other} (MRR|monthly revenue)$`).test(label), `${label} against ${other}`).toBe(other === k);
        }
      }
    }
  });

  it("a private, an archived and a typed-in milestone expose nothing, and the story reads oldest first", async () => {
    const f = await withPage("ms-story");
    const live = await h.asUser(f.ownerId).run((tx) => awardPageLiveMilestone(tx, f.businessId, { pageId: f.pageId, at: f.publishedAt }));
    const follower = await h.service().run((tx) => awardFirstFollowerMilestone(tx, f.businessId, { consentId: randomUUID(), at: new Date("2026-11-14T08:00:00Z") }));
    const customer = await record(f.businessId, "customer_1", "First customer", "2026-11-19T10:00:00Z");
    expect(await repos.pages.public.storyBySlug(db(), "ms-story")).toEqual([]);
    expect(await repos.pages.public.hasStory(db(), "ms-story")).toBe(false);
    expect(await repos.pages.public.cardById(db(), live!.id)).toBeNull();

    // Shown newest first; read oldest first.
    await repos.journeys.setMilestoneShown(db(), f.businessId, customer.id, true);
    for (const m of [follower!, live!]) await h.asUser(f.adminId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, m.id, true));
    const story = await repos.pages.public.storyBySlug(db(), "ms-story");
    expect(story.map((m) => m.label)).toEqual(["Page live", "First follower", "First customer"]);
    expect(story.map((m) => m.achievedAt.toISOString())).toEqual(["2026-11-12T09:00:00.000Z", "2026-11-14T08:00:00.000Z", "2026-11-19T10:00:00.000Z"]);
    expect(await repos.pages.public.hasStory(db(), "ms-story")).toBe(true);
    expect(await repos.pages.public.cardById(db(), follower!.id)).toEqual({ id: follower!.id, slug: "ms-story", key: "first_follower", label: "First follower", achievedAt: new Date("2026-11-14T08:00:00Z") });

    // A note someone typed in is never listed, even marked public by an owner.
    const note = await h.asUser(f.ownerId).run((tx) => repos.journeys.createMilestone(tx, f.businessId, { kind: "launch", label: "We are huge", visibility: "public" }));
    expect(await listed(note.id)).toBe(false);
    // Hidden again, and archived.
    await h.asUser(f.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, customer.id, false));
    await h.asUser(f.ownerId).run((tx) => repos.journeys.archiveMilestone(tx, f.businessId, follower!.id));
    expect((await repos.pages.public.storyBySlug(db(), "ms-story")).map((m) => m.key)).toEqual(["page_live"]);
    expect(await repos.pages.public.cardById(db(), customer.id)).toBeNull();
    expect(await repos.pages.public.cardById(db(), follower!.id)).toBeNull();
  });

  it("a page taken down, an archived business and a sample business remove the story and every card at once", async () => {
    const make = async (slug: string) => {
      const f = await withPage(slug);
      const m = (await h.asUser(f.ownerId).run((tx) => awardPageLiveMilestone(tx, f.businessId, { pageId: f.pageId, at: f.publishedAt })))!;
      await h.asUser(f.ownerId).run((tx) => repos.journeys.setMilestoneShown(tx, f.businessId, m.id, true));
      expect(await repos.pages.public.cardById(db(), m.id)).toMatchObject({ slug, key: "page_live" });
      return { ...f, milestoneId: m.id };
    };
    const gone = async (slug: string, id: string) => {
      expect(await repos.pages.public.storyBySlug(db(), slug)).toEqual([]);
      expect(await repos.pages.public.hasStory(db(), slug)).toBe(false);
      expect(await repos.pages.public.cardById(db(), id)).toBeNull();
      expect(await listed(id)).toBe(false);
    };

    const down = await make("ms-down");
    await h.asUser(down.ownerId).run((tx) => repos.pages.unpublish(tx, down.businessId, { userId: down.ownerId }));
    await gone("ms-down", down.milestoneId);
    // The milestone stays shown, so putting the page back up brings the story back.
    await h.asUser(down.ownerId).run((tx) => repos.pages.publish(tx, down.businessId, { content: content(), slug: "ms-down", userId: down.ownerId }));
    expect((await repos.pages.public.storyBySlug(db(), "ms-down")).map((m) => m.id)).toEqual([down.milestoneId]);

    const archived = await make("ms-archived");
    await h.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, archived.businessId));
    await gone("ms-archived", archived.milestoneId);

    const sample = await make("ms-sample");
    await h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, sample.businessId));
    await gone("ms-sample", sample.milestoneId);
  });

  it("an unknown or malformed address or id reads as nothing", async () => {
    expect(await repos.pages.public.storyBySlug(db(), "no-such-page")).toEqual([]);
    expect(await repos.pages.public.storyBySlug(db(), "Not A Slug")).toEqual([]);
    expect(await repos.pages.public.hasStory(db(), "")).toBe(false);
    expect(await repos.pages.public.cardById(db(), "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await repos.pages.public.cardById(db(), "not-an-id")).toBeNull();
    expect(await repos.pages.public.cardById(db(), "")).toBeNull();
  });
});

describe("the early milestones", () => {
  /** A confirmed follower's consent record, written as ingest leaves it. */
  const confirmedFollower = async (f: BusinessFixture, pageId: string, slug: string, at: string, entityId = f.entityId) =>
    (await h.db.insert(s.contactConsents).values({ businessId: f.businessId, entityId, purpose: "email", source: "page", sourceRef: slug, pageId, consentText: "I agree.", agreedAt: new Date("2026-11-12T10:00:00Z"), confirmedAt: new Date(at) }).returning({ id: s.contactConsents.id }))[0]!.id;

  it("\"First follower\" is awarded once, with the consent record's id and nothing about the person", async () => {
    const f = await withPage("ms-follow");
    const consentId = await confirmedFollower(f, f.pageId, "ms-follow", "2026-11-14T08:30:00Z");
    const first = await h.service().run((tx) => awardFirstFollowerMilestone(tx, f.businessId, { consentId, at: new Date("2026-11-14T08:30:00Z") }));
    expect(first).toMatchObject({ kind: "trophy", label: "First follower", visibility: "private" });
    expect(first!.ref).toEqual({ trophyKey: "first_follower", consentId });
    expect(JSON.stringify(first)).not.toContain("@");
    // The second follower awards nothing.
    const second = await confirmedFollower(f, f.pageId, "ms-follow", "2026-11-15T08:30:00Z", f.entity2Id);
    expect(await h.service().run((tx) => awardFirstFollowerMilestone(tx, f.businessId, { consentId: second, at: new Date("2026-11-15T08:30:00Z") }))).toBeNull();
    expect((await repos.journeys.listMilestones(db(), f.businessId)).filter((m) => m.label === "First follower")).toHaveLength(1);
    // A signed-in client cannot award it: only the confirmation does.
    const g = await withPage("ms-follow-hand");
    await expect(h.asUser(g.ownerId).run((tx) => awardFirstFollowerMilestone(tx, g.businessId, { consentId, at: new Date() }))).rejects.toThrow(/not written by hand/);
  });

  it("the catch-up gives both to a project that already reached them, with the original dates, once", async () => {
    const f = await withPage("ms-catch", new Date("2026-10-07T12:00:00Z"));
    // Two confirmations: the earlier one is the first follower, even though that person unsubscribed later.
    await confirmedFollower(f, f.pageId, "ms-catch", "2026-10-20T09:00:00Z", f.entity2Id);
    const earliest = await confirmedFollower(f, f.pageId, "ms-catch", "2026-10-09T15:00:00Z");
    await h.db.update(s.contactConsents).set({ withdrawnAt: new Date("2026-10-30T00:00:00Z") }).where(eq(s.contactConsents.id, earliest));
    expect(await repos.followers.firstConfirmed(db(), f.businessId)).toEqual({ consentId: earliest, confirmedAt: new Date("2026-10-09T15:00:00Z") });

    // A sweep dated before either happened awards nothing.
    expect(early(await catchUpMilestones(db(), f.businessId, { until: new Date("2026-10-01T00:00:00Z") }))).toEqual([]);
    const awarded = early(await catchUpMilestones(db(), f.businessId, { until: new Date("2026-11-12T00:00:00Z") }));
    expect(awarded.map((m) => [m.label, m.achievedAt.toISOString(), m.visibility])).toEqual([
      ["Page live", "2026-10-07T12:00:00.000Z", "private"],
      ["First follower", "2026-10-09T15:00:00.000Z", "private"],
    ]);
    expect(awarded.map((m) => m.ref)).toEqual([{ trophyKey: "page_live", pageId: f.pageId }, { trophyKey: "first_follower", consentId: earliest }]);
    expect(early(await catchUpMilestones(db(), f.businessId))).toEqual([]);
    expect(await catchUpMilestones(db(), f.businessId)).toEqual([]);

    // A page taken down did go live: the milestone keeps its date.
    const down = await withPage("ms-catch-down", new Date("2026-10-08T12:00:00Z"));
    await h.asUser(down.ownerId).run((tx) => repos.pages.unpublish(tx, down.businessId, { userId: down.ownerId }));
    expect(early(await catchUpMilestones(db(), down.businessId)).map((m) => [m.label, m.achievedAt.toISOString()])).toEqual([["Page live", "2026-10-08T12:00:00.000Z"]]);
  });

  it("nothing for a project with a draft only, a pending signup, or a sample business", async () => {
    const draft = await createBusinessFixture(h, "ms-none");
    await commit(draft.businessId);
    const saved = await h.asUser(draft.ownerId).run((tx) => repos.pages.saveDraft(tx, draft.businessId, { draft: content(), slug: "ms-none", userId: draft.ownerId }));
    await h.db.insert(s.contactConsents).values({ businessId: draft.businessId, entityId: draft.entityId, purpose: "email", source: "page", sourceRef: "ms-none", pageId: saved.id, consentText: "I agree." });
    expect(await repos.followers.firstConfirmed(db(), draft.businessId)).toBeNull();
    expect(early(await catchUpMilestones(db(), draft.businessId))).toEqual([]);

    const sample = await withPage("ms-sample-catch");
    await confirmedFollower(sample, sample.pageId, "ms-sample-catch", "2026-11-13T09:00:00Z");
    await h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, sample.businessId));
    expect(early(await catchUpMilestones(db(), sample.businessId))).toEqual([]);
    expect((await repos.journeys.awardedTrophyKeys(db(), sample.businessId)).filter((k) => k === "page_live" || k === "first_follower")).toEqual([]);
  });
});
