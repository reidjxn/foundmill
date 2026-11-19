---
date: 2026-11-16
branch: claude/wp11-advisor-fixes
title: The database advisors as tests; search_path, auth.uid() and foreign-key index fixes
areas: [db]
supersedes: []
---
## What changed
**WP-11 T4, T5 and T7 (A8-03, A8-05, A8-18, A8-19), in one pull request.**
- `packages/db/src/__tests__/rls/advisors.test.ts`: Supabase's advisor rules read from the catalog of a migrated database:
  No function in `public` without a pinned `search_path` (lint 0011);
  the tables with RLS on and no policy equal `SERVICE_ONLY_TABLES` and no client role reads them (lint 0008); every table has RLS on (lint 0013);
  no policy calls `auth.uid()` outside a `select` (lint 0003), and the plan shows an `InitPlan`; every foreign key has an index led by its own columns (a port of splinter's 0001).
- `0143_function_search_path`: the 13 functions get `search_path = pg_catalog, public, pg_temp`. Before: the test listed exactly the 13 the plan names.
- `0144_rls_initplan`: the 45 policies on 28 tables wrap `auth.uid()` in a select (one `alter policy` loop); `fm_idea_table` is redefined the same way, with the pinned path in its own text.
- `0145_fk_indexes`: the six indexes, mirrored in the schema files; `showcase_consents_inbox_item_id_idx` is replaced by the two-column one. Before: the port listed exactly the six constraints.
- `SERVICE_ONLY_TABLES` in `rls/tables.ts`; one line in `packages/db/CLAUDE.md`.

## Decisions
### Eleven service-only tables, not ten
`platform_metric_days` (0109) was added after the plan was written (at 04a0a509). It has RLS on and no policy on purpose (service role only, covered by `rls/platform-metric-days.test.ts`), so it joins the list.
### 0143 skips a missing function
The migration-point tests (`migration-00NN.test.ts`) apply every migration but one, so a function may not exist there. 0143 loops over the signatures and alters each that `to_regprocedure` finds. On a real database all 13 exist; the advisor test is the check. Two statements (tenancy helpers, then triggers and checks) because `migrations.test.ts` wants more than one per file.
### fm_set_updated_at keeps its pin
It fires on every update and a `set` clause costs a little per call. Measured `SEED_TARGET=pglite SEED_VOLUME_SCALE=0.1 pnpm seed`: pinned 22.9 s and 18.9 s, unpinned 19.7 s and 21.0 s, which is noise and under the 20% bar. No `ACCEPTED_MUTABLE_SEARCH_PATH` list.
### Migration numbers
Written as 0117 to 0119; main took those numbers while this waited, so on Nov 19, 2026 the migrations were renumbered 0143 to 0145 (journal idx 120 to 122, `when` after 0142's). The advisor test's service-only list gained the four tables main added (`account_usage`, `project_update_deliveries`, `reports`, `site_address_holds`).
### Real Postgres here was 16, not 17
The session has no Docker; the suites ran on a local Postgres 16 with pgvector and `scripts/ci/supabase-like.sql`. CI's job runs 17.

## Not done
- Reading the advisors on production after deploy (the "after" column) is the founder's or the Desktop session's.
- T6 (split the `for all` write policies) builds on this branch's 0144 and ships after it merges.
