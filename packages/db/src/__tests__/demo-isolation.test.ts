/**
 * A8-06 (WP-02 T10): demo data never reaches the platform's numbers. The same fixture is built twice, with and without
 * the demo project's rows (a page.published event, a webhook payment, a simulated email, cycles, notes, visits, an
 * invitation, a mock connection, agent sessions, approvals and an audit row); every function in `repos.metrics` and
 * `presenceRepo.retentionReport` returns the same result. The two counts that exist to count the demo
 * (`projects.total` and `projects.demo`) differ by exactly that one project.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
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

describe("demo isolation", () => {
  it("repos.metrics.snapshot is the same with and without the demo project", async () => {
    const a = await repos.metrics.snapshot(withDemo.db, AS_OF);
    const b = await repos.metrics.snapshot(without.db, AS_OF);
    const strip = (f: MetricFacts) => ({ ...f, projects: { ...f.projects, total: 0, demo: 0 } });
    expect(strip(a)).toEqual(strip(b));
    expect([a.projects.total - b.projects.total, a.projects.demo - b.projects.demo]).toEqual([1, 1]);
  });

  it("repos.metrics.record and history are the same", async () => {
    for (const h of [withDemo, without]) await repos.metrics.record(h.db, "2026-11-14", { n: 1 });
    expect(await repos.metrics.history(withDemo.db, 14)).toEqual(await repos.metrics.history(without.db, 14));
  });

  it("presenceRepo.retentionReport is the same, apart from the generated business ids", async () => {
    const end = metricWindowEnd(AS_OF);
    const range = { from: new Date(end.getTime() - 14 * DAY_MS), to: end };
    const anon = (r: Awaited<ReturnType<typeof repos.presence.retentionReport>>) => ({ ...r, rows: r.rows.map(({ businessId: _b, ownerUserId: _o, ...rest }) => rest) });
    const a = await repos.presence.retentionReport(withDemo.db, range);
    const b = await repos.presence.retentionReport(without.db, range);
    expect(anon(a)).toEqual(anon(b));
    expect(a.businesses).toBe(2);
  });
});
