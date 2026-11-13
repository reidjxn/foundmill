/**
 * Bought credits last 12 months (0087; founder, 2026-11-13): a paid top-up is a lot as well as a grant to the month's
 * balance; a charge spends the month's included credits first, then the lots, the one expiring first first; a new
 * month starts with its included credits plus every live lot; an expired lot leaves the balance with what is left.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settleCreditCheckout } from "../payments";
import { repos } from "../repos";
import { creditLotExpiry, periodOf } from "../repos/usage";
import * as s from "../schema";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("lots");
});
afterAll(() => r?.close());

const now = new Date();
const thisMonth = periodOf(now);

async function buy(businessId: string, amountMinor: number, paidAt = now) {
  const row = await repos.checkouts.create(r.db, businessId, { mode: "mock", amountMinor, createdBy: r.A.ownerId });
  const res = await settleCreditCheckout(r.db, { businessId, checkoutId: row.id, mode: "mock", externalId: null, amountMinor, currency: "USD", paidAt, eventId: `mock:${row.id}`, actor: { kind: "user", id: r.A.ownerId } });
  expect(res.outcome).toBe("granted");
  return row;
}

describe("credit lots", () => {
  it("expires 12 months after purchase, on the month's last day when the date does not exist", () => {
    expect(creditLotExpiry(new Date("2026-11-13T15:00:00Z")).toISOString()).toBe("2027-11-13T15:00:00.000Z");
    expect(creditLotExpiry(new Date("2028-02-29T10:00:00Z")).toISOString()).toBe("2029-02-28T10:00:00.000Z");
  });

  it("a paid top-up is one lot and a grant to the month's balance; included credits are spent before it", async () => {
    const biz = r.A.businessId;
    await repos.usage.ensurePeriodCredits(r.db, biz, thisMonth, 500);
    const checkout = await buy(biz, 2500);
    const lots = await repos.usage.creditLots(r.db, biz);
    expect(lots).toHaveLength(1);
    expect([lots[0]!.amountMinor, lots[0]!.remainingMinor, lots[0]!.checkoutId].map(String)).toEqual(["2500", "2500", checkout.id]);
    expect(Number((await repos.usage.creditBalance(r.db, biz, thisMonth))!.balanceMinor)).toBe(3000);
    // $3 spent: the $5 included covers it, the lot is untouched.
    await repos.usage.chargeCredits(r.db, biz, thisMonth, 300);
    expect(Number((await repos.usage.creditLots(r.db, biz))[0]!.remainingMinor)).toBe(2500);
    // $4 more: $2 of included left, $2 from the lot.
    await repos.usage.chargeCredits(r.db, biz, thisMonth, 400);
    expect(Number((await repos.usage.creditLots(r.db, biz))[0]!.remainingMinor)).toBe(2300);
    expect(Number((await repos.usage.creditBalance(r.db, biz, thisMonth))!.balanceMinor)).toBe(2300);
  });

  it("a new month starts with its included credits plus every live lot", async () => {
    const biz = r.A.businessId;
    const next = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2)));
    const { balance, created } = await repos.usage.ensurePeriodCredits(r.db, biz, next, 500);
    expect(created).toBe(true);
    expect(Number(balance.balanceMinor)).toBe(500 + 2300);
  });

  it("spends the lot that expires first first, and an expired lot leaves the balance", async () => {
    const biz = r.B.businessId;
    await repos.usage.ensurePeriodCredits(r.db, biz, thisMonth, 0);
    // An older purchase, carried into this month (as a new month's row would carry it), and one paid today.
    const old = new Date(now.getTime() - 300 * 24 * 60 * 60_000);
    await repos.usage.addCreditLot(r.db, biz, { amountMinor: 1000, purchasedAt: old });
    await repos.usage.grantCredits(r.db, biz, thisMonth, 1000);
    await buy(biz, 1000, now);
    // The month's row was created before both purchases, so the balance is the two grants.
    expect(Number((await repos.usage.creditBalance(r.db, biz, thisMonth))!.balanceMinor)).toBe(2000);
    await repos.usage.chargeCredits(r.db, biz, thisMonth, 300);
    const [newer, older] = await repos.usage.creditLots(r.db, biz);
    expect([Number(older!.remainingMinor), Number(newer!.remainingMinor)]).toEqual([700, 1000]);
    // The older lot reaches its expiry: what is left of it leaves the balance on the next charge.
    await r.db.update(s.creditLots).set({ expiresAt: new Date(now.getTime() - 1000) }).where(eq(s.creditLots.id, older!.id));
    const charged = await repos.usage.chargeCredits(r.db, biz, thisMonth, 100);
    expect(Number(charged!.balance.balanceMinor)).toBe(2000 - 300 - 700 - 100);
    const after = await repos.usage.creditLots(r.db, biz);
    expect(after.map((l) => Number(l.remainingMinor))).toEqual([900, 0]);
    expect(await repos.usage.liveLotCredits(r.db, biz)).toBe(900);
  });

  it("members read their business's lots and nobody else's; only services write", async () => {
    const mine = await r.h.asUser(r.A.ownerId).run((tx) => tx.select().from(s.creditLots));
    expect(mine.every((l) => l.businessId === r.A.businessId) && mine.length > 0).toBe(true);
    await expect(r.h.asUser(r.A.ownerId).run((tx) => tx.insert(s.creditLots).values({ businessId: r.A.businessId, amountMinor: 100, remainingMinor: 100, purchasedAt: now, expiresAt: creditLotExpiry(now) }))).rejects.toThrow();
  });
});
