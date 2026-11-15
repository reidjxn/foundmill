/**
 * `pnpm --filter @foundmill/db report:metrics [-- --as-of 2026-11-15] [--json] [--history 14] [--print-sql]`: the
 * nightly numbers (repos.metrics, WP-02 T10) for the UTC day of `--as-of` (default today), computed now. Reads with the
 * service role through DATABASE_URL (a `pglite:<dir>` URL works locally). Counts only: no ids, no names.
 *
 *   --history N   the last N recorded days from platform_metric_days instead of a new snapshot
 *   --print-sql   prints each statement of the snapshot with the window end written in, and connects to nothing, so a
 *                 Desktop session can run them read-only through the Supabase connector
 */
import { loadEnv } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { boundMetricSql, METRIC_QUERIES, metricsRepo, metricWindowEnd, type MetricFacts } from "./repos/metrics";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const print = (line: string) => process.stdout.write(`${line}\n`);
const pct = (share: number | null) => (share === null ? "n/a" : `${Math.round(share * 100)}%`);
const pairs = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${k} ${n}`).join(", ") || "none";

function printFacts(m: MetricFacts): void {
  const a = m.agent_work;
  print(`Numbers for ${m.day} (UTC; windows end ${m.asOfEnd}). Real projects only; the house is left out where it says "outside".`);
  print(`Accounts: ${m.accounts.total}, new in 14 days ${m.accounts.new_14d}, signed in during 14 days ${m.accounts.signed_in_14d}, profiles ${m.accounts.profiles}`);
  print(`Gate: waitlist ${m.gate.waitlist}, invitations ${m.gate.invitations}, admissions ${pairs(m.gate.admissions)}`);
  print(`Funnel, 14 days: ${pairs(m.funnel.totals_14d)}`);
  print(`  admitted by how: ${pairs(m.funnel.by.admitted)}; profiles by client: ${pairs(m.funnel.by.profiles_created)}; first ideas by source: ${pairs(m.funnel.by.idea_drafted)}`);
  print(`  median minutes: profile to commit ${m.funnel.medians_min.profile_to_commit ?? "n/a"}, commit to page ${m.funnel.medians_min.commit_to_page ?? "n/a"}`);
  print(`Projects: ${m.projects.total} = ${m.projects.demo} demo + ${m.projects.real} real (${m.projects.real_outside} outside the house); committed ${m.projects.committed}; page draft ${m.projects.with_page_draft}; page live ${m.projects.with_page_live}`);
  print(`North star (outside projects with a real outcome, by UTC week):`);
  for (const w of m.north_star) print(`  ${w.week}  ${w.projects_with_real_outcome}  (solo ${w.solo}, together ${w.together}, also visited ${w.also_visited})`);
  const r = m.retention;
  print(`Retention: visitors in 14 days ${r.visit_users_14d}, visit days ${r.visit_days_14d}; committed in 14 days ${r.report_14d.businesses}, activated ${r.report_14d.activated}, habit ${r.report_14d.habit}, page within 24 hours ${r.report_14d.page_within_24h}`);
  print(`  cycles: ${r.cycles.cycles} in ${r.cycles.projects_with_cycles} projects (median ${r.cycles.cycles_median ?? "n/a"}, median span ${r.cycles.span_days_median ?? "n/a"} days); ran only on the first day ${r.cycles.ran_only_first_day}`);
  print(`Agent work: sessions ${a.sessions_ended} (${pairs(a.sessions)}), blocked share ${pct(a.blocked_share)}`);
  print(`  task.blocked ${a.events.task_blocked}, task.completed ${a.events.task_completed}; approval.requested ${a.events.approval_requested_total} (${pairs(a.events.approval_requested)}); approval.resolved ${a.events.approval_resolved_total} (${pairs(a.events.approval_resolved)})`);
  print(`  approvals open ${a.approvals_open} (over 9 days ${a.approvals_open_over_9d}); stopped for a missing tool ${a.tool_missing_stopped}; notes in a project's first 24 hours: max ${a.notes_day_one.max}, median ${a.notes_day_one.median ?? "n/a"}`);
  print(`Honesty: fabricated left ${pairs(m.honesty.fabricated_left)}; simulated outcomes left out of the north star ${m.honesty.simulated_outcomes_excluded}`);
}

async function main(): Promise<void> {
  const asOf = arg("as-of") ? new Date(`${arg("as-of")}T00:00:00Z`) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error("--as-of takes a date, YYYY-MM-DD");
  if (process.argv.includes("--print-sql")) {
    const end = metricWindowEnd(asOf);
    print(`-- The nightly numbers for ${asOf.toISOString().slice(0, 10)} (UTC; windows end ${end.toISOString()}). Read-only.`);
    print(`-- retention.report_14d comes from presenceRepo.retentionReport (packages/db/src/repos/presence.ts), not shown here.`);
    for (const q of METRIC_QUERIES) print(`\n-- ${q.name}\n${boundMetricSql(q.text, end)};`);
    return;
  }
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const history = arg("history");
    if (history !== undefined) {
      const days = await metricsRepo.history(db, Math.max(1, Number(history) || 14));
      if (process.argv.includes("--json")) print(JSON.stringify(days, null, 2));
      else for (const d of days) printFacts(d.facts as unknown as MetricFacts);
      return;
    }
    const facts = await metricsRepo.snapshot(db, asOf);
    if (process.argv.includes("--json")) print(JSON.stringify(facts, null, 2));
    else printFacts(facts);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
