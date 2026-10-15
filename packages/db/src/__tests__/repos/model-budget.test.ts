/**
 * 0059 the monthly model budget (audit #15, BUILD §10.4): a column of `businesses`, so the business policies hold (members
 * read it, owners and admins change it); `modelBudgetState` is the month's metered cost against it, whoever pays the model.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelBudgetState } from "../../billing";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("modelbudget");
}, 120_000);
afterAll(() => r?.close());

const A = () => r.A.businessId;
const B = () => r.B.businessId;
const OCT = new Date("2026-10-14T12:00:00.000Z");
const book = (businessId: string, costMinor: number, occurredAt: Date, billedTo: "credits" | "byok", extra: { currency?: string; kind?: "tokens" | "sandbox" } = {}) =>
  repos.usage.record(r.db, businessId, { agentId: businessId === A() ? r.A.agentId : r.B.agentId, kind: extra.kind ?? "tokens", quantity: 1, costMinor, currency: extra.currency ?? "USD", billedTo, occurredAt });

describe("businesses.model_budget_minor", () => {
  it("starts unset, is set and cleared by an owner or admin, and rejects what is not an amount", async () => {
    expect((await repos.businesses.get(r.db, A())).modelBudgetMinor).toBeNull();
    expect((await r.as(r.A.adminId, (tx) => repos.businesses.setModelBudget(tx, A(), 25_000))).modelBudgetMinor).toBe(25_000);
    expect((await repos.businesses.get(r.db, A())).modelBudgetMinor).toBe(25_000);
    expect((await r.as(r.A.ownerId, (tx) => repos.businesses.setModelBudget(tx, A(), 0))).modelBudgetMinor).toBe(0);
    expect((await r.as(r.A.ownerId, (tx) => repos.businesses.setModelBudget(tx, A(), null))).modelBudgetMinor).toBeNull();
    await expect(repos.businesses.setModelBudget(r.db, A(), -1)).rejects.toThrow();
    await expect(repos.businesses.setModelBudget(r.db, A(), 1.5)).rejects.toThrow();
    // The column carries its own check as well.
    await expect(r.h.pg.query(`update businesses set model_budget_minor = -5 where id = $1`, [A()])).rejects.toThrow(/businesses_model_budget_check/);
  });

  it("members and viewers read it but cannot change it, and nobody reaches another business's", async () => {
    await repos.businesses.setModelBudget(r.db, A(), 10_000);
    expect((await r.as(r.A.viewerId, (tx) => repos.businesses.get(tx, A()))).modelBudgetMinor).toBe(10_000);
    await expect(r.as(r.A.memberId, (tx) => repos.businesses.setModelBudget(tx, A(), 1))).rejects.toThrow(/not found/i);
    await expect(r.as(r.A.viewerId, (tx) => repos.businesses.setModelBudget(tx, A(), 1))).rejects.toThrow(/not found/i);
    await expect(r.as(r.B.adminId, (tx) => repos.businesses.setModelBudget(tx, A(), 1))).rejects.toThrow(/not found/i);
    await expect(r.as(r.B.adminId, (tx) => repos.businesses.get(tx, A()))).rejects.toThrow(/not found/i);
    expect((await repos.businesses.get(r.db, A())).modelBudgetMinor).toBe(10_000);
    expect((await repos.businesses.get(r.db, B())).modelBudgetMinor).toBeNull();
  });
});

describe("modelBudgetState", () => {
  it("is unlimited without a budget and reads no ledger", async () => {
    expect(await modelBudgetState(r.db, { id: B(), modelBudgetMinor: null }, OCT)).toEqual({ period: "2026-10", budgetMinor: null, spentMinor: 0, remainingMinor: null });
  });

  it("counts the month's USD cost of credits and own-key rows alike, and nothing from another month, currency or business", async () => {
    await repos.businesses.setModelBudget(r.db, A(), 1_000);
    await book(A(), 300, OCT, "credits");
    await book(A(), 250, OCT, "byok");
    await book(A(), 50, new Date("2026-10-31T23:59:59.000Z"), "byok", { kind: "sandbox" });
    // Not this month, not US dollars, not this business.
    await book(A(), 700, new Date("2026-09-30T23:59:59.000Z"), "byok");
    await book(A(), 700, new Date("2026-11-01T00:00:00.000Z"), "byok");
    await book(A(), 700, OCT, "byok", { currency: "GBP" });
    await book(B(), 700, OCT, "byok");
    const business = await repos.businesses.get(r.db, A());
    expect(await modelBudgetState(r.db, business, OCT)).toEqual({ period: "2026-10", budgetMinor: 1_000, spentMinor: 600, remainingMinor: 400 });
    expect(await modelBudgetState(r.db, business, new Date("2026-11-02T00:00:00.000Z"))).toMatchObject({ period: "2026-11", spentMinor: 700, remainingMinor: 300 });
  });

  it("never reports a negative remainder once the month is over the budget", async () => {
    await book(A(), 900, OCT, "byok");
    const business = await repos.businesses.get(r.db, A());
    expect(await modelBudgetState(r.db, business, OCT)).toMatchObject({ spentMinor: 1_500, remainingMinor: 0 });
    await repos.businesses.setModelBudget(r.db, A(), 5_000);
    expect(await modelBudgetState(r.db, await repos.businesses.get(r.db, A()), OCT)).toMatchObject({ budgetMinor: 5_000, remainingMinor: 3_500 });
  });
});
