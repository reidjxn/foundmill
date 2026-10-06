/** Tenancy helpers, business/membership bootstrap and withRls plumbing. */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RLS_ROLES, withRls, type Db } from "../../client";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "help-a");
  B = await createBusinessFixture(h, "help-b");
});
afterAll(() => h?.close());

describe("withRls plumbing", () => {
  it("sets the role and the sub claim for the duration of the transaction only", async () => {
    const inside = await h.asUser(A.ownerId).execute<{ role: string; uid: string; claims: string }>(
      sql`select current_user as role, auth.uid()::text as uid, current_setting('request.jwt.claims', true) as claims`,
    );
    expect(inside[0]).toMatchObject({ role: "authenticated", uid: A.ownerId });
    expect(JSON.parse(inside[0]!.claims)).toEqual({ sub: A.ownerId, role: "authenticated" });
    const after = await h.db.execute(sql`select current_user as role, current_setting('request.jwt.claims', true) as claims`);
    const row = (after as unknown as { rows: { role: string; claims: string | null }[] }).rows[0]!;
    expect(row.role).toBe("postgres");
    expect(row.claims ?? "").toBe("");
  });
  it("rejects unknown roles and non-UUID user ids before touching the database", async () => {
    await expect(withRls(h.db as unknown as Db, { userId: A.ownerId, role: "superuser" as never }, async () => 1)).rejects.toThrow(/unknown role/);
    await expect(withRls(h.db as unknown as Db, { userId: "1 or 1=1" }, async () => 1)).rejects.toThrow(/UUID/);
    expect(RLS_ROLES).toEqual(["authenticated", "anon", "service_role"]);
  });
  it("rolls the transaction back when the callback throws", async () => {
    await expect(
      h.asUser(A.ownerId).run(async (tx) => {
        await tx.insert(s.milestones).values({ businessId: A.businessId, kind: "launch", label: "rolled back" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await h.db.select().from(s.milestones).where(eq(s.milestones.label, "rolled back"));
    expect(rows).toHaveLength(0);
  });
});

describe("tenancy helper functions", () => {
  it("is_member / has_role answer for auth.uid()", async () => {
    const r = await h.asUser(A.viewerId).execute<{ m: boolean; w: boolean; mb: boolean }>(
      sql`select is_member(${A.businessId}) as m, has_role(${A.businessId}, array['owner','admin','member']) as w, is_member(${B.businessId}) as mb`,
    );
    expect(r[0]).toEqual({ m: true, w: false, mb: false });
    const anon = await h.anon().execute<{ m: boolean }>(sql`select is_member(${A.businessId}) as m`);
    expect(anon[0]?.m).toBe(false);
  });
  it("is_public is true only for committed, non-archived LIVE businesses", async () => {
    const before = await h.asUser(A.ownerId).execute<{ p: boolean }>(sql`select is_public(${A.businessId}) as p`);
    expect(before[0]?.p).toBe(false);
    await h.db.update(s.businesses).set({ gameMode: "live", committedAt: new Date() }).where(eq(s.businesses.id, A.businessId));
    const after = await h.asUser(B.ownerId).execute<{ p: boolean }>(sql`select is_public(${A.businessId}) as p`);
    expect(after[0]?.p).toBe(true);
    await h.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, A.businessId));
    const archived = await h.asUser(B.ownerId).execute<{ p: boolean }>(sql`select is_public(${A.businessId}) as p`);
    expect(archived[0]?.p).toBe(false);
    await h.db.update(s.businesses).set({ archivedAt: null }).where(eq(s.businesses.id, A.businessId));
  });
});

describe("businesses and memberships", () => {
  it("businesses: a user sees only the businesses they belong to", async () => {
    const seen = await h.asUser(A.memberId).run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(seen.map((b) => b.id)).toEqual([A.businessId]);
  });
  it("businesses: a new user can create a business and bootstrap themselves as its first owner, once", async () => {
    const founder = await h.createUser("founder-new@test.local");
    // The id is generated client-side: RETURNING would need the select policy, which needs the membership.
    const biz = { id: crypto.randomUUID() };
    await h.asUser(founder).run((tx) => tx.insert(s.businesses).values({ id: biz.id, name: "Fresh", slug: "fresh", createdBy: founder }));
    // Not yet a member: cannot read it back...
    expect(await h.asUser(founder).run((tx) => tx.select().from(s.businesses).where(eq(s.businesses.id, biz.id)))).toHaveLength(0);
    // ...but may create the first owner membership for themselves (same transaction in apps/api).
    await h.asUser(founder).run((tx) => tx.insert(s.memberships).values({ businessId: biz.id, userId: founder, role: "owner" }));
    expect(await h.asUser(founder).run((tx) => tx.select().from(s.businesses).where(eq(s.businesses.id, biz.id)))).toHaveLength(1);
    // A stranger cannot repeat the trick on an existing business (it already has members).
    const stranger = await h.createUser("stranger@test.local");
    await expect(h.asUser(stranger).run((tx) => tx.insert(s.memberships).values({ businessId: biz.id, userId: stranger, role: "owner" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(stranger).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: stranger, role: "owner" }))).rejects.toThrow(RLS_DENIED);
    // Nor can someone bootstrap as a non-owner role or for another user.
    const biz2 = { id: crypto.randomUUID() };
    await h.asUser(stranger).run((tx) => tx.insert(s.businesses).values({ id: biz2.id, name: "Fresh 2", slug: "fresh-2", createdBy: stranger }));
    await expect(h.asUser(stranger).run((tx) => tx.insert(s.memberships).values({ businessId: biz2.id, userId: founder, role: "owner" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(stranger).run((tx) => tx.insert(s.memberships).values({ businessId: biz2.id, userId: stranger, role: "admin" }))).rejects.toThrow(RLS_DENIED);
    // RETURNING before the membership exists is refused by the select policy (documented in 0002).
    await expect(
      h.asUser(stranger).run((tx) => tx.insert(s.businesses).values({ name: "Fresh 3", slug: "fresh-3", createdBy: stranger }).returning()),
    ).rejects.toThrow(RLS_DENIED);
  });
  it("businesses: cannot be created on behalf of someone else", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.businesses).values({ name: "Spoof", slug: "spoof", createdBy: B.ownerId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.anon().run((tx) => tx.insert(s.businesses).values({ name: "Anon", slug: "anon" }))).rejects.toThrow(RLS_DENIED);
  });
  it("businesses: only owners/admins update; nobody deletes through app roles", async () => {
    const byMember = await h.asUser(A.memberId).run((tx) => tx.update(s.businesses).set({ name: "Renamed" }).where(eq(s.businesses.id, A.businessId)).returning());
    expect(byMember).toHaveLength(0);
    const byAdmin = await h.asUser(A.adminId).run((tx) => tx.update(s.businesses).set({ name: "Renamed" }).where(eq(s.businesses.id, A.businessId)).returning());
    expect(byAdmin).toHaveLength(1);
    const byB = await h.asUser(B.ownerId).run((tx) => tx.update(s.businesses).set({ name: "Hijack" }).where(eq(s.businesses.id, A.businessId)).returning());
    expect(byB).toHaveLength(0);
    const del = await h.asUser(A.ownerId).run((tx) => tx.delete(s.businesses).where(eq(s.businesses.id, A.businessId)).returning());
    expect(del).toHaveLength(0);
    expect(await h.db.select().from(s.businesses).where(eq(s.businesses.id, A.businessId))).toHaveLength(1);
  });
  it("memberships: owners/admins manage the team; members may only leave; nobody sees other teams", async () => {
    const newcomer = await h.createUser("newcomer@test.local");
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: newcomer, role: "member" }))).rejects.toThrow(RLS_DENIED);
    await h.asUser(A.adminId).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: newcomer, role: "viewer" }));
    const team = await h.asUser(A.viewerId).run((tx) => tx.select({ userId: s.memberships.userId }).from(s.memberships));
    expect(team).toHaveLength(5);
    expect(team.some((m) => m.userId === B.ownerId)).toBe(false);
    const promote = await h.asUser(A.memberId).run((tx) => tx.update(s.memberships).set({ role: "owner" }).where(eq(s.memberships.userId, A.memberId)).returning());
    expect(promote).toHaveLength(0);
    const leave = await h.asUser(newcomer).run((tx) => tx.delete(s.memberships).where(eq(s.memberships.userId, newcomer)).returning());
    expect(leave).toHaveLength(1);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.memberships).values({ businessId: B.businessId, userId: A.ownerId, role: "owner" }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("updated_at and search triggers", () => {
  it("updated_at moves on update", async () => {
    const [before] = await h.db.select().from(s.tasks).where(eq(s.tasks.id, A.taskId));
    await new Promise((r) => setTimeout(r, 5));
    await h.asUser(A.memberId).run((tx) => tx.update(s.tasks).set({ title: "Renamed task" }).where(eq(s.tasks.id, A.taskId)));
    const [after] = await h.db.select().from(s.tasks).where(eq(s.tasks.id, A.taskId));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });
  it("entities.search is maintained by trigger and matches names, aliases and identifiers", async () => {
    const hits = await h.asUser(A.memberId).execute<{ id: string }>(
      sql`select id from entities where business_id = ${A.businessId} and search @@ plainto_tsquery('simple', 'ada')`,
    );
    expect(hits.map((r) => r.id)).toEqual([A.entityId]);
    // The 'simple' parser keeps an email address as one token, so the domain alone finds the organisation
    // (identifiers.domain) and the full address finds the person (identifiers.email).
    const byDomain = await h.asUser(A.memberId).execute<{ id: string }>(
      sql`select id from entities where business_id = ${A.businessId} and search @@ plainto_tsquery('simple', ${`${A.slug}.test`})`,
    );
    expect(byDomain.map((r) => r.id)).toEqual([A.entity2Id]);
    const byEmail = await h.asUser(A.memberId).execute<{ id: string }>(
      sql`select id from entities where business_id = ${A.businessId} and search @@ plainto_tsquery('simple', ${`ada@${A.slug}.test`})`,
    );
    expect(byEmail.map((r) => r.id)).toEqual([A.entityId]);
    // Typo-tolerant name lookup through the pg_trgm GIN index (word similarity: the query is one word of the name).
    const trgm = await h.asUser(A.memberId).execute<{ id: string }>(
      sql`select id from entities where business_id = ${A.businessId} and 'Lovelase' <% display_name order by word_similarity('Lovelase', display_name) desc limit 1`,
    );
    expect(trgm[0]?.id).toBe(A.entityId);
  });
});
