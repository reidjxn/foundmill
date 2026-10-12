/**
 * 0026_membership_guards: ownership stays with owners (audit DB-02 / SECX-4 / ARB-03). An admin can neither demote the
 * owner nor mint owners, nobody edits their own row, and a business always keeps at least one owner, also through the
 * service connection; deleting the business or the owner's account still cascades.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "guard-a");
  B = await createBusinessFixture(h, "guard-b");
});
afterAll(() => h?.close());

const KEEP_OWNER = /at least one owner/;
/** The database error's own message, looking through Drizzle's "Failed query" wrapper. */
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (err) {
    const messages: string[] = [];
    for (let e: unknown = err; e && typeof e === "object" && messages.length < 4; e = (e as { cause?: unknown }).cause) messages.push(String((e as { message?: unknown }).message ?? ""));
    return messages.join(" | ");
  }
};
const roleOf = async (businessId: string, userId: string) => (await h.db.select({ role: s.memberships.role }).from(s.memberships).where(and(eq(s.memberships.businessId, businessId), eq(s.memberships.userId, userId))))[0]?.role ?? null;
const row = (businessId: string, userId: string) => and(eq(s.memberships.businessId, businessId), eq(s.memberships.userId, userId));

describe("memberships: only owners manage owners", () => {
  it("an admin cannot demote the owner, rewrite the owner's permissions or remove the owner", async () => {
    const demote = await h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ role: "viewer" }).where(row(A.businessId, A.ownerId)).returning());
    expect(demote).toHaveLength(0);
    const walls = await h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ sectionPermissions: { billing: "none" } }).where(row(A.businessId, A.ownerId)).returning());
    expect(walls).toHaveLength(0);
    const removed = await h.asUser(A.adminId).run((tx) => tx.delete(s.memberships).where(row(A.businessId, A.ownerId)).returning());
    expect(removed).toHaveLength(0);
    expect(await roleOf(A.businessId, A.ownerId)).toBe("owner");
  });

  it("an admin cannot grant ownership, by update or by insert", async () => {
    await expect(h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ role: "owner" }).where(row(A.businessId, A.memberId)))).rejects.toThrow(RLS_DENIED);
    const newcomer = await h.createUser("guard-newcomer@test.local");
    await expect(h.asUser(A.adminId).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: newcomer, role: "owner" }))).rejects.toThrow(RLS_DENIED);
    expect(await roleOf(A.businessId, A.memberId)).toBe("member");
    expect(await roleOf(A.businessId, newcomer)).toBeNull();
  });

  it("an admin still manages everyone but owners", async () => {
    const changed = await h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ role: "advisor", sectionPermissions: { finance: "none" } }).where(row(A.businessId, A.viewerId)).returning());
    expect(changed).toHaveLength(1);
    await h.db.update(s.memberships).set({ role: "viewer", sectionPermissions: {} }).where(row(A.businessId, A.viewerId));
  });

  it("nobody changes their own role or section permissions, not even an owner", async () => {
    const adminSelf = await h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ sectionPermissions: { finance: "write" } }).where(row(A.businessId, A.adminId)).returning());
    expect(adminSelf).toHaveLength(0);
    const memberSelf = await h.asUser(A.memberId).run((tx) => tx.update(s.memberships).set({ role: "admin" }).where(row(A.businessId, A.memberId)).returning());
    expect(memberSelf).toHaveLength(0);
    const ownerSelf = await h.asUser(A.ownerId).run((tx) => tx.update(s.memberships).set({ role: "admin" }).where(row(A.businessId, A.ownerId)).returning());
    expect(ownerSelf).toHaveLength(0);
    expect(await roleOf(A.businessId, A.ownerId)).toBe("owner");
  });

  it("an owner grants ownership and demotes another owner while one remains", async () => {
    const granted = await h.asUser(A.ownerId).run((tx) => tx.update(s.memberships).set({ role: "owner" }).where(row(A.businessId, A.memberId)).returning());
    expect(granted).toHaveLength(1);
    const demoted = await h.asUser(A.ownerId).run((tx) => tx.update(s.memberships).set({ role: "member" }).where(row(A.businessId, A.memberId)).returning());
    expect(demoted).toHaveLength(1);
    expect(await roleOf(A.businessId, A.memberId)).toBe("member");
  });

  it("no cross-tenant reach: B's owner changes nothing in A", async () => {
    const hijack = await h.asUser(B.ownerId).run((tx) => tx.update(s.memberships).set({ role: "viewer" }).where(eq(s.memberships.businessId, A.businessId)).returning());
    expect(hijack).toHaveLength(0);
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: B.ownerId, role: "admin" }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("memberships: a business always keeps an owner", () => {
  it("the sole owner cannot leave, and the service connection cannot demote or delete them", async () => {
    expect(await failure(h.asUser(A.ownerId).run((tx) => tx.delete(s.memberships).where(row(A.businessId, A.ownerId))))).toMatch(KEEP_OWNER);
    expect(await failure(h.service().run((tx) => tx.update(s.memberships).set({ role: "admin" }).where(row(A.businessId, A.ownerId))))).toMatch(KEEP_OWNER);
    expect(await failure(h.db.delete(s.memberships).where(row(A.businessId, A.ownerId)))).toMatch(KEEP_OWNER);
    expect(await roleOf(A.businessId, A.ownerId)).toBe("owner");
  });

  it("one statement that drops every owner at once is refused; dropping one of two is fine", async () => {
    await h.db.update(s.memberships).set({ role: "owner" }).where(row(A.businessId, A.adminId));
    expect(await failure(h.db.update(s.memberships).set({ role: "member" }).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.role, "owner"))))).toMatch(KEEP_OWNER);
    // A second owner may leave on their own.
    const left = await h.asUser(A.adminId).run((tx) => tx.delete(s.memberships).where(row(A.businessId, A.adminId)).returning());
    expect(left).toHaveLength(1);
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: A.adminId, role: "admin" });
  });

  it("the repos say so in words: setRole and remove keep the last owner, add never overwrites", async () => {
    const db = h.db as unknown as Db;
    await expect(repos.memberships.setRole(db, A.businessId, A.ownerId, "viewer")).rejects.toThrow(KEEP_OWNER);
    await expect(repos.memberships.remove(db, A.businessId, A.ownerId)).rejects.toThrow(KEEP_OWNER);
    await expect(repos.memberships.add(db, A.businessId, { userId: A.ownerId, role: "viewer" })).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(repos.memberships.add(db, A.businessId, { userId: A.memberId, role: "admin", sectionPermissions: { finance: "none" } })).rejects.toMatchObject({ status: 409 });
    expect(await roleOf(A.businessId, A.ownerId)).toBe("owner");
    expect((await repos.memberships.get(db, A.businessId, A.memberId))?.sectionPermissions).toEqual({});
  });

  it("deleting the business or the owner's account still cascades", async () => {
    const founder = await h.createUser("guard-founder@test.local");
    const [biz] = await h.db.insert(s.businesses).values({ name: "Short lived", slug: "short-lived", createdBy: founder }).returning({ id: s.businesses.id });
    await h.db.insert(s.memberships).values({ businessId: biz!.id, userId: founder, role: "owner" });
    await h.db.delete(s.businesses).where(eq(s.businesses.id, biz!.id));
    expect(await h.db.select().from(s.memberships).where(eq(s.memberships.businessId, biz!.id))).toHaveLength(0);

    const [biz2] = await h.db.insert(s.businesses).values({ name: "Orphaned", slug: "orphaned", createdBy: A.ownerId }).returning({ id: s.businesses.id });
    await h.db.insert(s.memberships).values({ businessId: biz2!.id, userId: founder, role: "owner" });
    await h.db.execute(sql`delete from auth.users where id = ${founder}`);
    expect(await h.db.select().from(s.memberships).where(eq(s.memberships.businessId, biz2!.id))).toHaveLength(0);
  });
});
