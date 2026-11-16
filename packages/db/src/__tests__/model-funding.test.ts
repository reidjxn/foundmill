/** Who pays for a model call (WP-13): read from the business's plan and billing, else the person's, else signed out. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cachedModelFundingOf, modelFundingOf } from "../model-funding";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
const set = (tier: string, billing: string) => h.db.execute(sql`update businesses set plan_tier = ${tier}, model_billing = ${billing} where id = ${A.businessId}`);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "funding-a");
});
afterAll(async () => {
  await h?.close();
});

describe("modelFundingOf (WP-13)", () => {
  it("reads a business's plan and billing; a service that cannot serve an own key falls back to the plan", async () => {
    const of = (ownKeyServed: boolean) => modelFundingOf(h.db, { businessId: A.businessId }, { ownKeyServed });
    await set("free", "credits");
    expect(await of(true)).toBe("free_plan");
    await set("pro", "credits");
    expect(await of(true)).toBe("paid_plan");
    await set("free", "byok");
    expect([await of(true), await of(false)]).toEqual(["own_key", "free_plan"]);
    await set("pro", "byok");
    expect([await of(true), await of(false)]).toEqual(["own_key", "paid_plan"]);
  });

  it("reads a person's best plan among the projects they own, and treats a signed-out visitor as free", async () => {
    await set("pro", "credits");
    expect(await modelFundingOf(h.db, { userId: A.ownerId }, { ownKeyServed: false })).toBe("paid_plan");
    expect(await modelFundingOf(h.db, { userId: A.memberId }, { ownKeyServed: false })).toBe("free_plan");
    expect(await modelFundingOf(h.db, undefined, { ownKeyServed: false })).toBe("free_plan");
  });

  it("caches an answer for its TTL and reads again after it", async () => {
    let t = 0;
    const funding = cachedModelFundingOf(h.db, { ownKeyServed: false, ttlMs: 1_000, now: () => t });
    await set("free", "credits");
    expect(await funding({ businessId: A.businessId })).toBe("free_plan");
    await set("pro", "credits");
    expect(await funding({ businessId: A.businessId })).toBe("free_plan");
    t = 1_001;
    expect(await funding({ businessId: A.businessId })).toBe("paid_plan");
  });
});
