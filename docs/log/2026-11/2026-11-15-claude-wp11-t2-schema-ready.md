---
date: 2026-11-15
branch: claude/wp11-t2-schema-ready
title: A failed migration at boot fails the api's health check
areas: [api, db, deploy]
supersedes: []
---
## What changed
**WP-11 T2: a failed migration fails readiness** (branch `claude/wp11-t2-schema-ready`). packages/db `schemaReady(db, dir)`; apps/api `schemaProbe` and
`/health`'s `schema: { applied, expected }`, 503 while behind. Tests: `packages/db` `schema-ready.test.ts` (behind after a failed file, ready once fixed),
apps/api `health.test.ts` (503 with the counts; 200 without a probe), `migrate-on-boot.test.ts` (the probe; no exit on an unreachable database, as before).

## Decisions
### A failed migration at boot makes the api not ready (WP-11 T2; amends 2026-10-11 "Deploy review: a deadlock at boot retries")

- **Kept.** After any migration error other than a lock timeout or a deadlock, the api still does not exit, so a broken migration does not loop (the 2026-10-11 entry).
- **Changed.** It no longer reports itself healthy while it runs new code on the old schema: `main()` gives `/health` a schema probe (`schemaProbe`, over packages/db `schemaReady`), and `/health` answers 503 with `schema: { applied, expected }` until every migration is applied. Railway's healthcheck then keeps the previous deployment serving. The probe remembers "ready" once seen and never throws.
- **Small call.** `ApiDeps["health"].schema` is optional and counts as ready when absent, rather than a required field with a default, so the test harnesses and the in-process caller need no change.
- **Not done here.** The other five services' schema check and a rollback procedure (EH-08 parts 2 and 3); `schemaReady` in packages/db is there for whoever takes them.

## Not done
See the pull request's "Not verified" section.
