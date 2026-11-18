/**
 * account_plans (0140, WP-09 T16): an account's entry plan. A person reads their own row's state and nobody else's,
 * never its Stripe ids; no client role writes any row, their own included; the service role does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPlansRepo } from "../../repos/account-plans";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "plans-a");
  const checkout = (await h.db.insert(s.billingCheckouts).values({ businessId: A.businessId, kind: "subscription", mode: "mock", amountMinor: 500, createdBy: A.ownerId }).returning())[0]!;
  await accountPlansRepo.activate(h.db, { userId: A.ownerId, mode: "mock", checkoutId: checkout.id });
});
afterAll(() => h?.close());

describe("account_plans", () => {
  it("the owner reads their own row; another person reads none", async () => {
    const state = { id: s.accountPlans.id, status: s.accountPlans.status, mode: s.accountPlans.mode, currentPeriodEnd: s.accountPlans.currentPeriodEnd };
    expect(await h.asUser(A.ownerId).run((tx) => tx.select(state).from(s.accountPlans))).toHaveLength(1);
    expect(await h.asUser(A.adminId).run((tx) => tx.select(state).from(s.accountPlans))).toHaveLength(0);
    await expect(h.anon().run((tx) => tx.select(state).from(s.accountPlans))).rejects.toThrow(/permission denied/);
    // The Stripe ids stay with the services, the person's own included.
    await expect(h.asUser(A.ownerId).run((tx) => tx.select({ sub: s.accountPlans.stripeSubscriptionId }).from(s.accountPlans))).rejects.toThrow(/permission denied/);
  });

  it("no client role writes a row, the person's own included", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.accountPlans).values({ userId: A.ownerId, status: "active", mode: "live" }))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.accountPlans).set({ status: "active", mode: "live" }))).rejects.toThrow(/permission denied/);
  });
});
