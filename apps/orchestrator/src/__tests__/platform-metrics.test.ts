/** The nightly numbers' activity (WP-02 T10): yesterday's UTC day, recorded once, logged by day, re-run in place. */
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlatformMetricsActivities, skillsPreloadVerdict } from "../activities/platform-metrics";
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

  it("raises the skills preload note once, on the night that closes the test's seventh day (WP-06 T13)", async () => {
    const error = vi.spyOn(t.deps.log, "error");
    const acts = createPlatformMetricsActivities(t.deps);
    const before = t.deps.env.SKILLS_PRELOAD_FROM;
    try {
      // The run records Nov 14: a test from Nov 9 has one day left, so no note yet.
      t.deps.env.SKILLS_PRELOAD_FROM = "2026-11-09";
      await acts.recordPlatformMetrics({});
      expect(error).not.toHaveBeenCalledWith(expect.objectContaining({ alert: "skills_preload_verdict" }), expect.any(String));
      // From Nov 8, Nov 14 is the seventh day: the note, with each half's averages and the verdict.
      t.deps.env.SKILLS_PRELOAD_FROM = "2026-11-08";
      await acts.recordPlatformMetrics({});
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ alert: "skills_preload_verdict", from: "2026-11-08", days: 7, verdict: "turn off", on: expect.objectContaining({ sessions: 0 }) }), expect.stringContaining("Skills preload test: turn off"));
      // Unset: nothing is counted and no note is raised.
      error.mockClear();
      t.deps.env.SKILLS_PRELOAD_FROM = undefined;
      await acts.recordPlatformMetrics({});
      expect(error).not.toHaveBeenCalledWith(expect.objectContaining({ alert: "skills_preload_verdict" }), expect.any(String));
    } finally {
      t.deps.env.SKILLS_PRELOAD_FROM = before;
    }
  });

  it("says keep on only when both halves ran and the preloaded half cost less per code task", () => {
    const half = (sessions: number, avgCostMinor: number) => ({ sessions, avgTokensIn: 0, avgTokensOut: 0, avgCostMinor });
    expect(skillsPreloadVerdict({ on: half(10, 4), off: half(10, 5) })).toBe("keep on");
    expect(skillsPreloadVerdict({ on: half(10, 5), off: half(10, 5) })).toBe("turn off");
    expect(skillsPreloadVerdict({ on: half(10, 6), off: half(10, 5) })).toBe("turn off");
    expect(skillsPreloadVerdict({ on: half(0, 0), off: half(10, 5) })).toBe("turn off");
    expect(skillsPreloadVerdict({ on: half(10, 4), off: half(0, 0) })).toBe("turn off");
  });
});
