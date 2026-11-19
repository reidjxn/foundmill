/**
 * 0135 — payment powers. Owners and admins of a business set them under the existing businesses_update policy; nobody
 * outside the business, and no member or viewer inside it, can. Only 'inbound' exists: the column's check refuses
 * anything else, so an outbound power cannot be stored even by the service.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "powers-a");
  B = await createBusinessFixture(h, "powers-b");
});
afterAll(() => h?.close());

const powersOf = async (id: string) => (await h.db.select({ p: s.businesses.paymentPowers }).from(s.businesses).where(eq(s.businesses.id, id)))[0]!.p;
const setAs = (userId: string, businessId: string, powers: string[]) => h.asUser(userId).run((tx) => tx.update(s.businesses).set({ paymentPowers: powers as never }).where(eq(s.businesses.id, businessId)).returning({ id: s.businesses.id }));

describe("businesses.payment_powers (0135)", () => {
  it("is empty by default", async () => {
    expect(await powersOf(A.businessId)).toEqual([]);
  });

  it("an owner or admin of the business sets it; a member, a viewer and another business's owner cannot", async () => {
    expect(await setAs(A.memberId, A.businessId, ["inbound"])).toHaveLength(0);
    expect(await setAs(A.viewerId, A.businessId, ["inbound"])).toHaveLength(0);
    expect(await setAs(B.ownerId, A.businessId, ["inbound"])).toHaveLength(0);
    expect(await powersOf(A.businessId)).toEqual([]);
    expect(await setAs(A.adminId, A.businessId, ["inbound"])).toHaveLength(1);
    expect(await powersOf(A.businessId)).toEqual(["inbound"]);
    expect(await powersOf(B.businessId)).toEqual([]);
    expect(await setAs(A.ownerId, A.businessId, [])).toHaveLength(1);
  });

  it("refuses any power but inbound, at the repo and in the column", async () => {
    await expect(repos.businesses.setPaymentPowers(h.db as never, A.businessId, ["outbound"])).rejects.toThrow();
    await expect(h.db.execute(sql`update businesses set payment_powers = array['outbound'] where id = ${A.businessId}`)).rejects.toThrow();
    expect((await repos.businesses.setPaymentPowers(h.db as never, A.businessId, ["inbound", "inbound"])).paymentPowers).toEqual(["inbound"]);
  });
});
