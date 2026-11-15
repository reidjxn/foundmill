/**
 * The nightly numbers (WP-02 T10): yesterday's UTC day of funnel, north star, retention, agent-work and honesty counts
 * across real projects (`repos.metrics.snapshot`), stored as one `platform_metric_days` row (`repos.metrics.record`; a
 * second run for the day replaces it) and logged as `{ platformReport: "metrics", day }`. Counts only, no ids or names.
 */
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";

const DAY_MS = 86_400_000;

export function createPlatformMetricsActivities(deps: OrchestratorDeps) {
  return {
    async recordPlatformMetrics(_input: Record<string, never> = {}): Promise<{ day: string }> {
      const yesterday = new Date(deps.clock.now().getTime() - DAY_MS);
      const facts = await repos.metrics.snapshot(deps.db, yesterday);
      await repos.metrics.record(deps.db, facts.day, facts);
      deps.log.info({ platformReport: "metrics", day: facts.day }, "nightly platform numbers recorded");
      return { day: facts.day };
    },
  };
}
