/**
 * `pnpm --filter @foundmill/db report:cost [-- --from 2026-11-01 --to 2026-11-15] [--json] [--print-sql]`: the cost
 * report (costReportRepo, WP-02 T11) for real projects, all time unless a range is given (from inclusive, to
 * exclusive). Reads with the service role through DATABASE_URL (a `pglite:<dir>` URL works locally). `--print-sql`
 * prints each query exactly as it would run and exits without connecting. Every dollar figure is printed with
 * "(measured)"; a figure from fewer than 5 projects with "(small sample)". Only ids, no names. The queries run in a
 * read-only transaction (costReportRepo.run), so the service role cannot write through this report.
 */
import { loadEnv } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { COST_QUERIES, costReportRepo, renderCostQuery, type CostRange } from "./repos/cost-report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const print = (line: string) => process.stdout.write(`${line}\n`);
const SMALL_SAMPLE = 5;

async function main(): Promise<void> {
  const range: CostRange = {
    ...(arg("from") ? { from: new Date(`${arg("from")}T00:00:00Z`) } : {}),
    ...(arg("to") ? { to: new Date(`${arg("to")}T00:00:00Z`) } : {}),
  };
  for (const d of Object.values(range)) if (Number.isNaN(d.getTime())) throw new Error("--from and --to take YYYY-MM-DD");
  if (process.argv.includes("--print-sql")) {
    for (const q of COST_QUERIES) print(`-- ${q.name}\n${renderCostQuery(q, range)}\n`);
    return;
  }
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const r = await costReportRepo.run(db, range);
    if (process.argv.includes("--json")) {
      print(JSON.stringify(r, null, 2));
      return;
    }
    const small = (projects: number) => (projects < SMALL_SAMPLE ? " (small sample)" : "");
    const usd = (n: number, projects: number, digits = 3) => `$${n.toFixed(digits)} (measured)${small(projects)}`;
    /** One project's own figure: measured, not a sample. */
    const own = (n: number, digits = 3) => `$${n.toFixed(digits)} (measured)`;
    const ledger = r.projects.ledger;
    const sessions = r.projects.sessions;

    print(`Cost report, ${r.from?.slice(0, 10) ?? "all time"} to ${r.to?.slice(0, 10) ?? "now"}, real projects only, read in a read-only transaction`);
    print(`Projects in the ledger: ${ledger}; with ended sessions: ${sessions}; with training runs: ${r.projects.trainingRuns}`);

    print("\nCost per route (direct model calls)");
    for (const x of r.byRoute) print(`  ${x.route}  ${x.model ?? "-"}  ${x.billedTo}  calls=${x.calls}  tokens=${x.tokens}  ${usd(x.usd, ledger, 4)}  per call ${usd(x.centsPerCall / 100, ledger, 5)}`);

    print("\nAgent sessions by model and outcome");
    for (const x of r.sessionsByModelAndOutcome) {
      const turns = x.p50Turns === null ? "turns not recorded" : `turns p50=${x.p50Turns} p90=${x.p90Turns}`;
      print(`  ${x.modelKey}  ${x.route ?? "-"}  effort ${x.effort ?? "-"}  ${x.outcome ?? "-"}  sessions=${x.sessions}  avg tokens in=${x.avgTokensIn} out=${x.avgTokensOut}  ${turns}  avg ${usd(x.avgUsd, sessions)}  total ${usd(x.usd, sessions, 2)}`);
    }

    const fd = r.firstDayPerProject;
    print(`\nFirst 24 hours per project (${fd.projects} projects)`);
    for (const k of ["median", "p90"] as const) {
      const s = fd[k];
      print(`  ${k}: total ${usd(s.total, fd.projects)}  foundations ${usd(s.foundations, fd.projects)}  sessions ${usd(s.sessions, fd.projects)}  notes and replies ${usd(s.notesAndReplies, fd.projects)}`);
    }
    for (const x of fd.rows) print(`  ${x.businessId}  ${x.createdAt.slice(0, 10)}  ${own(x.usd)}`);

    const fw = r.firstWeekPerProject;
    print(`\nFirst 7 days per project, from commit (${fw.projects} projects)`);
    if (!fw.projects) print("  no data");
    else print(`  median ${usd(fw.median, fw.projects)}  p90 ${usd(fw.p90, fw.projects)}`);

    const pc = r.preCommitPerProject;
    print(`\nDrafting before commit per project (${pc.projects} projects)`);
    if (!pc.projects) print("  no data");
    else print(`  median ${usd(pc.median, pc.projects, 4)}  p90 ${usd(pc.p90, pc.projects, 4)}`);

    print("\nOne round of work (cycles that ended)");
    if (r.rounds.medianMinor === null) print("  no data");
    else print(`  rounds=${r.rounds.rounds}  median ${usd(r.rounds.medianMinor / 100, ledger, 2)}  the free allowance pays for ${r.rounds.perAllowance} (Estimate)`);

    print("\nCache-read share per route");
    if (!r.cacheShareByRoute.length) print("  no data");
    for (const x of r.cacheShareByRoute) print(`  ${x.route}  read=${x.cacheRead}  write=${x.cacheWrite}  uncached=${x.uncachedInput}  ${x.cacheReadPct === null ? "no data" : `${x.cacheReadPct}% read from cache`}`);

    print("\nIdea box, signed out (live cards per day)");
    if (!r.ideaBox.length) print("  no data");
    for (const x of r.ideaBox) print(`  ${x.day.slice(0, 10)}  cards=${x.cards}  ${own(x.usd, 4)}`);

    const d = r.projectWeeks.distribution;
    print(`\nProject-weeks (${d.projectWeeks} weeks across ${d.projects} projects)`);
    print(`  mean ${usd(d.mean, d.projects)}  p50 ${usd(d.p50, d.projects)}  p90 ${usd(d.p90, d.projects)}  max ${usd(d.max, d.projects)}`);
    for (const x of r.projectWeeks.rows) print(`  ${x.businessId}  week of ${x.week.slice(0, 10)}  paid by ${x.billedTo}  ${own(x.usd)}  model rows=${x.modelRows}`);

    print("\nCost per agent family");
    for (const x of r.byAgentFamily) print(`  ${x.layer}  ${x.agentType}  ${x.modelKey}  sessions=${x.sessions}  ${usd(x.usd, ledger)}`);

    print("\nBlocked sessions by reason");
    for (const x of r.blockedSessions) print(`  ${x.modelKey}  ${x.reason ?? "no task.blocked event for the session"}  sessions=${x.sessions}  ${usd(x.usd, sessions, 2)}`);

    print("\nTraining runs");
    for (const x of r.trainingRuns) print(`  ${x.status}  runs=${x.runs}  avg ${usd(x.avgUsd, r.projects.trainingRuns, 2)}  max ${usd(x.maxUsd, r.projects.trainingRuns, 2)}`);

    print(`\nCredits this month (${r.creditsThisMonth.length} projects)`);
    for (const x of r.creditsThisMonth) {
      print(`  ${x.businessId}  ${x.planTier}  ${x.modelBilling}  granted ${own(x.grantedMinor / 100, 2)}  spent ${own(x.spentMinor / 100, 2)}  balance ${own(x.balanceMinor / 100, 2)}${x.agentsStoppedReason ? `  stopped: ${x.agentsStoppedReason}` : ""}`);
    }

    print("\nNot measured");
    for (const line of r.notMeasured) print(`  ${line}`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
