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
import { PUBLIC_PROJECT_PAGE_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

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
const publicSlugs = async (runner = h.service()) => (await runner.execute<{ slug: string }>(sql`select slug from public_project_pages order by slug`)).map((r) => r.slug);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "page-a");
  B = await createBusinessFixture(h, "page-b");
  outsiderId = await h.createUser("page-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  // B's page exists and is live before any test: every cross-tenant case has something to reach for.
  await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: content({ pitch: "Bravo's page" }), slug: "bravo-page", userId: B.ownerId }));
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
    }
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
    const first = await h.asUser(A.adminId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "unused", userId: A.adminId, at: new Date("2026-10-07T12:00:00Z") }));
    expect(first).toMatchObject({ wasLive: false, page: { slug: "alpha-candles", publishedBy: A.adminId, unpublishedAt: null } });
    expect(first.page.published).toEqual(content());
    expect(first.page.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");

    const changed = await h.asUser(A.ownerId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content({ stage: "live" }), slug: "unused", userId: A.ownerId, at: new Date("2026-10-09T12:00:00Z") }));
    expect(changed).toMatchObject({ wasLive: true, page: { publishedBy: A.ownerId } });
    expect(changed.page.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(changed.page.published?.stage).toBe("live");
    expect(changed.page.draft.stage).toBe("live");

    // While it is live a member still edits the draft, and nothing public moves.
    const edited = await h.asUser(A.memberId).run((tx) => repos.pages.saveDraft(tx, A.businessId, { draft: content({ pitch: "A new pitch, not out yet" }), slug: "x-unused", userId: A.memberId }));
    expect(edited.published?.pitch).toBe(content().pitch);
    // But not its address, not taking it down, and not deleting the row.
    await expect(h.asUser(A.memberId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "member-moved-it", draft: content(), userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.memberId }))).rejects.toThrow(RLS_DENIED);
    await expectNoEffect(h.asUser(A.memberId).run((tx) => tx.delete(s.projectPages).where(eq(s.projectPages.businessId, A.businessId)).returning({ id: s.projectPages.id })));
    expect(await publicSlugs()).toContain("alpha-candles");

    const moved = await h.asUser(A.adminId).run((tx) => repos.pages.setSlug(tx, A.businessId, { slug: "alpha-live", draft: content(), userId: A.adminId }));
    expect(moved.page.slug).toBe("alpha-live");

    const down = await h.asUser(A.ownerId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.ownerId, at: new Date("2026-10-10T12:00:00Z") }));
    expect(down).toMatchObject({ published: null, slug: "alpha-live" });
    expect(down?.unpublishedAt?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(down?.draft.pitch).toBe("A new pitch, not out yet");
    // Taken down twice: nothing to do.
    expect(await h.asUser(A.ownerId).run((tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.ownerId }))).toBeNull();

    const back = await h.asUser(A.ownerId).run((tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "unused", userId: A.ownerId, at: new Date("2026-10-11T12:00:00Z") }));
    expect(back).toMatchObject({ wasLive: false, page: { unpublishedAt: null } });
    expect(back.page.publishedAt?.toISOString()).toBe("2026-10-11T12:00:00.000Z");
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
  it("exposes exactly its eight columns and nothing else", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_project_pages' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_PROJECT_PAGE_COLUMNS]);
    expect(columns).toEqual(["slug", "published", "published_at", "name", "logo_version", "kit_primary", "kit_secondary", "founder_names"]);
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
