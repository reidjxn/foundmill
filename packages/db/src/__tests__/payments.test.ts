/**
 * Credit top-ups through Stripe Checkout (0033, audit 2026-10-12 #22): a checkout row opens, records its session, and
 * `settleCreditCheckout` grants its USD amount once, however often the payment is announced; a payment that disagrees
 * with the row (session, amount, currency, mode) grants nothing and is audited; a row of another business is unknown.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditsState } from "../billing";
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
    // The project's own balance is what it bought: the owner's included budget is shared and sits apart from it (0162).
    const settle = (eventId: string) => settleCreditCheckout(r.db, { businessId: A, checkoutId: row.id, externalId: row.externalId, eventId, amountMinor: 10_000, currency: "usd", mode: "live", paidAt, actor: { kind: "webhook" } });

    const first = await settle("evt_1");
    expect(first.outcome).toBe("granted");
    if (first.outcome !== "granted") return;
    expect(first.balance.balanceMinor).toBe(10_000);
    expect(first.checkout).toMatchObject({ status: "paid", paidEventId: "evt_1", grantedPeriod: "2026-10", creditBalanceId: first.balance.id });

    // Stripe re-sends, or the async success follows the completion: nothing more is granted.
    const again = await settle("evt_2");
    expect(again.outcome).toBe("duplicate");
    expect((await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor).toBe(10_000);

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

describe("the entry plan and credit packs (0140, WP-09 T16)", () => {
  const sub = { stripeSubscriptionId: "sub_test_entry1", stripeCustomerId: "cus_test_entry1", currentPeriodEnd: new Date(Date.UTC(2026, 10, 12)) };

  it("a paid entry-plan checkout grants no credits and makes its account's plan active, once", async () => {
    const before = await creditsState(r.db, await repos.businesses.get(r.db, r.B.businessId), "2026-10");
    const row = await repos.checkouts.create(r.db, r.B.businessId, { mode: "live", amountMinor: 500, kind: "subscription", createdBy: r.B.ownerId });
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(false);
    const settle = (eventId: string) => settleCreditCheckout(r.db, { businessId: r.B.businessId, checkoutId: row.id, externalId: null, eventId, amountMinor: 500, currency: "usd", mode: "live", paidAt, actor: { kind: "webhook" }, subscription: sub });
    expect((await settle("evt_entry_1")).outcome).toBe("subscribed");
    expect((await settle("evt_entry_2")).outcome).toBe("duplicate");
    expect(await repos.accountPlans.forUser(r.db, r.B.ownerId)).toMatchObject({ status: "active", mode: "live", stripeSubscriptionId: "sub_test_entry1", stripeCustomerId: "cus_test_entry1" });
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(true);
    // An owner's plan opens their own projects only.
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: true })).toBe(false);
    const after = await creditsState(r.db, await repos.businesses.get(r.db, r.B.businessId), "2026-10");
    expect(after?.balanceMinor).toBe(before?.balanceMinor);
  });

  it("Stripe's later events move the plan: past due and canceled close it, a renewal opens it again", async () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    await repos.accountPlans.setStatusBySubscription(r.db, "sub_test_entry1", "past_due", at(20));
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(false);
    await repos.accountPlans.setStatusBySubscription(r.db, "sub_test_entry1", "active", at(21), new Date(Date.UTC(2026, 11, 12)));
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(true);
    // An older event delivered late changes nothing (Stripe does not deliver in order).
    expect(await repos.accountPlans.setStatusBySubscription(r.db, "sub_test_entry1", "past_due", at(19))).toBeNull();
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(true);
    await repos.accountPlans.setStatusBySubscription(r.db, "sub_test_entry1", "canceled", at(22));
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.B.businessId, { live: true })).toBe(false);
    // A canceled subscription never comes back, even on a newer event (its final invoice, a stale update).
    expect(await repos.accountPlans.setStatusBySubscription(r.db, "sub_test_entry1", "active", at(23))).toBeNull();
    expect((await repos.accountPlans.forUser(r.db, r.B.ownerId))?.status).toBe("canceled");
    expect(await repos.accountPlans.setStatusBySubscription(r.db, "sub_unknown", "active", at(23))).toBeNull();
  });

  it("a live entry-plan session without its subscription, or of another kind, settles nothing", async () => {
    const row = await repos.checkouts.create(r.db, r.A.businessId, { mode: "live", amountMinor: 500, kind: "subscription", createdBy: r.A.adminId });
    const base = { businessId: r.A.businessId, checkoutId: row.id, externalId: null, amountMinor: 500, currency: "USD", mode: "live" as const, paidAt, actor: { kind: "webhook" as const } };
    expect((await settleCreditCheckout(r.db, { ...base, eventId: "evt_nosub", subscription: { stripeSubscriptionId: null, stripeCustomerId: null, currentPeriodEnd: null } })).outcome).toBe("mismatch");
    expect((await settleCreditCheckout(r.db, { ...base, eventId: "evt_kind", kind: "credits", subscription: sub })).outcome).toBe("mismatch");
    expect(await repos.accountPlans.forUser(r.db, r.A.adminId)).toBeNull();
  });

  it("a cofounder's plan opens the project too; a collaborator's does not", async () => {
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: true })).toBe(false);
    // A's admin is not a founder: a plan of theirs opens nothing here.
    const adminRow = await repos.checkouts.create(r.db, r.A.businessId, { mode: "live", amountMinor: 500, kind: "subscription", createdBy: r.A.adminId });
    await repos.accountPlans.activate(r.db, { userId: r.A.adminId, mode: "live", checkoutId: adminRow.id, stripeSubscriptionId: "sub_test_admin" });
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: true })).toBe(false);
    await repos.memberships.setRole(r.db, r.A.businessId, r.A.adminId, "cofounder");
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: true })).toBe(true);
    await repos.memberships.setRole(r.db, r.A.businessId, r.A.adminId, "admin");
  });

  it("a simulated plan never opens live work", async () => {
    const row = await repos.checkouts.create(r.db, r.A.businessId, { mode: "mock", amountMinor: 500, kind: "subscription", createdBy: r.A.ownerId });
    await settleCreditCheckout(r.db, { businessId: r.A.businessId, checkoutId: row.id, externalId: null, eventId: `mock:${row.id}`, amountMinor: 500, currency: "USD", mode: "mock", paidAt, actor: { kind: "user", id: r.A.ownerId } });
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: false })).toBe(true);
    expect(await repos.accountPlans.ownerHasActivePlan(r.db, r.A.businessId, { live: true })).toBe(false);
  });

  it("a credit pack grants its credits, which can differ from its price, and marks its buyer as having bought one", async () => {
    expect(await repos.accountPlans.boughtPack(r.db, r.B.ownerId, { live: true })).toBe(false);
    const row = await repos.checkouts.create(r.db, r.B.businessId, { mode: "live", amountMinor: 2000, creditsMinor: 2200, createdBy: r.B.ownerId });
    const before = await creditsState(r.db, await repos.businesses.get(r.db, r.B.businessId), "2026-10");
    const settled = await settleCreditCheckout(r.db, { businessId: r.B.businessId, checkoutId: row.id, externalId: null, eventId: "evt_pack_1", amountMinor: 2000, currency: "USD", mode: "live", paidAt, actor: { kind: "webhook" } });
    expect(settled.outcome).toBe("granted");
    const after = await creditsState(r.db, await repos.businesses.get(r.db, r.B.businessId), "2026-10");
    expect((after?.balanceMinor ?? 0) - (before?.balanceMinor ?? 0)).toBe(2200);
    expect(await repos.accountPlans.boughtPack(r.db, r.B.ownerId, { live: true })).toBe(true);
  });
});
