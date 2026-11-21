/**
 * 0150: a domain checkout and `domain_registrants`.
 *   - no app role reads or writes `domain_registrants`: not the founder who paid, not another founder of the project,
 *     not anyone outside it (a founder's address is theirs alone);
 *   - a domain checkout names its domain (and only a domain checkout names one);
 *   - its one registration is claimed once, only when paid, and given back when the registry refused.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainOrdersStore, repos } from "../../repos";
import { settleCreditCheckout } from "../../payments";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const OWNER = { firstName: "Maya", lastName: "Lee", address1: "12 Elm Street", city: "Springfield", state: "IL", postalCode: "62701", country: "US", phone: "+1.2175550123", email: "maya@example.com" };

async function domainCheckout(f: BusinessFixture, paid: boolean): Promise<string> {
  const c = await h.service().run((tx) => repos.checkouts.create(tx, f.businessId, { kind: "domain", mode: "mock", amountMinor: 1425, domainName: "acme-goods.com", createdBy: f.ownerId }));
  await h.service().run((tx) => repos.domainRegistrants.put(tx, f.businessId, c.id, OWNER));
  if (paid) await settleCreditCheckout(h.db as never, { businessId: f.businessId, checkoutId: c.id, externalId: null, eventId: `mock:${c.id}`, amountMinor: 1425, currency: "USD", mode: "mock", paidAt: new Date(), actor: { kind: "user", id: f.ownerId } });
  return c.id;
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "registrant-a");
  B = await createBusinessFixture(h, "registrant-b");
}, 120_000);
afterAll(() => h?.close());

describe("domain_registrants: nobody but the services", () => {
  it("no app role reads or writes it, not even the project's own founders", async () => {
    const id = await domainCheckout(A, false);
    for (const userId of [A.ownerId, A.adminId, A.memberId, B.ownerId]) {
      await expect(h.asUser(userId).run((tx) => tx.select().from(s.domainRegistrants))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.update(s.domainRegistrants).set({ registrant: {} }).where(eq(s.domainRegistrants.checkoutId, id)))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.insert(s.domainRegistrants).values({ businessId: A.businessId, checkoutId: id, registrant: {} }))).rejects.toThrow(RLS_DENIED);
    }
    await expect(h.anon().run((tx) => tx.select().from(s.domainRegistrants))).rejects.toThrow(RLS_DENIED);
    expect(await repos.domainRegistrants.get(h.db as never, A.businessId, id)).toMatchObject({ firstName: "Maya" });
    // Another business's id never reads A's row.
    expect(await repos.domainRegistrants.get(h.db as never, B.businessId, id)).toBeNull();
  });

  it("only a domain checkout names a domain", async () => {
    await expect(h.service().run((tx) => repos.checkouts.create(tx, A.businessId, { kind: "domain", mode: "mock", amountMinor: 1425 }))).rejects.toThrow();
    await expect(h.service().run((tx) => repos.checkouts.create(tx, A.businessId, { kind: "credits", mode: "mock", amountMinor: 1425, domainName: "acme-goods.com" }))).rejects.toThrow();
  });
});

describe("a domain checkout's one registration", () => {
  it("is claimed only once it is paid, only once, and by its own business", async () => {
    const orders = domainOrdersStore(h.db as never);
    const open = await domainCheckout(A, false);
    expect(await orders.claim(A.businessId, open)).toBeNull();
    const paid = await domainCheckout(A, true);
    expect(await orders.claim(B.businessId, paid)).toBeNull();
    expect(await orders.claim(A.businessId, paid)).toEqual({ domain: "acme-goods.com", priceMinor: 1425, owner: expect.objectContaining({ email: "maya@example.com" }), simulated: true, createdBy: A.ownerId });
    expect(await orders.claim(A.businessId, paid)).toBeNull();
    // The registry refused: it may be tried again.
    await orders.release(A.businessId, paid, "taken");
    expect((await repos.checkouts.get(h.db as never, A.businessId, paid)).failure).toBe("taken");
    expect(await orders.claim(A.businessId, paid)).not.toBeNull();
    await orders.done(A.businessId, paid);
    expect(await repos.domainRegistrants.get(h.db as never, A.businessId, paid)).toBeNull();
  });

  it("paying a domain checkout grants no credits", async () => {
    const before = await repos.usage.creditBalance(h.db as never, B.businessId, new Date().toISOString().slice(0, 7));
    await domainCheckout(B, true);
    const after = await repos.usage.creditBalance(h.db as never, B.businessId, new Date().toISOString().slice(0, 7));
    expect(Number(after?.balanceMinor ?? 0)).toBe(Number(before?.balanceMinor ?? 0));
  });
});
