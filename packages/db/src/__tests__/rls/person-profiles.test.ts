/**
 * 0080 — a person's own public profile (columns on `founder_profiles`) and the view `public_person_profiles`.
 *
 *   - tenancy: the row stays its owner's (0002 `founder_profiles_own`): nobody else reads or writes it, anon never;
 *   - going public, and changing what a public profile shows, is the api's (service role): a signed-in client writing
 *     straight to the table cannot, while it can still take its profile down and edit it while it is private;
 *   - the database checks the new fields' shape and the handle's rule and uniqueness itself;
 *   - the view: exactly its ten columns; no row for a private, archived or handle-less profile; every private field
 *     (email, residence, citizenship, budget, skills, experience, time, constraints, risk, visibility, ids) stays out,
 *     with values planted to prove it; project pages listed only where the person is an owner and the page names its
 *     founders; readable by the service role only (anon and signed-in clients are refused);
 *   - a display name a published page shows changes only through the api;
 *   - a handle a person leaves stays theirs for 90 days (`person_handle_releases`, service role only).
 */
import { PAGE_RESERVED_SLUGS, PERSON_HANDLE_TAKEN, type PersonProfileContent, type ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { repos } from "../../repos";
import * as s from "../../schema";
import { PUBLIC_PERSON_PROFILE_COLUMNS } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const PRIVATE_MARKERS = {
  experience: "PRIVATE-EXPERIENCE-marker",
  timeCommitment: "PRIVATE-TIME-marker",
  citizenship: "PRIVATE-CITIZENSHIP-marker",
  residence: "PRIVATE-RESIDENCE-marker",
  riskAppetite: "PRIVATE-RISK-marker",
  targetMarkets: ["PRIVATE-MARKET-marker"],
  constraints: ["PRIVATE-CONSTRAINT-marker"],
  skills: { finance: 17 },
  budgetMinor: 4_242_424,
} as const;

const profile = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker who wants to sell online", about: "I bake bread.\n\nI want to learn selling.", strengths: ["Baking", "Talking to people"], wantsToLearn: ["Selling"], lookingFor: "open_to_people", place: "Leeds, UK", ...over });
const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bread by bike", about: "Fresh bread delivered.", forWhom: "", stage: "building", showFounders: true, followForm: false, ...over });

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
const publicHandles = async (runner = h.service()) => (await runner.execute<{ handle: string }>(sql`select handle from public_person_profiles order by handle`)).map((r) => r.handle);

/**
 * A founder profile written as the api writes it (service role), with private values planted. The api creates a
 * profile only for a person who confirmed they are 18 or older (0100), so the confirmation comes first.
 */
async function makeProfile(userId: string, displayName: string, options: { adult?: boolean } = {}) {
  if (options.adult !== false) await repos.adults.confirm(h.db as never, userId);
  await repos.founders.upsert(h.db as never, userId, { displayName, ...PRIVATE_MARKERS, targetMarkets: [...PRIVATE_MARKERS.targetMarkets], constraints: [...PRIVATE_MARKERS.constraints], skills: { ...PRIVATE_MARKERS.skills }, currency: "GBP", visibility: "public" });
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "person-a");
  B = await createBusinessFixture(h, "person-b");
  outsiderId = await h.createUser("person-outsider@test.local");
  await commit(A.businessId);
  await commit(B.businessId);
  await makeProfile(A.ownerId, "Maya Okafor");
  await makeProfile(B.ownerId, "Sam Lee");
  // B's owner is public before any test: every cross-account case has something to reach for.
  await repos.personProfiles.save(h.db as never, B.ownerId, { handle: "sam-lee", content: profile({ headline: "Sam's headline" }) });
  await repos.personProfiles.publish(h.db as never, B.ownerId);
}, 120_000);
afterAll(() => h?.close());

describe("founder_profiles 0080: the row stays its owner's", () => {
  it("nobody else reads or writes a person's profile fields, anon never", async () => {
    expect(await h.asUser(A.ownerId).run((tx) => repos.personProfiles.get(tx, B.ownerId))).toBeNull();
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.founderProfiles))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.founderProfiles)));
    for (const userId of [A.ownerId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.founderProfiles).set({ headline: "Taken over" }).where(eq(s.founderProfiles.userId, B.ownerId)).returning({ id: s.founderProfiles.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.founderProfiles).set({ public: false }).where(eq(s.founderProfiles.userId, B.ownerId)).returning({ id: s.founderProfiles.id })));
    }
    expect((await repos.personProfiles.get(h.db as never, B.ownerId))).toMatchObject({ public: true, content: { headline: "Sam's headline" } });
  });

  it("the owner edits a private profile directly, but cannot make it public or change a public one without the api", async () => {
    // Private: the owner's own client may edit it.
    const saved = await h.asUser(A.ownerId).run((tx) => repos.personProfiles.save(tx, A.ownerId, { handle: "maya-okafor", content: profile() }));
    expect(saved).toMatchObject({ handle: "maya-okafor", public: false, publishedAt: null, content: profile() });
    // Going public straight through the table is refused, whichever way it is written.
    await expect(h.asUser(A.ownerId).run((tx) => repos.personProfiles.publish(tx, A.ownerId))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.founderProfiles).set({ public: true, publishedAt: new Date() }).where(eq(s.founderProfiles.userId, A.ownerId)))).rejects.toThrow(RLS_DENIED);
    expect(await publicHandles()).not.toContain("maya-okafor");

    // The api publishes; now the owner's own client cannot change what the public sees...
    await repos.personProfiles.publish(h.db as never, A.ownerId, { at: new Date("2026-10-07T12:00:00Z") });
    expect(await publicHandles()).toContain("maya-okafor");
    for (const set of [{ headline: "Changed behind the screen" }, { about: "call me 555 123 4567" }, { handle: "maya-two" }, { displayName: "Someone Else" }, { strengths: ["x"] }, { place: "Elsewhere" }, { lookingFor: "looking_to_join" as const }, { publishedAt: new Date() }]) {
      await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.founderProfiles).set(set).where(eq(s.founderProfiles.userId, A.ownerId))), JSON.stringify(set)).rejects.toThrow(RLS_DENIED);
    }
    // ...but can still edit what is private and take the profile down.
    await h.asUser(A.ownerId).run((tx) => tx.update(s.founderProfiles).set({ riskAppetite: "low" }).where(eq(s.founderProfiles.userId, A.ownerId)));
    const down = await h.asUser(A.ownerId).run((tx) => repos.personProfiles.unpublish(tx, A.ownerId));
    expect(down).toMatchObject({ public: false });
    expect(down?.publishedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(await publicHandles()).not.toContain("maya-okafor");
    expect(await h.asUser(A.ownerId).run((tx) => repos.personProfiles.unpublish(tx, A.ownerId))).toBeNull();
  });

  it("publishing again keeps the first date only while it stays public", async () => {
    const first = await repos.personProfiles.publish(h.db as never, A.ownerId, { at: new Date("2026-10-08T12:00:00Z") });
    expect(first.publishedAt?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    const again = await repos.personProfiles.publish(h.db as never, A.ownerId, { at: new Date("2026-10-09T12:00:00Z") });
    expect(again.publishedAt?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    await repos.personProfiles.unpublish(h.db as never, A.ownerId);
  });
});

describe("founder_profiles 0080: what the database itself refuses", () => {
  it("a handle outside the rule, a reserved one, or one another person holds", async () => {
    const set = (handle: string) => h.pg.query(`update founder_profiles set handle = $1 where user_id = $2`, [handle, A.ownerId]);
    for (const bad of ["ab", "x".repeat(41), "-abc", "abc-", "Abc", "a_b", "a b"]) await expect(set(bad), bad).rejects.toThrow(/founder_profiles_handle_format/);
    for (const reserved of PAGE_RESERVED_SLUGS.filter((r) => r.length >= 3)) await expect(set(reserved), reserved).rejects.toThrow(/founder_profiles_handle_reserved/);
    await expect(repos.personProfiles.save(h.db as never, A.ownerId, { handle: "sam-lee", content: profile() })).rejects.toThrow(PERSON_HANDLE_TAKEN);
    expect(await repos.personProfiles.handleTaken(h.db as never, A.ownerId, "sam-lee")).toBe(true);
    expect(await repos.personProfiles.handleTaken(h.db as never, B.ownerId, "sam-lee")).toBe(false);
    // The repo refuses a bad handle first.
    await expect(repos.personProfiles.save(h.db as never, A.ownerId, { handle: "login", content: profile() })).rejects.toThrow(/Invalid public profile/);
  });

  it("the migration's reserved list is the shared list", () => {
    const migration = readMigrations().find((m) => m.tag === "0080_person_profiles")!.sql;
    const block = /check \(handle not in \(([\s\S]*?)\)\)/.exec(migration)?.[1] ?? "";
    const inSql = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect([...inSql].sort()).toEqual([...PAGE_RESERVED_SLUGS].sort());
  });

  it("fields over their limits, and a public profile without a handle", async () => {
    const id = A.ownerId;
    const q = (setSql: string, value: unknown) => h.pg.query(`update founder_profiles set ${setSql} where user_id = $2`, [value, id]);
    await expect(q("headline = $1", "x".repeat(81)), "headline").rejects.toThrow(/founder_profiles_headline_shape/);
    await expect(q("headline = $1", "two\nlines"), "headline lines").rejects.toThrow(/founder_profiles_headline_shape/);
    await expect(q("about = $1", "x".repeat(601)), "about").rejects.toThrow(/founder_profiles_about_shape/);
    await expect(q("place = $1", "x".repeat(61)), "place").rejects.toThrow(/founder_profiles_place_shape/);
    await expect(q("strengths = $1", Array.from({ length: 9 }, (_, i) => `t${i}`)), "nine tags").rejects.toThrow(/founder_profiles_strengths_shape/);
    await expect(q("strengths = $1", ["x".repeat(31)]), "long tag").rejects.toThrow(/founder_profiles_strengths_shape/);
    await expect(q("wants_to_learn = $1", [""]), "empty tag").rejects.toThrow(/founder_profiles_wants_to_learn_shape/);
    await expect(q("looking_for = $1", "hiring"), "looking for").rejects.toThrow(/founder_profiles_looking_for_value/);
    const c = await h.createUser("person-nohandle@test.local");
    await makeProfile(c, "No Handle");
    await expect(h.pg.query(`update founder_profiles set public = true, published_at = now() where user_id = $1`, [c])).rejects.toThrow(/founder_profiles_public_ready/);
    await expect(repos.personProfiles.publish(h.db as never, c)).rejects.toThrow(/not found/);
  });
});

describe("public_person_profiles: what anyone may read", () => {
  it("exposes exactly its ten columns, and no private field travels with a row", async () => {
    const columns = (await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_person_profiles' order by ordinal_position`)).map((r) => r.column_name);
    expect(columns).toEqual([...PUBLIC_PERSON_PROFILE_COLUMNS]);
    expect(columns).toEqual(["handle", "display_name", "headline", "about", "strengths", "wants_to_learn", "looking_for", "place", "published_at", "projects"]);
    const row = (await h.service().execute<Record<string, unknown>>(sql`select * from public_person_profiles where handle = 'sam-lee'`))[0]!;
    expect(Object.keys(row).sort()).toEqual([...PUBLIC_PERSON_PROFILE_COLUMNS].sort());
    for (const leaked of ["id", "user_id", "email", "experience", "skills", "time_commitment", "budget_minor", "currency", "citizenship", "residence", "target_markets", "constraints", "risk_appetite", "visibility", "public", "archived_at", "created_at", "updated_at"]) expect(row).not.toHaveProperty(leaked);
    expect(row).toMatchObject({ handle: "sam-lee", display_name: "Sam Lee", headline: "Sam's headline", strengths: ["Baking", "Talking to people"], wants_to_learn: ["Selling"], looking_for: "open_to_people", place: "Leeds, UK", projects: [] });
    // The planted private values appear nowhere in what the view gives, nor the account's email or id.
    const all = JSON.stringify(await h.service().execute(sql`select * from public_person_profiles`));
    for (const marker of [...Object.values(PRIVATE_MARKERS).flat().map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))), "4242424", "test.local", B.ownerId, A.ownerId, "GBP"]) expect(all, String(marker)).not.toContain(String(marker).replace(/^\{|\}$/g, ""));
  });

  it("the service connection reads it; anon and signed-in clients are refused, and nobody writes it", async () => {
    expect(await publicHandles(h.service())).toContain("sam-lee");
    for (const runner of [h.anon(), h.asUser(outsiderId), h.asUser(B.ownerId)]) {
      await expect(runner.execute(sql`select handle from public_person_profiles`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`select * from public_person_profiles where handle = 'sam-lee'`)).rejects.toThrow(/permission denied/);
    }
    const grants = await rows<{ grantee: string; privilege_type: string }>(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'public_person_profiles' and grantee <> 'postgres'`);
    expect(grants).toEqual([{ grantee: "service_role", privilege_type: "SELECT" }]);
    await expect(h.anon().execute(sql`update public_person_profiles set headline = 'x'`)).rejects.toThrow();
    await expect(h.asUser(B.ownerId).execute(sql`delete from public_person_profiles`)).rejects.toThrow();
    await expect(h.service().execute(sql`update public_person_profiles set headline = 'x'`)).rejects.toThrow();
    expect((await h.service().run((tx) => repos.personProfiles.public.byHandle(tx, "sam-lee")))?.content.headline).toBe("Sam's headline");
    expect((await repos.personProfiles.public.byHandle(h.db as never, "sam-lee"))?.content.headline).toBe("Sam's headline");
  });

  it("a private profile, an archived one and an unknown handle expose nothing", async () => {
    const p = await h.createUser("person-private@test.local");
    await makeProfile(p, "Pat Private");
    await repos.personProfiles.save(h.db as never, p, { handle: "pat-private", content: profile({ headline: "PAT-PRIVATE-headline" }) });
    expect(await publicHandles()).not.toContain("pat-private");
    expect(await repos.personProfiles.public.byHandle(h.db as never, "pat-private")).toBeNull();
    const everything = JSON.stringify(await h.service().execute(sql`select * from public_person_profiles`));
    expect(everything).not.toContain("PAT-PRIVATE-headline");

    await repos.personProfiles.publish(h.db as never, p);
    expect(await publicHandles()).toContain("pat-private");
    await h.db.update(s.founderProfiles).set({ archivedAt: new Date() }).where(eq(s.founderProfiles.userId, p));
    expect(await publicHandles()).not.toContain("pat-private");
    expect(await repos.personProfiles.public.byHandle(h.db as never, "pat-private")).toBeNull();

    expect(await repos.personProfiles.public.byHandle(h.db as never, "no-such-person")).toBeNull();
    expect(await repos.personProfiles.public.byHandle(h.db as never, "Not A Handle")).toBeNull();
    expect(await repos.personProfiles.public.byHandle(h.db as never, "")).toBeNull();
  });

  it("0100: a public profile reads as public only once its person confirmed they are 18 or older", async () => {
    const p = await h.createUser("person-unconfirmed@test.local");
    // A profile from before sign-up asked: public, published, with no confirmation on record.
    await makeProfile(p, "Uma Unconfirmed", { adult: false });
    await repos.personProfiles.save(h.db as never, p, { handle: "uma-unconfirmed", content: profile({ headline: "UMA-headline" }) });
    await repos.personProfiles.publish(h.db as never, p);
    expect(await publicHandles()).not.toContain("uma-unconfirmed");
    expect(await repos.personProfiles.public.byHandle(h.db as never, "uma-unconfirmed")).toBeNull();
    expect(JSON.stringify(await h.service().execute(sql`select * from public_person_profiles`))).not.toContain("UMA-headline");
    // Confirmed: public as published, with nothing to publish again.
    await repos.adults.confirm(h.db as never, p);
    expect(await publicHandles()).toContain("uma-unconfirmed");
    expect((await repos.personProfiles.public.byHandle(h.db as never, "uma-unconfirmed"))?.content.headline).toBe("UMA-headline");
  });

  it("lists a project page only where the person owns it and the published page names its founders", async () => {
    const projects = async () => (await h.service().execute<{ projects: unknown }>(sql`select projects from public_person_profiles where handle = 'sam-lee'`))[0]?.projects;
    // B's page, published without naming the founders: not listed.
    await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: page({ showFounders: false }), slug: "bread-by-bike", userId: B.ownerId }));
    expect(await projects()).toEqual([]);
    expect(await repos.personProfiles.projectsShown(h.db as never, B.ownerId)).toEqual([]);
    // Named: listed (slug, name, pitch only).
    await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: page(), slug: "bread-by-bike", userId: B.ownerId }));
    expect(await projects()).toEqual([{ slug: "bread-by-bike", name: "PERSON-B", pitch: "Bread by bike" }]);
    expect(await repos.personProfiles.projectsShown(h.db as never, B.ownerId)).toEqual([{ slug: "bread-by-bike", name: "PERSON-B", pitch: "Bread by bike" }]);

    // A business where Sam is only a member, whose page names its founders: never listed for Sam.
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: B.ownerId, role: "member" });
    await h.service().run((tx) => repos.pages.publish(tx, A.businessId, { content: page({ pitch: "Maya's project" }), slug: "mayas-project", userId: A.ownerId }));
    expect(((await projects()) as { slug: string }[]).map((p) => p.slug)).toEqual(["bread-by-bike"]);

    // Taken down, or the business archived: gone from the profile too.
    await h.service().run((tx) => repos.pages.unpublish(tx, B.businessId, { userId: B.ownerId }));
    expect(await projects()).toEqual([]);
    await h.service().run((tx) => repos.pages.publish(tx, B.businessId, { content: page(), slug: "bread-by-bike", userId: B.ownerId }));
    await h.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, B.businessId));
    expect(await projects()).toEqual([]);
    await h.db.update(s.businesses).set({ archivedAt: null }).where(eq(s.businesses.id, B.businessId));
    // A person who is private shows none of it: their row is gone, projects and all.
    await repos.personProfiles.unpublish(h.db as never, B.ownerId);
    expect(await projects()).toBeUndefined();
    await repos.personProfiles.publish(h.db as never, B.ownerId);
  });
});

describe("founder_profiles 0080: a name a public page shows", () => {
  it("the owner's own client cannot change it while a published page names them; the service connection can", async () => {
    const C = await createBusinessFixture(h, "person-c");
    await commit(C.businessId);
    await makeProfile(C.ownerId, "Cleo Hart");
    const rename = (name: string) => h.asUser(C.ownerId).run((tx) => tx.update(s.founderProfiles).set({ displayName: name }).where(eq(s.founderProfiles.userId, C.ownerId)).returning({ name: s.founderProfiles.displayName }));
    // No page yet: the person's own client may rename a private profile.
    expect(await rename("Cleo H")).toEqual([{ name: "Cleo H" }]);
    // A page that does not name its founders: still free.
    await h.service().run((tx) => repos.pages.publish(tx, C.businessId, { content: page({ showFounders: false }), slug: "cleo-page", userId: C.ownerId }));
    expect(await rename("Cleo Hart")).toEqual([{ name: "Cleo Hart" }]);
    // Named on the published page: refused straight through the table, whatever the name.
    await h.service().run((tx) => repos.pages.publish(tx, C.businessId, { content: page(), slug: "cleo-page", userId: C.ownerId }));
    await expect(rename("cleo@example.com")).rejects.toThrow(RLS_DENIED);
    await expect(rename("Cleo Two")).rejects.toThrow(RLS_DENIED);
    // Other private fields stay the person's to edit.
    await h.asUser(C.ownerId).run((tx) => tx.update(s.founderProfiles).set({ riskAppetite: "high" }).where(eq(s.founderProfiles.userId, C.ownerId)));
    // The api (service role) may, after its own screen.
    await repos.founders.update(h.db as never, C.ownerId, { displayName: "Cleo Hart-Lee" });
    expect((await repos.pages.public.bySlug(h.db as never, "cleo-page"))?.founderNames).toEqual(["Cleo Hart-Lee"]);
    // Taken down: free again.
    await h.service().run((tx) => repos.pages.unpublish(tx, C.businessId, { userId: C.ownerId }));
    expect(await rename("Cleo Hart")).toEqual([{ name: "Cleo Hart" }]);
  });

  it("a display name with a bidi control is refused", async () => {
    const d = await h.createUser("person-bidi@test.local");
    await expect(repos.founders.upsert(h.db as never, d, { displayName: "Ana\u202emoc.elpmaxe" })).rejects.toThrow(/direction of the text/);
    await makeProfile(d, "Ana Bidi");
    await expect(repos.founders.update(h.db as never, d, { displayName: "Ana\u2066Bidi" })).rejects.toThrow(/direction of the text/);
    expect((await repos.founders.get(h.db as never, d))?.displayName).toBe("Ana Bidi");
  });
});

describe("person_handle_releases 0080: a handle a person leaves stays theirs for 90 days", () => {
  let first: string;
  let second: string;
  beforeAll(async () => {
    first = await h.createUser("person-release-a@test.local");
    second = await h.createUser("person-release-b@test.local");
    await makeProfile(first, "Rio Vance");
    await makeProfile(second, "Rio Vale");
  });

  it("A renames; B cannot take A's old handle, through the repo or straight through the table; A can take it back", async () => {
    await repos.personProfiles.save(h.db as never, first, { handle: "rio-v", content: profile() });
    await repos.personProfiles.save(h.db as never, first, { handle: "rio-vance", content: profile() });
    const released = await rows<{ handle: string; user_id: string }>(sql`select handle, user_id from person_handle_releases where handle = 'rio-v'`);
    expect(released).toEqual([{ handle: "rio-v", user_id: first }]);

    expect(await repos.personProfiles.handleTaken(h.db as never, second, "rio-v")).toBe(true);
    expect(await repos.personProfiles.handleTaken(h.db as never, first, "rio-v")).toBe(false);
    await expect(repos.personProfiles.save(h.db as never, second, { handle: "rio-v", content: profile() })).rejects.toThrow(PERSON_HANDLE_TAKEN);
    // B's own client, while B's profile is private (the guard allows edits then): refused by the database too.
    await expect(h.asUser(second).run((tx) => tx.update(s.founderProfiles).set({ handle: "rio-v" }).where(eq(s.founderProfiles.userId, second)))).rejects.toThrow(/founder_profiles_handle_key|duplicate key/);
    expect((await repos.personProfiles.get(h.db as never, second))?.handle).toBeNull();

    // A takes it back: the release is forgotten, and the handle A left in turn is kept for A.
    await repos.personProfiles.save(h.db as never, first, { handle: "rio-v", content: profile() });
    expect(await rows(sql`select 1 from person_handle_releases where handle = 'rio-v'`)).toEqual([]);
    expect(await repos.personProfiles.handleTaken(h.db as never, second, "rio-vance")).toBe(true);
  });

  it("after 90 days, B can take it", async () => {
    await h.pg.query(`update person_handle_releases set released_at = now() - interval '89 days' where handle = 'rio-vance'`);
    expect(await repos.personProfiles.handleTaken(h.db as never, second, "rio-vance")).toBe(true);
    await h.pg.query(`update person_handle_releases set released_at = now() - interval '91 days' where handle = 'rio-vance'`);
    expect(await repos.personProfiles.handleTaken(h.db as never, second, "rio-vance")).toBe(false);
    const taken = await repos.personProfiles.save(h.db as never, second, { handle: "rio-vance", content: profile() });
    expect(taken.handle).toBe("rio-vance");
  });

  it("is the service role's only: no client role reads or writes it", async () => {
    expect((await h.service().execute(sql`select handle from person_handle_releases`)).length).toBeGreaterThan(0);
    for (const runner of [h.anon(), h.asUser(first), h.asUser(second)]) {
      await expect(runner.execute(sql`select handle from person_handle_releases`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`insert into person_handle_releases (handle, user_id) values ('squat-this', ${first})`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`delete from person_handle_releases`)).rejects.toThrow(/permission denied/);
    }
    const grants = await rows<{ grantee: string }>(sql`select distinct grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = 'person_handle_releases' and grantee <> 'postgres'`);
    expect(grants.map((g) => g.grantee)).toEqual(["service_role"]);
  });

  it("an account's releases go with the account", async () => {
    const gone = await h.createUser("person-release-gone@test.local");
    await makeProfile(gone, "Gone Soon");
    await repos.personProfiles.save(h.db as never, gone, { handle: "gone-soon", content: profile() });
    await repos.personProfiles.save(h.db as never, gone, { handle: "gone-later", content: profile() });
    expect(await rows(sql`select 1 from person_handle_releases where user_id = ${gone}`)).toHaveLength(1);
    await h.pg.query(`delete from auth.users where id = $1`, [gone]);
    expect(await rows(sql`select 1 from person_handle_releases where user_id = ${gone}`)).toEqual([]);
  });
});
