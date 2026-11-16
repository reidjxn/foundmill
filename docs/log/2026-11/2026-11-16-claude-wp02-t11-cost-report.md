---
date: 2026-11-16
branch: claude/wp02-t11-cost-report
title: The cost report reads in a read-only transaction, and T11 is ticked
areas: [db]
supersedes: []
---
## What changed
**WP-02 T11, the second pass.** The report itself merged on Nov 15 (commit aa958680, log
`2026-11-15-claude-wp02-t11-cost-report.md`). This change makes Postgres enforce what was only true by reading the
SQL: `repos.costReport.run` now runs every query in one transaction marked `set transaction read only`, and the
report gains `readOnly: boolean`, read back from Postgres's own `transaction_read_only`. The CLI's first line says
"read in a read-only transaction". T11 is ticked in WP-02.
Test: `src/__tests__/cost-report.test.ts` gains one case: `readOnly` is true and every query starts with `select` or
`with` (it failed before the change: `readOnly` was undefined).

## Decisions
- **The work was already on main.** The task asked for T11 to be built, but the code, CLI and tests merged with
  aa958680 and match the spec's blocks (byRoute, sessionsByModelAndOutcome, firstDayPerProject, projectWeeks,
  byAgentFamily, blockedSessions, trainingRuns, creditsThisMonth, notMeasured). It was not rebuilt. One small
  difference from the spec: the repo is exported through `src/repos/index.ts`, not `src/index.ts`, which is where
  every other repo goes.
- **Read-only enforced by Postgres, not only by code review.** The CLI connects with the service role, which bypasses
  RLS and can write, so a select-only query list is the sole guard. A transaction-scoped `set transaction read only`
  works on a direct connection and through the transaction pooler alike (no startup parameter), and costs nothing.
  `--print-sql` is unchanged: a Desktop session runs it through a connector that is already read-only.
- **Labels.** Every figure in the report is measured from the ledger, so each is printed "(measured)", and a figure
  from fewer than 5 projects also gets "(small sample)". The report shows no Estimate or Forecast. It prints only
  ids, never names or keys.
- **Shaped for WP-09 T1 and T2.** They add blocks (`cacheShareByRoute`, `firstWeekPerProject`, `rounds`,
  `preCommitPerProject`, `ideaBox`) and drop an A7-02 line from `notMeasured`. The new `readOnly` field and the
  transaction leave those additions as one more entry in `COST_QUERIES` each.
- **Ticked with the production run still pending.** Done-when 7 (the CLI prints these figures for real projects)
  holds in code. Step 3, the read-only production run pasted into WP-09 and docs/DEPLOY.md §6, is a Desktop step;
  it waits there.

## Not done
- The production run (T11 step 3): Desktop, read-only, `--print-sql`.
- An empty range still prints `$0.000 (measured)`, not "no data". WP-09 T1 step 5 owns that.
- Query 7 (cache-read share) waits for WP-09 T1 (A7-07).
