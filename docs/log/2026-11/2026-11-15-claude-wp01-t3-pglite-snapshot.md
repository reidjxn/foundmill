---
date: 2026-11-15
branch: claude/wp01-t3-pglite-snapshot
title: Tests load one migrated PGlite database instead of replaying every migration
areas: [db, ci, tests]
supersedes: []
---
## What changed
**WP-01 T3: tests load a migrated database** (branch `claude/wp01-t3-pglite-snapshot`, stacked on T1). `packages/db/src/testing/snapshot.ts` dumps one fully
migrated PGlite database, keyed by the bootstrap SQL, every migration's tag and SQL, the PGlite version and pgvector; `createTestDb()` without its own migration
list loads it (`FM_PGLITE_SNAPSHOT=0` replays as before). CI caches the dump per branch and builds it before the unit lane; `turbo.json` passes the two
variables to tests. `testing-snapshot.test.ts` compares the snapshot with a fresh replay (columns, policies, row-level security, applied tags) and checks that
harnesses share nothing. Locally the whole db package (2,647 tests) runs in 184 s instead of 268 s, with the same results.

## Decisions
None beyond the pull request.

## Not done
See the pull request's "Not verified" section.
