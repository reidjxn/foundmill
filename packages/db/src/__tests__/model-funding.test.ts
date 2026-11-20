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

  it("from the day sign-up opens a Try project whose owner bought a credit pack of $20 or more reaches every model; before then, and with a smaller or a simulated one, it does not (A16)", async () => {
    await set("free", "credits");
    const of = (stage: "invite_only" | "open") => modelFundingOf(h.db, { businessId: A.businessId }, { ownKeyServed: true, stage });
    const pack = (amountMinor: number, mode: "live" | "mock") =>
      h.db.execute(sql`insert into billing_checkouts (business_id, kind, status, mode, amount_minor, currency, paid_at) values (${A.businessId}, 'credits', 'paid', ${mode}, ${amountMinor}, 'USD', now())`);
    const packBy = (userId: string) => h.db.execute(sql`insert into billing_checkouts (business_id, kind, status, mode, amount_minor, currency, paid_at, created_by) values (${A.businessId}, 'credits', 'paid', 'live', 5000, 'USD', now(), ${userId})`);
    expect(await of("open")).toBe("free_plan");
    await pack(1000, "live");
    await pack(5000, "mock");
    expect(await of("open")).toBe("free_plan");
    // Only the purchases of the person who took charge count: one with no buyer recorded, or an admin's, does not.
    await pack(2000, "live");
    await packBy(A.adminId);
    expect(await of("open")).toBe("free_plan");
    await h.db.execute(sql`update billing_checkouts set created_by = ${A.ownerId} where business_id = ${A.businessId} and amount_minor = 2000`);
    expect(await of("open")).toBe("paid_plan");
    expect(await of("invite_only")).toBe("free_plan");
    // The stage the product is in today.
    expect(await modelFundingOf(h.db, { businessId: A.businessId }, { ownKeyServed: true })).toBe("free_plan");
    await h.db.execute(sql`delete from billing_checkouts where business_id = ${A.businessId}`);
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
