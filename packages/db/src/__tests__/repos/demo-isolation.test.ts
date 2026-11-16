/**
 * No sample changes a number that reads across projects (WP-11 T9, A8-06). Every report in CROSS_BUSINESS_REPORTS is
 * run, a sample business with the same activity is added, and every report must give the same answer. A new
 * cross-project report joins real_businesses (0121) and is listed here (packages/db CLAUDE.md).
 * The WP-02 reports (cost report, metric facts) filter `is_demo` in their own SQL and read other columns of businesses,
 * so they are listed here without joining the view; the metric facts' own `demo` count is left out of the comparison
 * because counting samples is what it is for.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUSE_BUSINESS_ID } from "@foundmill/config";
import type { Executor } from "../../repos/_shared";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED } from "../rls/fixtures";

const FROM = new Date("2026-11-01T00:00:00Z");
const TO = new Date("2026-11-15T00:00:00Z");
const COMMITTED = "2026-11-03T10:00:00Z";

export const CROSS_BUSINESS_REPORTS: { name: string; run: (db: Executor) => Promise<unknown> }[] = [
  { name: "presence.retentionReport", run: (db) => repos.presence.retentionReport(db, { from: FROM, to: TO }) },
  { name: "costReport.run", run: (db) => repos.costReport.run(db, { from: FROM, to: TO }) },
  {
    name: "metrics.snapshot (without its demo count)",
    run: async (db) => {
      const facts = (await repos.metrics.snapshot(db, TO)) as unknown as Record<string, unknown>;
      return JSON.parse(JSON.stringify(facts, (key, value) => (key === "demo" ? undefined : value)));
    },
  },
];

let h: TestHarness;
const exec = (q: ReturnType<typeof sql>) => h.db.execute(q) as unknown as Promise<{ rows: Record<string, unknown>[] }>;

beforeAll(async () => {
  h = await createTestDb();
  const real = await createBusinessFixture(h, "demo-iso-real");
  await exec(sql`update businesses set committed_at = ${COMMITTED}::timestamptz where id = ${real.businessId}`);
}, 120_000);
afterAll(() => h?.close());

describe("real_businesses and the cross-project reports", () => {
  it("a sample with the same activity changes no cross-project report", async () => {
    const before = [];
    for (const r of CROSS_BUSINESS_REPORTS) before.push(await r.run(h.db as unknown as Executor));
    const sample = await createBusinessFixture(h, "demo-iso-sample");
    await exec(sql`update businesses set is_demo = true, committed_at = ${COMMITTED}::timestamptz where id = ${sample.businessId}`);
    for (const [i, r] of CROSS_BUSINESS_REPORTS.entries()) expect(await r.run(h.db as unknown as Executor), r.name).toEqual(before[i]);
    // The guard is live: the sample shows once it is not a sample.
    await exec(sql`update businesses set is_demo = false where id = ${sample.businessId}`);
    expect(await CROSS_BUSINESS_REPORTS[0]!.run(h.db as unknown as Executor)).not.toEqual(before[0]);
    await exec(sql`update businesses set is_demo = true where id = ${sample.businessId}`);
  });

  it("is_house is true for Foundmill's own project alone, and a sample never appears", async () => {
    await exec(sql`insert into businesses (id, name, slug, created_by) select ${HOUSE_BUSINESS_ID}::uuid, 'Foundmill', 'foundmill-house', created_by from businesses limit 1`);
    const rows = (await exec(sql`select r.id, r.is_house, b.is_demo from real_businesses r join businesses b on b.id = r.id`)).rows;
    expect(rows.filter((r) => r.is_house).map((r) => r.id)).toEqual([HOUSE_BUSINESS_ID]);
    expect(rows.some((r) => r.is_demo)).toBe(false);
  });

  it("the client roles cannot read the view", async () => {
    const user = await h.createUser("demo-iso-client");
    await expect(h.asUser(user).execute(sql`select id from real_businesses`)).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(user, "anon").execute(sql`select id from real_businesses`)).rejects.toThrow(RLS_DENIED);
  });
});
