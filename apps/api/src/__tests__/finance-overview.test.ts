import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

/** A day in the full calendar month `offset` months before this one (UTC). */
const inMonth = (offset: number, day: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, day, 12));
};

describe("finance.overview (BUILD §11.8): burn without financing, payback over every paying customer", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "finov" });
  }, 120_000);
  afterAll(() => hz.close());

  it("a raise in the trailing months leaves net burn positive, so runway and its warnings stay measured", async () => {
    const { businessId, accountId } = hz.A;
    await repos.finance.upsertTransactions(hz.db, businessId, [
      { accountId, externalId: "pay-3", bookedAt: inMonth(3, 10), amountMinor: -900_000, counterparty: "Payroll", category: "payroll" },
      { accountId, externalId: "pay-2", bookedAt: inMonth(2, 10), amountMinor: -900_000, counterparty: "Payroll", category: "payroll" },
      { accountId, externalId: "pay-1", bookedAt: inMonth(1, 10), amountMinor: -900_000, counterparty: "Payroll", category: "payroll" },
      { accountId, externalId: "rev-1", bookedAt: inMonth(1, 20), amountMinor: 300_000, counterparty: "Stripe", category: "revenue" },
      { accountId, externalId: "safe-1", bookedAt: inMonth(2, 3), amountMinor: 40_000_000, counterparty: "Angel", category: "financing" },
      { accountId, externalId: "move-1", bookedAt: inMonth(1, 4), amountMinor: 5_000_000, counterparty: "Savings", category: "transfer" },
    ]);
    await repos.finance.updateBalance(hz.db, businessId, accountId, 1_200_000, new Date());
    const overview = await hz.caller({ userId: hz.A.ownerId }).finance.overview({ businessId });
    // (2,700,000 operating out − 300,000 operating in) ÷ 3; the SAFE and the transfer are not income.
    expect(overview.burn.netBurnMinor).toBe(800_000);
    expect(overview.burn.grossBurnMinor).toBe(900_000);
    expect(overview.runway.months).toBe(1.5);
    expect(overview.runway.blocksContinue).toBe(true);
  });

  it("payingCustomers counts distinct paying entities over the trailing full months, beside the 30-day new count", async () => {
    const { businessId, entityId, entity2Id } = hz.A;
    for (const occurredAt of [inMonth(3, 2), inMonth(2, 2), inMonth(1, 2)]) await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 4900, occurredAt });
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: entity2Id, kind: "payment", amountMinor: 4900, occurredAt: inMonth(1, 15) });
    // Outside the window: four months ago.
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: inMonth(4, 15) });
    const overview = await hz.caller({ userId: hz.A.ownerId }).finance.overview({ businessId });
    expect(overview.payingCustomers.count).toBe(2);
    expect(overview.payingCustomers.months).toBe(3);
    expect(overview.payingCustomers.from).toBe(new Date(Date.UTC(inMonth(3, 1).getUTCFullYear(), inMonth(3, 1).getUTCMonth(), 1)).toISOString());
    expect((await hz.caller({ userId: hz.B.ownerId }).finance.overview({ businessId: hz.B.businessId })).payingCustomers.count).toBe(0);
  });
});
