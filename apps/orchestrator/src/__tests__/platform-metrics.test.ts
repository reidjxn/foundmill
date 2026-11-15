/** The nightly numbers' activity (WP-02 T10): yesterday's UTC day, recorded once, logged by day, re-run in place. */
import { repos } from "@foundmill/db";
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
});
