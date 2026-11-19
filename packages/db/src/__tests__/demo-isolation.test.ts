/**
 * A8-06 (WP-02 T10): demo data never reaches the platform's numbers. The same fixture is built twice, with and without
 * the demo project's rows (a page.published event, a webhook payment, a simulated email, cycles, notes, visits, an
 * invitation, a mock connection, agent sessions, approvals and an audit row); every function in `repos.metrics` and
 * `presenceRepo.retentionReport` returns the same result. The two counts that exist to count the demo
 * (`projects.total` and `projects.demo`) differ by exactly that one project.
 */
import { HOUSE_BUSINESS_ID } from "@foundmill/config";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
import type { Executor } from "../repos/_shared";
import { metricWindowEnd, type MetricFacts } from "../repos/metrics";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { AS_OF, buildMetricsFixture } from "./metrics-fixture";

let withDemo: TestHarness;
let without: TestHarness;

beforeAll(async () => {
  [withDemo, without] = await Promise.all([createTestDb(), createTestDb()]);
  await buildMetricsFixture(withDemo, { withDemo: true });
  await buildMetricsFixture(without, { withDemo: false });
});
afterAll(async () => {
  await withDemo?.close();
  await without?.close();
});

const DAY_MS = 86_400_000;

/**
 * Every repo function that reads more than one project (packages/db/CLAUDE.md): it joins `real_businesses` and is listed
 * here, and each is compared with and without a demo project below. A new report that forgets the view fails once listed.
 */
const end = metricWindowEnd(AS_OF);
const anon = (r: Awaited<ReturnType<typeof repos.presence.retentionReport>>) => ({ ...r, rows: r.rows.map(({ businessId: _b, ownerUserId: _o, ...rest }) => rest) });
const stripDemoCounts = (f: MetricFacts) => ({ ...f, projects: { ...f.projects, total: 0, demo: 0 } });
export const CROSS_BUSINESS_REPORTS: { name: string; run: (db: Executor) => Promise<unknown> }[] = [
  { name: "metrics.snapshot", run: async (db) => stripDemoCounts(await repos.metrics.snapshot(db, AS_OF)) },
  { name: "presence.retentionReport", run: async (db) => anon(await repos.presence.retentionReport(db, { from: new Date(end.getTime() - 14 * DAY_MS), to: end })) },
];

describe("demo isolation", () => {
  it("the two counts that exist to count the demo differ by exactly that one project", async () => {
    const a = await repos.metrics.snapshot(withDemo.db, AS_OF);
    const b = await repos.metrics.snapshot(without.db, AS_OF);
    expect([a.projects.total - b.projects.total, a.projects.demo - b.projects.demo]).toEqual([1, 1]);
  });

  it("repos.metrics.record and history are the same", async () => {
    for (const h of [withDemo, without]) await repos.metrics.record(h.db, "2026-11-14", { n: 1 });
    expect(await repos.metrics.history(withDemo.db, 14)).toEqual(await repos.metrics.history(without.db, 14));
  });

  it("the retention report counts the two real projects and not the demo", async () => {
    const a = await repos.presence.retentionReport(withDemo.db, { from: new Date(end.getTime() - 14 * DAY_MS), to: end });
    expect(a.businesses).toBe(2);
  });

  for (const report of CROSS_BUSINESS_REPORTS) {
    it(`${report.name} is the same with and without a demo project`, async () => {
      expect(await report.run(withDemo.db)).toEqual(await report.run(without.db));
    });
  }
});

describe("real_businesses (0143)", () => {
  const rows = async (h: TestHarness) => ((await h.db.execute(sql`select id, is_house from real_businesses`)) as unknown as { rows: { id: string; is_house: boolean }[] }).rows;

  it("holds no sample, and is_house is true for the house project alone", async () => {
    const real = await rows(withDemo);
    const demo = ((await withDemo.db.execute(sql`select id from businesses where is_demo`)) as unknown as { rows: { id: string }[] }).rows;
    expect(demo.length).toBe(1);
    expect(real.some((r) => r.id === demo[0]!.id)).toBe(false);
    expect(real.filter((r) => r.is_house).map((r) => r.id)).toEqual([HOUSE_BUSINESS_ID]);
    expect(real.length).toBe((await rows(without)).length);
  });

  it("anon and authenticated cannot read it", async () => {
    const user = await withDemo.createUser("real-businesses@test.local");
    await expect(withDemo.anon().execute(sql`select id from real_businesses`)).rejects.toThrow(/permission denied/);
    await expect(withDemo.asUser(user).execute(sql`select id from real_businesses`)).rejects.toThrow(/permission denied/);
  });
});
