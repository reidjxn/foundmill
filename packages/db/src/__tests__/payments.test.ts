/**
 * Credit top-ups through Stripe Checkout (0033, audit 2026-10-12 #22): a checkout row opens, records its session, and
 * `settleCreditCheckout` grants its USD amount once, however often the payment is announced; a payment that disagrees
 * with the row (session, amount, currency, mode) grants nothing and is audited; a row of another business is unknown.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_TOP_UP_LABEL, settleCreditCheckout } from "../payments";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("pay");
});
afterAll(() => r?.close());

const paidAt = new Date(Date.UTC(2026, 9, 12, 15, 45));

async function openLive(businessId: string, amountMinor = 5000) {
  const row = await repos.checkouts.create(r.db, businessId, { mode: "live", amountMinor, createdBy: r.A.ownerId });
  return repos.checkouts.attachSession(r.db, businessId, row.id, { mode: "live", externalId: `cs_test_${row.id.replace(/-/g, "")}`, checkoutUrl: "https://checkout.stripe.com/c/pay/x", expiresAt: new Date(paidAt.getTime() + 86_400_000) });
}

describe("billing_checkouts", () => {
  it("opens in USD, records its session, and refuses a non-positive amount", async () => {
    const row = await openLive(r.A.businessId);
    expect(row).toMatchObject({ status: "open", mode: "live", currency: "USD", amountMinor: 5000 });
    expect(row.externalId).toMatch(/^cs_test_/);
    await expect(repos.checkouts.create(r.db, r.A.businessId, { mode: "live", amountMinor: 0 })).rejects.toThrow(/Invalid checkout/);
    expect((await repos.checkouts.listRecent(r.db, r.A.businessId)).map((c) => c.id)).toContain(row.id);
    // Another business never sees it.
    await expect(repos.checkouts.get(r.db, r.B.businessId, row.id)).rejects.toThrow(/not found/i);
  });

  it("a failed or expired row is closed; markFailed and markExpired leave a paid row alone", async () => {
    const failed = await repos.checkouts.create(r.db, r.A.businessId, { mode: "live", amountMinor: 2500 });
    expect((await repos.checkouts.markFailed(r.db, r.A.businessId, failed.id, "Payments are not set up"))?.status).toBe("failed");
    expect(await repos.checkouts.markExpired(r.db, r.A.businessId, failed.id)).toBeNull();
  });
});

describe("settleCreditCheckout", () => {
  it("grants the amount to the period's balance once, marks the row paid and audits it", async () => {
    const A = r.A.businessId;
    const row = await openLive(A, 10_000);
    const before = (await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor ?? 0;
    const settle = (eventId: string) => settleCreditCheckout(r.db, { businessId: A, checkoutId: row.id, externalId: row.externalId, eventId, amountMinor: 10_000, currency: "usd", mode: "live", paidAt, actor: { kind: "webhook" } });

    const first = await settle("evt_1");
    expect(first.outcome).toBe("granted");
    if (first.outcome !== "granted") return;
    expect(first.balance.balanceMinor).toBe(Number(before) + 10_000);
    expect(first.checkout).toMatchObject({ status: "paid", paidEventId: "evt_1", grantedPeriod: "2026-10", creditBalanceId: first.balance.id });

    // Stripe re-sends, or the async success follows the completion: nothing more is granted.
    const again = await settle("evt_2");
    expect(again.outcome).toBe("duplicate");
    expect((await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor).toBe(Number(before) + 10_000);

    const audit = await repos.audit.list(r.db, A, { action: "billing.credits_purchased" });
    expect(audit.items.filter((e) => (e.target as { id?: string }).id === row.id)).toHaveLength(1);
  });

  it("grants nothing for another session, another amount, another currency or another mode, and audits why", async () => {
    const A = r.A.businessId;
    const row = await openLive(A, 2500);
    const base = { businessId: A, checkoutId: row.id, externalId: row.externalId, eventId: "evt_x", amountMinor: 2500, currency: "USD", mode: "live" as const, paidAt, actor: { kind: "webhook" as const } };
    const balance = (await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor ?? 0;
    expect(await settleCreditCheckout(r.db, { ...base, externalId: "cs_test_someoneelse" })).toMatchObject({ outcome: "mismatch", reason: /session/ });
    expect(await settleCreditCheckout(r.db, { ...base, amountMinor: 250 })).toMatchObject({ outcome: "mismatch", reason: /expected 2500 USD/ });
    expect(await settleCreditCheckout(r.db, { ...base, currency: "eur" })).toMatchObject({ outcome: "mismatch" });
    expect(await settleCreditCheckout(r.db, { ...base, mode: "mock", eventId: `mock:${row.id}` })).toMatchObject({ outcome: "mismatch", reason: /mock payment cannot settle a live checkout/ });
    expect((await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor ?? 0).toBe(balance);
    expect((await repos.checkouts.get(r.db, A, row.id)).status).toBe("open");
    const audit = await repos.audit.list(r.db, A, { action: "billing.checkout_mismatch" });
    expect(audit.items.filter((e) => (e.target as { id?: string }).id === row.id)).toHaveLength(4);
  });

  it("a row of another business is unknown; a mock settlement is labeled", async () => {
    const row = await repos.checkouts.create(r.db, r.A.businessId, { mode: "mock", amountMinor: 5000, createdBy: r.A.ownerId });
    expect(await settleCreditCheckout(r.db, { businessId: r.B.businessId, checkoutId: row.id, externalId: null, eventId: "evt_y", amountMinor: 5000, currency: "USD", mode: "mock", paidAt, actor: { kind: "webhook" } })).toEqual({ outcome: "unknown" });
    const mock = await settleCreditCheckout(r.db, { businessId: r.A.businessId, checkoutId: row.id, externalId: null, eventId: `mock:${row.id}`, amountMinor: 5000, currency: "USD", mode: "mock", paidAt, actor: { kind: "user", id: r.A.ownerId } });
    expect(mock.outcome).toBe("granted");
    const audit = await repos.audit.list(r.db, r.A.businessId, { action: "billing.credits_purchased" });
    const entry = audit.items.find((e) => (e.target as { id?: string }).id === row.id);
    expect(entry).toMatchObject({ actorKind: "user", actorId: r.A.ownerId, details: { mode: "mock", label: MOCK_TOP_UP_LABEL } });
  });

  it("a payment for a row closed as failed still grants its credits (money was taken)", async () => {
    const A = r.A.businessId;
    const row = await openLive(A, 1500);
    await repos.checkouts.markFailed(r.db, A, row.id, "The gateway did not answer");
    const settled = await settleCreditCheckout(r.db, { businessId: A, checkoutId: row.id, externalId: row.externalId, eventId: "evt_late", amountMinor: 1500, currency: "USD", mode: "live", paidAt, actor: { kind: "webhook" } });
    expect(settled).toMatchObject({ outcome: "granted", checkout: { status: "paid" } });
  });
});
