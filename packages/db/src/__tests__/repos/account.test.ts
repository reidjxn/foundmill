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
  adultConfirmed: (await repos.adults.confirmedAt(r.db, userId)) !== null,
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

    // Their "I am 18 or older" (0100) is answered in the same statement.
    await repos.adults.confirm(r.db, founder);
    const expected = await separately(founder);
    expect(expected.adultConfirmed).toBe(true);
    expect(expected.memberships).toHaveLength(3);
    expect(expected.businesses.map((b) => b.id).sort()).toEqual([r.A.businessId, r.B.businessId].sort());
    expect(await repos.founders.account(r.db, founder)).toEqual(expected);
    wire.reset();
    expect(await repos.founders.account(wire.db, founder)).toEqual(expected);
    expect(wire.statements()).toHaveLength(1);
    expect(wire.roundTrips()).toBe(1);
  });

  it("marks a business held through an example membership (0065) as isExample, and only that one", async () => {
    const explorer = await r.h.createUser("explorer@account.test");
    await r.db.insert(s.memberships).values({ businessId: r.B.businessId, userId: explorer, role: "viewer", source: "example" });
    const account = await repos.founders.account(r.db, explorer);
    expect(account.businesses.map((b) => [b.id, b.isExample])).toEqual([[r.B.businessId, true]]);
    expect(await repos.founders.account(wire.db, explorer)).toEqual(account);
    expect((await repos.founders.account(r.db, r.B.ownerId)).businesses.find((b) => b.id === r.B.businessId)?.isExample).toBe(false);
  });

  it("answers no profile and empty lists for an account with nothing yet, and an archived profile reads as none", async () => {
    const nobody = await r.h.createUser("nobody@account.test");
    expect(await repos.founders.account(r.db, nobody)).toEqual({ profile: null, memberships: [], businesses: [], adultConfirmed: false });
    expect(await repos.founders.account(wire.db, nobody)).toEqual({ profile: null, memberships: [], businesses: [], adultConfirmed: false });

    const member = r.A.memberId;
    await repos.founders.upsert(r.db, member, { displayName: "Member" });
    await r.db.update(s.founderProfiles).set({ archivedAt: new Date() }).where(eq(s.founderProfiles.userId, member));
    const expected = await separately(member);
    expect(expected.profile).toBeNull();
    expect(await repos.founders.account(r.db, member)).toEqual(expected);
    expect(await repos.founders.account(wire.db, member)).toEqual(expected);
  });

  it("ownerExperience: the owner memberships.owner picks, joined to their open profile, in one statement", async () => {
    await repos.founders.upsert(r.db, r.A.ownerId, { displayName: "Ada", experience: "Exited" });
    // A co-owner who is not the creator, with a profile of their own: the creator still answers.
    await r.db.update(s.memberships).set({ role: "owner" }).where(eq(s.memberships.userId, r.A.adminId));
    await repos.founders.upsert(r.db, r.A.adminId, { displayName: "Co", experience: "First-time" });
    const twoReads = async (businessId: string) => {
      const owner = await repos.memberships.owner(r.db, businessId);
      return (owner ? await repos.founders.get(r.db, owner.userId) : null)?.experience ?? null;
    };
    expect(await twoReads(r.A.businessId)).toBe("Exited");
    wire.reset();
    expect(await repos.founders.ownerExperience(wire.db, r.A.businessId)).toBe("Exited");
    expect(wire.statements()).toHaveLength(1);
    // An owner without a profile, and a business with no owner at all, read as null.
    expect(await repos.founders.ownerExperience(r.db, r.B.businessId)).toBe(await twoReads(r.B.businessId));
    expect(await repos.founders.ownerExperience(r.db, "00000000-0000-4000-8000-0000000000ff")).toBeNull();
    // Archived profile: as founders.get, none.
    await r.db.update(s.founderProfiles).set({ archivedAt: new Date() }).where(eq(s.founderProfiles.userId, r.A.ownerId));
    expect(await repos.founders.ownerExperience(r.db, r.A.businessId)).toBe(await twoReads(r.A.businessId));
  });
});
