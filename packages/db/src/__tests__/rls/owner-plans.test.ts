/**
 * 0144 — plans and prices (WP-14 T14): `owner_plans` (account-scoped, the service role's only) and `partner_waitlist`
 * (business-scoped; the generated cross-tenant suite covers its walls, this file its rules).
 *
 *   - no client role reads or writes `owner_plans`, a person's own row included: the invited marker cannot be forged;
 *   - the marker is the day the account was made, is kept once set, and the opening step marks everyone from before;
 *   - the first Founder or Studio price paid is kept while the person stays subscribed;
 *   - joining the Partner waitlist records the owner, the project and consent, once.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsider: string;

const svc = <T>(fn: Parameters<ReturnType<TestHarness["service"]>["run"]>[0]) => h.service().run(fn) as Promise<T>;
const madeAt = async (userId: string) => ((await h.pg.query<{ created_at: Date }>(`select created_at from auth.users where id = $1`, [userId])).rows[0]!.created_at as Date).getTime();

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "plans-a");
  B = await createBusinessFixture(h, "plans-b");
  outsider = await h.createUser("plans-outsider@test.local");
}, 120_000);
afterAll(() => h?.close());

describe("owner_plans 0144: the service role's only", () => {
  it("no client role reads or writes a row, the person's own included", async () => {
    await svc((tx) => repos.ownerPlans.markInvited(tx, A.ownerId));
    for (const runner of [h.anon(), h.asUser(outsider), h.asUser(A.ownerId)]) {
      await expect(runner.execute(sql`select user_id from owner_plans`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`insert into owner_plans (user_id, invited_at) values (${outsider}, now())`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`update owner_plans set invited_at = now()`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`delete from owner_plans`)).rejects.toThrow(/permission denied/);
      await expect(runner.run((tx) => repos.ownerPlans.get(tx, A.ownerId))).rejects.toThrow(/permission denied/);
    }
    expect(await svc((tx) => repos.ownerPlans.get(tx, outsider))).toBeNull();
  });

  it("the marker carries the day the account was made and is kept once set", async () => {
    const first = await svc<Awaited<ReturnType<typeof repos.ownerPlans.get>>>((tx) => repos.ownerPlans.get(tx, A.ownerId));
    expect(first?.invitedAt?.getTime()).toBe(await madeAt(A.ownerId));
    await h.pg.query(`update auth.users set created_at = created_at + interval '3 days' where id = $1`, [A.ownerId]);
    await svc((tx) => repos.ownerPlans.markInvited(tx, A.ownerId));
    expect((await svc<Awaited<ReturnType<typeof repos.ownerPlans.get>>>((tx) => repos.ownerPlans.get(tx, A.ownerId)))?.invitedAt?.getTime()).toBe(first?.invitedAt?.getTime());
  });

  it("the opening step marks everyone from before the cutoff once, and nobody after it", async () => {
    const late = await h.createUser("plans-late@test.local");
    await h.pg.query(`update auth.users set created_at = '2031-01-02T00:00:00Z' where id = $1`, [late]);
    await h.pg.query(`update auth.users set created_at = '2030-12-01T00:00:00Z' where id = $1`, [outsider]);
    const cutoff = new Date("2031-01-01T00:00:00Z");
    const marked = await svc<number>((tx) => repos.ownerPlans.markInvitedBefore(tx, cutoff));
    expect(marked).toBeGreaterThanOrEqual(1);
    expect((await svc<Awaited<ReturnType<typeof repos.ownerPlans.get>>>((tx) => repos.ownerPlans.get(tx, outsider)))?.invitedAt?.toISOString()).toBe("2030-12-01T00:00:00.000Z");
    expect(await svc((tx) => repos.ownerPlans.get(tx, late))).toBeNull();
    expect(await svc<number>((tx) => repos.ownerPlans.markInvitedBefore(tx, cutoff))).toBe(0);
  });

  it("the first price paid for a plan is kept: paying again at another price changes nothing; another plan replaces it; the marker stays", async () => {
    const who = B.ownerId;
    await svc((tx) => repos.ownerPlans.markInvited(tx, who));
    expect(await svc((tx) => repos.ownerPlans.storePrice(tx, who, { tier: "pro", priceMinor: 1500 }))).toMatchObject({ priceTier: "pro", priceMinor: 1500 });
    expect(await svc((tx) => repos.ownerPlans.storePrice(tx, who, { tier: "pro", priceMinor: 2500 }))).toMatchObject({ priceTier: "pro", priceMinor: 1500 });
    expect(await svc((tx) => repos.ownerPlans.storePrice(tx, who, { tier: "scale", priceMinor: 5000 }))).toMatchObject({ priceTier: "scale", priceMinor: 5000 });
    await svc((tx) => repos.ownerPlans.clearPrice(tx, who));
    const after = await svc<Awaited<ReturnType<typeof repos.ownerPlans.get>>>((tx) => repos.ownerPlans.get(tx, who));
    expect(after).toMatchObject({ priceTier: null, priceMinor: null, priceSetAt: null });
    expect(after?.invitedAt).not.toBeNull();
    await expect(h.pg.query(`update owner_plans set price_tier = 'free', price_minor = 500, price_set_at = now() where user_id = $1`, [who])).rejects.toThrow(/price_tier_value/);
    await expect(h.pg.query(`update owner_plans set price_minor = 500 where user_id = $1`, [who])).rejects.toThrow(/price_together/);
  });
});

describe("partner_waitlist 0144", () => {
  it("records the owner, the project and consent once; the project's owner reads it, another project's owner and a collaborator do not", async () => {
    const at = new Date("2026-11-17T12:00:00Z");
    const joined = await svc<Awaited<ReturnType<typeof repos.partnerWaitlist.join>>>((tx) => repos.partnerWaitlist.join(tx, A.businessId, { userId: A.ownerId, consentedAt: at }));
    expect(joined).toMatchObject({ created: true, entry: { businessId: A.businessId, userId: A.ownerId, consentedAt: at } });
    const again = await svc<Awaited<ReturnType<typeof repos.partnerWaitlist.join>>>((tx) => repos.partnerWaitlist.join(tx, A.businessId, { userId: A.ownerId }));
    expect(again).toMatchObject({ created: false, entry: { id: joined.entry.id, consentedAt: at } });
    expect(await h.asUser(A.ownerId).run((tx) => repos.partnerWaitlist.entry(tx, A.businessId, A.ownerId))).toMatchObject({ id: joined.entry.id });
    expect(await h.asUser(B.ownerId).run((tx) => repos.partnerWaitlist.entry(tx, A.businessId, A.ownerId))).toBeNull();
    await expect(h.asUser(A.ownerId).run((tx) => repos.partnerWaitlist.join(tx, A.businessId, { userId: A.adminId }))).rejects.toThrow();
  });
});
