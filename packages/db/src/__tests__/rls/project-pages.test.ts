/**
 * 0077 `project_pages` and the view `public_project_pages` (a project's public page).
 *
 * The table has one row per business, so it is not in the generated cross-tenant suite (`tables.ts` inserts a second
 * row per business); this file covers the same cases by hand and the ones only this table has:
 *   - tenancy: members read their row; nobody reads, writes or deletes another business's; a viewer reads only; a
 *     non-member and anon get nothing from the table;
 *   - the draft is a member's to write; publishing, taking down, changing a live page's address and deleting are an
 *     owner's or an admin's, whichever client wrote;
 *   - the address and the published copy are checked by the database itself;
 *   - when a page went live and when it was taken down are recorded by the database (0090): a signed-in client cannot
 *     set, backdate, forward-date or move either date, on its own page or anyone's; the service connection keeps the
 *     date it writes (seeds, backfills);
 *   - the public view: exactly its eight columns, and no row for a draft, a page taken down, an archived business, a
 *     sample business or a business not yet committed; readable by the service role only since 0081 (anon and
 *     signed-in clients are refused: the api serves it one address at a time, rate-limited).
 */
import { PAGE_RESERVED_SLUGS, PAGE_SLUG_TAKEN, type ProjectPageContent } from "@foundmill/shared";
import { bytesToBase64 } from "@foundmill/shared/logo";
import { makePng } from "@foundmill/shared/testing/logo-fixtures";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { repos } from "../../repos";
import * as s from "../../schema";
import { PUBLIC_EXPLORE_PROJECT_COLUMNS, PUBLIC_PROJECT_PAGE_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
/** When B's page went live: written on the service connection, the only one whose date is kept (0090). */
const bPublishedAt = new Date("2026-10-05T09:00:00Z");

const content = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand.", forWhom: "People in small apartments", stage: "building", showFounders: false, followForm: true, ...over });

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const commit = (businessId: string) => h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, businessId));
/** A date the database just recorded: its own clock (not a date a test sent), kept to the millisecond. */
const expectRecordedNow = (d: Date | null | undefined) => {
  expect(d).toBeInstanceOf(Date);
  expect(Math.abs(d!.getTime() - Date.now())).toBeLessThan(60_000);
};
const datesOf = async (businessId: string) => {
  const row = (await h.db.select().from(s.projectPages).where(eq(s.projectPages.businessId, businessId)))[0]!;
  return { published_at: row.publishedAt, unpublished_at: row.unpublishedAt, live: row.published !== null };
};
const publicSlugs = async (runner = h.service()) => (await runner.execute<{ slug: string }>(sql`select slug from public_project_pages order by slug`)).map((r) => r.slug);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "page-a");
  B = await createBusinessFixture(h, "page-b");
  outsiderId = await h.createUser("page-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  // B's page exists and is live before any test: every cross-tenant case has something to reach for.
  await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: content({ pitch: "Bravo's page" }), slug: "bravo-page", userId: B.ownerId, at: bPublishedAt }));
}, 120_000);
afterAll(() => h?.close());

describe("project_pages: tenancy", () => {
  it("a member saves the draft (the first save writes the row at its address) and every member reads it", async () => {
    const saved = await h.asUser(A.memberId).run((tx) => repos.pages.saveDraft(tx, A.businessId, { draft: content(), slug: "alpha-page", userId: A.memberId }));
    expect(saved).toMatchObject({ businessId: A.businessId, slug: "alpha-page", published: null, publishedAt: null, updatedBy: A.memberId });
    expect(saved.draft).toEqual(content());
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect((await h.asUser(userId).run((tx) => repos.pages.get(tx, A.businessId)))?.slug).toBe("alpha-page");
      expect(await h.asUser(userId).run((tx) => repos.pages.get(tx, B.businessId))).toBeNull();
    }
    // A later save changes the draft, never the address.
    const again = await h.asUser(A.ownerId).run((tx) => repos.pages.saveDraft(tx, A.businessId, { draft: content({ about: "" }), slug: "ignored-now", userId: A.ownerId }));
    expect(again).toMatchObject({ slug: "alpha-page", updatedBy: A.ownerId });
    expect(again.draft.about).toBe("");
  });

  it("a non-member and anon read nothing from the table", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.projectPages))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.projectPages)));
  });

  it("nobody writes or deletes another business's page", async () => {
    for (const userId of [A.ownerId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectPages).set({ draft: content({ pitch: "Taken over" }) }).where(eq(s.projectPages.businessId, B.businessId)).returning({ id: s.projectPages.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.projectPages).where(eq(s.projectPages.businessId, B.businessId)).returning({ id: s.projectPages.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => repos.pages.unpublish(tx, B.businessId, { userId })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectPages).set({ publishedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(s.projectPages.businessId, B.businessId)).returning({ id: s.projectPages.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectPages).set({ unpublishedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(s.projectPages.businessId, B.businessId)).returning({ id: s.projectPages.id })));
    }
    expect(await datesOf(B.businessId)).toEqual({ published_at: bPublishedAt, unpublished_at: null, live: true });
    const c = await createBusinessFixture(h, "page-c");
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.projectPages).values({ businessId: c.businessId, slug: "charlie-page", draft: content() }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(outsiderId).run((tx) => repos.pages.saveDraft(tx, c.businessId, { draft: content(), slug: "charlie-page", userId: outsiderId }))).rejects.toThrow(RLS_DENIED);
    expect((await repos.pages.get(h.db as never, B.businessId))?.published?.pitch).toBe("Bravo's page");
    expect(await repos.pages.get(h.db as never, c.businessId)).toBeNull();
  });

  it("a viewer reads and changes nothing", async () => {
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.update(s.projectPages).set({ draft: content({ pitch: "Viewer" }) }).where(eq(s.projectPages.businessId, A.businessId)).returning({ id: s.projectPages.id })));
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.delete(s.projectPages).where(eq(s.projectPages.businessId, A.businessId)).returning({ id: s.projectPages.id })));
    const d = await createBusinessFixture(h, "page-d");
    await expect(h.asUser(d.viewerId).run((tx) => repos.pages.saveDraft(tx, d.businessId, { draft: content(), slug: "delta-page", userId: d.viewerId }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("project_pages: publishing is an owner's or an admin's", () => {
  it("a member cannot publish, through the repo or with a direct write", async () => {
    await expect(h.asUser(A.memberId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "alpha-page", userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.projectPages).set({ published: content(), publishedAt: new Date() }).where(eq(s.projectPages.businessId, A.businessId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.projectPages).set({ publishedBy: A.memberId }).where(eq(s.projectPages.businessId, A.businessId)))).rejects.toThrow(RLS_DENIED);
    expect((await repos.pages.get(h.db as never, A.businessId))?.published).toBeNull();
    // A member cannot write a first row that is already public either.
    const e = await createBusinessFixture(h, "page-e");
    await expect(h.asUser(e.memberId).run((tx) => repos.pages.publish(tx, e.businessId, { content: content(), slug: "echo-page", userId: e.memberId }))).rejects.toThrow(RLS_DENIED);
    expect(await repos.pages.get(h.db as never, e.businessId)).toBeNull();
  });

  it("a member changes the address while the page is not live", async () => {
    const moved = await h.asUser(A.memberId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "alpha-candles", draft: content(), userId: A.memberId }));
    expect(moved).toMatchObject({ previousSlug: "alpha-page", page: { slug: "alpha-candles" } });
  });

  it("an admin publishes; publishing changes keeps the date; an owner takes it down and puts it back", async () => {
    // The dates a signed-in client sends (`at`) are never the ones stored: the database records its own (0090).
    const first = await h.asUser(A.adminId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "unused", userId: A.adminId, at: new Date("2020-01-01T00:00:00Z") }));
    expect(first).toMatchObject({ wasLive: false, page: { slug: "alpha-candles", publishedBy: A.adminId, unpublishedAt: null } });
    expect(first.page.published).toEqual(content());
    expectRecordedNow(first.page.publishedAt);
    // A known date for the rest of the test, as a backfill would write it on the service connection.
    await h.service().execute(sql`update project_pages set published_at = '2026-10-07T12:00:00Z' where business_id = ${A.businessId}`);

    const changed = await h.asUser(A.ownerId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content({ stage: "live" }), slug: "unused", userId: A.ownerId, at: new Date("2026-10-09T12:00:00Z") }));
    expect(changed).toMatchObject({ wasLive: true, page: { publishedBy: A.ownerId } });
    expect(changed.page.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(changed.page.published?.stage).toBe("live");
    expect(changed.page.draft.stage).toBe("live");

    // While it is live a member still edits the draft, and nothing public moves.
    const edited = await h.asUser(A.memberId).run((tx) => repos.pages.saveDraft(tx, A.businessId, { draft: content({ pitch: "A new pitch, not out yet" }), slug: "x-unused", userId: A.memberId }));
    expect(edited.published?.pitch).toBe(content().pitch);
    expect(edited.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    // But not its address, not taking it down, and not deleting the row.
    await expect(h.asUser(A.memberId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "member-moved-it", draft: content(), userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expectNoEffect(h.asUser(A.memberId).run((tx) => tx.delete(s.projectPages).where(eq(s.projectPages.businessId, A.businessId)).returning({ id: s.projectPages.id })));
    expect(await publicSlugs()).toContain("alpha-candles");

    const moved = await h.asUser(A.adminId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "alpha-live", draft: content(), userId: A.adminId }));
    expect(moved.page.slug).toBe("alpha-live");
    expect(moved.page.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");

    const down = await h.asUser(A.ownerId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.ownerId, at: new Date("2026-10-10T12:00:00Z") }));
    expect(down).toMatchObject({ published: null, slug: "alpha-live" });
    // Taken down now, by the database's clock; the day it went live is kept.
    expectRecordedNow(down?.unpublishedAt);
    expect(down?.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(down?.draft.pitch).toBe("A new pitch, not out yet");
    // Taken down twice: nothing to do.
    expect(await h.asUser(A.ownerId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.ownerId }))).toBeNull();

    // Put back up: it went live again now, not on the date sent and not on the earlier one.
    const back = await h.asUser(A.ownerId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "unused", userId: A.ownerId, at: new Date("2026-10-11T12:00:00Z") }));
    expect(back).toMatchObject({ wasLive: false, page: { unpublishedAt: null } });
    expectRecordedNow(back.page.publishedAt);
  });

  it("an address is one project's: a second project gets the founder's sentence", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "bravo-page", draft: content(), userId: A.ownerId }))).rejects.toThrow(PAGE_SLUG_TAKEN);
    const f = await createBusinessFixture(h, "page-f");
    await expect(h.asUser(f.ownerId).run((tx) => repos.pages.saveDraft(tx, f.businessId, { draft: content(), slug: "bravo-page", userId: f.ownerId }))).rejects.toThrow(PAGE_SLUG_TAKEN);
    expect(await repos.pages.slugTaken(h.db as never, f.businessId, "bravo-page")).toBe(true);
    expect(await repos.pages.slugTaken(h.db as never, B.businessId, "bravo-page")).toBe(false);
    expect(await repos.pages.slugTaken(h.db as never, f.businessId, "nobody-has-this")).toBe(false);
  });
});

describe("project_pages: when a page went live is the database's to record (0090)", () => {
  const PAST = new Date("2020-01-01T00:00:00Z");
  const FUTURE = new Date("2031-01-01T00:00:00Z");
  const make = async (slug: string) => {
    const f = await createBusinessFixture(h, slug);
    await commit(f.businessId);
    return f;
  };
  const set = (userId: string, businessId: string, change: Partial<typeof s.projectPages.$inferInsert>) =>
    h.asUser(userId).run((tx) => tx.update(s.projectPages).set(change).where(eq(s.projectPages.businessId, businessId)).returning({ id: s.projectPages.id }));

  it("a first publish is dated by the database, through the repo or a direct write, whatever date the client sends", async () => {
    for (const [slug, sent] of [["date-past", PAST], ["date-future", FUTURE]] as const) {
      // The row is written already published (no draft before it): the insert path.
      const f = await make(slug);
      const { page } = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug, userId: f.ownerId, at: sent }));
      expectRecordedNow(page.publishedAt);
      expect(page.unpublishedAt).toBeNull();
      // What the public reads is the same date.
      expect((await repos.pages.public.bySlug(h.db as never, slug))?.publishedAt).toEqual(page.publishedAt);
    }
    // A direct insert as PostgREST would send it, by an admin.
    const direct = await make("date-direct");
    await h.asUser(direct.adminId).run((tx) => tx.insert(s.projectPages).values({ businessId: direct.businessId, slug: "date-direct", draft: content(), published: content(), publishedAt: PAST, publishedBy: direct.adminId }));
    expectRecordedNow((await datesOf(direct.businessId)).published_at);
    // A draft first, then published with a direct update: the update path.
    const later = await make("date-later");
    await h.asUser(later.memberId).run((tx) => repos.pages.saveDraft(tx, later.businessId, { draft: content(), slug: "date-later", userId: later.memberId }));
    await set(later.ownerId, later.businessId, { published: content(), publishedAt: FUTURE, publishedBy: later.ownerId });
    const stored = await datesOf(later.businessId);
    expectRecordedNow(stored.published_at);
    // Kept to the millisecond, so the date a client reads back is exactly the date stored.
    expect(await rows(sql`select 1 from project_pages where business_id = ${later.businessId} and published_at = date_trunc('milliseconds', published_at)`)).toHaveLength(1);
  });

  it("an owner and an admin cannot move a live page's date, alone or with another change; a member is refused as before", async () => {
    const f = await make("date-live");
    const { page } = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug: "date-live", userId: f.ownerId }));
    const wentLive = page.publishedAt!;
    for (const userId of [f.ownerId, f.adminId]) {
      for (const sent of [PAST, FUTURE]) {
        await set(userId, f.businessId, { publishedAt: sent });
        await set(userId, f.businessId, { publishedAt: sent, published: content({ stage: "live" }), draft: content({ stage: "live" }) });
        await h.asUser(userId).execute(sql`update project_pages set published_at = ${sent.toISOString()}::timestamptz where business_id = ${f.businessId}`);
        expect((await datesOf(f.businessId)).published_at).toEqual(wentLive);
      }
      // Clearing it or marking a live page "taken down" changes nothing either.
      await set(userId, f.businessId, { publishedAt: null });
      await set(userId, f.businessId, { unpublishedAt: PAST });
      expect(await datesOf(f.businessId)).toEqual({ published_at: wentLive, unpublished_at: null, live: true });
    }
    expect((await repos.pages.public.bySlug(h.db as never, "date-live"))?.publishedAt).toEqual(wentLive);
    for (const change of [{ publishedAt: PAST }, { unpublishedAt: PAST }]) await expect(set(f.memberId, f.businessId, change)).rejects.toThrow(RLS_DENIED);
    await expectNoEffect(set(f.viewerId, f.businessId, { publishedAt: PAST }));
    expect((await datesOf(f.businessId)).published_at).toEqual(wentLive);
  });

  it("a page that never went live cannot be given a date", async () => {
    // Written with a date but no published copy: the insert keeps neither date.
    const typed = await make("date-typed");
    await h.asUser(typed.ownerId).run((tx) => tx.insert(s.projectPages).values({ businessId: typed.businessId, slug: "date-typed", draft: content(), publishedAt: PAST, unpublishedAt: PAST }));
    expect(await datesOf(typed.businessId)).toEqual({ published_at: null, unpublished_at: null, live: false });
    // A draft, then a date written onto it.
    const draft = await make("date-draft");
    await h.asUser(draft.memberId).run((tx) => repos.pages.saveDraft(tx, draft.businessId, { draft: content(), slug: "date-draft", userId: draft.memberId }));
    for (const userId of [draft.ownerId, draft.adminId]) {
      await set(userId, draft.businessId, { publishedAt: PAST });
      await set(userId, draft.businessId, { unpublishedAt: PAST });
      await set(userId, draft.businessId, { publishedAt: PAST, unpublishedAt: FUTURE });
    }
    expect(await datesOf(draft.businessId)).toEqual({ published_at: null, unpublished_at: null, live: false });
    // A member's draft save still works and still writes no date.
    await h.asUser(draft.memberId).run((tx) => repos.pages.saveDraft(tx, draft.businessId, { draft: content({ about: "Still a draft." }), slug: "date-draft", userId: draft.memberId }));
    expect(await datesOf(draft.businessId)).toEqual({ published_at: null, unpublished_at: null, live: false });
  });

  it("a take-down is dated by the database, and neither date moves afterwards", async () => {
    const f = await make("date-down");
    const { page } = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug: "date-down", userId: f.ownerId }));
    // Taken down with a direct write that also sends both dates.
    await set(f.adminId, f.businessId, { published: null, publishedAt: PAST, unpublishedAt: PAST });
    const down = await datesOf(f.businessId);
    expect(down).toMatchObject({ published_at: page.publishedAt, live: false });
    expectRecordedNow(down.unpublished_at);
    for (const userId of [f.ownerId, f.adminId]) {
      await set(userId, f.businessId, { unpublishedAt: FUTURE });
      await set(userId, f.businessId, { unpublishedAt: null });
      await set(userId, f.businessId, { publishedAt: PAST });
      await set(userId, f.businessId, { publishedAt: null, unpublishedAt: null });
    }
    expect(await datesOf(f.businessId)).toEqual(down);
    await expect(set(f.memberId, f.businessId, { unpublishedAt: PAST })).rejects.toThrow(RLS_DENIED);
  });

  it("the migration puts right the dates that cannot be real on rows written before it, and leaves the rest", async () => {
    const all = readMigrations();
    // The world before 0090: 0119 rewrites 0090's guard, so later migrations are left out too.
    const before = await createTestDb({ migrations: all.filter((m) => m.tag < "0090") });
    try {
      const page = async (slug: string, set: Partial<typeof s.projectPages.$inferInsert>) => {
        const f = await createBusinessFixture(before, slug);
        // As an owner could write it under 0077's guard, which checked who wrote and not the dates.
        // By named columns, so the columns later migrations add are not needed here.
        await before.asUser(f.ownerId).run((tx) =>
          tx.execute(sql`insert into project_pages (business_id, slug, draft, published, published_at, unpublished_at) values (${f.businessId}, ${slug}, ${JSON.stringify(content())}::jsonb, ${set.published ? JSON.stringify(set.published) : null}::jsonb, ${set.publishedAt?.toISOString() ?? null}::timestamptz, ${set.unpublishedAt?.toISOString() ?? null}::timestamptz)`),
        );
        return f.businessId;
      };
      const read = async (businessId: string) => {
        const row = (await before.db.select({ publishedAt: s.projectPages.publishedAt, unpublishedAt: s.projectPages.unpublishedAt }).from(s.projectPages).where(eq(s.projectPages.businessId, businessId)))[0]!;
        return { publishedAt: row.publishedAt?.toISOString() ?? null, unpublishedAt: row.unpublishedAt?.toISOString() ?? null };
      };
      const neverLive = await page("old-never", { publishedAt: PAST });
      const forward = await page("old-forward", { published: content(), publishedAt: FUTURE });
      const forwardDown = await page("old-forward-down", { publishedAt: FUTURE, unpublishedAt: new Date("2026-11-01T00:00:00Z") });
      const backdated = await page("old-backdated", { published: content(), publishedAt: PAST });
      const takenDown = await page("old-down", { publishedAt: new Date("2026-10-07T12:00:00Z"), unpublishedAt: new Date("2026-10-10T12:00:00Z") });
      const draft = await page("old-draft", {});
      expect(await read(neverLive)).toEqual({ publishedAt: PAST.toISOString(), unpublishedAt: null });
      expect(await read(forward)).toEqual({ publishedAt: FUTURE.toISOString(), unpublishedAt: null });

      await before.pg.exec(all.find((m) => m.tag === "0090_page_dates_recorded")!.sql);

      // Never live: no date, so the catch-up has nothing to record "Page live" from.
      expect(await read(neverLive)).toEqual({ publishedAt: null, unpublishedAt: null });
      // A date in the future becomes the moment of the migration, or the day the page was taken down when that is earlier.
      expectRecordedNow(new Date((await read(forward)).publishedAt!));
      expect(await read(forwardDown)).toEqual({ publishedAt: "2026-11-01T00:00:00.000Z", unpublishedAt: "2026-11-01T00:00:00.000Z" });
      // A date in the past cannot be told from a real one, and an honest row is untouched.
      expect(await read(backdated)).toEqual({ publishedAt: PAST.toISOString(), unpublishedAt: null });
      expect(await read(takenDown)).toEqual({ publishedAt: "2026-10-07T12:00:00.000Z", unpublishedAt: "2026-10-10T12:00:00.000Z" });
      expect(await read(draft)).toEqual({ publishedAt: null, unpublishedAt: null });
    } finally {
      await before.close();
    }
  }, 120_000);

  it("the service connection keeps the date it writes (seeds, backfills)", async () => {
    const f = await make("date-service");
    const first = await h.service().run((tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug: "date-service", userId: null, at: new Date("2026-10-07T12:00:00Z") }));
    expect(first.page.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    const down = await h.service().run((tx) => repos.pages.unpublish(tx, f.businessId, { userId: null, at: new Date("2026-10-10T12:00:00Z") }));
    expect(down?.unpublishedAt?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    await h.service().execute(sql`update project_pages set published_at = '2026-09-01T00:00:00Z' where business_id = ${f.businessId}`);
    expect((await datesOf(f.businessId)).published_at).toEqual(new Date("2026-09-01T00:00:00Z"));
  });
});

describe("project_pages: what the database itself refuses", () => {
  it("an address outside the rule, for every role", async () => {
    const g = await createBusinessFixture(h, "page-g");
    const insert = (slug: string) => h.pg.query(`insert into project_pages (business_id, slug, draft) values ($1, $2, '{}'::jsonb)`, [g.businessId, slug]);
    for (const bad of ["ab", "x".repeat(41), "-abc", "abc-", "Abc", "a_b", "a b"]) await expect(insert(bad), bad).rejects.toThrow(/project_pages_slug_format/);
    for (const reserved of PAGE_RESERVED_SLUGS.filter((r) => r.length >= 3)) await expect(insert(reserved), reserved).rejects.toThrow(/project_pages_slug_reserved/);
    // The repo refuses first, in the founder's words.
    await expect(repos.pages.saveDraft(h.db as never, g.businessId, { draft: content(), slug: "login", userId: null })).rejects.toThrow(/Invalid page draft/);
  });

  it("the migration's reserved list is the shared list", () => {
    const migration = readMigrations().find((m) => m.tag === "0077_project_pages")!.sql;
    const block = /check \(slug not in \(([\s\S]*?)\)\)/.exec(migration)?.[1] ?? "";
    const inSql = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect([...inSql].sort()).toEqual([...PAGE_RESERVED_SLUGS].sort());
  });

  it("a published copy that is not a page, even from the service role", async () => {
    const k = await createBusinessFixture(h, "page-k");
    const publish = (published: unknown) => h.pg.query(`insert into project_pages (business_id, slug, draft, published, published_at) values ($1, 'kilo-page', '{}'::jsonb, $2::jsonb, now())`, [k.businessId, JSON.stringify(published)]);
    for (const bad of [
      {},
      [],
      "text",
      { ...content(), pitch: "" },
      { ...content(), pitch: "x".repeat(141) },
      { ...content(), pitch: "two\nlines" },
      { ...content(), about: "" },
      { ...content(), about: "x".repeat(1501) },
      { ...content(), forWhom: "x".repeat(301) },
      { ...content(), stage: "launched" },
      { ...content(), showFounders: "yes" },
      { ...content(), followForm: "yes" },
      { pitch: "No about", stage: "idea", showFounders: false, forWhom: "" },
    ]) {
      await expect(publish(bad), JSON.stringify(bad).slice(0, 60)).rejects.toThrow(/project_pages_published_shape/);
    }
    // A published copy needs its date, and a live page is not also "taken down".
    await expect(h.pg.query(`insert into project_pages (business_id, slug, draft, published) values ($1, 'kilo-page', '{}'::jsonb, $2::jsonb)`, [k.businessId, JSON.stringify(content())])).rejects.toThrow(/project_pages_published_dated/);
    await expect(h.pg.query(`insert into project_pages (business_id, slug, draft, published, published_at, unpublished_at) values ($1, 'kilo-page', '{}'::jsonb, $2::jsonb, now(), now())`, [k.businessId, JSON.stringify(content())])).rejects.toThrow(/project_pages_live_or_down/);
    await expect(publish(content())).resolves.toBeTruthy();
  });

  it("a sample business never has a published page, and a page never moves to another business", async () => {
    const demo = await createBusinessFixture(h, "page-demo");
    await commit(demo.businessId);
    await h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, demo.businessId));
    await expect(h.asUser(demo.ownerId).run((tx) => repos.pages.publish(tx, demo.businessId, { content: content(), slug: "demo-page", userId: demo.ownerId }))).rejects.toThrow(/sample business/);
    await expect(h.service().run((tx) => repos.pages.publish(tx, demo.businessId, { content: content(), slug: "demo-page", userId: null }))).rejects.toThrow(/sample business/);
    // Its draft is still its members' to write.
    await expect(h.asUser(demo.ownerId).run((tx) => repos.pages.saveDraft(tx, demo.businessId, { draft: content(), slug: "demo-page", userId: demo.ownerId }))).resolves.toMatchObject({ published: null });
    await expect(h.pg.query(`update project_pages set business_id = $1 where business_id = $2`, [demo.businessId, B.businessId])).rejects.toThrow();
  });
});

describe("public_project_pages: what anyone may read", () => {
  it("exposes exactly its nine columns and nothing else", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_project_pages' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_PROJECT_PAGE_COLUMNS]);
    expect(columns).toEqual(["slug", "published", "published_at", "name", "logo_version", "kit_primary", "kit_secondary", "founder_names", "content_published_at"]);
    const row = (await h.service().execute<Record<string, unknown>>(sql`select * from public_project_pages where slug = 'bravo-page'`))[0]!;
    expect(Object.keys(row).sort()).toEqual([...PUBLIC_PROJECT_PAGE_COLUMNS].sort());
    // Nothing that identifies the row, the business or a person travels with it.
    for (const leaked of ["id", "business_id", "draft", "published_by", "updated_by", "unpublished_at", "user_id", "created_by", "plan_tier", "game_mode"]) expect(row).not.toHaveProperty(leaked);
    expect(row).toMatchObject({ slug: "bravo-page", name: "PAGE-B", logo_version: null, kit_primary: "#1b4fd8", kit_secondary: "#f5c400", founder_names: [] });
    expect(row.published).toEqual(content({ pitch: "Bravo's page" }));
  });

  it("the service connection reads it; anon and signed-in clients are refused (0081), and get nothing from the table", async () => {
    expect(await publicSlugs(h.service())).toContain("bravo-page");
    for (const runner of [h.anon(), h.asUser(outsiderId), h.asUser(B.ownerId)]) {
      await expect(runner.execute(sql`select slug from public_project_pages`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`select * from public_project_pages where slug = 'bravo-page'`)).rejects.toThrow(/permission denied/);
    }
    const grants = await rows<{ grantee: string; privilege_type: string }>(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'public_project_pages' and grantee <> 'postgres'`);
    expect(grants).toEqual([{ grantee: "service_role", privilege_type: "SELECT" }]);
    // What the api reads on the service connection is unchanged.
    expect((await h.service().run((tx) => repos.pages.public.bySlug(tx, "bravo-page")))?.slug).toBe("bravo-page");
    expect((await h.service().run((tx) => repos.followers.target(tx, "bravo-page")))?.slug).toBe("bravo-page");
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.projectPages)));
    // The view is read-only for everyone.
    await expect(h.anon().execute(sql`update public_project_pages set name = 'x'`)).rejects.toThrow();
    await expect(h.asUser(B.ownerId).execute(sql`delete from public_project_pages`)).rejects.toThrow();
  });

  it("a draft, a page taken down, an archived business, a sample business and a business not yet committed expose nothing", async () => {
    const make = async (slug: string) => {
      const f = await createBusinessFixture(h, slug);
      await commit(f.businessId);
      return f;
    };
    const visible = async (slug: string) => (await publicSlugs()).includes(slug);

    // Draft only.
    const draft = await make("pub-draft");
    await h.asUser(draft.ownerId).run((tx) => repos.pages.saveDraft(tx, draft.businessId, { draft: content(), slug: "pub-draft", userId: draft.ownerId }));
    expect(await visible("pub-draft")).toBe(false);
    expect(await repos.pages.public.bySlug(h.db as never, "pub-draft")).toBeNull();

    // Published, then taken down.
    const down = await make("pub-down");
    await h.asUser(down.ownerId).run((tx) => repos.pages.publish(tx, down.businessId, { content: content(), slug: "pub-down", userId: down.ownerId }));
    expect(await visible("pub-down")).toBe(true);
    await h.asUser(down.ownerId).run((tx) => repos.pages.unpublish(tx, down.businessId, { userId: down.ownerId }));
    expect(await visible("pub-down")).toBe(false);
    expect(await repos.pages.public.bySlug(h.db as never, "pub-down")).toBeNull();

    // Published, then the business is archived; restored, it is back.
    const archived = await make("pub-archived");
    await h.asUser(archived.ownerId).run((tx) => repos.pages.publish(tx, archived.businessId, { content: content(), slug: "pub-archived", userId: archived.ownerId }));
    expect(await visible("pub-archived")).toBe(true);
    await h.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, archived.businessId));
    expect(await visible("pub-archived")).toBe(false);
    await h.db.update(s.businesses).set({ archivedAt: null }).where(eq(s.businesses.id, archived.businessId));
    expect(await visible("pub-archived")).toBe(true);

    // A business that became a sample after it published (the guard refuses publishing one outright).
    const demo = await make("pub-demo");
    await h.asUser(demo.ownerId).run((tx) => repos.pages.publish(tx, demo.businessId, { content: content(), slug: "pub-demo", userId: demo.ownerId }));
    expect(await visible("pub-demo")).toBe(true);
    await h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, demo.businessId));
    expect(await visible("pub-demo")).toBe(false);
    expect(await repos.pages.public.logoBySlug(h.db as never, "pub-demo")).toBeNull();
    // The plan behind a page is read through the view too: nothing for a page the view does not list.
    expect(await repos.pages.public.planTierBySlug(h.db as never, "pub-demo")).toBeNull();
    expect(await repos.pages.public.planTierBySlug(h.db as never, "no-such-page")).toBeNull();
    expect(await repos.pages.public.planTierBySlug(h.db as never, "pub-archived")).toBe("free");
    await h.db.update(s.businesses).set({ planTier: "pro" }).where(eq(s.businesses.id, archived.businessId));
    expect(await repos.pages.public.planTierBySlug(h.db as never, "pub-archived")).toBe("pro");
    await h.db.update(s.businesses).set({ planTier: "free" }).where(eq(s.businesses.id, archived.businessId));

    // Not committed yet.
    const early = await createBusinessFixture(h, "pub-early");
    await h.asUser(early.ownerId).run((tx) => repos.pages.publish(tx, early.businessId, { content: content(), slug: "pub-early", userId: early.ownerId }));
    expect(await visible("pub-early")).toBe(false);
    await commit(early.businessId);
    expect(await visible("pub-early")).toBe(true);
  });

  it("does not depend on the old Personal and Live setting", async () => {
    const mode = await rows<{ game_mode: string }>(sql`select game_mode from businesses where id = ${B.businessId}`);
    expect(mode[0]?.game_mode).toBe("personal");
    expect(await publicSlugs()).toContain("bravo-page");
  });

  it("names the owners only while the published copy says so, and only the owners", async () => {
    const names = async () => (await h.service().execute<{ founder_names: string[] }>(sql`select founder_names from public_project_pages where slug = 'bravo-page'`))[0]?.founder_names;
    await h.db.insert(s.founderProfiles).values([
      { userId: B.ownerId, displayName: "Maya Okafor", visibility: "private" },
      { userId: B.adminId, displayName: "An Admin" },
      { userId: B.memberId, displayName: "A Member" },
    ]);
    expect(await names()).toEqual([]);
    expect(await repos.pages.ownerNames(h.db as never, B.businessId)).toEqual(["Maya Okafor"]);

    // The draft turning it on shows nothing until it is published.
    await h.asUser(B.memberId).run((tx) => repos.pages.saveDraft(tx, B.businessId, { draft: content({ pitch: "Bravo's page", showFounders: true }), slug: "bravo-page", userId: B.memberId }));
    expect(await names()).toEqual([]);
    await h.asUser(B.ownerId).run((tx) => repos.pages.publish(tx, B.businessId, { content: content({ pitch: "Bravo's page", showFounders: true }), slug: "bravo-page", userId: B.ownerId }));
    expect(await names()).toEqual(["Maya Okafor"]);
    expect((await repos.pages.public.bySlug(h.db as never, "bravo-page"))?.founderNames).toEqual(["Maya Okafor"]);

    // A second owner is named after the first; an owner with no profile is left out.
    const second = await h.createUser("page-b-second-owner@test.local");
    const third = await h.createUser("page-b-third-owner@test.local");
    await h.db.insert(s.memberships).values([{ businessId: B.businessId, userId: second, role: "owner", createdAt: new Date(Date.now() + 60_000) }, { businessId: B.businessId, userId: third, role: "owner", createdAt: new Date(Date.now() + 120_000) }]);
    await h.db.insert(s.founderProfiles).values({ userId: second, displayName: "Sam Lee" });
    expect(await names()).toEqual(["Maya Okafor", "Sam Lee"]);

    await h.asUser(B.ownerId).run((tx) => repos.pages.publish(tx, B.businessId, { content: content({ pitch: "Bravo's page", showFounders: false }), slug: "bravo-page", userId: B.ownerId }));
    expect(await names()).toEqual([]);
  });

  it("carries the logo's version, and gives the image only for a page it lists", async () => {
    // Written as the api does: with the service role, after the logo check.
    const { meta } = await repos.logos.set(h.db as never, B.businessId, { source: "upload", logo: { mime: "image/png", base64: bytesToBase64(makePng(64, 64)) } });
    const page = await repos.pages.public.bySlug(h.db as never, "bravo-page");
    expect(page?.logoVersion).toBe(meta.sha256);
    expect(await repos.pages.public.logoBySlug(h.db as never, "bravo-page")).toMatch(/^data:image\/png;base64,/);
    expect(await repos.pages.public.logoBySlug(h.db as never, "pub-draft")).toBeNull();
    expect(await repos.pages.public.logoBySlug(h.db as never, "no-such-page")).toBeNull();
  });

  it("an unknown or malformed address reads as nothing", async () => {
    expect(await repos.pages.public.bySlug(h.db as never, "no-such-page")).toBeNull();
    expect(await repos.pages.public.bySlug(h.db as never, "Not A Slug")).toBeNull();
    expect(await repos.pages.public.bySlug(h.db as never, "")).toBeNull();
  });
});

describe("the starter draft's inputs", () => {
  it("reads the vision and the founder's own words from the business's rows, and nothing for a business with neither", async () => {
    expect(await repos.pages.starterInputs(h.db as never, A.businessId)).toEqual({ founderWords: null, visionStatement: null, visionForWhom: null });
    await h.db.insert(s.businessFoundations).values({ businessId: A.businessId, door: "ideation", status: "ready", vision: { statement: "Bring the outdoors inside.", forWhom: "People in small apartments" } });
    const [idea] = await h.db.insert(s.ideas).values({ businessId: A.businessId, ownerUserId: A.ownerId, title: "Candles", pitch: "Agent-written pitch" }).returning({ id: s.ideas.id });
    const [version] = await h.db
      .insert(s.ideaVersions)
      .values({ ideaId: idea!.id, businessId: A.businessId, ownerUserId: A.ownerId, title: "Candles", pitch: "Agent-written pitch", research: { citations: [{ kind: "foundmill:meta", founder_words: "Candles that smell like a forest walk. Sold online." }] } })
      .returning({ id: s.ideaVersions.id });
    await h.db.update(s.ideas).set({ currentVersionId: version!.id }).where(eq(s.ideas.id, idea!.id));
    expect(await h.asUser(A.memberId).run((tx) => repos.pages.starterInputs(tx, A.businessId))).toEqual({ founderWords: "Candles that smell like a forest walk. Sold online.", visionStatement: "Bring the outdoors inside.", visionForWhom: "People in small apartments" });
    expect(await h.asUser(A.memberId).run((tx) => repos.pages.starterInputs(tx, B.businessId))).toEqual({ founderWords: null, visionStatement: null, visionForWhom: null });
  });
});

describe("project_pages.content_published_at: when the public copy last changed (0119)", () => {
  it("is the database's clock for a client, unchanged by a republish of the same copy, moved by a changed one; listed follows the rule", async () => {
    const f = await createBusinessFixture(h, "seo");
    await commit(f.businessId);
    const long = "We bake sourdough every weekend and leave it on porches in West Asheville. ".repeat(7);
    const first = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content({ about: long }), slug: "seo-loaf", userId: f.ownerId, at: new Date("2020-01-01T00:00:00Z") }));
    expectRecordedNow(first.page.contentPublishedAt);
    await h.service().execute(sql`update project_pages set content_published_at = '2026-10-07T12:00:00Z' where business_id = ${f.businessId}`);
    // A client cannot move it on its own.
    await h.asUser(f.ownerId).run((tx) => tx.update(s.projectPages).set({ contentPublishedAt: new Date("2030-01-01T00:00:00Z") }).where(eq(s.projectPages.businessId, f.businessId)));
    const same = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content({ about: long }), slug: "unused", userId: f.ownerId }));
    expect(same.page.contentPublishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    const changed = await h.asUser(f.ownerId).run((tx) => repos.pages.publish(tx, f.businessId, { content: content({ about: `${long} Order by Thursday.` }), slug: "unused", userId: f.ownerId }));
    expectRecordedNow(changed.page.contentPublishedAt);
    const pub = await h.service().run((tx) => repos.pages.public.bySlug(tx, "seo-loaf"));
    expect(pub?.updatedAt.getTime()).toBe(changed.page.contentPublishedAt!.getTime());
    const listed = await h.service().run((tx) => repos.pages.public.listed(tx, { limit: 5000 }));
    expect(listed.items.find((i) => i.slug === "seo-loaf")).toMatchObject({ story: false });
    // A short page is public and not listed.
    expect(listed.items.map((i) => i.slug)).not.toContain("alpha-candles");
  });
});

describe("public_explore_projects: the opt-in gallery (0149)", () => {
  it("lists a live page only after an owner or an admin opted in, and drops it when it is taken down or opted out", async () => {
    const D = await createBusinessFixture(h, "page-explore");
    await commit(D.businessId);
    await h.service().run((tx) => repos.pages.publish(tx, D.businessId, { content: content({ pitch: "Gallery pitch" }), slug: "explore-page", userId: D.ownerId }));
    const listed = async () => (await h.service().run((tx) => repos.pages.public.explore(tx, 60))).map((p) => p.slug);
    // Public is not listed: nothing is in the gallery by default.
    expect(await listed()).not.toContain("explore-page");
    // A member and a viewer cannot opt in, on their own page or by writing the column directly.
    for (const userId of [D.memberId, D.viewerId]) await expectNoEffect(h.asUser(userId).run((tx) => repos.pages.setExplore(tx, D.businessId, true)));
    expect(await listed()).not.toContain("explore-page");
    await h.asUser(D.adminId).run((tx) => repos.pages.setExplore(tx, D.businessId, true));
    const card = (await h.service().run((tx) => repos.pages.public.explore(tx, 60))).find((p) => p.slug === "explore-page");
    expect(card).toMatchObject({ slug: "explore-page", name: "PAGE-EXPLORE", pitch: "Gallery pitch", stage: "building" });
    // The opt-in counts only while the page is live; it comes back with the page.
    await h.asUser(D.ownerId).run((tx) => repos.pages.unpublish(tx, D.businessId, { userId: D.ownerId }));
    expect(await listed()).not.toContain("explore-page");
    await h.asUser(D.ownerId).run((tx) => repos.pages.publish(tx, D.businessId, { content: content(), slug: "explore-page", userId: D.ownerId }));
    expect(await listed()).toContain("explore-page");
    await h.asUser(D.ownerId).run((tx) => repos.pages.setExplore(tx, D.businessId, false));
    expect(await listed()).not.toContain("explore-page");
  });

  it("another business's owner cannot opt a page in, and a page row can't be inserted already listed by a member", async () => {
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => repos.pages.setExplore(tx, B.businessId, true)));
    expect(await h.service().run((tx) => repos.pages.public.explore(tx, 60))).not.toContainEqual(expect.objectContaining({ slug: "bravo-page" }));
    const E = await createBusinessFixture(h, "page-explore-insert");
    await expect(h.asUser(E.memberId).run((tx) => tx.insert(s.projectPages).values({ businessId: E.businessId, slug: "explore-insert", draft: content(), exploreListed: true }))).rejects.toThrow(/permission denied/);
  });

  it("exposes exactly the card's seven columns, to the service connection only", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_explore_projects' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_EXPLORE_PROJECT_COLUMNS]);
    for (const runner of [h.anon(), h.asUser(outsiderId), h.asUser(B.ownerId)]) await expect(runner.execute(sql`select slug from public_explore_projects`)).rejects.toThrow(/permission denied/);
    const grants = await rows<{ grantee: string; privilege_type: string }>(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'public_explore_projects' and grantee <> 'postgres'`);
    expect(grants).toEqual([{ grantee: "service_role", privilege_type: "SELECT" }]);
  });
});
