/**
 * The nightly numbers (WP-02 T10): yesterday's UTC day of funnel, north star, retention, agent-work and honesty counts
 * across real projects (`repos.metrics.snapshot`), stored as one `platform_metric_days` row (`repos.metrics.record`; a
 * second run for the day replaces it) and logged as `{ platformReport: "metrics", day }`. Counts only, no ids or names.
 * When the median time from commit to the first plan passes ten minutes it also logs `{ alert: "first_plan_slow" }`.
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
      // WP-14 T12: a slow first plan is the operator's to hear about (an error log an alert can match, as model_billing is).
      if (facts.first_session.note) deps.log.error({ alert: "first_plan_slow", day: facts.day, medianMinutes: facts.first_session.to_first_plan.median_min }, facts.first_session.note);
      return { day: facts.day };
    },
  };
}
