/**
 * 0086 — `attributions`: who or what brought a new person (docs/NETWORK.md §5, §11).
 *
 *   - the service role's only: no client role reads or writes it, not even the person's own row, so who is credited
 *     and which project it was, by id, never reach a client (another account, the referrer and the source project's
 *     members are refused the same way). What each of the two people does read is their own account event, which
 *     carries the public address and nothing else (rls/account-events.test.ts, migration-0086.test.ts);
 *   - one row per account, ever: the first stays, whatever arrives later;
 *   - the database checks the kind, the reference's shape, that nobody brings themselves and that only a project page
 *     names a business;
 *   - `resolve` goes by the public views alone: a published page of a committed, open, real business, or a public
 *     profile; a draft, a page taken down, an archived or sample business, a private or archived profile and an unknown
 *     address all resolve to nothing;
 *   - the row follows its account; the referrer and the source business may go and the row stays.
 */
import { VIA_KINDS } from "@foundmill/shared/via";
import type { PersonProfileContent, ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let newcomer: string;
let outsider: string;

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bread by bike", about: "Fresh bread delivered.", forWhom: "", stage: "building", showFounders: false, followForm: false, ...over });
const profile = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker", about: "I bake bread.", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "", ...over });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const commit = (businessId: string) => h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, businessId));
const publish = (f: BusinessFixture, slug: string) => h.service().run((tx) => repos.pages.publish(tx, f.businessId, { content: page(), slug, userId: f.ownerId }));

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "attr-a");
  B = await createBusinessFixture(h, "attr-b");
  newcomer = await h.createUser("attr-newcomer@test.local");
  outsider = await h.createUser("attr-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  await publish(A, "bread-by-bike");
  await repos.founders.upsert(h.db as never, B.ownerId, { displayName: "Sam Lee" });
  await repos.personProfiles.save(h.db as never, B.ownerId, { handle: "sam-lee", content: profile() });
  await repos.personProfiles.publish(h.db as never, B.ownerId);
  // The row every cross-account case reaches for: the newcomer came through A's page.
  await h.service().run((tx) => repos.attributions.record(tx, newcomer, { kind: "project_page", ref: "bread-by-bike", businessId: A.businessId, referrerUserId: A.ownerId }));
}, 120_000);
afterAll(() => h?.close());

describe("attributions 0086: the service role's only", () => {
  it("the api (service connection) reads and writes it", async () => {
    const row = await h.service().run((tx) => repos.attributions.forUser(tx, newcomer));
    expect(row).toMatchObject({ userId: newcomer, sourceKind: "project_page", sourceRef: "bread-by-bike", sourceBusinessId: A.businessId, referrerUserId: A.ownerId });
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, outsider))).toBeNull();
  });

  it("no client role reads a row: not another account, not the referrer, not the source project's members, not the person themselves, not anon", async () => {
    for (const runner of [h.anon(), h.asUser(outsider), h.asUser(A.ownerId), h.asUser(A.memberId), h.asUser(A.viewerId), h.asUser(B.ownerId), h.asUser(newcomer)]) {
      await expect(runner.execute(sql`select id from attributions`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`select referrer_user_id, source_business_id from attributions where user_id = ${newcomer}`)).rejects.toThrow(/permission denied/);
      await expect(runner.run((tx) => repos.attributions.forUser(tx, newcomer))).rejects.toThrow(/permission denied/);
    }
  });

  it("no client role writes one: no insert for oneself or anyone else, no update, no delete", async () => {
    for (const [runner, who] of [[h.anon(), outsider], [h.asUser(outsider), outsider], [h.asUser(A.ownerId), outsider], [h.asUser(newcomer), newcomer]] as const) {
      await expect(runner.execute(sql`insert into attributions (user_id, source_kind, source_ref, referrer_user_id) values (${who}, 'person_profile', 'sam-lee', ${B.ownerId})`)).rejects.toThrow(/permission denied/);
      await expect(runner.run((tx) => repos.attributions.record(tx, who, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: B.ownerId }))).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`update attributions set referrer_user_id = ${outsider} where user_id = ${newcomer}`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`delete from attributions where user_id = ${newcomer}`)).rejects.toThrow(/permission denied/);
    }
    expect(await rows(sql`select user_id, referrer_user_id from attributions`)).toEqual([{ user_id: newcomer, referrer_user_id: A.ownerId }]);
  });

  it("row level security is on with no policy, and only the service role holds a grant", async () => {
    expect(await rows(sql`select relrowsecurity from pg_class where oid = 'public.attributions'::regclass`)).toEqual([{ relrowsecurity: true }]);
    expect(await rows(sql`select policyname from pg_policies where schemaname = 'public' and tablename = 'attributions'`)).toEqual([]);
    const grants = await rows<{ grantee: string }>(sql`select distinct grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = 'attributions' and grantee <> 'postgres'`);
    expect(grants.map((g) => g.grantee)).toEqual(["service_role"]);
    expect(await rows(sql`select grantee from information_schema.column_privileges where table_schema = 'public' and table_name = 'attributions' and grantee in ('anon', 'authenticated', 'PUBLIC')`)).toEqual([]);
  });
});

describe("attributions 0086: once per account, and what the database itself refuses", () => {
  it("the first stays: a second record writes nothing, through the repo or straight to the table", async () => {
    expect(await h.service().run((tx) => repos.attributions.record(tx, newcomer, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: B.ownerId }))).toBeNull();
    await expect(h.service().execute(sql`insert into attributions (user_id, source_kind, source_ref) values (${newcomer}, 'person_profile', 'sam-lee')`)).rejects.toThrow(/attributions_user_id_key|duplicate key/);
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, newcomer))).toMatchObject({ sourceKind: "project_page", sourceRef: "bread-by-bike", referrerUserId: A.ownerId });
  });

  it("nobody brings themselves", async () => {
    expect(await h.service().run((tx) => repos.attributions.record(tx, B.ownerId, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: B.ownerId }))).toBeNull();
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, B.ownerId))).toBeNull();
    await expect(h.service().execute(sql`insert into attributions (user_id, source_kind, source_ref, referrer_user_id) values (${B.ownerId}, 'person_profile', 'sam-lee', ${B.ownerId})`)).rejects.toThrow(/attributions_not_self/);
  });

  it("an unknown kind, a reference outside the address shape, and a business on a person's profile", async () => {
    const insert = (kind: string, ref: string, businessId: string | null = null) => h.service().execute(sql`insert into attributions (user_id, source_kind, source_ref, source_business_id) values (${outsider}, ${kind}, ${ref}, ${businessId})`);
    await expect(insert("invitation", "sam-lee")).rejects.toThrow(/attributions_source_kind_value/);
    for (const bad of ["ab", "x".repeat(41), "-abc", "abc-", "Abc", "a_b", "a b", "p.sam-lee", ""]) await expect(insert("person_profile", bad), bad).rejects.toThrow(/attributions_source_ref_format/);
    await expect(insert("person_profile", "sam-lee", A.businessId)).rejects.toThrow(/attributions_business_for_page_only/);
    // The repo refuses the same before it reaches the table.
    await expect(repos.attributions.record(h.db as never, outsider, { kind: "person_profile", ref: "Not A Handle", businessId: null, referrerUserId: B.ownerId })).rejects.toThrow(/Invalid attribution/);
    await expect(repos.attributions.record(h.db as never, outsider, { kind: "person_profile", ref: "sam-lee", businessId: A.businessId, referrerUserId: B.ownerId })).rejects.toThrow(/Invalid attribution/);
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, outsider))).toBeNull();
  });

  it("the migration's kinds are the shared kinds", () => {
    const migration = readMigrations().find((m) => m.tag === "0086_attributions")!.sql;
    const block = /check \(source_kind in \(([^)]*)\)\)/.exec(migration)?.[1] ?? "";
    expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...VIA_KINDS].sort());
  });
});

describe("repos.attributions.resolve: the public views only", () => {
  const resolve = (kind: (typeof VIA_KINDS)[number], ref: string) => h.service().run((tx) => repos.attributions.resolve(tx, { kind, ref }));

  it("a published page names its business and its longest-standing owner", async () => {
    expect(await resolve("project_page", "bread-by-bike")).toEqual({ kind: "project_page", ref: "bread-by-bike", businessId: A.businessId, referrerUserId: A.ownerId });
    // A second owner who joined later changes nothing; one who has been an owner longer is the one named.
    const later = await h.createUser("attr-later-owner@test.local");
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: later, role: "owner" });
    expect((await resolve("project_page", "bread-by-bike"))?.referrerUserId).toBe(A.ownerId);
    await h.db.update(s.memberships).set({ createdAt: new Date("2020-01-01T00:00:00Z") }).where(eq(s.memberships.userId, later));
    expect((await resolve("project_page", "bread-by-bike"))?.referrerUserId).toBe(later);
    await h.db.delete(s.memberships).where(eq(s.memberships.userId, later));
  });

  it("a public profile names its person, and no business", async () => {
    expect(await resolve("person_profile", "sam-lee")).toEqual({ kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: B.ownerId });
  });

  it("a slug is never read as a handle, nor a handle as a slug", async () => {
    expect(await resolve("person_profile", "bread-by-bike")).toBeNull();
    expect(await resolve("project_page", "sam-lee")).toBeNull();
  });

  it("nothing public, nothing resolved: unknown, draft, taken down, archived, a sample business, a private or archived profile", async () => {
    expect(await resolve("project_page", "no-such-page")).toBeNull();
    expect(await resolve("person_profile", "no-such-person")).toBeNull();
    expect(await resolve("project_page", "Not A Slug")).toBeNull();
    expect(await resolve("person_profile", "")).toBeNull();

    // B's page: a draft only, then published, then taken down.
    await h.service().run((tx) => repos.pages.saveDraft(tx, B.businessId, { draft: page(), slug: "sams-draft", userId: B.ownerId }));
    expect(await resolve("project_page", "sams-draft")).toBeNull();
    await publish(B, "sams-draft");
    expect((await resolve("project_page", "sams-draft"))?.businessId).toBe(B.businessId);
    await h.service().run((tx) => repos.pages.unpublish(tx, B.businessId, { userId: B.ownerId }));
    expect(await resolve("project_page", "sams-draft")).toBeNull();

    // Published, but the business is archived, not committed, or a sample business.
    await publish(B, "sams-draft");
    await h.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, B.businessId));
    expect(await resolve("project_page", "sams-draft")).toBeNull();
    await h.db.update(s.businesses).set({ archivedAt: null, committedAt: null }).where(eq(s.businesses.id, B.businessId));
    expect(await resolve("project_page", "sams-draft")).toBeNull();
    await h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z"), isDemo: true }).where(eq(s.businesses.id, B.businessId));
    expect(await resolve("project_page", "sams-draft")).toBeNull();
    await h.db.update(s.businesses).set({ isDemo: false }).where(eq(s.businesses.id, B.businessId));
    expect((await resolve("project_page", "sams-draft"))?.businessId).toBe(B.businessId);

    // A profile that is private, or archived.
    await repos.personProfiles.unpublish(h.db as never, B.ownerId);
    expect(await resolve("person_profile", "sam-lee")).toBeNull();
    await repos.personProfiles.publish(h.db as never, B.ownerId);
    await h.db.update(s.founderProfiles).set({ archivedAt: new Date() }).where(eq(s.founderProfiles.userId, B.ownerId));
    expect(await resolve("person_profile", "sam-lee")).toBeNull();
    await h.db.update(s.founderProfiles).set({ archivedAt: null }).where(eq(s.founderProfiles.userId, B.ownerId));
    expect((await resolve("person_profile", "sam-lee"))?.referrerUserId).toBe(B.ownerId);
  });
});

describe("attributions 0086: what follows what", () => {
  it("the row goes with its account; a referrer or a source business that goes leaves the row", async () => {
    const C = await createBusinessFixture(h, "attr-c");
    const brought = await h.createUser("attr-brought@test.local");
    const gone = await h.createUser("attr-gone@test.local");
    await h.service().run((tx) => repos.attributions.record(tx, brought, { kind: "project_page", ref: "c-page", businessId: C.businessId, referrerUserId: C.ownerId }));
    await h.service().run((tx) => repos.attributions.record(tx, gone, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: B.ownerId }));

    await h.pg.query(`delete from auth.users where id = $1`, [gone]);
    expect(await rows(sql`select 1 from attributions where user_id = ${gone}`)).toEqual([]);

    await h.pg.query(`delete from businesses where id = $1`, [C.businessId]);
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, brought))).toMatchObject({ sourceRef: "c-page", sourceBusinessId: null, referrerUserId: C.ownerId });
    await h.pg.query(`delete from auth.users where id = $1`, [C.ownerId]);
    expect(await h.service().run((tx) => repos.attributions.forUser(tx, brought))).toMatchObject({ sourceKind: "project_page", sourceRef: "c-page", sourceBusinessId: null, referrerUserId: null });
  });
});
