# packages/db (`@foundmill/db`)

Owns the Drizzle schema, the SQL migrations, RLS, the repositories (`repos`), the seeds and the PGlite test harness. It holds no product logic beyond data rules, and it calls no vendor.

## Invariants
- **A business-scoped table ships in one change with:** `business_id`, its RLS policy (the `fm_tenant_table(...)` pattern from `0001_tenancy.sql`, or BUILD §7.1 by hand), and a cross-tenant test (a row in `src/__tests__/rls/tables.ts` for the generated suite, or its own `rls/<name>.test.ts`; the `rls-test` skill).
- A new table with `business_id` is also listed in `EXPORT_TABLES` or `EXPORT_EXCLUDED_TABLES` (`src/repos/portability.ts`); `portability.test.ts` fails otherwise.
- **Migration numbers:** take the next number after every OPEN branch's migrations, not just main's. Check with `git fetch origin --prune`, then `git branch -r --no-merged origin/main | xargs -I{} git ls-tree --name-only {} packages/db/migrations/ | grep '\.sql$' | sort -u | tail -3`. Add the entry to `migrations/meta/_journal.json` too.
- Every new or redefined function sets `search_path = pg_catalog, public, pg_temp` in its own text, and a policy calls `(select auth.uid())`, never a bare `auth.uid()`; a table with RLS on and no policy is listed in `SERVICE_ONLY_TABLES` (`src/__tests__/rls/tables.ts`). `rls/advisors.test.ts` checks all three.
- The SQL is the source of truth for RLS; `src/schema/*.ts` mirrors it (`migrations.test.ts` checks the mirror).
- **Journal order:** each new `_journal.json` entry has the next `idx` and a `when` later than every entry before it (`migrations.test.ts` checks both). Branches stacked on one another keep their numbers in merge order.
- **Migration-point tests** (`migration-00NN.test.ts`) apply only the migrations before NN, then build fixtures. The RLS fixtures therefore insert by named columns (`fixtures.ts` inserts businesses with raw SQL), never the schema's full insert, so a column a later migration adds does not break them. Keep it that way when you add a column to a table the fixtures write.
- Service code (orchestrator, composer, ingest, gateway) reaches the database only through `repos.<area>.<fn>(db, businessId, ...)`, `businessId` first after `db`. The ESLint rule `fm/no-raw-db` forbids raw `db.select/insert/update/delete/execute` outside `src/repos/**`, migrations, seeds, tests and the events outbox.
- `apps/api` runs user-originated queries in `withRls(db, { userId }, fn)` so Postgres enforces tenancy.
- Audit log: `repos.audit.append(...)` keeps the hash chain; no update or delete grants.
- Money is `{ amountMinor, currency }`; amounts in different currencies are never added together.
- Events go through the outbox in the caller's transaction (`writeEvent` / `writeAccountEvent` in `@foundmill/events`). An account-scoped type never goes into `events` (check `events_not_account_scoped`; `repos.events.write` refuses it).
- People are free: no plan limit on cofounders or collaborators (root CLAUDE.md).

## Read when needed
- docs/ARCHITECTURE.md §4 Database (helpers, repos, per-table contracts for 0064–0085, migrations, tests, money, seeds), §5 Events for account events, §15 Testing. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §7.1 Tenancy helpers and RLS pattern, §7.2 Tables, §7.3 Visibility rules, §17.2 Seeds.
- Decisions: `node scripts/decisions-index.mjs migration RLS` (every word must match; add words to narrow), then read only the printed line range.
- Skills: `rls-test`, `plan-change` (overlap with other branches), `verify-done`.

## Commands
- `pnpm --filter @foundmill/db typecheck` | `lint` | `test`
- `pnpm --filter @foundmill/db test:rls` (root: `pnpm test:rls`): the PGlite cross-tenant suites
- `pnpm db:migrate`, `pnpm db:seed` (Northwind Skincare and Ledgerly), `pnpm --filter @foundmill/db generate` (drizzle-kit)

## Key files
- `migrations/*.sql` and `migrations/meta/_journal.json`: the migrations, in drizzle-kit format
- `src/schema/*.ts`: the Drizzle mirror of the SQL
- `src/repos/<area>.ts`, re-exported as `repos` from `src/repos.ts`
- `src/testing/pglite.ts`: `createTestDb()` applies every migration, stubs `auth.uid()`, gives `asUser(userId)`
- `src/__tests__/rls/tables.ts`: `TENANT_TABLES` drives the generated cross-tenant suite; `fixtures.ts` builds businesses A and B
- `src/repos/portability.ts`: export classification of every business-scoped table
- `src/seed.ts` and `src/seed/`: deterministic demo seeds
