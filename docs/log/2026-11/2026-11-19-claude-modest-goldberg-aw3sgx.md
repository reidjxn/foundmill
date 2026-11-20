---
date: 2026-11-19
branch: claude/modest-goldberg-aw3sgx
title: The production schema check, the steps for bak_20261013, and the Today load test (WP-11 T3, T8, T10)
areas: [db, scripts, docs, ci]
supersedes: []
---
## What changed
- **T8.** `pnpm --filter @foundmill/db check:schema` (`packages/db/src/schema-check.ts`) reads a database in one read-only transaction and reports the migration count against the journal, the public tables against a PGlite migrated from the same checkout, every `bak_%` schema (size, largest tables, owner, grants, outside dependents, rows it still holds)
  and the connection limits T10 step 2 asks for.
  It exits 1 on any problem.
- **T8 steps.** DEPLOY §4 gains "The production schema check, and `bak_20261013`": the rule (a backup is never a schema in the live database) and the six steps in order, with the founder's drop as step 5. §6 gains the row "Backup schemas and the schema check".
- **T10.** `scripts/load-today.mjs` sends the Today screen's batched read (`today.get`, `today.visit`) at 25, 50 and 100 at once and prints p50, p95, max, errors and the gate's stats before and after.
  `scripts/load-today.test.mjs` runs in the config self-tests job. DEPLOY §3 gains how to run it, a correction (the product database is Supabase, not the Railway Postgres that Temporal uses) and an empty results table.
- **T3.** The restore drill no longer names a fixed journal count (113 was stale; main has 121): it points at `check:schema`.

## Decisions
### The schema check is a script, not SQL to paste
The task's SQL is the same, but run as one `begin transaction read only` with a 15 s statement timeout, so a mistyped statement cannot write. The reference table list comes from an in-memory PGlite migrated from the checkout, so no second database is needed to compare.
### Limits read the session's value
The check sets its own `statement_timeout`, so it reads `pg_settings.reset_val` for that and for the idle timeout: the session's value, not the check's.
### No production run, no migration
Nothing here writes to production or adds a migration, so PR #238 does not gate it. The drop of `bak_20261013`, the production check and run B of the load test are Session 11 (Desktop, with the founder). DECISIONS.md stays frozen: this entry records the rule.
### Run A not done here
This container's Postgres 16 has no pgvector, so the migrations cannot run on it. The schema check was run end to end on real Postgres against a database without the migrations (with a `bak_` schema added); the load script against a stub server.

### Security review
The `security-reviewer` agent found nothing blocking.
Fixed from its findings: secrets are set with `read -rs` in every documented command (never inline, so out of shell history); the load script refuses plain `http://` except on localhost; the check connects with TLS except locally and with `default_transaction_read_only` as a second guard; an odd `bak_` name is reported instead of aborting the run; backup ids are compared as text.
Not taken: refusing every unknown argument to the load script (a stray value is never sent).

## Not done
- Run A and run B of T10, and the rewrite of DEPLOY §3 "Database connections" that needs their numbers and the pooler limits.
- T8 steps 1 to 7 on production, and the drop (founder).
- T3's drill (founder, F2). No WP-11 task is ticked: each is done only when its production step is.
