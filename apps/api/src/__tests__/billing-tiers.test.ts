/**
 * Billing and plan limits through the routers (BUILD §10.5, §11.15): credits are bought and reported in US dollars
 * whatever the business's currency, third-party spend in another currency is listed apart, a seat past the tier is
 * refused with a typed `tier_limit` error, and the founder's "Spend cap per action" is stored and editable by admins.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { PRICING_CURRENCY } from "@foundmill/models";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "tiers" });
}, 120_000);
afterAll(() => hz.close());

const period = () => new Date().toISOString().slice(0, 7);

describe("credits are US dollars", () => {
  it("the credits currency is the model price list's currency", () => {
    expect(CREDITS_CURRENCY).toBe(PRICING_CURRENCY);
  });

  it("a top-up is granted in US dollars; another currency is refused, never merged", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.billing.topUp({ businessId: hz.A.businessId, amountMinor: 2_500, currency: "GBP" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repos.usage.creditBalance(hz.db, hz.A.businessId, period())).toBeNull();
    // A top-up is a checkout (mock mode here) whose payment grants the credits.
    const buy = async (amountMinor: number, currency?: string) => {
      const opened = await owner.billing.topUp({ businessId: hz.A.businessId, amountMinor, ...(currency ? { currency } : {}) });
      expect(opened.checkout).toMatchObject({ currency: "USD", amountMinor });
      return owner.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: opened.checkout.id });
    };
    expect((await buy(2_500)).balance).toMatchObject({ grantedMinor: 2_500, currency: "USD" });
    expect((await buy(500, "usd")).balance).toMatchObject({ grantedMinor: 3_000 });
  });

  it("plan and usage report US dollar costs and list spend in another currency apart", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await repos.usage.record(hz.db, hz.A.businessId, { agentId: hz.A.agentId, kind: "tokens", modelKey: "sonnet", quantity: 1_000, costMinor: 34 });
    await repos.usage.record(hz.db, hz.A.businessId, { agentId: hz.A.agentId, kind: "tool", quantity: 1, unit: "calls", costMinor: 1_200, currency: "GBP" });
    const plan = await owner.billing.plan({ businessId: hz.A.businessId });
    expect(plan.creditsCurrency).toBe("USD");
    expect(plan.usage).toMatchObject({ currency: "USD", label: "Estimate", otherCurrencies: [{ currency: "GBP", costMinor: 1_200 }] });
    expect(plan.usage.costMinor).toBeGreaterThanOrEqual(34);
    const usage = await owner.billing.usage({ businessId: hz.A.businessId });
    expect(usage.currency).toBe("USD");
    expect(usage.byAgent.find((a) => a.agentId === hz.A.agentId)?.costMinor).toBe(plan.usage.costMinor);
    const wages = await owner.finance.wages({ businessId: hz.A.businessId });
    expect(wages).toMatchObject({ currency: "USD", label: "Estimate" });
  });
});

describe("seats (TIERS.seats)", () => {
  it("an invitation past the tier's seats is refused with a typed error; a larger tier has room", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const guest = await hz.h.createUser("tiers-guest@test.local");
    // The fixture business already has four members; the free tier has one seat.
    await expect(owner.team.humans.invite({ businessId: hz.B.businessId, userId: guest, role: "member" })).rejects.toMatchObject({ code: "FORBIDDEN", cause: { code: "tier_limit", details: { limit: "seats", tier: "free", allowed: 1, used: 4 } } });
    expect(await repos.memberships.get(hz.db, hz.B.businessId, guest)).toBeNull();
    await owner.billing.changeTier({ businessId: hz.B.businessId, tier: "scale" });
    try {
      const membership = await owner.team.humans.invite({ businessId: hz.B.businessId, userId: guest, role: "member" });
      expect(membership.role).toBe("member");
    } finally {
      await owner.billing.changeTier({ businessId: hz.B.businessId, tier: "free" });
    }
  });
});

describe("business.setSpendCap (Settings › Mode)", () => {
  it("an admin sets and clears the business cap, audited; a member cannot", async () => {
    const admin = hz.caller({ userId: hz.B.adminId });
    const set = await admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: 5_000 });
    expect(set.spendCapMinor).toBe(5_000);
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).spendCapMinor).toBe(5_000);
    const audit = await repos.audit.list(hz.db, hz.B.businessId, { action: "business.set_spend_cap" });
    expect(audit.items[0]?.details).toMatchObject({ from: null, to: 5_000 });
    await expect(hz.caller({ userId: hz.B.memberId }).business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: null })).spendCapMinor).toBeNull();
    await expect(admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
