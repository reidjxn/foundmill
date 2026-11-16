/** The free plan's monthly cap (WP-13 T6): what counts, the three states, the message and the cache. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cachedFreeCap, capMonth, freeCapHeldMessage, freeCapState, freePlanSpendMicro } from "../free-plan-cap";
import { repos } from "../repos";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

let h: TestHarness;
let free: BusinessFixture;
let paid: BusinessFixture;
const NOW = new Date("2026-11-20T12:00:00Z");
const book = (businessId: string, costMicroMinor: number, opts: { billedTo?: "credits" | "byok"; at?: string } = {}) =>
  repos.usage.record(h.db, businessId, { kind: "tokens", modelKey: "haiku", costMicroMinor, currency: "USD", billedTo: opts.billedTo ?? "credits", occurredAt: opts.at ?? NOW.toISOString() });

beforeAll(async () => {
  h = await createTestDb();
  free = await createBusinessFixture(h, "cap-free");
  paid = await createBusinessFixture(h, "cap-paid");
  await h.db.execute(sql`update businesses set plan_tier = 'pro' where id = ${paid.businessId}`);
});
afterAll(async () => {
  await h?.close();
});

describe("the free plan's monthly cap (WP-13 T6)", () => {
  it("counts this month's platform-credit spend of free businesses only: not a paid plan, not an own key, not last month", async () => {
    const { start } = capMonth(NOW);
    const before = await freePlanSpendMicro(h.db, start);
    await book(free.businessId, 7_000_000);
    await book(paid.businessId, 50_000_000);
    await book(free.businessId, 9_000_000, { billedTo: "byok" });
    await book(free.businessId, 11_000_000, { at: "2026-10-31T23:59:00Z" });
    expect((await freePlanSpendMicro(h.db, start)) - before).toBe(7_000_000);
  });

  it("is open below 80%, slow from 80% and held at the cap", () => {
    const cap = 60_000; // $600 in cents
    expect(freeCapState(0, cap)).toBe("open");
    expect(freeCapState(cap * 1_000_000 * 0.8 - 1, cap)).toBe("open");
    expect(freeCapState(cap * 1_000_000 * 0.8, cap)).toBe("slow");
    expect(freeCapState(cap * 1_000_000, cap)).toBe("held");
    expect(freeCapState(0, 0)).toBe("held");
  });

  it("says when free AI is back, as a US date", () => {
    expect(capMonth(NOW).resetsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(freeCapHeldMessage(capMonth(NOW).resetsAt)).toBe("Free AI is busy for the rest of the month. It is back on Dec 1. To keep going now, connect your own Anthropic key.");
  });

  it("caches the state for its TTL", async () => {
    let at = NOW;
    const cap = cachedFreeCap(h.db, { capCents: 1, ttlMs: 1_000, now: () => at });
    expect((await cap()).state).toBe("held"); // 7 cents booked above, over a 1-cent cap
    const first = await cap();
    at = new Date(NOW.getTime() + 500);
    expect(await cap()).toBe(first);
    at = new Date(NOW.getTime() + 1_001);
    expect(await cap()).not.toBe(first);
  });
});
