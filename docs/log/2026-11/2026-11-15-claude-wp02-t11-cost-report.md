---
date: 2026-11-15
branch: claude/wp02-t11-cost-report
title: The cost report reads what the platform's work costs, from the ledger
areas: [db]
supersedes: []
---
## What changed
**WP-02 T11: the cost report.** packages/db `repos.costReport.run(db, { from?, to? })` (`src/repos/cost-report.ts`)
runs queries 1, 2, 3, 4, 4b, 5, 6, 8 and 9 of a7 Appendix B and returns `byRoute`, `sessionsByModelAndOutcome`,
`firstDayPerProject` (rows, median and p90), `projectWeeks` (rows and p50/p90/max, who paid), `byAgentFamily`,
`blockedSessions`, `trainingRuns`, `creditsThisMonth` and the two fixed `notMeasured` lines (A7-02, A7-03).
CLI `pnpm --filter @foundmill/db report:cost [-- --from --to] [--json] [--print-sql]` (`src/cost-report.ts`).
Test: `src/__tests__/cost-report.test.ts` (a real and a demo project, micro and pre-0039 rows, a blocked session).

## Decisions
- **The blocked reason key is the audit's.** `task.blocked` declares `reason` (packages/events `catalogue.ts`), and
  apps/orchestrator `session.ts` writes it with the idempotency key `task.blocked:<sessionId>` for blocked and failed
  sessions. One gap: when the agent blocked itself on a dependency (the gateway's `blockTask`), the orchestrator
  writes no event of its own and the gateway's has no key, so that session's reason reads null. The CLI prints
  "no task.blocked event for the session" for it. Query 6 is kept as written.
- **SQL as text, one placeholder.** Each query is a string in `COST_QUERIES`; `{range:<column>}` becomes the bounds
  (from inclusive, to exclusive) or `true`, with dates only from `Date.toISOString()`. `renderCostQuery` gives the
  exact text that runs, so `--print-sql` prints it (range filled in) without connecting.
- **Range columns.** `usage_ledger.occurred_at` (1, 4, 4b, 5), `agent_sessions.ended_at` (2, 6),
  `training_runs.created_at` (8), and `businesses.created_at` for the first day (3: projects created in the range).
  Query 9 stays "this month" (`credit_balances.period` has no timestamp).
- **Small additions to the audit's SQL.** A `projects` query counts real projects per source (ledger, sessions,
  training) so the CLI can mark figures from fewer than 5 projects "(small sample)"; 4b also returns
  `count(distinct business_id)`. Each query's `where` gained only its range clause. The first-day median and p90
  are computed in TypeScript with the same interpolation as `percentile_cont`; a project with no foundations row
  counts as $0 there.
- **Per-project rows are not marked "(small sample)"**: a project's own figure is measured, not a sample.
- **Columns checked.** Every column the queries use exists in `src/schema` (`usage_ledger`, `agent_sessions`,
  `agents.layer/agent_type/model_key`, `training_runs`, `credit_balances`, `businesses.plan_tier/model_billing/
  agents_stopped_reason/is_demo`); nothing needed adapting.

## Not done
- The production run through the Supabase connector (T11 step 3, read-only, `--print-sql`) is a Desktop step, not
  done here, so T11 stays unticked in WP-02.
- The local run (`--json` against a migrated, seeded PGlite) returns empty blocks: both seeded businesses are demos.
- Query 7 (cache-read share) waits for WP-09 (A7-07).
