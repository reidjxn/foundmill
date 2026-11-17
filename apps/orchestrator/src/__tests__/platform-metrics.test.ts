/** The nightly numbers' activity (WP-02 T10): yesterday's UTC day, recorded once, logged by day, re-run in place. */
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlatformMetricsActivities } from "../activities/platform-metrics";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "platmetrics", clockStart: "2026-11-15T03:15:00.000Z" });
});
afterAll(async () => {
  await t?.close();
});

describe("recordPlatformMetrics", () => {
  it("records the UTC day before the run, logs only the day, and replaces the row on a second run", async () => {
    const info = vi.spyOn(t.deps.log, "info");
    const acts = createPlatformMetricsActivities(t.deps);
    expect(await acts.recordPlatformMetrics({})).toEqual({ day: "2026-11-14" });
    expect(info).toHaveBeenCalledWith({ platformReport: "metrics", day: "2026-11-14" }, expect.any(String));
    await acts.recordPlatformMetrics({});
    const days = await repos.metrics.history(t.db, 14);
    expect(days.map((d) => d.day)).toEqual(["2026-11-14"]);
    expect(days[0]!.facts).toMatchObject({ day: "2026-11-14", asOfEnd: "2026-11-15T00:00:00.000Z" });
  });

  it("tells the operator when the median time from commit to the first plan passes ten minutes (WP-14 T12)", async () => {
    const error = vi.spyOn(t.deps.log, "error");
    const acts = createPlatformMetricsActivities(t.deps);
    await acts.recordPlatformMetrics({});
    expect(error).not.toHaveBeenCalledWith(expect.objectContaining({ alert: "first_plan_slow" }), expect.any(String));
    // A project committed on the day, whose plan was asked for 25 minutes later.
    await t.db.execute(sql`update businesses set committed_at = '2026-11-14T10:00:00Z', is_demo = false where id = ${t.businessId}`);
    await t.db.execute(sql`insert into product_signoffs (business_id, kind, round, status, requested_at) values (${t.businessId}, 'spec', 1, 'pending', '2026-11-14T10:25:00Z')`);
    await acts.recordPlatformMetrics({});
    expect(error).toHaveBeenCalledWith({ alert: "first_plan_slow", day: "2026-11-14", medianMinutes: 25 }, expect.stringContaining("25 minutes"));
  });
});
