---
date: 2026-11-15
branch: claude/wp11-t1-real-postgres
title: Real Postgres in CI: grants and concurrency tested where PGlite cannot
areas: [ci, db, security]
supersedes: []
---
## What changed
**WP-11 T1: real Postgres in CI** (branch `claude/wp11-t1-real-postgres`, stacked on WP-01 T1 for its `changes` job). New job "Real Postgres (migrations and
tenancy)": Postgres 17 with pgvector, set up like Supabase by `scripts/ci/supabase-like.sql`, runs the whole `rls` directory, `testing-postgres`,
`migrate-lock`, `owner-lock`, `date-params` and the api's `migrate-on-boot` and `people-races`. Run here first: 4 of 1,982 db tests failed, all test
assumptions, fixed in the tests (a collation-sensitive order in `client-grants`, and `owner-lock` creating an `auth` schema that a Supabase-like template
already has, plus its first case, which expected 0026's unlocked trigger although 0026 was edited in place on Oct 12). After: 1,979 passed, 3 skipped; api 8
passed, 2 skipped. A deleted revoke in 0087 fails four `client-grants` cases on Postgres and none on PGlite.

## Decisions
### The real-Postgres job's first run: the four failures were the tests' (WP-11 T1)

- `rls/client-grants.test.ts` compared an `order by` result with a JS-sorted list; a real Postgres orders text by the database's collation (`is_member(uuid)` after `is_member_not_collaborator(uuid)`). The test now sorts both sides in JS.
- `owner-lock.test.ts` created `auth` itself; on a Supabase-like cluster the template already has `auth.users` in a schema another role owns, so even `create ... if not exists` is refused. It now creates its stub only when `auth.users` is missing (the shared harness's rule).
- Its first case asserted the defect under 0026 alone (both demotions commit). `0026_membership_guards.sql` was edited in place on Oct 12, 2026 (70a70e0a) to
  take a per-business lock, the same day 0035 added one, so the file no longer shows the defect. The case now asserts what 0026 says today. Not a product
  defect: 0035 replaces the function on every database. Editing an applied migration is against the repo's practice; noted, not changed.

## Not done
See the pull request's "Not verified" section.
