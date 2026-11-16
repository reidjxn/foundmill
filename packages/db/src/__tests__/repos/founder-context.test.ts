/**
 * `repos.founders.contextFor` (WP-04 T10): who the Chief of Staff and the Composer are talking with. The person's own
 * profile, the other founders' first names, nulls and "not_said" for what nobody filled in, and nothing of another
 * business, in one statement.
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
  r = await setupRepoHarness("founder_context");
  wire = await createWireDb(r.h.pg);
}, 120_000);
afterAll(async () => {
  await wire?.close();
  await r?.close();
});

describe("repos.founders.contextFor", () => {
  it("reads a solo founder's own profile, with nothing about other people", async () => {
    await repos.founders.upsert(r.db, r.A.ownerId, { displayName: "Maya Lopez", experience: "first_time", budgetMinor: 0 });
    await r.db.update(s.founderProfiles).set({ strengths: ["Design", "Writing"], wantsToLearn: ["Selling"] }).where(eq(s.founderProfiles.userId, r.A.ownerId));
    wire.reset();
    const ctx = await repos.founders.contextFor(wire.db, r.A.businessId, r.A.ownerId);
    expect(wire.statements()).toHaveLength(1);
    expect(ctx).toEqual({ firstName: "Maya", experience: "first_time", strengths: ["Design", "Writing"], wantsToLearn: ["Selling"], lookingFor: "on_my_own", budget: "none", others: [] });
    // Without a person: the primary owner.
    expect(await repos.founders.contextFor(r.db, r.A.businessId)).toEqual(ctx);
  });

  it("an admin who is not a founder is addressed by their own name, and every founder is listed for them", async () => {
    await repos.founders.upsert(r.db, r.A.adminId, { displayName: "Lee" });
    const ctx = await repos.founders.contextFor(r.db, r.A.businessId, r.A.adminId);
    expect(ctx.firstName).toBe("Lee");
    expect(ctx.budget).toBe("not_said");
    expect(ctx.others).toEqual([{ firstName: "Maya" }]);
  });

  it("names the other founders of a shared project, never anyone who is not a founder", async () => {
    await r.db.update(s.memberships).set({ role: "cofounder" }).where(eq(s.memberships.userId, r.A.memberId));
    await repos.founders.upsert(r.db, r.A.memberId, { displayName: "Sam Okafor", experience: "operator", budgetMinor: 50_000 });
    expect((await repos.founders.contextFor(r.db, r.A.businessId, r.A.ownerId)).others).toEqual([{ firstName: "Sam" }]);
    const sam = await repos.founders.contextFor(r.db, r.A.businessId, r.A.memberId);
    expect(sam).toMatchObject({ firstName: "Sam", experience: "operator", budget: "some", others: [{ firstName: "Maya" }] });

    // A viewer (or any role that is not a founder's) is not one of the founders.
    await repos.founders.upsert(r.db, r.A.viewerId, { displayName: "Vic" });
    expect((await repos.founders.contextFor(r.db, r.A.businessId, r.A.ownerId)).others).toEqual([{ firstName: "Sam" }]);
  });

  it("reads a founder with no profile as not said, and never another business's people", async () => {
    const ctx = await repos.founders.contextFor(r.db, r.B.businessId, r.B.ownerId);
    expect(ctx).toEqual({ firstName: null, experience: "first_time", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", budget: "not_said", others: [] });
    // A's owner asking about B (not a member there) gets nothing of A's profile and only B's founders.
    expect(await repos.founders.contextFor(r.db, r.B.businessId, r.A.ownerId)).toEqual(ctx);
  });
});
