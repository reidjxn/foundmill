/**
 * founder.businesses.list / allowance: the signed-in person's businesses (Switch business, Your businesses) under RLS,
 * and the plan facts Commit states (no business limit for now; the included-credit pool, SEC2 S6).
 */
import { includedCreditsMinor } from "@foundmill/config";
import { periodOf, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "fbiz" });
});
afterAll(() => hz.close());

describe("founder.businesses.list", () => {
  it("lists the businesses the caller belongs to, with their role, and nobody else's", async () => {
    const asOwnerA = await hz.caller({ userId: hz.A.ownerId }).founder.businesses.list();
    expect(asOwnerA.businesses).toEqual([expect.objectContaining({ id: hz.A.businessId, role: "owner", planTier: "free", businessMode: expect.any(String), isDemo: false, agentsStopped: false, logo: null })]);
    expect((await hz.caller({ userId: hz.A.viewerId }).founder.businesses.list()).businesses).toEqual([expect.objectContaining({ id: hz.A.businessId, role: "viewer" })]);
    // Cross-tenant: B's owner never sees A, and A's owner never sees B.
    expect((await hz.caller({ userId: hz.B.ownerId }).founder.businesses.list()).businesses.map((b) => b.id)).toEqual([hz.B.businessId]);
    expect(asOwnerA.businesses.some((b) => b.id === hz.B.businessId)).toBe(false);
    const nobody = await hz.h.createUser("fbiz-nobody@test.local");
    expect(await hz.caller({ userId: nobody }).founder.businesses.list()).toEqual({ businesses: [] });
    await expect(hz.caller(null).founder.businesses.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reads a stored LIVE business as Personal while LIVE is closed here", async () => {
    await repos.businesses.setGameMode(hz.db, hz.B.businessId, "live");
    expect((await hz.caller({ userId: hz.B.ownerId }).founder.businesses.list()).businesses[0]?.gameMode).toBe("personal");
    await repos.businesses.setGameMode(hz.db, hz.B.businessId, "personal");
  });
});

describe("founder.businesses.allowance", () => {
  it("a plan holds projects (Try 1); the shared team budget is the caller's own and shrinks as their projects spend it", async () => {
    const period = periodOf(new Date());
    const before = await hz.caller({ userId: hz.A.ownerId }).founder.businesses.allowance();
    expect(before).toMatchObject({ tier: "free", businesses: { allowed: 1, owned: 1 }, includedCredits: { period, monthlyMinor: includedCreditsMinor("free"), remainingMinor: includedCreditsMinor("free"), currency: "USD" } });
    expect(new Date(before.includedCredits.nextGrantAt).getUTCDate()).toBe(1);
    // A project of this owner draws on the one budget; another owner's budget is untouched.
    await repos.usage.chargeCredits(hz.db, hz.A.businessId, period, 120, { owner: { userId: hz.A.ownerId, budgetMinor: async () => includedCreditsMinor("free") } });
    expect((await hz.caller({ userId: hz.A.ownerId }).founder.businesses.allowance()).includedCredits).toMatchObject({ monthlyMinor: includedCreditsMinor("free"), remainingMinor: includedCreditsMinor("free") - 120 });
    expect((await hz.caller({ userId: hz.B.ownerId }).founder.businesses.allowance()).includedCredits).toMatchObject({ remainingMinor: includedCreditsMinor("free") });
  });
});
