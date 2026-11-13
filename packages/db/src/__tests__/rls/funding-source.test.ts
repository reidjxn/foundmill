/**
 * 0100 who funds a business's agent work: `businesses.funding_source` and `funding_plan_provider`. The businesses table's
 * tenancy is the generated suite's (tables.ts); this one proves the new columns across tenants and the parts it cannot
 * see: a member reads only their own business's funding, no other business's member reads or writes it, an anonymous
 * caller sees nothing, no app role (not even an owner) sets or changes the founder's own plan, the own-key path maps onto
 * `own_api_key` by itself, and the plan is set only through the repo while the flag is on and the provider integrated.
 */
import { ConflictError } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const fundingOf = (businessId: string) => h.service().run(async (tx) => (await tx.select({ source: s.businesses.fundingSource, provider: s.businesses.fundingPlanProvider }).from(s.businesses).where(eq(s.businesses.id, businessId)))[0]);
/** The plan switched on for the test only (the flag is off and no provider is integrated in the product). */
const ON = { enabled: true, providers: ["openai"] } as const;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "fund-a");
  B = await createBusinessFixture(h, "fund-b");
  outsiderId = await h.createUser("fund-outsider@test.local");
}, 120_000);
afterAll(() => h?.close());

describe("businesses.funding_source (0100): tenancy", () => {
  it("defaults to today's behavior: the month's credits", async () => {
    expect(await fundingOf(A.businessId)).toEqual({ source: "foundmill_credits", provider: null });
  });

  it("a member reads their own business's funding and no other's; an outsider and an anonymous caller read none", async () => {
    const own = await h.asUser(A.memberId).run((tx) => tx.select({ id: s.businesses.id, source: s.businesses.fundingSource }).from(s.businesses));
    expect(own).toEqual([{ id: A.businessId, source: "foundmill_credits" }]);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select({ source: s.businesses.fundingSource }).from(s.businesses).where(eq(s.businesses.id, A.businessId)))).toEqual([]);
    expect(await h.asUser(outsiderId).run((tx) => tx.select({ source: s.businesses.fundingSource }).from(s.businesses))).toEqual([]);
    // An anonymous caller has no grant on businesses at all (0002): refused outright.
    await expect(h.anon().run((tx) => tx.select({ source: s.businesses.fundingSource }).from(s.businesses))).rejects.toThrow();
  });

  it("another business's owner writes nothing of it", async () => {
    const touched = await h.asUser(B.ownerId).run((tx) => tx.update(s.businesses).set({ modelBilling: "byok" }).where(eq(s.businesses.id, A.businessId)).returning({ id: s.businesses.id }));
    expect(touched).toEqual([]);
    await expect(h.asUser(B.ownerId).run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, "openai", ON))).rejects.toThrow();
    expect(await fundingOf(A.businessId)).toEqual({ source: "foundmill_credits", provider: null });
  });

  it("no app role sets or changes the founder's own plan, not even the owner, and a hand-written source is put back in step", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.businesses).set({ fundingSource: "own_plan", fundingPlanProvider: "openai" }).where(eq(s.businesses.id, A.businessId)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, "openai", ON))).rejects.toThrow(/permission denied/);
    // A source written by hand that disagrees with the billing is put back in step with it.
    await h.asUser(A.ownerId).run((tx) => tx.update(s.businesses).set({ fundingSource: "own_api_key" }).where(eq(s.businesses.id, A.businessId)));
    expect(await fundingOf(A.businessId)).toEqual({ source: "foundmill_credits", provider: null });
  });
});

describe("businesses.funding_source (0100): the own-key path and the own plan", () => {
  it("the existing own-key path maps onto own_api_key without any code change, and back", async () => {
    await h.service().run((tx) => repos.businesses.update(tx, A.businessId, { modelBilling: "byok" }));
    expect(await fundingOf(A.businessId)).toEqual({ source: "own_api_key", provider: null });
    await h.service().run((tx) => repos.businesses.update(tx, A.businessId, { modelBilling: "credits" }));
    expect(await fundingOf(A.businessId)).toEqual({ source: "foundmill_credits", provider: null });
    const created = await h.service().run((tx) => repos.businesses.create(tx, { name: "Own Key From Start", modelBilling: "byok" }));
    expect(created.fundingSource).toBe("own_api_key");
  });

  it("the plan is refused while the flag is off or the provider is not integrated, which is today for everyone", async () => {
    await expect(h.service().run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, "openai"))).rejects.toBeInstanceOf(ConflictError);
    await expect(h.service().run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, "anthropic", ON))).rejects.toBeInstanceOf(ConflictError);
    expect(await fundingOf(A.businessId)).toEqual({ source: "foundmill_credits", provider: null });
  });

  it("with the flag on for an integrated provider, service code sets it, the billing no longer moves it, and clearing it goes back in step", async () => {
    const set = await h.service().run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, "openai", ON));
    expect(set).toMatchObject({ fundingSource: "own_plan", fundingPlanProvider: "openai" });
    await h.service().run((tx) => repos.businesses.update(tx, A.businessId, { modelBilling: "byok" }));
    expect(await fundingOf(A.businessId)).toEqual({ source: "own_plan", provider: "openai" });
    // A member of A still reads it; B's member does not.
    expect(await h.asUser(A.memberId).run((tx) => tx.select({ source: s.businesses.fundingSource }).from(s.businesses).where(eq(s.businesses.id, A.businessId)))).toEqual([{ source: "own_plan" }]);
    expect(await h.asUser(B.memberId).run((tx) => tx.select({ source: s.businesses.fundingSource }).from(s.businesses).where(eq(s.businesses.id, A.businessId)))).toEqual([]);
    // The owner cannot clear it either: only service code moves the plan.
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.businesses).set({ fundingSource: "foundmill_credits", fundingPlanProvider: null }).where(eq(s.businesses.id, A.businessId)))).rejects.toThrow(/permission denied/);
    const cleared = await h.service().run((tx) => repos.businesses.setOwnPlan(tx, A.businessId, null, ON));
    expect(cleared).toMatchObject({ fundingSource: "own_api_key", fundingPlanProvider: null });
    await h.service().run((tx) => repos.businesses.update(tx, A.businessId, { modelBilling: "credits" }));
  });

  it("the database holds the shape: a plan needs its provider and a provider needs the plan", async () => {
    await expect(h.service().run((tx) => tx.update(s.businesses).set({ fundingSource: "own_plan" }).where(eq(s.businesses.id, B.businessId)))).rejects.toThrow();
    await expect(h.service().run((tx) => tx.update(s.businesses).set({ fundingPlanProvider: "Open AI!" }).where(eq(s.businesses.id, B.businessId)))).rejects.toThrow();
    expect(await fundingOf(B.businessId)).toEqual({ source: "foundmill_credits", provider: null });
  });
});
