# WP-11: Data, API and security hygiene

Goal: the database advisor findings, the open security items and the leftovers are closed, and the next production-only database bug is caught in CI.

Why: A8-01 to A8-07, A8-09 to A8-16, A8-18 to A8-27, A8-32 (`audits/a8-data-api-security.md`); A7-15, A7-16, N2, N3, N4 (`audits/a7-models-gateway-economics.md` §1.5 and §3); SEC-8, 9, 11, 15, 17, 18, 19 and the loose ends a11 S1 to S5, S8 to S14 and S24 (`audits/a11-roadmap-status.md` §5 C, §7.0, §7.1); the advisor results and live configuration in `audits/e0-production-evidence.md`; EH-08 and EH-11 (`audits/a10-engineering-health.md`).

Done when (each line is checked, not felt):
- CI runs every migration and the cross-tenant suites on Postgres 17 with Supabase's roles and default privileges; a wrong grant turns that job red while the PGlite job stays green (T1).
- A migration that fails at boot makes the api's `/health` answer 503, so Railway keeps the previous deployment serving (T2).
- The Supabase advisors, read again after T4 to T7 are deployed, show the "after" column below.
- `node scripts/load-today.mjs` has been run at 25, 50 and 100 simultaneous Today loads and the numbers are in docs/DEPLOY.md §3 (T10).
- `real_businesses` exists, the retention report reads through it, and `demo-isolation.test.ts` fails when a sample row changes a cross-project number (T9).
- `select count(*) from pg_namespace where nspname like 'bak\_%'` is 0 on production, or docs/DECISIONS.md says why not (T8).
- Every open security item in docs/SECURITY_REVIEW.md has a merged fix or a dated decision (T11 to T20).

| Advisor finding today (`audits/e0-production-evidence.md`) | Count | After | Task |
| --- | --- | --- | --- |
| Function with a mutable `search_path` (security, WARN) | 13 | 0 | T4 |
| RLS on, no policy (security, INFO) | 10 | 10, intentional, pinned by a test | T4 |
| Extension in `public`: `pg_trgm`, `vector` (security, WARN) | 2 | 2, accepted with a dated decision | T19 |
| Leaked-password protection off (security, WARN) | 1 | 1, accepted: the api refuses password sessions (`apps/api/src/auth.ts` `passwordOnlyFromPayload`) | T19 |
| `auth.uid()` evaluated per row (performance) | 45 | 0 | T5 |
| Multiple permissive policies (performance) | 320 | only the tables on T6's allow-list: `posts` and `community_members` (their `_moderate` policies are `for all` on purpose), plus any other pair T6's test names and explains | T6 |
| Unindexed foreign key (performance, INFO) | 6 | 0 (six new rows under "unused index" until used) | T7 |
| Unused index (INFO); Auth connection cap absolute (INFO) | 149; 1 | unchanged: pre-launch volume | none |

Scope, in: the tasks below. Out: funnel events, the north-star query and the cost report (WP-02); model-call booking and allowances (WP-09); `apps/social`, `apps/collab`, the other dead weight of A8-30 and the people side, including a suite that runs `live.*` as a stranger before `LIVE_MODE=1` (WP-12); CI structure beyond the one job in T1 and required security scans (A8-26) (WP-01). The other five services' schema check and a rollback procedure (EH-08 parts 2 and 3) are planned in no package: T2 leaves `schemaReady` in packages/db for whoever takes them (see "Accepted for now"). No new event type is declared here: if a task seems to need one, stop and hand it to WP-02.

Depends on: nothing to start. Inside the package: T1 before T4 to T7; T2 and T3's drill before T6 reaches production.

Collides with: `.github/workflows/ci.yml` (WP-01 and branch `claude/blissful-fermat-q03yq1`: T1 adds one job and touches nothing else); `apps/api/src/app.ts` `/health` (WP-02's production check reads it: T2, T12, T14 and T15 only add fields); `packages/db/migrations/**` and `meta/_journal.json` (everyone); `packages/shared/src/env.ts` and `.env.example` (any package adding a variable); `apps/gateway/src/app.ts`, `apps/gateway/src/pipeline.ts` (WP-05, WP-09); docs/DEPLOY.md, docs/DECISIONS.md.

Setup it needs. Three kinds of id appear in this file and never mix: `WP-00 S<n>` is a step of docs/holistic-plan/WP-00-setup-and-switches.md; `a11 S<n>`, `a11 A<n>` and `a11 C<n>` are rows of `audits/a11-roadmap-status.md`; `F<n>` is a founder or operator step this package adds, for WP-00 to take into its list. Code merges first in every case.

| Step | What | Who | For |
| --- | --- | --- | --- |
| F1 | After five green runs on `main`, add "Real Postgres (migrations and tenancy)" to the required checks | founder (GitHub) | T1 |
| F2 | Read from the Supabase dashboard: plan, scheduled backups and days kept, PITR on or off; run one restore drill (beside WP-00 S14, the hosting plan) | founder | T3 |
| F3 | Read-only SQL on production (T8 steps 1 to 3 and 7, T9 step 4, T10 step 2) through the Supabase connector or the SQL editor | the Desktop session, or the founder | T8, T9, T10 |
| WP-00 S16 | `drop schema bak_20261013 cascade;` after a backup | founder only | T8 |
| F4 | Run `scripts/load-today.mjs` against `https://api.foundmill.com` at a quiet hour with the founder's own session token | founder | T10 |
| F5 | `API_SERVICE_TOKEN_SECRET` on the gateway with `API_SERVICE_TOKEN_LEGACY=1`, then on the api, then remove the legacy flag (a11 C4) | founder pastes the secret; Desktop sets the flag | T12 |
| WP-00 S10 | `supabase config push` with the keys T14 adds; confirm the diff shows nothing else (a11 A7, C11) | founder | T14 |
| WP-00 S2 | Confirm SendGrid's Event Webhook as T15 step 4 describes. S2's own step 2 (`LIVE_CONNECTORS=sendgrid` on ingest) must not be done: see "Corrections to the audits", item 5 | Desktop and founder | T15 |
| WP-00 S16 | Delete `DEV_MASTER_KEY` and `SESSION_TOKEN_SECRET` from stream and composer and the connector keys from the api, as T19 step 4 confirms; ingest keeps `DEV_MASTER_KEY` (T20 needs it there); do not set `APP_ENV=production` before `KMS_KEY_ID` exists | Desktop | T19 |
| WP-00 S8 | `stripe` in ingest's `LIVE_CONNECTORS` once T20 is merged. S8 names the open item as N3; it is the Stripe half of N2 | Desktop | T20 |
| F6 | Delete an auth user in the Supabase dashboard when a person asks to close their account | founder only | T16 |

Rules for every task here (docs/holistic-plan/README.md applies in full):
- Builds and tests run in the cloud session, never on the founder's laptop. One task, one pull request, branch `claude/wp11-t<n>`. The founder merges.
- Migrations: the next free number when the branch is cut (0108 and journal idx 96 at `04a0a509`); renumber on rebase. Run the open-branch check in `packages/db/CLAUDE.md` first. Journal entry, appended to `packages/db/migrations/meta/_journal.json`: `{ "idx": 96, "version": "7", "when": 1796139240000, "tag": "0108_<name>", "breakpoints": true }`; `when` is later than every entry before it (the last ones step by 600000). Statements are separated by a line `--> statement-breakpoint`. The numbers written in the tasks assume nothing else merged first.
- Every migration task is proven twice: `pnpm --filter @foundmill/db test:rls` on PGlite, and the same with `RLS_TEST_DATABASE_URL` set (T1's cluster).
- Review: a task marked "Review: security-reviewer" passes the repo's `security-reviewer` agent (`.claude/agents/security-reviewer.md`) on its diff before `ship-change`; its findings, with file and line, go in the pull request; a hard-gate bypass blocks.
- `verify-done` before a task is called finished; one line in docs/PROGRESS.md; tick the task below in the same pull request. If WP-01 has moved the two logs (`docs/log/**`, the `log-entry` skill), write every PROGRESS and DECISIONS entry this file asks for the way WP-01 says.

## Tasks

| Done | Task | Size | Needs |
| --- | --- | --- | --- |
| [ ] | T1 Real Postgres in CI | M | F1 after merge |
| [ ] | T2 A failed migration fails readiness | S | |
| [ ] | T3 Backup and restore runbook | S | F2 (founder) |
| [x] | T4 Advisor test, pinned service-only tables, `search_path` migration | S | T1 |
| [x] | T5 Migration: `auth.uid()` once per statement | S | T1 |
| [ ] | T6 Migration: split the `for all` write policies | M | T1, T2 |
| [x] | T7 Migration: six foreign-key indexes | S | T1 |
| [ ] | T8 `bak_20261013` and the production schema check | S | F3, WP-00 S16 (founder) |
| [ ] | T9 Demo data out of every cross-project number | S | F3 |
| [ ] | T10 Measure the api under 100 Today loads | M | F3, F4 |
| [x] | T11 Gateway: who may mint what; a tool without hints is refused | S | |
| [x] | T12 An api-only service token secret | M | F5 |
| [x] | T13 One JWT verifier for the api and the stream | M | |
| [x] | T14 Supabase settings: declared and watched | S | WP-00 S10 |
| [x] | T15 ingest: bounded webhook bodies; mail routes on `/health` | S | WP-00 S2 |
| [ ] | T16 Account export and closing, by request | M | F6 |
| [x] | T17 The service connection: the rule as it is, and a pinned list | S | |
| [ ] | T18 The P3 items in one change | S | |
| [x] | T19 A dated decision for every item left open | S | WP-00 S16 |
| [x] | T20 A founder's own Stripe: store the webhook signing secret | M | WP-00 S8; WP-07 and WP-08 wait for it |

Sizes: S under a day, M one to three days, L up to a week. 13 S and 7 M: about four to five weeks of one session in sequence (Estimate). T3, T8 and the founder steps run beside the rest; T11 to T20 do not depend on each other. T20 is last in the list only because another package sets its date: start it when WP-07's `create_payment_link` task starts.

### [x] T1: Real Postgres in CI            [size M] [ships alone]
Why: A8-01, EH-11a, a11 S8, a11 S9. Two production-only bugs passed PGlite already (`0087_client_grants.sql` header; `packages/db/src/client.ts` `withDateParams`). Every migration in this package changes what PGlite cannot show.
Files: create `scripts/ci/supabase-like.sql`; modify `.github/workflows/ci.yml` (one new job), docs/DEPLOY.md §4 "Checking grants on a real Postgres" (point at the script).
Interfaces: consumes `RLS_TEST_DATABASE_URL`, `RLS_TEST_ALLOW_REMOTE`, `createRealPostgresTestDb` (`packages/db/src/testing/postgres.ts`: one fresh database `fm_rls_<random>` per harness, dropped on close; the URL's role needs CREATEDB), `FM_TEST_POSTGRES_URL` (`migrate-lock.test.ts`, `owner-lock.test.ts`, apps/api `migrate-on-boot.test.ts`). Produces: CI job id `postgres-suites`, name `Real Postgres (migrations and tenancy)` (the id `audits/a10-engineering-health.md` §3.6 uses, so WP-01 extends this job instead of adding a second).
The script, run once as the superuser against `template1` (roles are cluster-wide; the `auth` schema and default privileges are copied into every database the harness creates). It is docs/DEPLOY.md lines 173 to 182 made runnable:
```sql
create role postgres login password 'postgres' createrole createdb replication bypassrls nosuperuser;
create role authenticator login noinherit; create role anon nologin noinherit; create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls; create role supabase_auth_admin login noinherit createrole;
grant anon, authenticated, service_role to authenticator; grant anon, authenticated, service_role to postgres;
create extension if not exists pg_trgm; create extension if not exists vector;
create schema auth authorization supabase_auth_admin;
-- auth.users, auth.uid() and auth.role(): the three statements of PGLITE_BOOTSTRAP_SQL (packages/db/src/pglite.ts), unchanged
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, postgres;
grant select on auth.users to service_role; grant select, insert, update, delete, references, trigger on auth.users to postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
-- the same three lines again `for role supabase_admin`
```
The job (checkout, pnpm, Node 22 and install as in the `checks` job):
```yaml
  postgres-suites:
    name: Real Postgres (migrations and tenancy)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      RLS_TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
      FM_TEST_POSTGRES_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
    steps:
      - name: Postgres 17 with Supabase's roles and default privileges
        run: |
          docker run -d --name pg -p 5432:5432 -e POSTGRES_USER=supabase_admin -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17 -c max_connections=300
          until docker exec pg pg_isready -h 127.0.0.1 -U supabase_admin; do sleep 1; done
          docker exec -i pg psql -v ON_ERROR_STOP=1 -U supabase_admin -d template1 < scripts/ci/supabase-like.sql
      - run: pnpm --filter @foundmill/db exec vitest run src/__tests__/rls src/__tests__/testing-postgres.test.ts src/__tests__/migrate-lock.test.ts src/__tests__/owner-lock.test.ts src/__tests__/date-params.test.ts
      - run: pnpm --filter @foundmill/api exec vitest run src/__tests__/migrate-on-boot.test.ts src/__tests__/people-races.test.ts
```
Use `pnpm --filter … exec vitest`, not turbo: turbo passes only the variables `turbo.json` declares. `pg_isready -h 127.0.0.1` because the image listens on its socket alone while it initializes.
Pull request versus `main`: until WP-01's `changes` job exists the job runs on every pull request and every push to `main` (it is shorter than the unit job, so it adds no wall time). WP-01's T1 leaves room for this job and does not add it (its "Scope, out"). Once its `changes` job is merged, give this job `needs: changes` and `if: ${{ github.event_name != 'pull_request' || needs.changes.outputs.code == 'true' }}`: on `main` it always runs, on a pull request only when code changed (`code` is the output WP-01 defines; a narrower `db` output is not worth a second filter). Filter inside the workflow, never under `on:` (a required check that never starts stays "Expected"). Not a required check at first (F1).
Steps:
1. Write the script; start the container in the session and load it. verify: `psql postgres://postgres:postgres@127.0.0.1:5432/postgres -Atc "select rolsuper, rolbypassrls from pg_roles where rolname = 'postgres'"` prints `f|t`.
2. Run the two vitest commands against it before touching CI. verify: `testing-postgres.test.ts` reports "createTestDb on a real Postgres" as run, not skipped. Paste the failing test names into the pull request.
3. Sort each failure: a test that assumed PGlite (fix the test here); a harness gap (fix `testing/postgres.ts` here); a grant, policy or query that is wrong on real Postgres (stop: it gets its own migration and pull request with Review: security-reviewer, and this task rebases on it). Most migrations after 0087 have never run this way (a11 S8, a11 S9), so expect some.
4. Add the job. verify: green on the pull request; the PGlite jobs unchanged.
5. Prove it catches what PGlite cannot. verify: on a scratch commit, delete the line of `0087_client_grants.sql` that revokes delete on `account_preferences`; `rls/client-grants.test.ts` fails in `postgres-suites` and passes under PGlite. Drop the scratch commit.
Tests: no new file. The real-Postgres halves of `testing-postgres`, `migrate-lock`, `owner-lock`, `date-params`, the whole `rls` directory, and the api's `migrate-on-boot` and `people-races` now run on every change to the database.
Done when: the job is green on `main`; step 5's result is in the pull request; DEPLOY §4 names the script.

### [x] T2: A failed migration fails readiness            [size S] [ships alone]
Why: A8-15, EH-08 part 1. `apps/api/src/index.ts` `migrateOnBoot` logs "migrations failed; serving anyway (health reports db status)" and `/health` then answers 200 because it probes `select 1`.
Recorded decision: 2026-10-11 "Deploy review: a deadlock at boot retries; `next` never resolves off-site" keeps the api running after any other migration error because exiting would loop. This task keeps that (no exit, no loop) and changes only what `/health` answers; record it in docs/DECISIONS.md as an amendment that cites the entry.
Files: modify `packages/db/src/migrator.ts`, `packages/db/src/migrate.ts`, `packages/db/src/index.ts` (export), `apps/api/src/context.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/__tests__/health.test.ts`, `apps/api/src/__tests__/migrate-on-boot.test.ts`, docs/DEPLOY.md §3 "Migrations at boot"; create `packages/db/src/__tests__/schema-ready.test.ts`.
Interfaces: consumes `appliedMigrationCount(db: Db): Promise<number>`, `readMigrations(dir?: string): MigrationFile[]`, `migrateOnBoot(deps: ApiDeps, options?: MigrateOnBootOptions): Promise<boolean>`. Produces:
- packages/db: `schemaReady(db: Db, dir: string = MIGRATIONS_DIR): Promise<{ applied: number; expected: number; ready: boolean }>`, `ready` when `applied >= expected`.
- apps/api: `type SchemaState = { ready: boolean; applied: number | null; expected: number | null }`; `ApiDeps["health"].schema: () => Promise<SchemaState>`, default `{ ready: true, applied: null, expected: null }` (tests and the in-process caller build their database without the migrator); `schemaProbe(db: Db): () => Promise<SchemaState>` in `index.ts`, which asks `schemaReady` on each call until it is ready, then remembers it, and never throws (an unreachable database is `{ ready: false, applied: null, expected: null }`).
- `main()` sets `deps.health.schema = schemaProbe(deps.db)` when `migrateOnBoot` returned false and `DATABASE_URL` is set. `/health` adds `schema: { applied, expected }`; `ok` and the 200 need `db && schema.ready`.
Steps:
1. `health.test.ts`: `createApp({ ...hz.deps, health: { ...hz.deps.health, schema: async () => ({ ready: false, applied: 95, expected: 96 }) } })` answers 503 with `ok: false` and `schema: { applied: 95, expected: 96 }`; the unchanged deps answer 200. verify: fails before the change.
2. `schema-ready.test.ts` (PGlite, `createDb("pglite::memory:")`, temp folders built as `migrate-lock.test.ts` builds its own): a folder whose second file fails makes `migrateDb` reject and `schemaReady(db, dir)` return `ready: false` with `expected: 2` and `applied` below 2; with the file fixed, `ready: true`.
3. Implement; keep the existing case "an unreachable database is not a reason to exit" green, and change the log line to say the api will not pass its health check. verify: `pnpm --filter @foundmill/api test health migrate-on-boot` and `pnpm --filter @foundmill/db test schema-ready`.
4. DEPLOY §3: a failed migration leaves the previous deployment serving; how to read `schema` on `/health`. verify: `node --test scripts/railway-config.test.mjs` still finds `/health` as the api's healthcheck path.
Tests: `health.test.ts` (503 and the `schema` field), `schema-ready.test.ts` (behind, then ready), `migrate-on-boot.test.ts` (no exit on an unreachable database, as before).
Done when: a deployment whose migration fails never takes traffic, and `/health` says which count is behind.

### T3: Backup and restore runbook            [size S] [ships alone] [needs the founder: F2]
Why: A8-14. docs/DEPLOY.md mentions backups only for Temporal's Railway Postgres. The Privacy Policy promises "Deleted data leaves our backups as they expire, within 30 days" (`apps/web/content/legal/privacy.ts`, retention list).
Files: modify docs/DEPLOY.md (§4, new part "Backups and restore"; two rows in §6), docs/DECISIONS.md.
Interfaces: none (a document and one founder step).
Steps:
1. Write the part with blanks the founder fills from the dashboard (Database → Backups; Settings → Billing): plan; scheduled backups and days kept; PITR on or off; date of the latest backup. State the rule the policy sets: backups and any manual dump are kept 30 days at most. If the plan has no backups, that is a founder decision to record (upgrade, or a dump by hand each week): do not pick for them. verify: the part exists and names every blank.
2. Write the drill: restore the latest backup into a new Supabase project (Backups → restore to a new project); in it run `select count(*) from drizzle.__drizzle_migrations;` (equals the journal's entry count), `select count(*) from businesses;`, `select audit_log_verify(id) from businesses limit 3;` (null means the chain is intact); delete the drill project the same day. verify: §6 gains "Restore drill" with a date once F2 is done.
3. Say what is not backed up and why: Redis streams (rebuilt from the outbox), Temporal's Postgres (already in DEPLOY §3).
4. Record per-table retention as it is today (everything kept) and the two triggers in "Accepted for now" (outbox rows, `journey_daily_mv`).
Tests: none (documents). Done when: the blanks are filled and one drill is dated in §6, before T6 is deployed.

### [x] T4: Advisor test, pinned service-only tables, `search_path` migration            [size S] [ships alone] Review: security-reviewer
Why: A8-05, A8-19. The repo has exactly 13 functions without a `search_path` (checked against all 96 migrations; none is `security definer`).
Files: create `packages/db/migrations/0108_function_search_path.sql`, `packages/db/src/__tests__/rls/advisors.test.ts`; modify `meta/_journal.json`, `packages/db/src/__tests__/rls/tables.ts`, `packages/db/CLAUDE.md` (one line: every new function sets `search_path`; the service-only list lives in `tables.ts`).
Interfaces: consumes `createTestDb()`, `h.db.execute(sql…)`. Produces `SERVICE_ONLY_TABLES: readonly string[]` in `tables.ts`, each with a comment naming its migration: `account_admissions` (0091), `account_outbox` (0085), `attributions` (0088), `credentials` (0011), `founder_cancel_links` (0097), `idea_drafts`, `waitlist_entries` (0086), `person_handle_releases` (0080), `persona_portraits` (0067), `retired_mail_local_parts` (0078).
The migration is one statement per function, `alter function <signature> set search_path = pg_catalog, public, pg_temp;`, for: `fm_set_updated_at()`, `fm_track_updated_at(text)`, `fm_tenant_table(text, text[], text)`, `fm_idea_table(text)`, `entities_search_update()`, `audit_log_chain()`, `audit_log_immutable()`, `fm_agents_clear_paused_reason()`, `fm_business_currency(text)`, `fm_page_content_ok(jsonb)`, `fm_person_tags_ok(text[])`, `admission_existing_before()`, `fm_page_quiz_ok(jsonb)`. `public` stays on the path: the helpers name tables unqualified and the extensions live there.
Steps:
1. Write `advisors.test.ts` with three assertions. (a) Functions in `public` that are not extension members and have no `search_path=` entry in `proconfig`: `[]`. (b) Tables in `public` with `relrowsecurity` and no row in `pg_policy`, sorted: equals `SERVICE_ONLY_TABLES` sorted; for each, `has_table_privilege('anon' | 'authenticated', …, 'select')` is false. (c) Tables in `public` without `relrowsecurity`: `[]`. verify: (a) fails listing exactly the 13 names above; if the list differs, stop and correct this file first.
2. Add the migration and journal entry. verify: `pnpm --filter @foundmill/db test:rls`, then again with `RLS_TEST_DATABASE_URL`; `pnpm --filter @foundmill/db test migrations`.
3. Measure the one hot function. `fm_set_updated_at` fires on every update, and a function with a `set` clause pays a small cost per call. verify: time `SEED_TARGET=pglite SEED_VOLUME_SCALE=0.1 pnpm --filter @foundmill/db seed` and the roll-forward suite before and after; write both in the pull request. If the seed slows by more than 20%, take `fm_set_updated_at` out of the migration, add it to a constant `ACCEPTED_MUTABLE_SEARCH_PATH` that assertion (a) subtracts, and record it in docs/DECISIONS.md.
Note for T5 and T6: `create or replace function` resets what `alter function … set` stored, so every later redefinition carries `set search_path = pg_catalog, public, pg_temp` in its own text; assertion (a) catches a miss.
Tests: `rls/advisors.test.ts` (a) no function without a `search_path`, (b) the policy-less tables are exactly the ten and no client role reads them, (c) every table has RLS on; `packages/db/src/seed/__tests__/roll-forward.test.ts` unchanged and green.
Done when: the advisor's 13 are gone on a database migrated from `main`, and an eleventh policy-less table fails the suite.

### [x] T5: Migration: `auth.uid()` once per statement            [size S] [ships alone] Review: security-reviewer
Why: A8-03. 45 policies: 39 written by hand and 6 from `fm_idea_table` (`0002_accounts_businesses_ideas.sql:145-158`). No policy on `main` contains `select auth.uid()` today, so one textual pass is safe.
Files: create `packages/db/migrations/0109_rls_initplan.sql`; modify `meta/_journal.json`, `advisors.test.ts`.
Interfaces: consumes `pg_policies` (`qual`, `with_check` as Postgres prints them) and `fm_idea_table(tbl text)`; produces no new name: the same policies and the same helper signature.
SQL. `alter policy` keeps the command, the roles and whether the policy is restrictive (`inbox_items_for_user` stays restrictive):
```sql
do $$
declare p record; q text; c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')
  loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    c := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
      case when q is not null then format(' using (%s)', q) else '' end,
      case when c is not null then format(' with check (%s)', c) else '' end);
  end loop;
end $$;
```
Then, in the same file, `create or replace function fm_idea_table(tbl text)` with the body of 0002 unchanged except that each `auth.uid()` reads `(select auth.uid())` and the header carries `set search_path = pg_catalog, public, pg_temp`, so the helper cannot bring the old form back.
Steps:
1. Add to `advisors.test.ts`: policies where `regexp_replace(coalesce(qual, ''), 'select\s+auth\.uid\(\)', '', 'gi') ~ 'auth\.uid\(\)'`, or the same on `with_check`: `[]`. And one plan check: `explain (costs off) select 1 from founder_profiles` run with `h.asUser(userId)` contains `InitPlan`. verify: the first fails listing 45 policies on 28 tables (the 25 tables `audits/e0-production-evidence.md` names plus `founder_departures`, `inbox_items`, `showcase_consents`).
2. Add the migration. verify: `test:rls` green on both engines with no other test edited: this task changes no rule, only when the function is evaluated.
Tests: `advisors.test.ts` (no bare `auth.uid()` in any policy; the plan shows `InitPlan`); every suite under `rls/` unchanged.
Done when: the advisor's 45 are gone and every RLS suite passes unchanged.

### T6: Migration: split the `for all` write policies            [size M] [ships alone] Review: security-reviewer
Why: A8-04. `fm_tenant_table` (`0001_tenancy.sql:78-96`) and `fm_idea_table` create `<t>_select` and `<t>_write for all`, so every select evaluates both. The repo already split by hand where it mattered (`skill_tests` in 0004, `events` and `outbox` in 0099), and 0095's header records that a `for all` policy also answers select.
Files: create `packages/db/migrations/0110_split_write_policies.sql`; modify `meta/_journal.json`, `advisors.test.ts`, `packages/db/src/__tests__/rls/people-roles.test.ts` (the Money and Legal block near line 226 expects `_select:SELECT` and `_write:ALL` with one exact expression: now `_select`, `_insert`, `_update`, `_delete`, the same expression on the three write policies), `packages/db/src/__tests__/rls/founder-departures.test.ts` (line 283 reads `suppression_list_write` by name: read `suppression_list_update`), docs/BUILD.md §7.1 and docs/ARCHITECTURE.md §4 where they say "`T_write` (for all)", docs/DECISIONS.md (supersedes that one line of 2026-10-05 "packages/db: schema, RLS and test harness choices").
Interfaces: consumes `fm_tenant_table(tbl text, write_roles text[], mode text)` and `fm_idea_table(tbl text)` (signatures unchanged, so later migrations call them as before); produces policy names `<t>_insert`, `<t>_update`, `<t>_delete` in place of `<t>_write`.
SQL, part 1. Only policies named `<table>_write` are split; `posts_moderate`, `community_members_moderate` and the single `*_own` policies are left alone. The two guards make the migration fail, not guess:
```sql
do $$
declare p record; r text;
begin
  for p in select tablename, policyname, qual, with_check, roles from pg_policies
            where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE' and policyname = tablename || '_write'
  loop
    if exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename
                and x.policyname in (p.tablename || '_insert', p.tablename || '_update', p.tablename || '_delete')) then
      raise exception 'split write policies: % already has a per-command policy', p.tablename;
    end if;
    if not exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename and x.cmd = 'SELECT') then
      raise exception 'split write policies: % has no select policy; writers would lose reads', p.tablename;
    end if;
    r := array_to_string(p.roles, ', ');
    execute format('create policy %I on public.%I for insert to %s with check (%s)', p.tablename || '_insert', p.tablename, r, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', p.tablename || '_update', p.tablename, r, p.qual, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for delete to %s using (%s)', p.tablename || '_delete', p.tablename, r, p.qual);
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
```
Part 2, the helpers, so tables made later are born split:
```sql
create or replace function fm_tenant_table(tbl text, write_roles text[] default array['owner','admin','member'], mode text default 'standard') returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if mode not in ('standard', 'read_only') then raise exception 'fm_tenant_table: unknown mode %', mode; end if;
  execute format('alter table %I enable row level security', tbl);
  execute format('create policy %I on %I for select using (is_member(business_id))', tbl || '_select', tbl);
  if mode = 'standard' then
    execute format('create policy %I on %I for insert with check (has_role(business_id, %L::text[]))', tbl || '_insert', tbl, write_roles);
    execute format('create policy %I on %I for update using (has_role(business_id, %L::text[])) with check (has_role(business_id, %L::text[]))', tbl || '_update', tbl, write_roles, write_roles);
    execute format('create policy %I on %I for delete using (has_role(business_id, %L::text[]))', tbl || '_delete', tbl, write_roles);
  end if;
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end; $$;
```
and `fm_idea_table` by the same rule from its text after T5: `_insert` takes the old `with check`, `_update` the old `using` and `with check`, `_delete` the old `using`.
Why writers keep their reads: an `update … where` or a `returning` also needs the select policy, and in every pair the writers are among the readers (`has_role` implies `is_member`; the seven 0095 tables pair `has_role and is_member_not_collaborator` with a select of `is_member_not_collaborator`; `skill_definitions` and `suppression_list` pair `business_id is not null and has_role(…)` with `business_id is null or is_member(…)`; the idea tables pair owner-or-writer with owner-or-member).
Steps:
1. Before writing SQL, list the pairs from a migrated database: `select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public' and (policyname = tablename || '_write' or policyname = tablename || '_select') order by 1, 2`. verify: for each distinct pair of expressions, write in the pull request one line saying why the writers are readers. A pair that does not fit the four shapes above stops the task.
2. Add to `advisors.test.ts` the advisor's own rule: for each of select, insert, update and delete, the tables with more than one permissive policy that applies to it (`cmd` equal to it, or `ALL`) are exactly the keys of `MULTIPLE_PERMISSIVE_ALLOWED: Record<string, string>` (table to reason), which starts with `posts` and `community_members`. verify: before the migration it fails listing every table with a `_write` policy; the count goes in the pull request. After it, a table still listed that is not one of the two is either fixed here or added with its reason.
3. Add the migration; update the two tests named above. verify: `test:rls` on both engines; `cross-tenant.test.ts`, `people-roles`, `collaborator-finance`, `events-collaborator` and `team-calls` need no change beyond the two edits.
4. A new table still works. verify: in `advisors.test.ts`, inside a transaction that rolls back, create a table with `business_id`, call `fm_tenant_table`, and read its policy names: `_select`, `_insert`, `_update`, `_delete`.
5. Update the two documents and DECISIONS. verify: `grep -rn "T_write\|_write (for all)" docs packages/db/CLAUDE.md` shows only history.
Tests: `advisors.test.ts` (no table outside the allow-list has two permissive policies for one command; a table made by the helper is born split); `people-roles.test.ts` and `founder-departures.test.ts` edited as named; `cross-tenant.test.ts` unchanged.
Done when: the advisor's 320 fall to the allow-listed tables, and no suite changed what a role may read or write.

### [x] T7: Migration: six foreign-key indexes            [size S] [ships alone]
Why: A8-18. Each of the six already has an index led by its first column, so no query gets faster: this clears the lint so the next real finding is visible. The six new indexes will sit under "unused index" until used.
Files: create `packages/db/migrations/0111_fk_indexes.sql`; modify `meta/_journal.json`, `advisors.test.ts`, and the mirror: `packages/db/src/schema/governance.ts` (`account_outbox`), `conversations.ts` (`agent_messages`), `inbox.ts` (`inbox_item_reads`), `showcase.ts` (`showcase_consents`: replace `showcase_consents_inbox_item_id_idx`), `team-calls.ts` (two).
Interfaces: none beyond the index names below, each mirrored with `index("<name>").on(…)` in its schema file.
SQL, constraint names checked against 0085, 0020, 0048, 0103 and 0082. No `concurrently`: the migrator runs in one transaction and the tables are small.
```sql
create index account_outbox_event_user_idx       on account_outbox    (event_id, user_id);          -- account_outbox_event_fkey
create index agent_messages_thread_business_idx  on agent_messages    (thread_id, business_id);     -- agent_messages_thread_fkey
create index inbox_item_reads_item_business_idx  on inbox_item_reads  (inbox_item_id, business_id); -- inbox_item_reads_item_fkey
create index showcase_consents_item_business_idx on showcase_consents (inbox_item_id, business_id); -- showcase_consents_inbox_item_fkey
drop index showcase_consents_inbox_item_id_idx;
create index team_call_actions_call_business_idx on team_call_actions (call_id, business_id);       -- team_call_actions_call_fkey
create index team_call_turns_call_business_idx   on team_call_turns   (call_id, business_id);       -- team_call_turns_call_fkey
```
Steps:
1. Add to `advisors.test.ts` a port of Supabase's lint `0001_unindexed_foreign_keys` (the splinter project's SQL), limited to schema `public`: a foreign key with no index whose leading columns are its own. verify: before the migration it returns exactly the six constraints above; more or fewer means the port is wrong, so fix the port.
2. Add the migration and the mirror. verify: the assertion returns `[]`; `pnpm --filter @foundmill/db test migrations` (the mirror test) passes; `test:rls` on both engines.
Tests: `advisors.test.ts` (no foreign key in `public` without a covering index); `migrations.test.ts` (the mirror).
Done when: the advisor's six are gone.

### T8: `bak_20261013` and the production schema check            [size S] [ships alone] [needs the founder: F3, WP-00 S16]
Why: A8-07, A8-32. 89 tables without primary keys, in no migration, document or commit. It was 33 days old on Nov 15, 2026, past the 30 days the Privacy Policy gives backups, and `fm_purge_business` never reaches it.
Files: modify docs/DECISIONS.md (what it was, what was done, the rule: a backup is a Supabase backup or a dump with a deletion date, never a schema in the live database), docs/DEPLOY.md §4 (the check in step 6).
Interfaces: none (operator SQL; no code).
Steps. 1 to 3 only read; 5 is the founder's alone.
1. Inventory. verify: paste the results into the pull request.
```sql
select count(*) from pg_tables where schemaname = 'bak_20261013';
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) from pg_stat_user_tables where schemaname = 'bak_20261013' order by pg_total_relation_size(relid) desc limit 15;
select pg_size_pretty(sum(pg_total_relation_size(relid))) from pg_stat_user_tables where schemaname = 'bak_20261013';
select pg_get_userbyid(nspowner) as owner, nspacl from pg_namespace where nspname = 'bak_20261013';
select grantee, privilege_type, count(*) from information_schema.table_privileges where table_schema = 'bak_20261013' group by 1, 2;
```
2. Nothing outside depends on it. verify: both return no row.
```sql
select conrelid::regclass, conname from pg_constraint where contype = 'f' and connamespace <> 'bak_20261013'::regnamespace
   and confrelid in (select oid from pg_class where relnamespace = 'bak_20261013'::regnamespace);
select distinct dn.nspname, dc.relname from pg_depend d
  join pg_class sc on d.refclassid = 'pg_class'::regclass and sc.oid = d.refobjid
  join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
  join pg_class dc on dc.oid = r.ev_class join pg_namespace dn on dn.oid = dc.relnamespace
 where sc.relnamespace = 'bak_20261013'::regnamespace and dn.nspname <> 'bak_20261013';
```
3. Does it hold what should be gone? verify: the two counts are written down; anything above 0 means the 30-day promise is already broken for those rows, which makes the drop urgent.
```sql
select count(*) from bak_20261013.businesses b where not exists (select 1 from public.businesses p where p.id = b.id);
select count(*) from bak_20261013.credentials;
```
4. Backup first (founder). Either confirm that Supabase's scheduled backup of today exists (it contains the schema; see T3), or, to keep a copy of your own: `pg_dump --schema=bak_20261013 --format=custom --file=bak_20261013.dump "<direct connection string>"`, encrypted, with a deletion date at most 30 days out. Check the size from step 1 against free disk first. Recommended: rely on the scheduled backup and keep no copy.
5. Founder only, in the SQL editor: `drop schema bak_20261013 cascade;` This cannot be undone.
6. verify: `select count(*) from pg_namespace where nspname like 'bak\_%';` is 0. Hand WP-00 this query for its check script.
7. A8-32, while connected: `select count(*) from drizzle.__drizzle_migrations;` equals the journal's entry count; `select tablename from pg_tables where schemaname = 'public' order by 1;` compared with the same query on a database the harness migrated from `main`. verify: the one table missing in production (132 against 131) is named in the pull request; if a migration did not fully apply, stop and report.
Tests: none (no code). The check is step 6's query, kept in DEPLOY §4.
Done when: step 6 answers 0, or DECISIONS records why the founder kept it.

### T9: Demo data out of every cross-project number            [size S] [ships alone]
Why: A8-06. Per-project numbers are scoped by `business_id` and covered by the cross-tenant suites; the gap is SQL that reads across projects, which today must remember `not is_demo` by hand.
Recorded decisions: 2026-11-09 "A first-week timeline on Today…" item 3 and 2026-11-10 "The sample's roll-forward…" chose the in-place hourly roll over shifting at read time and over re-seeding. This task does not stop the roll: it measures it, and leaves the off switch (`DEMO_ROLL_FORWARD=off`) to the founder.
Files: create `packages/db/migrations/0112_real_businesses.sql`, `packages/db/src/__tests__/repos/demo-isolation.test.ts`; modify `meta/_journal.json`, `packages/db/src/schema/accounts.ts` (`export const realBusinesses = pgView("real_businesses", { id: uuid("id").notNull(), isHouse: boolean("is_house").notNull() }).existing()`), `packages/db/src/__tests__/migrations.test.ts` (the view list near line 221), `packages/db/src/repos/presence.ts` (`retentionReport`), `packages/db/CLAUDE.md`, `apps/api/src/services/demo-roll-forward.ts`.
SQL (the id is `HOUSE_BUSINESS_ID`, `packages/config/src/showcase.ts`; the view carries no column of `businesses` but `id`, so a column added later never makes it stale). A sample can never appear in it; Foundmill's own project appears with `is_house` true, because WP-02 counts it in some figures and leaves it out of its "outside" ones:
```sql
create view real_businesses as
  select b.id, (b.id = 'f0f0f0f0-0000-4000-8000-00000000f00d'::uuid) as is_house from businesses b where not b.is_demo;
revoke all on real_businesses from public, anon, authenticated, service_role;
grant select on real_businesses to service_role;
comment on view real_businesses is 'Every project that is not a sample; is_house marks Foundmill''s own. A query that reads more than one project joins this.';
```
Interfaces: consumes `repos.presence.retentionReport(db: Executor, range: { from: Date; to: Date }): Promise<RetentionReport>`. Produces: view `real_businesses(id, is_house)`; `CROSS_BUSINESS_REPORTS: { name: string; run: (db: Executor) => Promise<unknown> }[]` exported from `demo-isolation.test.ts`. Rule added to `packages/db/CLAUDE.md`: a repo function that reads more than one business joins `real_businesses` and is listed in `CROSS_BUSINESS_REPORTS`. WP-02's `MetricFacts` and cost report filter on `is_demo = false` in their own SQL today and name the house by id: they join the view and add themselves to the list, in whichever of the two packages merges second.
Steps:
1. Write the test: one real business with a commit date, sign-offs and visit days; run every entry of `CROSS_BUSINESS_REPORTS` and keep the results; add a business with `is_demo = true` and the same activity; run again; the results are deep-equal. Also: a business inserted with `HOUSE_BUSINESS_ID` reads `is_house` true and every other one false; anon and authenticated cannot select from the view (`RLS_DENIED`). verify: the view assertions fail before the migration.
2. Add the migration and the mirror; `retentionReport` joins `realBusinesses` and drops its own `is_demo` filter (the house stays in it, as today). verify: `pnpm --filter @foundmill/db test demo-isolation presence migrations`; `test:rls` on both engines.
3. Log how long a roll takes: `rollDemoBusinesses` adds `ms` to its "sample businesses rolled forward with the calendar" line. verify: one case in `apps/api/src/__tests__/sample-numbers.test.ts` reads `ms` as a number from the captured line. After three days in production, write the three figures in DEPLOY §6. Above 60 seconds, put two options to the founder (the off switch, which lets the sample's dates go stale; a weekly roll); below, change nothing.
4. Read-only on production (F3): `select id, name, is_demo from businesses where id = 'f0f0f0f0-0000-4000-8000-00000000f00d' or name ilike 'foundmill%';`. verify: the answer is passed to WP-02, whose plan assumes Foundmill's own project carries the house id; if it does not, WP-02's "13 and 12" needs the real id. Which figures count the house is WP-02's question, not decided here.
Tests: `demo-isolation.test.ts` (every listed report is the same with and without a demo; `is_house` is true for `HOUSE_BUSINESS_ID` alone; client roles are refused); `migrations.test.ts` (the view list); `presence.test.ts` unchanged.
Done when: adding a demo business changes no cross-project report, and a new report that forgets the view fails the test once listed.

### T10: Measure the api under 100 Today loads            [size M] [ships alone] [needs the founder for the production run: F4]
Why: A8-02, a11 S14. Pool 10, six request transactions at once (`apps/api/src/services/tx-gate.ts` `gateLimitsFor`), a 15 s wait, no statement timeout through the pooler (`packages/db/src/client.ts` `createDb`), and no measurement. Recorded: 2026-11-12 "The api's pool filled by one request" ("The pool is not raised yet") and 2026-10-19 "The api's pool wedged for four hours" (timeouts only on direct connections, because startup parameters do not pass a pooler). Neither is re-decided: this task measures, then changes only what the table below says.
Files: create `scripts/load-today.mjs`, `scripts/load-today.test.mjs`; modify `.github/workflows/ci.yml` (run the script's test beside the other `scripts/*.test.mjs`), docs/DEPLOY.md §3 "Database connections". Only if the table says so: `packages/db/src/client.ts`, `packages/db/src/__tests__/rls/statement-timeout.test.ts`.
Interfaces: consumes `GET <api>/trpc/today.get,today.visit?batch=1&input=<json>` with superjson input `{"0":{"json":{"businessId":"…"}},"1":{"json":{"businessId":"…"}}}` (the two reads `apps/web/components/today/TodayScreen.tsx` makes), `Authorization: Bearer`; `/health` `transactions` (`TransactionGateStats`: `held`, `waiting`, `peak`, `timeouts`, `total`, `perRequest`) and `pool`. Produces: `node scripts/load-today.mjs --url <api> --business <uuid> --users 25,50,100 [--rounds 3]`, bearer from the environment variable `FM_BEARER` and never from an argument; it prints, per step, requests, errors, p50, p95, max in ms, and the gate's `peak`, `waiting` and `timeouts` before and after. No dependency: `fetch` and `performance.now()`. Exports `percentile(sorted: number[], p: number): number`.
Steps:
1. Write `percentile` and the argument parser test first, then the script. verify: `node --test scripts/load-today.test.mjs`.
2. Read production's limits (F3): `select current_user, current_setting('statement_timeout'), current_setting('idle_in_transaction_session_timeout'), current_setting('max_connections');` and `select rolname, rolconfig from pg_roles where rolname in ('postgres', 'authenticator', 'authenticated');`; from the dashboard, the pooler's pool size and client limit. verify: in the pull request. `set local role` does not apply a role's own settings, so the first row is what an RLS transaction really gets.
3. Run A, in the session, no production: T1's cluster, a database `fm_load` migrated and seeded with `pnpm --filter @foundmill/db seed` at full volume, the api started as `e2e/playwright.config.ts` starts it but with `DATABASE_URL` on `fm_load` and `API_DB_POOL_MAX=10`, `FM_BEARER=dev`, the business Northwind (`DEMO_BUSINESS_IDS`, `packages/db/src/seed/constants.ts`), the heaviest tenant. verify: the table for 25, 50, 100 in the pull request, and a second run of one account sending 50 at once while another sends 1.
4. Run B (F4), production, a quiet hour, the founder's own token and the sample business. verify: the same table, pasted by the founder.
5. Rewrite DEPLOY's "Database connections": the product database is Supabase behind its pooler; Temporal has its own Railway Postgres; the paragraph today sizes the wrong database. Record both runs and step 2.
6. Change only what a row calls for; each change is its own pull request with its own before and after:

| What the numbers show | Change |
| --- | --- |
| p95 under 1.5 s at 100 and `timeouts` 0 | nothing |
| `timeouts` above 0, or `waiting` high while the database is idle | raise `API_DB_POOL_MAX` to 20 once step 2 shows the pooler has room (a WP-00 variable; the gate follows through `gateLimitsFor`) |
| p95 high with `waiting` near 0 | the query is the cost: rerun after T5 and T6; if still high, read `pg_stat_statements` for `today.get` |
| `statement_timeout` is 0 for the api's sessions | `RLS_SETUP_SQL` also sets `set_config('statement_timeout', '8000', true)` (transaction-local, so it passes the pooler); test: `select pg_sleep(9)` under `withRls` fails with code 57014 on real Postgres; background work keeps its own |
| one account's burst lifts another's p95 above 1.5 s | a per-account cap inside the gate, as a new task |
Tests: `scripts/load-today.test.mjs` (`percentile` on known arrays; `--users 25,50,100` parses; a bearer passed as an argument is refused). The runs themselves are measurements, recorded, not asserted in CI.
Done when: both runs and the limits are in DEPLOY §3, and each row that applied has a merged change or a line saying why not.

### [x] T11: Gateway: who may mint what; a tool without hints is refused            [size S] [ships alone] Review: security-reviewer
Why: A7-15, A7-16, SEC-17. `POST /v1/session-tokens` (`apps/gateway/src/app.ts`) accepts any `svc` and copies `allowedTools` and `kitMode` from the request; `buildPolicyInput` (`apps/gateway/src/pipeline.ts`) reads `connector.policyHints[tool.name] ?? {}`, so a tool with no entry counts as internal: every hint false, allowed in every mode.
Files: modify `apps/gateway/src/app.ts`, `apps/gateway/src/pipeline.ts`, `packages/connectors/src/testing/contract-suite.ts`, `apps/gateway/src/__tests__/service-routes.test.ts`, `apps/gateway/src/__tests__/policy-hardening.test.ts`, `apps/gateway/CLAUDE.md`, docs/DECISIONS.md.
Interfaces: consumes `MintSessionTokenRequest` (`apps/gateway/src/types.ts`), `ServiceToken.svc`, `GatewayError(code, message, status)`, `McpToolDefinition.annotations.readOnlyHint`, `PolicyHint`. Produces:
- `mintRefusal(svc: string, claims: { sessionId: string | null; allowedTools: string[]; kitMode: boolean }): string | null` in `app.ts`, called before the business is read. It refuses: a `svc` other than `orchestrator` or `api` (the only callers: `grep -rn "mintSessionToken\|session-tokens" apps/*/src`; a third caller is added with its reason); for anyone, the bare ref `*`; for `svc: "api"`, a session id, more or fewer than one tool ref, a wildcard in it, or `kitMode: true` (the api's one path, `apps/api/src/services/gateway.ts` `toolCall`, asks for exactly one tool and no session). 403, `forbidden_service` or `mint_scope_refused`.
- In `executeToolCall`: a tool with no `policyHints` entry at all is denied with policy id `missing-policy-hints`, audited like the `session-scope` refusal next to it. The contract suite already demands an entry for every tool, so this changes nothing today; it is the default that fails closed.
- In the contract suite, one new case: a tool whose hints are all false declares `annotations.readOnlyHint: true`, or its ref is a key of `INTERNAL_WRITE_TOOLS: ReadonlyMap<string, string>` (ref to the reason it only writes inside the project), exported from `contract-suite.ts`.
Steps:
1. Mint tests: a `svc: "ingest"` token is refused; `svc: "api"` with a session id, with two tools, with `github:*`, with `kitMode: true` is refused; `svc: "api"` with one tool and no session, and `svc: "orchestrator"` with a session and `platform:*`, still mint. verify: fail before.
2. Pipeline test: a connector double whose tool has no hints entry gets 403 with `missing-policy-hints` and an audit row.
3. Run the new contract case. verify: its first failure list is the inventory; paste it. Sort each tool: it only reads (add `readOnlyHint`); it writes only inside the project (add to the map with a reason); it reaches a third party, spends or cannot be undone (add the hint). A tool that gains a hint will start asking in assisted mode: name each one in the pull request with its outcome before and after, for the founder.
4. `apps/gateway/CLAUDE.md`: replace "Anything outward or costly asks first in augmented and assisted mode" with what the Cedar files do: augmented asks for anything that contacts a third party, spends or cannot be undone; assisted asks for what cannot be undone, for contracts and above the threshold, and lets the rest run (BUILD §9.6, `60-assisted.cedar`). The policy is not changed.
5. DECISIONS: why the mint does not intersect with the agent's grants and does not refuse an ended session (see "Corrections to the audits", item 4).
Tests and evals: `service-routes.test.ts` (the mint table of step 1), `policy-hardening.test.ts` (no hints entry is a deny), the contract suite's new case for every connector; `pnpm evals` in mock mode unchanged, since a tool that gains a hint changes what an agent is allowed to do alone.
verify for all: `pnpm --filter @foundmill/gateway test`, `pnpm --filter @foundmill/connectors test`, `pnpm --filter @foundmill/policy test`, `pnpm --filter @foundmill/orchestrator test grants-contract session`.
Done when: only the two services mint, the api only one tool at a time, and a tool with empty hints is either read-only or on a reviewed list.

### [x] T12: An api-only service token secret            [size M] [ships alone] [production switch: F5] Review: security-reviewer
Why: N4, A8-09 (first step), a11 C4, a11 S1. Recorded: 2026-11-11 "SEC-14: the calls made" ("needs a new variable set on the api and the gateway on Railway at the same deploy; doing it in code alone would break production"). This task writes the code so it merges first and the switch is three safe steps.
Files: modify `packages/shared/src/env.ts`, `.env.example`, `apps/gateway/src/config.ts`, `apps/gateway/src/tokens.ts`, `apps/gateway/src/app.ts` (`requireService`, `/health`), `apps/api/src/services/gateway.ts`, `apps/api/src/context.ts`, `apps/gateway/src/__tests__/tokens.test.ts`, docs/DEPLOY.md §3 (variable table) and §6, docs/SECURITY_REVIEW.md (N4).
Interfaces: consumes `verifyServiceToken(secret: string, token: string): Promise<ServiceToken>`, `signServiceToken(secret, svc, ttlSeconds)`, `gatewayConfig(env, nodeEnv)`. Produces:
- Env: `API_SERVICE_TOKEN_SECRET` (optional; 32 characters or more, else the gateway and the api refuse to start), `API_SERVICE_TOKEN_LEGACY` (optional, `1`).
- `verifyServiceTokenFor(secrets: { shared: string; api: string | null; legacy: boolean }, token: string): Promise<ServiceToken>`: with `api` null, as today. With `api` set: a token that verifies under `api` must claim `svc: "api"`; a token that verifies under `shared` may claim `api` only while `legacy` is true; every other `svc` verifies under `shared` as before.
- The api signs with `API_SERVICE_TOKEN_SECRET` when set, else `SESSION_TOKEN_SECRET`.
- Gateway `/health` adds `apiServiceToken: "shared" | "legacy" | "own"` (a word, never a value).
Steps:
1. Table-driven test over (signing secret, `svc`, mode): shared + `api` passes in `shared` and `legacy`, fails in `own`; api secret + `api` passes in `legacy` and `own`; api secret + `orchestrator` always fails; shared + `orchestrator` always passes; a 31-character secret fails `gatewayConfig`. verify: fails before.
2. Implement; `node --test scripts/env-example.test.mjs` passes with the two names added.
3. DEPLOY: F5 in order, each with its check. (a) gateway gets the secret and `API_SERVICE_TOKEN_LEGACY=1`: `/health` says `legacy`. (b) the api gets the same secret: Settings › Integrations still answers. (c) remove the flag from the gateway: `/health` says `own`. Forgetting (c) stays visible as `legacy`.
Tests: `tokens.test.ts` (the table of step 1); `scripts/env-example.test.mjs`; the api's gateway-client suites (`apps/api/src/__tests__/gateway-double.ts` users) unchanged.
Done when: after F5, a token signed with `SESSION_TOKEN_SECRET` that claims `svc: "api"` gets 401 from the gateway.

### [x] T13: One JWT verifier for the api and the stream            [size M] [ships alone] Review: security-reviewer
Why: A8-12, A8-24, a11 S5, a11 S24. `apps/api/src/auth.ts` refuses password-only sessions and computes `emailConfirmed`; `apps/stream/src/auth.ts` is an older copy that does neither, so a listed address opens a socket without the confirmed-address rule.
Files: create `packages/shared/src/auth-verifier.ts`, `packages/shared/src/auth-verifier.test.ts`; modify `packages/shared/package.json` (`"jose": "catalog:"`, already in the catalog), `apps/api/src/auth.ts` (re-export, no logic), `apps/stream/src/auth.ts` (a wrapper that keeps `StreamAuthError`; its unused `audience` option goes if `grep -rn "audience:" apps/stream/src` shows no caller passing one), `packages/shared/src/allowlist.ts`, `packages/shared/src/allowlist.test.ts`, `apps/stream/src/index.ts`, `apps/stream/src/server.ts`, `apps/stream/src/__tests__/auth.test.ts`.
Interfaces: moved unchanged from `apps/api/src/auth.ts`: `createAuthVerifier(opts: AuthVerifierOptions): AuthVerifier`, `AuthUser`, `AuthError`, `supabaseJwks`, `parseDevToken`, `bearerToken`, `emailConfirmedFromPayload`, `passwordOnlyFromPayload`, `googleVerifiedFromPayload`, `authenticatedAtFromPayload`, `SIGN_IN_METHODS`, `JWKS_REFRESH_MS`, `JWKS_CACHE_MAX_AGE_MS`. Changed: `AuthVerifierOptions` gains `nodeEnv?: string` (default `process.env.NODE_ENV`); the dev bypass needs `appEnv` development or test and `nodeEnv !== "production"`; `jwtVerify` always gets `requiredClaims: ["exp"]`; `keepKeysFresh` unchanged. `liveChannelAdmit(env, devUserId, isAdmitted)` returns a function over `{ userId: string; email: string | null; emailConfirmed?: boolean }`, and a listed address admits only when `emailConfirmed === true`, the rule of `isAdmittedNow` (`apps/api/src/services/access.ts`).
Recorded: 2026-11-11 "Security prerequisites (package 0.7)" keeps `APP_ENV=test` legal in a production image because CI boots the image that way. That stays: the boot check reads `/health` and uses no bypass.
Steps:
1. `auth-verifier.test.ts`, new cases only (the api's `dev-auth`, `google-auth` and `google-signin-hardening` suites stay where they are and keep passing through the re-export): `appEnv: "test"` with `nodeEnv: "production"` refuses `dev` and `dev:<uuid>`; a token without `exp` is refused; a password-only token is refused. verify: the first two fail before.
2. `allowlist.test.ts`: a listed address with `emailConfirmed: false` is refused, with `true` admitted; an admitted account and the dev user as before.
3. Move the module; the api re-exports; the stream verifies through it and passes `emailConfirmed` to its admit. verify: `pnpm --filter @foundmill/shared test auth-verifier allowlist`, `pnpm --filter @foundmill/api test dev-auth google-auth google-signin-hardening`, `pnpm --filter @foundmill/stream test`; `grep -rn "auth-verifier" apps/web` finds nothing (the module must not reach the browser bundle).
4. One warning line at boot in the api and the stream whenever the dev bypass is active.
Not done: `apps/collab` keeps its copy (not deployed; WP-12 decides its future). The stream does not watch Supabase's "Confirm email" setting as the api does; it relies on the token.
Tests: `packages/shared/src/auth-verifier.test.ts`, `packages/shared/src/allowlist.test.ts`, `apps/stream/src/__tests__/auth.test.ts` (a password-only token and an unconfirmed listed address are refused at the upgrade).
Done when: a password-only session and an unconfirmed listed address get no socket, and `grep -rn "jwtVerify" apps/api/src apps/stream/src` finds no call outside tests.

### [x] T14: Supabase settings: declared and watched            [size S] [ships alone] [production switch: WP-00 S10] Review: security-reviewer
Why: A8-11, SEC-8 (accepted only while the Data API is off), a11 C11, a11 S10, a11 S11. The setting lives in a dashboard and nothing notices if it flips.
Files: create `apps/api/src/services/data-api-probe.ts`, `apps/api/src/__tests__/data-api-probe.test.ts`; modify `apps/api/src/context.ts`, `apps/api/src/index.ts`, `apps/api/src/app.ts` (`/health`), `supabase/config.toml`, `scripts/supabase-config.test.mjs`, docs/DEPLOY.md §4.
Interfaces: consumes the shape of `createConfirmEmailGuard` (`apps/api/src/services/confirm-email.ts`) and `CONFIRM_EMAIL_REFRESH_MS`. Produces `createDataApiProbe(opts: { supabaseUrl: string; anonKey: string | undefined; log: ApiLogger; fetchImpl?: typeof fetch; timeoutMs?: number }): { state(): "off" | "on" | "unknown"; start(): { stop(): void } }`: `GET {supabaseUrl}/rest/v1/` with the `apikey` header at boot (never awaited) and every 10 minutes; a 2xx is `on` and logs one error; 503 or 404 is `off`; anything else keeps the last value. `/health` adds `dataApi`. It reports and never fails readiness.
Steps:
1. Probe test with a stubbed fetch: 200 gives `on` and one error line; 503 gives `off`; a thrown error keeps the last value; no key gives `unknown` with one warning.
2. `supabase/config.toml`: `[api] enabled = false`; under `[auth]`, `enable_anonymous_sign_ins = false`; under `[auth.email]`, `enable_confirmations = true`; `[auth.sms] enable_signup = false`. Check each key against the CLI version in use; `scripts/supabase-config.test.mjs` asserts the four. verify: `node --test scripts/supabase-config.test.mjs`.
3. DEPLOY §4: the push of WP-00 S10, and that it must show no other difference. WP-00 S10's own check (`/rest/v1/` answers 503) becomes `dataApi: "off"` on the api's `/health`.
Tests: `data-api-probe.test.ts` (the four answers of step 1); `scripts/supabase-config.test.mjs` (the four keys).
Done when: `https://api.foundmill.com/health` shows `dataApi: "off"`, and turning the Data API on would log an error within 10 minutes.

### [x] T15: ingest: bounded webhook bodies; mail routes on `/health`            [size S] [ships alone] Review: security-reviewer
Why: A8-22, N2, `audits/e0-production-evidence.md` "Live configuration". `apps/ingest/src/webhooks.ts` (`ctx.req.clone().text()`) and `apps/ingest/src/billing.ts` (`req.text()`) read a body of any size on a public service; only `/mail/*` is capped.
Files: modify `apps/ingest/src/app.ts`, `apps/ingest/src/webhooks.ts`, `apps/ingest/src/billing.ts` (constants), `apps/ingest/src/__tests__/webhooks.test.ts`, `apps/ingest/src/__tests__/billing.test.ts`, `apps/ingest/CLAUDE.md`, docs/DEPLOY.md §3 (ingest row) and §5.7.
Interfaces: consumes the existing `tooLarge(maxSize)` in `app.ts` (hono `bodyLimit`; answers 413 `payload_too_large`). Produces `WEBHOOK_MAX_BYTES = 1024 * 1024`, `WEBHOOK_MAX_BYTES_BY_CONNECTOR: Record<string, number> = { github: 25 * 1024 * 1024 }`, `BILLING_WEBHOOK_MAX_BYTES = 1024 * 1024`; `/health` adds `platformMail: { domain: boolean; inbound: boolean; events: boolean }` (`inbound`: the token is set; `events`: the event key and the signing secret are set; booleans only).
Steps:
1. Tests: 2 MB to `/webhooks/stripe` answers 413 and the connector's `verify` is never called; 2 MB to `/webhooks/github` passes the limit and is judged by its signature; 2 MB to the billing path answers 413.
2. Register the limits above the routes (hono runs middleware in the order it was added, and `tooLarge` is defined below the webhook routes today); the limit is chosen from the path segment after `/webhooks/`. verify: `pnpm --filter @foundmill/ingest test`.
3. Write down why ingest refuses every vendor webhook today, in DEPLOY §3. It is by design, 2026-10-12 "Mock webhooks only in development and test…": ingest runs `INTEGRATIONS_MODE=mock` with no `LIVE_CONNECTORS`, so `registry.mountableWebhooks` mounts nothing and `/health` lists the five under `refusedMockWebhooks`. A connector's webhook mounts when its key is in ingest's `LIVE_CONNECTORS` and its secret is set, and a delivery is written only for a business that connected it. `sendgrid` stays out of that list (DEPLOY §5.7 step 6; N2).
4. Write down what SendGrid's event webhook needs (WP-00 S2). It is not one of those mounts: it is `POST /mail/events`, on while `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY` and `PLATFORM_MAIL_SIGNING_SECRET` are set on ingest, which they are. What is unconfirmed is SendGrid's side: Mail Settings → Event Webhook, URL `https://ingest.foundmill.com/mail/events`, actions Dropped, Bounced, Spam Reports, Unsubscribes, Signed Event Webhook on, its verification key equal to the variable. Check: SendGrid's test delivery shows 200 for `/mail/events` in ingest's log; a wrong key logs "platform mail events refused: signature verification failed"; `/health` shows `platformMail.events: true`. WP-00 S2 as written sets `LIVE_CONNECTORS=sendgrid` on ingest and checks that `/health` lists `sendgrid` under `webhooks`: that mounts the per-business SendGrid routes, which DEPLOY §5.7 step 6 forbids while N2 is open, and it is not what delivers the platform's bounces. Tell the WP-00 session before it runs S2; its check becomes the three above plus a test bounce writing a suppression row.
5. Flag for WP-00, not switched here: GitHub is connected for one project through the gateway, but its webhook is refused at ingest, so GitHub's own deliveries (a merged pull request, a finished check) never reach a project as events until `github` is in ingest's `LIVE_CONNECTORS` with `GITHUB_WEBHOOK_SECRET`.
Tests: `webhooks.test.ts` and `billing.test.ts` (the three cases of step 1; `/health` carries `platformMail` as three booleans).
Done when: an oversized delivery costs ingest nothing, and one request to `/health` says whether mail events can arrive.

### T16: Account export and closing, by request            [size M] [ships alone] [needs the founder: F6] Review: security-reviewer
Why: A8-13, a11 S12, a11 S13, a11 C10. The Privacy Policy says "Closing your account and exporting all your data is done by request for now" and "When you ask us to delete it, we delete it within 30 days" (`apps/web/content/legal/privacy.ts`); recorded 2026-11-13 "The Terms and the Privacy Policy (founder)". So the promise is an operator path that works, not a button. Today the only way is the dashboard, which strands projects (`fm_memberships_keep_owner`, 0092, lets the last owner go with the auth user) and leaves the Redis stream.
Files: create `packages/db/src/repos/account-portability.ts`, `packages/db/src/__tests__/repos/account-portability.test.ts`, `apps/api/src/scripts/account.ts`; modify `packages/db/src/repos.ts`, `apps/api/package.json` (`"account": "tsx src/scripts/account.ts"`), docs/DEPLOY.md §4 ("Closing an account by request").
Interfaces: consumes `portableValue` (`packages/db/src/repos/portability.ts`), `deleteAccountStream(redis, userId)` (`packages/events/src/outbox/account-relay.ts`), `createApiDeps` (`apps/api/src/context.ts`). Produces, as `repos.accountPortability`:
- `ACCOUNT_COLUMNS: Readonly<Record<string, { export: boolean; onDelete: "cascade" | "set null" | "restrict" | "none"; note?: string }>>`, keyed `table.column`: every column in `public` with a foreign key to `auth.users(id)`, plus the listed ones without a key (`message_threads.participant_ids`).
- `export(db: Executor, userId: string): Promise<{ format: "foundmill-account-export/1"; userId: string; generatedAt: string; tables: Record<string, PortableRow[]>; truncated: string[] }>` (10,000 rows a table at most).
- `closingPlan(db: Executor, userId: string): Promise<{ soleOwnerOf: { businessId: string; name: string }[]; memberships: number }>`: non-demo businesses where the person is the only unexpired owner or cofounder.
- `leftovers(db: Executor, userId: string): Promise<{ column: string; rows: number }[]>`: classified columns that still hold the id.
- The script: `pnpm --filter @foundmill/api account export <userId>` (JSON to stdout), `check <userId>` (prints `closingPlan`; exit 1 while `soleOwnerOf` is not empty), `verify <userId>` (after the auth user is gone: `leftovers` shows only `set null` and `none` columns; removes the `ae:` stream).
Steps:
1. Structural test first, as `portability.test.ts` does for businesses: the set of foreign keys to `auth.users` read from `pg_constraint` equals the keyed columns of `ACCOUNT_COLUMNS` that have a key. verify: fails listing every column; classify each.
2. Export test: two accounts; A's export holds none of B's ids. Closing test, on both engines: after `delete from auth.users where id = A` on the owner connection, `leftovers(A)` lists only columns classified `set null` or `none`, and a business A solely owned shows in `closingPlan` beforehand.
3. Implement the repo and the script. verify: `pnpm --filter @foundmill/db test account-portability` on PGlite and with `RLS_TEST_DATABASE_URL`.
4. The runbook, in order: answer the email within a week; `export` and send the file; the person deletes or hands over each project they solely own (Settings, 7 days to change their mind), or the founder purges it with `select fm_purge_business('<id>');` when the person asks in writing (permanent, founder only); `check` exits 0; the founder deletes the user in Supabase → Authentication → Users (F6); `verify`. Add the orphan check for WP-00's script: `select b.id, b.name from businesses b where not b.is_demo and not exists (select 1 from memberships m where m.business_id = b.id and m.source <> 'example' and (m.expires_at is null or m.expires_at > now()));`.
Tests: `account-portability.test.ts` (every foreign key to `auth.users` is classified; an export holds one account only; after the auth user is deleted only classified columns keep the id), on both engines.
Done when: a test account is exported, closed and verified end to end, and the orphan query returns no row on production.

### [x] T17: The service connection: the rule as it is, and a pinned list            [size S] [ships alone]
Why: A8-16. `apps/api/CLAUDE.md` says every user-originated query runs under RLS. In `apps/api/src/routers`, 201 lines use `ctx.db` and 206 use `ctx.rls(`. Recorded 2026-10-07 "apps/api: RLS runner for user work, service db only for service-written tables, never nested" covers part of it; the person-level routers came later. Moving 201 call sites under RLS is not a hygiene task: the rule is written as it is and a new use becomes visible in review.
Files: create `apps/api/src/__tests__/service-connection.test.ts`; modify `apps/api/CLAUDE.md` (the first invariant), docs/ARCHITECTURE.md §13 (one paragraph), docs/DECISIONS.md.
Interfaces: produces `SERVICE_CONNECTION_ROUTERS: Readonly<Record<string, { lines: number; why: "person" | "signed_out" | "service_written" | "mixed"; note: string }>>`. At `04a0a509`: `live.ts` 61, `idea.ts` 26, `founder.ts` 15, `email.ts` 15, `agent.ts` 14, `business.ts` 14, `integrations.ts` 10, `import.ts` 9, `product.ts` 5, `distribution.ts` 5, `team.ts` 5, `logo.ts` 5, `idea-box.ts` 5, `billing.ts` 4, `legal.ts` 3, `founder-businesses.ts` 2, `dev.ts` 1, `team-call.ts` 1, `people.ts` 1.
Steps:
1. The test reads each file in `apps/api/src/routers`, counts the lines matching `/\bctx\.db\b/`, and expects the map of non-zero counts to equal the constant, so a new use or a removed one edits the list in the same pull request. verify: passes with the numbers above (recount first; if `main` moved, use its numbers).
2. Fill `why` and `note` per file by reading it: `person` (no business; the repo takes `ctx.userId`), `signed_out` (a token is the only credential), `service_written` (a table only services write, after the membership check), `mixed`.
3. Rewrite the invariant: user-originated work in a business runs under `ctx.rls`; the service connection is allowed for the three classes above and for the membership read in `businessProcedure`; each use is counted in `service-connection.test.ts`; a `ctx.db` call is never made inside a `ctx.rls` callback. A per-procedure list would need a parser for nested routers; the per-file count catches the same event with ten lines.
Tests: `service-connection.test.ts` (the per-file counts equal the constant).
Done when: the document matches the code and the test fails on the next unlisted use.

### T18: The P3 items in one change            [size S] [ships alone] Review: security-reviewer
Why: A8-21 (a11 S10), A8-23, A8-27 (CORS part), SEC-15 (redaction part).
Files: create `packages/db/migrations/0113_public_profiles_service_only.sql`, `packages/shared/src/logger.test.ts`; modify `meta/_journal.json`, `packages/db/src/__tests__/rls/client-grants.test.ts`, `apps/web/lib/env.ts`, `apps/web/lib/__tests__/env.test.ts`, `apps/api/src/app.ts` (`allowedOrigins`), `apps/api/src/__tests__/health.test.ts`, `packages/shared/src/logger.ts`, docs/DECISIONS.md.
Interfaces: `allowedOrigins(env: { APP_URL: string; APP_ENV: string }): string[]` (gains `APP_ENV`); `parsePublicEnv(raw)` unchanged in shape; no other name changes.
Steps:
1. `public_profiles`: `revoke all on public_profiles from public, anon, authenticated;` then `grant select on public_profiles to service_role;` (every reader is `repos/social.ts` on the service connection). Test in `client-grants.test.ts`: `has_table_privilege` is false for `anon` and `authenticated`. verify: `grep -rn "public_profiles\|publicProfiles" packages/db/src/__tests__`; a suite that reads the view as a client moves to `h.service()`; `test:rls` on both engines. This follows the rule of the Nov 11 person-profile review (public views are the service's) and supersedes the 2026-10-05 line that left this view readable by anyone: say so in DECISIONS.
2. `parsePublicEnv` (`apps/web/lib/env.ts`): with `NODE_ENV === "production"` and `NEXT_PUBLIC_APP_ENV` unset or not a known value, the result is `production`, not `development`. Test both. Production sets the variable today, so nothing changes there.
3. `allowedOrigins(env: { APP_URL: string; APP_ENV: string })`: the two localhost origins only when `APP_ENV` is development or test. Test: staging refuses `http://localhost:3000`; the existing test-environment case stays.
4. `REDACT` (`packages/shared/src/logger.ts`): add `*.accessToken`, `*.refreshToken`, `*.sealed`, and the two-level forms `*.*.apiKey`, `*.*.token`, `*.*.secret`, `*.*.password`, `*.*.authorization`. Test: a nested `{ integration: { credential: { secret: "x" } } }` logs `[Redacted]`.
verify for all: `pnpm exec turbo run typecheck lint test --filter=@foundmill/shared --filter=@foundmill/api --filter=@foundmill/web --filter=@foundmill/db`.
Tests: `client-grants.test.ts`, `apps/web/lib/__tests__/env.test.ts`, `health.test.ts`, `packages/shared/src/logger.test.ts`, one case each as the steps say.
Done when: the four checks pass and a11 S10 is closed.

### [x] T19: A dated decision for every item left open            [size S] [ships alone]
Why: the package's last "done when". An item nobody fixes and nobody accepts is picked up again by every audit.
Files: modify docs/DECISIONS.md (one entry, dated on the day it merges, titled "Security and data items accepted for now (WP-11)"), docs/SECURITY_REVIEW.md (a status table dated the same day, one row per id, each "fixed in T<n>" or "accepted, see DECISIONS"), docs/DEPLOY.md §3 (which service holds `DEV_MASTER_KEY` and why; WP-00 S16).
Interfaces: none (documents).
Steps:
1. Copy "Accepted for now, with the reason" below into the DECISIONS entry, one bullet per item, each with its trigger. verify: `node scripts/decisions-index.mjs accepted WP-11` finds it.
2. SECURITY_REVIEW: SEC-8, 9, 11, 15, 17, 18, 19, N2, N3, N4, the Nov 13 redirect row, the #131 and #132 P3 rows, A8-09 to A8-12 and A8-21 to A8-27, each with its state. SEC-18 is closed, not accepted. verify: `grep -rn "disable trigger" packages/db/src/seed packages/db/src/seed.ts` finds nothing; no row reads "open" without a decision.
3. DEPLOY §3, the vault key: the gateway decrypts a credential for one call; the orchestrator reads a founder's own model key for a session; the api seals a founder's Anthropic key (`apps/api/src/services/keys.ts`, its only use); ingest builds a vault only with a live connector (`apps/ingest/src/index.ts`), so today its copy is unused, and it will read a project's own webhook secret with it once `stripe` is live there (T20), so it stays; stream and composer never use it. And the trap: `createVault` (`packages/shared/src/crypto/index.ts`) refuses `DEV_MASTER_KEY` when `APP_ENV=production`, so switching `APP_ENV` before `KMS_KEY_ID` exists turns the vault off and refuses every founder on their own key.
4. Confirm WP-00 S16's removal list against the code, which it waits for. At `04a0a509`: `grep -rn "SESSION_TOKEN_SECRET\|DEV_MASTER_KEY\|createVault" apps/stream/src apps/composer/src` finds nothing outside tests, so both variables can leave both services; a grep of `apps/api/src` for `env.<NAME>` ending in a key, secret or token finds only `SESSION_TOKEN_SECRET`, `ANTHROPIC_API_KEY` and `SUPABASE_JWT_SECRET` beside the Supabase keys, and the api builds its connector registry without platform secrets (`apps/api/src/__tests__/gateway-double.ts`), so every connector's platform key can leave the api. verify: rerun both greps on `main`, and also over what the api hands its env to (`createVault`, the model client); write the variable names that may go into DEPLOY §3 and hand the list to the WP-00 session.
Tests: none (documents); the two greps in steps 1 and 2 are the check.
Done when: every id in `audits/a8-data-api-security.md` §4 and `audits/a11-roadmap-status.md` §7.0 has a row.

### [x] T20: A founder's own Stripe: store the webhook signing secret            [size M] [ships alone] [production switch: WP-00 S8] Review: security-reviewer
Why: N2 (the Stripe half). The Stripe connector verifies a delivery with the project's own `stripe_webhook_secret` and falls back to the platform's (`packages/connectors/src/connectors/stripe/index.ts` `secretFor`); ingest reads that credential (`apps/ingest/src/secrets.ts` `WEBHOOK_SECRET_NAMES`); nothing ever stores it. A founder's own Stripe account signs with its own endpoint secret, so its deliveries fail verification and `payment.received` never arrives. WP-07's pay link and WP-08's first payment both wait for that event.
Files: modify `packages/connectors/src/connectors/stripe/tools.ts` (`STRIPE_CONNECT_FIELDS`), `apps/gateway/src/integrations.ts`, `apps/gateway/src/__tests__/live-integrations.test.ts`, `apps/ingest/src/__tests__/staging-webhooks.test.ts`, docs/DEPLOY.md §5.5, docs/SECURITY_REVIEW.md (N2).
Interfaces: consumes `ConnectField` (`packages/connectors/src/contract.ts`), `connectIntegration(deps: GatewayDeps, input: ConnectInput, service: string)` and its provisional-then-bound sealing (`encryptJson`, `buildAad`, `repos.credentials.store`, `repos.credentials.rotate`), `createBusinessSecretResolver` (ingest, unchanged). Produces: a second field `{ name: "webhookSecret", label: "Webhook signing secret", secret: true, required: false, placeholder: "whsec_…", hint }`; in the gateway `WEBHOOK_SECRET_FIELDS: Readonly<Record<string, { field: string; kind: "stripe_webhook_secret" }>>` with the one entry `stripe`; after the main credential is stored, a field named there is sealed as a second `credentials` row of that kind on the same integration, in the same transaction, never echoed, and audited by kind only. A value that does not start with `whsec_` is a 400 before the vendor is called. The field is taken out of the input before `connector.connect` sees it.
Steps:
1. Gateway test: a live connect of `stripe` with both fields stores two rows (kinds `INTEGRATION_CREDENTIAL_KIND` and `stripe_webhook_secret`); the response and the audit row hold neither secret; without the field, one row; `webhookSecret: "abc"` is refused. verify: fails before.
2. Ingest test, beside "accepts a really signed delivery only for a business that connected the connector": staging, `stripe` live, a project with a stored `stripe_webhook_secret`; a `checkout.session.completed` signed with it at `/webhooks/stripe/<businessId>` is written; the same body signed with another secret is 401; the same delivery sent to another project's address is refused (`business_mismatch` or 401).
3. Implement. verify: `pnpm --filter @foundmill/gateway test live-integrations`, `pnpm --filter @foundmill/ingest test staging-webhooks`, `pnpm --filter @foundmill/connectors test`; the connect dialog renders `connectFields` as given, so run the Settings › Integrations Playwright spec unchanged.
4. DEPLOY §5.5, for the founder of a project: in Stripe → Developers → Webhooks, add an endpoint at `https://ingest.foundmill.com/webhooks/stripe/<the project's id, from its address /b/<id>/…>` with the events `stripe/webhooks.ts` handles (`checkout.session.completed`, `invoice.paid`, `customer.subscription.created` and the others its `switch` lists), then paste the signing secret into Settings › Integrations › Stripe. The field's hint says the same in one sentence. Showing the address in the product is WP-07's, with its pay link.
Tests: the two files above, as steps 1 and 2 say.
Done when: with `stripe` live on ingest (WP-00 S8), a test-mode payment on a founder's own Stripe account writes `payment.received` for that project and for no other.

## Accepted for now, with the reason

Each line goes into T19's DECISIONS entry with its trigger.
- Extensions `pg_trgm` and `vector` stay in `public` (A8-20). Moving them changes how every function with a pinned `search_path` (T4), the raw SQL in `repos/social.ts` and the PGlite harness resolve `%`, `similarity()` and the vector type, for no exposure while the Data API is off. Trigger: the Data API is ever turned on.
- SEC-8, write policies wider than the api's roles: accepted while the Data API is off, now watched by T14.
- SEC-17, no deny-list for session tokens: the gateway re-reads business and agent state on every call; a list keyed on the session's end would refuse the platform's own push and merge. Trigger: tokens leave the orchestrator's process.
- SEC-19, per-business policies never loaded: the table stays, no screen claims it. SEC-11, Dropbox Sign's scheme: until `dropbox_sign` enters any `LIVE_CONNECTORS`. N2, the SendGrid half: until a founder's own SendGrid is offered; `sendgrid` stays out of ingest's list (the Stripe half is T20). N3: until Stripe Connect is wanted; WP-07's pay link runs on the founder's own restricted key and does not need it.
- The wider secret split of A8-09 (session, service and link secrets, HKDF, 32 characters for the shared one): T12 closes the path that mattered, a service posing as the api. Trigger: a second service gains a route only it may call.
- The vault on KMS, and moving the api's seal into the gateway (A8-10): one project stores a key today. The seal sits inside the api's transaction and its AAD needs the row id, so the move is a design change, not hygiene. Trigger: ten stored keys, or the first paid plan.
- Rotating the vault key: no tool. Today it means a new key and the founders who stored one pasting it again. Trigger: same as above.
- PgBouncer in CI: the one pooler-only bug so far (the session advisory lock) has its test, run by hand with `FM_TEST_POOLER_URL`. Trigger: a second pooler-only bug.
- A general per-user limit on `/trpc/*` (SEC-13 remainder) and a second api replica: T10's numbers decide.
- `journey_daily_mv` rebuilt for every business (A8-17) and outbox rows never pruned (A8-25): fine at 3,500 events. Trigger: a refresh above 5 seconds, or `outbox` above one million rows.
- The other five services do not check the schema they need, and no rollback procedure is written (EH-08 parts 2 and 3; WP-01 lists them as planned nowhere). They deploy beside the api, so after a failed migration they run new code on the old schema until someone reads the failed deploy. Trigger: the first migration that fails in production, or a second api replica. `schemaReady` (T2) is the function to use.
- The automatic sweep of projects with no members: T16's path cannot create one, and its query finds any. Trigger: the query ever returns a row.
- `/health` detail without sign-in, the `iss` claim, `GET /v1/connectors` without a token (A8-27, A7-22): the detail is what WP-00's check reads; with JWKS the signature already binds the project; the gateway has no public address.
- `approvals.args` holds raw arguments (SEC-15): a founder must read what they approve. Export held in memory (A8-29) and raw validation text reaching people (A8-28): not security; A8-28 is WP-10's.
- Collaborator P3s (#131, #132): defense in depth; no collaborator exists yet. Leaked-password protection: no password sign-in is accepted.
- The demo roll stays hourly (recorded decision); T9 measures it.

## Corrections to the audits

1. A8-15 asks for a new `migrate-on-boot.test.ts`: the file exists (`apps/api/src/__tests__/migrate-on-boot.test.ts`), and "serving anyway" is a recorded decision (2026-10-11), which T2 amends instead of reversing.
2. A8-07's `information_schema.schema_privileges` is not a Postgres view. T8 reads `pg_namespace.nspacl` and `information_schema.table_privileges`.
3. A8-06 proposes to stop or thin the daily rewrite, or reseed at a tenth of the volume. The roll in place was chosen on 2026-11-09 and 2026-11-10 over both alternatives, with the reasons. T9 measures and leaves the switch to the founder.
4. A7-15's fixes 2 and 3 (intersect `allowedTools` with the agent's grants; refuse a token whose session ended) would break the platform's own steps: `apps/orchestrator/src/activities/workspace-push.ts`, `merge.ts` and `checkout.ts` mint with the session's id for tools the agent does not hold, some after the session ended. T11 limits who may mint instead.
5. `audits/e0-production-evidence.md` says ingest refuses SendGrid's event webhook for lack of `LIVE_CONNECTORS`. The platform address's events arrive at `/mail/events`, which depends on three `PLATFORM_MAIL_*` variables that are set; `webhooks: []` on `/health` lists only the `/webhooks/:connector` mounts; and `sendgrid` is kept out of ingest's list on purpose (DEPLOY §5.7 step 6). WP-00 S2 was written from that sentence and sets `LIVE_CONNECTORS=sendgrid` on ingest: it should not (T15 step 4).
6. The same file's list of tables for the 45 `auth.uid()` policies leaves out `founder_departures`, `inbox_items` (`inbox_items_for_user`) and `showcase_consents`. The count is right: 39 by hand and 6 from `fm_idea_table`.
7. A8-16 cites `today.ts:311-313,352,361` as router lines; `routers/today.ts` has 17 lines and no `ctx.db`. They are in `apps/api/src/services/today.ts`.
8. A8-10 says to remove the vault key from ingest "unless a live webhook needs it": the code builds no vault there without a live connector, so it is unused today; but T20 makes ingest read a project's own Stripe secret with it, so it stays.
9. A8-13 proposes self-serve procedures with re-authentication. The policy promises closing and export by request, so T16 builds the operator path.
10. A8-18 does not say that six new indexes become six "unused index" findings.
11. A8-02 and A8-01 propose a per-statement timeout and a PgBouncer container as given steps. T10 makes the first conditional on what production reports; the second is accepted for now.
12. The audits list N2 as open "for a founder's own account" and stop there. Its Stripe half blocks a real outcome: a payment on a founder's own Stripe account cannot be verified, so `payment.received` never arrives (T20). WP-00 S8 files this under N3, which is about Stripe Connect and is not needed.

## Risks

- T6 rewrites the policies of about 60 tables in one transaction and takes a brief exclusive lock on each. Deploy it at a quiet hour, after T2 (a failure keeps the old deployment) and T3's drill (a backup exists). If Postgres aborts it as a deadlock victim the api exits and Railway retries the boot, as designed.
- T1 will find things: most migrations after 0087 never ran with Supabase's default privileges (a11 S8, a11 S9). A real finding becomes its own pull request and delays the job by days, not hours.
- T5's loop edits policy text by replacement. Its test proves no bare call remains; the unchanged RLS suites on two engines prove no rule moved. Neither proves speed: read the advisor again after deploy.
- T12's three production steps must happen in order. Out of order the api cannot reach the gateway (Settings › Integrations, key checks, push). `/health` on the gateway names the state at each step.
- T11's contract case may show outward tools with empty hints. Giving one a hint makes agents ask more in assisted mode, and 113 of 127 approval requests already go unanswered: each such tool is the founder's call, named in the pull request.
- T10's production run loads the one live environment. Use the sample business and a quiet hour; stop at the first step with errors.
- Five input classes no test here covers, in the order they are likely to bite: a migration that passes both engines but times out on production's locks; a founder's Anthropic key pasted while the vault is off; a vendor retry larger than the new body limit (GitHub's own cap is 25 MB); a closing request from someone who co-owns a project with a person who cannot be reached; a restore into a project whose extensions differ.
- A package this wide tempts drive-by fixes. A task that looks larger than its finding is a mistake in this file: say so in the pull request instead of building the excess.

## Starting prompt

```
You are executing docs/holistic-plan/WP-11-data-api-security.md in the Foundmill repository, in this cloud session. Never build or test on the founder's machine.

Read first, in this order: FOUNDMILL.md; docs/holistic-plan/README.md; docs/holistic-plan/WP-11-data-api-security.md in full; packages/db/CLAUDE.md, apps/api/CLAUDE.md, apps/gateway/CLAUDE.md, apps/ingest/CLAUDE.md; then, for the task in hand only, the finding it cites in docs/holistic-plan/audits/ (a8-data-api-security.md, a7-models-gateway-economics.md §1.5 and A7-15/A7-16, a11-roadmap-status.md §5 C and §7, e0-production-evidence.md) and the decisions it names (node scripts/decisions-index.mjs <words>, then only the printed range of docs/DECISIONS.md). Where the plan and the code disagree, the code is right: say so in the pull request and fix the plan in the same change.

Work one task at a time, in the order of the table under "## Tasks", starting with T1. For each task: run the plan-change skill (other branches, the next free migration number); branch claude/wp11-t<n>; write the failing test the task names; make it pass with the smallest change; run its verify lines; for a migration, run pnpm --filter @foundmill/db test:rls on PGlite and again with RLS_TEST_DATABASE_URL on the cluster from scripts/ci/supabase-like.sql; where the task says "Review: security-reviewer", run that agent on the diff and put its findings in the pull request; run verify-done; add one line to docs/PROGRESS.md, tick the task in the plan, open the pull request, and stop. Do not merge and do not push to main.

Stop and ask instead of guessing when: a count the plan gives (13 functions, 45 policies, six constraints, 201 lines) does not match what you find; a guard in a migration raises; T1 shows a grant or policy that is wrong on real Postgres; a step is marked "needs the founder" or names F1 to F6 or a WP-00 step. For those, build and merge the code and the document, write the exact statement or setting for the founder, and leave the step to them. You never drop a schema, delete a user, purge a business, push Supabase settings or change a Railway variable.

Follow the karpathy-guidelines skill on every change: state assumptions, the simplest change that closes the finding, touch only what the task names, and a check that proves it. A task that seems to need more than its finding is a mistake in the plan: say so in the pull request.
```
