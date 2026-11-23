/**
 * The nightly numbers (WP-02 T10): yesterday's UTC day of funnel, north star, retention, agent-work and honesty counts
 * across real projects (`repos.metrics.snapshot`), stored as one `platform_metric_days` row (`repos.metrics.record`; a
 * second run for the day replaces it) and logged as `{ platformReport: "metrics", day }`. Counts only, no ids or names.
 * When the median time from commit to the first plan passes ten minutes it also logs `{ alert: "first_plan_slow" }`.
 * Seven days after SKILLS_PRELOAD_FROM it raises one `{ alert: "skills_preload_verdict" }` note (WP-06 T13).
 */
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";

const DAY_MS = 86_400_000;
/** The preload test runs for seven days from SKILLS_PRELOAD_FROM (founder, Nov 18, 2026). */
export const SKILLS_PRELOAD_DAYS = 7;

type Half = { sessions: number; avgTokensIn: number; avgTokensOut: number; avgCostMinor: number };

/** "keep on" only when both halves ran code tasks and the preloaded half cost less per code task; otherwise "turn off". */
export function skillsPreloadVerdict(halves: { on: Half; off: Half }): "keep on" | "turn off" {
  return halves.on.sessions > 0 && halves.off.sessions > 0 && halves.on.avgCostMinor < halves.off.avgCostMinor ? "keep on" : "turn off";
}

export function createPlatformMetricsActivities(deps: OrchestratorDeps) {
  return {
    async recordPlatformMetrics(_input: Record<string, never> = {}): Promise<{ day: string }> {
      const yesterday = new Date(deps.clock.now().getTime() - DAY_MS);
      const facts = await repos.metrics.snapshot(deps.db, yesterday);
      await repos.metrics.record(deps.db, facts.day, facts);
      deps.log.info({ platformReport: "metrics", day: facts.day }, "nightly platform numbers recorded");
      // WP-14 T12: a slow first plan is the operator's to hear about (an error log an alert can match, as model_billing is).
      if (facts.first_session.note) deps.log.error({ alert: "first_plan_slow", day: facts.day, medianMinutes: facts.first_session.to_first_plan.median_min }, facts.first_session.note);
      // WP-06 T13: the night that closes the seventh day of the preload test raises its one note for the operator.
      const from = deps.env.SKILLS_PRELOAD_FROM;
      if (from) {
        const start = new Date(`${from}T00:00:00Z`);
        const end = new Date(start.getTime() + SKILLS_PRELOAD_DAYS * DAY_MS);
        if (facts.day === new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10)) {
          const halves = await repos.metrics.skillsPreloadComparison(deps.db, start, end);
          const verdict = skillsPreloadVerdict(halves);
          deps.log.error({ alert: "skills_preload_verdict", from, days: SKILLS_PRELOAD_DAYS, on: halves.on, off: halves.off, verdict }, `Skills preload test: ${verdict} (average cost per code task, USD cents, Estimate: on ${halves.on.avgCostMinor}, off ${halves.off.avgCostMinor})`);
        }
      }
      return { day: facts.day };
    },
  };
}
