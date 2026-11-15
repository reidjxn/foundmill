---
date: 2026-11-15
branch: claude/wp02-t10-nightly-numbers
title: Nightly numbers for real projects
areas: [db, shared, orchestrator, docs]
supersedes: []
---
## What changed
- Migration 0109: `platform_metric_days` (service role only: RLS on, no policy, revoked from anon and
  authenticated) and `events_type_occurred_idx` on `events (type, occurred_at desc)`.
- `repos.metrics`: `snapshot(db, asOf)`, `record(db, day, facts)`, `history(db, limit)`. Every statement is in
  `METRIC_QUERIES`; `report:metrics` prints a snapshot, the history or the SQL (`--print-sql`).
- Shared: `isRealOutcome(e)` is the rule `realOutcomes()` applies, factored out with no behavior change.
  `founderActivation` also returns `pagePublishedWithin24h` and `minutesToPage`, from `firstPagePublishedAt`,
  which `presenceRepo.retentionReport` now passes.
- Orchestrator: activity `recordPlatformMetrics` (the UTC day before), workflow `platformMetrics`, and the
  schedule `platform-metrics` at 3:15 AM UTC, not run on boot.
- Tests: `metrics.test.ts` (every block; the north star counts one project; `isRealOutcome` and the SQL agree on
  each fixture event), `demo-isolation.test.ts`, `rls/platform-metric-days.test.ts`, `platform-metrics.test.ts`.
- ARCHITECTURE §4 "Platform numbers" and a row in §10's schedules table.

## Decisions
- The table also has `id` (unique, not the key) and `updated_at` with its trigger: `migrations.test.ts` requires
  both on every table. `day` stays the primary key, and a re-run for a day replaces its facts.
- A signed-in role's select on the table is refused (permission denied), which is stricter than "zero rows". The
  test accepts either and asserts no row comes back.
- The north star is A8-08's SQL with three changes: a `page.published` counts only when it is the project's first
  (Decisions for the founder, 1); `now()` becomes the window end, so a past day can be recomputed; and the window
  is the last 12 whole UTC weeks, so every week returned is complete. Weeks with no outcome are rows of zeros.
- The window end is the start of the UTC day after `asOf`, written into the SQL as a literal timestamp made from a
  `Date`, so `--print-sql` output runs as is. Agent-work counts are totals up to that end, as e0 reports them.
- `projects.with_page_draft` and `with_page_live` read the page's current state: `project_pages` keeps no
  history, so a past day cannot be rebuilt for them.
- `accounts` counts every `auth.users` row, the seeded demo owners included, as e0's 19 does. Accounts are not
  projects. The isolation test keeps the demo owner in both databases and compares the project rows.
- `projects.total` and `projects.demo` count the demo by definition. The isolation test checks that they differ
  by exactly one project and that everything else is equal.
- The funnel and the medians include the house project (it is not a demo); only "outside" figures and the north
  star leave it out, as the spec says.
- Cycles are `cycle.started` events: there is no cycles table. "Ran only the first day" means a project's last
  cycle came less than a day after its first. "Notes on day one" counts Inbox items in the 24 hours after commit.
- `simulated_outcomes_excluded` counts outcome-type events that are simulated, over the north star's projects and
  window. `fabricated_left` is T4's read-only query as written (demo out, house in).
- The PGlite stand-in for `auth.users` gains Supabase's `last_sign_in_at`. The demo fixture has no published page
  row, because the database refuses one for a sample business; its `page.published` event is still there.
- `events_type_occurred_idx` was not in any migration on main or an open branch. WP-11's planned 0110 should
  drop it from its list.

## Not done
- Step 5, the Desktop production comparison against the Nov 15 numbers (e0) through the Supabase connector, is
  not done; nothing here connected to production. `report:metrics -- --json` ran against a local PGlite seed (two
  demo projects only, so the project figures are zeros).
- T10 is not ticked in the WP-02 file.
- Overlap with `claude/wp02-t11-cost-report`: both add one line to `packages/db/package.json` and to
  `src/repos/index.ts`. Whichever merges second resolves those two lines.
