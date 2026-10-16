/**
 * `repos.founders.account` (founder.profile.get): the profile, the memberships and the open businesses in one statement,
 * answering exactly what the three reads it replaced answer, in one round trip on the wire.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createWireDb, type WireDb } from "../../testing/wire";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
let wire: WireDb;
beforeAll(async () => {
  r = await setupRepoHarness("account");
  wire = await createWireDb(r.h.pg);
}, 120_000);
afterAll(async () => {
  await wire?.close();
  await r?.close();
});

const separately = async (userId: string) => ({
  profile: await repos.founders.get(r.db, userId),
  memberships: await repos.memberships.listForUser(r.db, userId),
  businesses: await repos.businesses.listForUser(r.db, userId),
});

describe("repos.founders.account", () => {
  it("answers what founders.get, memberships.listForUser and businesses.listForUser answer, in one round trip", async () => {
    // A's owner also holds B (as admin) and a third business that is then archived: its membership is listed, the
    // business is not. The profile carries every kind of column (json, arrays, numbers, dates).
    const founder = r.A.ownerId;
    await r.db.insert(s.memberships).values({ businessId: r.B.businessId, userId: founder, role: "admin", sectionPermissions: { finance: "read" } });
    const [archived] = await r.db.insert(s.businesses).values({ name: "Archived Co", slug: "account-archived", createdBy: founder, archetype: "b2b_saas" }).returning({ id: s.businesses.id });
    await r.db.insert(s.memberships).values({ businessId: archived!.id, userId: founder, role: "owner" });
    await r.db.update(s.businesses).set({ archivedAt: new Date() }).where(eq(s.businesses.id, archived!.id));
    await repos.founders.upsert(r.db, founder, { displayName: "Ada O'Hara", experience: "Two exits", skills: { sales: 14, code: 9 }, budgetMinor: 250000, currency: "GBP", targetMarkets: ["UK", "US, East"], constraints: ['No "cold" calls'], visibility: "connections" });

    const expected = await separately(founder);
    expect(expected.memberships).toHaveLength(3);
    expect(expected.businesses.map((b) => b.id).sort()).toEqual([r.A.businessId, r.B.businessId].sort());
    expect(await repos.founders.account(r.db, founder)).toEqual(expected);
    wire.reset();
    expect(await repos.founders.account(wire.db, founder)).toEqual(expected);
    expect(wire.statements()).toHaveLength(1);
    expect(wire.roundTrips()).toBe(1);
  });

  it("answers no profile and empty lists for an account with nothing yet, and an archived profile reads as none", async () => {
    const nobody = await r.h.createUser("nobody@account.test");
    expect(await repos.founders.account(r.db, nobody)).toEqual({ profile: null, memberships: [], businesses: [] });
    expect(await repos.founders.account(wire.db, nobody)).toEqual({ profile: null, memberships: [], businesses: [] });

    const member = r.A.memberId;
    await repos.founders.upsert(r.db, member, { displayName: "Member" });
    await r.db.update(s.founderProfiles).set({ archivedAt: new Date() }).where(eq(s.founderProfiles.userId, member));
    const expected = await separately(member);
    expect(expected.profile).toBeNull();
    expect(await repos.founders.account(r.db, member)).toEqual(expected);
    expect(await repos.founders.account(wire.db, member)).toEqual(expected);
  });
});
