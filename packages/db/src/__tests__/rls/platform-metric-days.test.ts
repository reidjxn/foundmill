/**
 * platform_metric_days (0109; WP-02 T10): the nightly numbers. Not business-scoped and service role only: RLS on, no
 * policy, no client grant, so a signed-in person or a visitor reads nothing of it (the select is refused outright, which
 * is stricter than zero rows) and writes nothing; `repos.metrics.record` on the service connection writes one row a day.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { metricsRepo } from "../../repos/metrics";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";

let h: TestHarness;
let ada: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada-metrics@test.local");
  await metricsRepo.record(h.db, "2026-11-14", { accounts: { total: 1 } });
});
afterAll(() => h?.close());

describe("platform_metric_days", () => {
  it("has RLS on and no policy", async () => {
    const t = await h.db.execute(sql`select relrowsecurity as on from pg_class where relname = 'platform_metric_days'`);
    expect((t.rows[0] as { on: boolean }).on).toBe(true);
    const p = await h.db.execute(sql`select count(*)::int as n from pg_policies where tablename = 'platform_metric_days'`);
    expect((p.rows[0] as { n: number }).n).toBe(0);
  });

  it("a signed-in person and a visitor read no row and write none", async () => {
    for (const role of [() => h.anon(), () => h.asUser(ada)]) {
      const read = await role()
        .run((tx) => tx.select().from(s.platformMetricDays))
        .then((rows) => rows.length, (err: Error) => (/permission denied/.test(err.message) ? 0 : Promise.reject(err)));
      expect(read).toBe(0);
      await expect(role().run((tx) => tx.insert(s.platformMetricDays).values({ day: "2026-11-13", facts: {} }))).rejects.toThrow(/permission denied/);
    }
  });

  it("the service role reads what record wrote, one row a day (a second record replaces it)", async () => {
    await metricsRepo.record(h.db, "2026-11-14", { accounts: { total: 2 } });
    const rows = await h.service().run((tx) => tx.select().from(s.platformMetricDays));
    expect(rows.map((r) => [r.day, r.facts])).toEqual([["2026-11-14", { accounts: { total: 2 } }]]);
  });
});
