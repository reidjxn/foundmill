/**
 * The nightly numbers (WP-02 T10): every block of `repos.metrics.snapshot` on a fixture of one demo project, the house
 * and two real projects (metrics-fixture.ts). The north star counts exactly one project: Alpha, in the week of its
 * first published page (the republish a week later is not a second outcome); Bravo's simulated email and payment, the
 * house's page and follow and everything in the demo count for nothing. `isRealOutcome` and the SQL agree on each event.
 */
import { isRealOutcome } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundMetricSql, METRIC_QUERIES, metricsRepo, metricWindowEnd, REAL_OUTCOME_PREDICATE, type MetricFacts } from "../repos/metrics";
import { repos } from "../repos";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { AS_OF, buildMetricsFixture } from "./metrics-fixture";

let h: TestHarness;
let m: MetricFacts;

beforeAll(async () => {
  h = await createTestDb();
  await buildMetricsFixture(h, { withDemo: true });
  m = await repos.metrics.snapshot(h.db, AS_OF);
});
afterAll(() => h?.close());

describe("repos.metrics.snapshot", () => {
  it("is for the UTC day of asOf, its windows ending at the next UTC midnight", () => {
    expect(metricWindowEnd(AS_OF).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect([m.day, m.asOfEnd]).toEqual(["2026-11-14", "2026-11-15T00:00:00.000Z"]);
  });

  it("accounts and the gate", () => {
    expect(m.accounts).toEqual({ total: 5, new_14d: 2, signed_in_14d: 2, profiles: 2 });
    // The demo's invitation is left out.
    expect(m.gate).toEqual({ waitlist: 1, invitations: 1, admissions: { invitation: 1, open: 1 } });
  });

  it("the funnel: 14 days, per day and in total, split by the account facts' payloads, and its medians", () => {
    expect(m.funnel.per_day).toHaveLength(14);
    expect(m.funnel.per_day[0]!.day).toBe("2026-11-01");
    expect(m.funnel.per_day.at(-1)!.day).toBe("2026-11-14");
    expect(m.funnel.per_day.find((d) => d.day === "2026-11-05")).toEqual({ day: "2026-11-05", idea_cards: 0, cards_kept: 1, accounts_new: 1, admitted: 1, profiles_created: 1, idea_drafted: 1, committed: 1, page_published: 1, first_other_outcome: 0 });
    // The house is a real project (not demo): its first page and its follow are in the funnel; Bravo's simulated
    // results and the demo's page and payment are not.
    expect(m.funnel.totals_14d).toEqual({ idea_cards: 2, cards_kept: 1, accounts_new: 2, admitted: 2, profiles_created: 2, idea_drafted: 1, committed: 2, page_published: 2, first_other_outcome: 1 });
    expect(m.funnel.by).toEqual({ admitted: { open: 1, invitation: 1 }, profiles_created: { web: 1, app: 1 }, idea_drafted: { set: 1 } });
    // Profile to commit: an hour for both founders. Commit to page: Alpha's two hours and the house's 72 days.
    expect(m.funnel.medians_min).toEqual({ profile_to_commit: 60, commit_to_page: (120 + 104_220) / 2 });
  });

  it("projects", () => {
    expect(m.projects).toEqual({ total: 4, demo: 1, real: 3, real_outside: 2, committed: 3, with_page_draft: 2, with_page_live: 1 });
  });

  it("the north star counts exactly one project, in the week of its first page, solo, visited that week", () => {
    expect(m.north_star).toHaveLength(12);
    expect(m.north_star.map((w) => w.week).slice(0, 3)).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
    expect(m.north_star[1]).toEqual({ week: "2026-11-02", projects_with_real_outcome: 1, solo: 1, together: 0, also_visited: 1 });
    expect(m.north_star.reduce((n, w) => n + w.projects_with_real_outcome, 0)).toBe(1);
  });

  it("retention", () => {
    expect(m.retention).toEqual({
      visit_users_14d: 2,
      visit_days_14d: 3,
      report_14d: { businesses: 2, activated: 0, habit: 0, page_within_24h: 1 },
      cycles: { projects_with_cycles: 2, cycles: 4, cycles_median: 2, span_days_median: 1.5, ran_only_first_day: 1 },
    });
  });

  it("agent work", () => {
    expect(m.agent_work).toEqual({
      sessions: { blocked: 2, done: 1, failed: 1 },
      sessions_ended: 4,
      blocked_share: 0.5,
      events: { task_blocked: 2, task_completed: 1, approval_requested: { launch_campaign: 1, merge_pr: 1 }, approval_requested_total: 2, approval_resolved: { approved: 1 }, approval_resolved_total: 1 },
      approvals_open: 1,
      approvals_open_over_9d: 1,
      tool_missing_stopped: 1,
      notes_day_one: { max: 2, median: 0 },
    });
  });

  it("safety: open reports and those past the review target (0112)", () => {
    expect(m.safety).toEqual({ reports_open: 0, reports_overdue: 0 });
  });

  it("honesty: T4's five counts, and the simulated outcomes the north star left out", () => {
    expect(m.honesty).toEqual({ fabricated_left: { mock_leads: 0, estimate_rows: 0, mock_integrations: 0, live_campaigns: 0, stale_launch_approvals: 1 }, simulated_outcomes_excluded: 2 });
  });

  it("isRealOutcome and the SQL agree on every fixture event", async () => {
    const rows = (await h.db.execute(sql.raw(`select e.type, e.actor, e.payload, ${REAL_OUTCOME_PREDICATE} as real from events e`))).rows as { type: string; actor: { kind: string; id: string }; payload: Record<string, unknown>; real: boolean }[];
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.real, `${r.type} ${JSON.stringify(r.actor)} ${JSON.stringify(r.payload)}`).toBe(isRealOutcome(r));
    expect(rows.filter((r) => r.real).map((r) => r.type).sort()).toEqual(["page.followed", "page.published", "page.published", "page.published", "page.published", "payment.received"]);
  });

  it("every query is printable SQL with the window end written in, and names are unique", () => {
    expect(new Set(METRIC_QUERIES.map((q) => q.name)).size).toBe(METRIC_QUERIES.length);
    for (const q of METRIC_QUERIES) {
      const text = boundMetricSql(q.text, metricWindowEnd(AS_OF));
      expect(text, q.name).not.toContain(":as_of_end");
      expect(text, q.name).toContain("'2026-11-15T00:00:00.000Z'::timestamptz");
    }
  });

  it("record stores the day's facts and history reads them back, newest first", async () => {
    await metricsRepo.record(h.db, "2026-11-13", { day: "2026-11-13" });
    await metricsRepo.record(h.db, m.day, m);
    const hist = await metricsRepo.history(h.db, 14);
    expect(hist.map((x) => x.day)).toEqual(["2026-11-14", "2026-11-13"]);
    expect(hist[0]!.facts).toEqual(JSON.parse(JSON.stringify(m)));
  });
});
