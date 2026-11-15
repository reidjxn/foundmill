# A10. Engineering health, delivery speed and cost, and how the repo works for agent sessions

Audit of `/Users/reidjackson/code/founder-manager` (remote `reidjxn/foundmill`, private; `main` at `04a0a509`), 2026-11-15. Read-only: files, `git`, `gh run list/view`, `gh pr list/view`. Nothing was built, run or changed. Every number was measured today unless marked **Estimate** or **Unverified**.

Legend: P0 = hurting delivery or safety now, cheap to fix, do first. P1 = large recurring cost or a real safety gap. P2 = worth doing in the plan. P3 = housekeeping.

## 0. The ten numbers that matter

| # | Measure | Value | Source |
| --- | --- | --- | --- |
| 1 | `CI` wall time, successful runs | p50 64 min, p90 85 min (Nov 12 to 15, n=99). Earlier: p50 21 (Oct 6 to 14), 50 (Oct 15 to 24), 58 (Oct 25 to Nov 3), 49 (Nov 4 to 11) | `gh run list --workflow=CI --limit 1000` (566 runs) |
| 2 | The long pole | job `Typecheck, lint, unit tests`: 62.7, 66.8, 68.4, 69.0, 72.7, 89.3 min on the last six main runs; **cancelled at 90.3 min by its own `timeout-minutes: 90`** on run 43663128650 attempt 1 | `gh run view <id> --json jobs` |
| 3 | Unit-test step alone | 54.0 to 77.4 min; turbo prints `Tasks: 24 successful, Cached: 0 cached, Time: 58m44s` | job log 132758109196 |
| 4 | Where unit time goes | api 1,944 s, db 1,173 s, web 726 s, gateway 717 s, orchestrator 527 s, modules 455 s, dugout 390 s; the other 17 packages 732 s together. 6,664 s of vitest wall time on one runner at turbo `--concurrency=2` | same log |
| 5 | Root cause | every PGlite-backed test file boots a WASM Postgres and replays all 96 migrations (7,958 lines of SQL): per-file floor about 11 to 13 s. 137 of 152 api files and 101 of 110 db files take 10 s or more | same log; `packages/db/src/testing/pglite.ts:90-107` |
| 6 | CI runs and outcomes | 566 runs in 40 days: 279 success, 195 cancelled, 92 failure. On main: 105 success, 44 cancelled, 23 failure. Nov 13: 95 runs; Nov 14: 82 | `gh run list` |
| 7 | Merges | 134 PRs merged (all authored by `reidjxn`); 25 on Nov 13, 24 on Nov 14. Time to merge p50 1.9 h, p90 16.5 h. Median PR 627 changed lines, p90 7,443 | `gh pr list --state all` |
| 8 | Agent PRs | 7 opened by `app/foundmill`, 0 merged, 0 closed; no agent-authored commit is on main; all 14 `agent/*` branches are 227 to 254 commits behind | `gh pr list`, `git branch -r --merged origin/main` |
| 9 | Shared logs | `docs/DECISIONS.md` 1,061,621 bytes, 4,610 lines, 337 sections; `docs/PROGRESS.md` 697,606 bytes, 2,191 lines (62 lines over 2,000 characters, longest 12,676). 162 of 263 first-parent commits on main touch PROGRESS, 148 touch DECISIONS | `wc`, `git log --first-parent -m` |
| 10 | Alerting | none configured: `SENTRY_DSN` and `OTEL_*` unset on all six services, no uptime monitor, no status page, no browser error reporting | `docs/DEPLOY.md:274`, code search |

## 1. How it works today

### 1.1 Workflows (`.github/workflows/`, 442 lines in 4 files)

| File | Triggers | Jobs | Notes |
| --- | --- | --- | --- |
| `ci.yml` (274 lines) | `push` to main, every `pull_request`, `workflow_dispatch` (lines 6-10) | 9 (below) | `permissions: contents: read`; `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true` (16-18), also on main; env `APP_ENV=test`, `INTEGRATIONS_MODE=mock`, `MODEL_MODE=mock`; no secrets |
| `security.yml` (69) | push to main, every PR, dispatch | `secrets` (gitleaks 8.21.2, checksum pinned, commits of the change only), `dependencies` (`pnpm audit`; fails only on a critical advisory in a production dependency) | 19 to 26 s. Not a required check. Latest result on main: "34 vulnerabilities found. Severity: 4 low, 20 moderate, 10 high" in production dependencies; passes |
| `evals-typed-reads.yml` (54) | dispatch; PRs touching 7 listed paths | 1: typed-read injection suite on a live model (`MODEL_MODE=live`, secret `ANTHROPIC_API_KEY`) | The only place any live-model eval runs. No `schedule:` trigger exists in any workflow |
| `e2b-template.yml` (45) | dispatch only | builds the E2B sandbox template (`npx --yes @e2b/cli@2.22.3`) | secret `E2B_API_KEY` |

`ci.yml` jobs:

| Job id | Check name | What it runs | Cache | Measured |
| --- | --- | --- | --- | --- |
| `banned-terms` (29) | Banned terms, vocabulary and US English | `pnpm install`, then `node --test scripts/banned-terms.test.mjs`, `node scripts/banned-terms.mjs --sweep docs/VOCAB_SWEEP.md`, `us-english` self-test and scan, `focus-visible` self-test and scan; uploads the sweep | pnpm store (`setup-node cache: pnpm`) | 0.8 to 1.1 min |
| `plain-language` (66) | Plain-language linter (...) | self-test, `node scripts/plain-language.mjs --gate --summary`, sweep as a report | pnpm store | 0.8 to 1.0 min |
| `checks` (99) | Typecheck, lint, unit tests | three `node --test` config tests (`railway-config`, `env-example`, `supabase-config`), then `pnpm exec turbo run typecheck lint --continue --concurrency=4 --output-logs=new-only` (line 122, `NODE_OPTIONS=--max-old-space-size=4096`), then `pnpm exec turbo run test --continue --concurrency=2 --output-logs=new-only --filter='!@foundmill/e2e' -- --maxWorkers=2` (line 125) | pnpm store only. **No `.turbo` cache, no remote cache**: `0 cached` on every run | 62.7 to 89.3 min (typecheck and lint 7.8 to 10.9; unit 54.0 to 77.4); `timeout-minutes: 90` |
| `docker` (127) | Docker image (build and boot) | `docker build --build-arg APP=api`, boots it on `pglite::memory:`, waits for `/health` | none (no buildx layer cache) | 2.5 to 3.4 min; build 2.1 to 2.9; "image answers /health after 12s" |
| `storybook` (147) | Storybook build | `pnpm --filter @foundmill/dugout storybook:build` | pnpm store | 1.0 to 1.3 min |
| `e2e-shard` (161) | Playwright shard N of 3 | install Chromium, seed file-backed PGlite (`SEED_VOLUME_SCALE=0.1`), start `apps/api` (:4000), `next build` and `next start` (:3000), then this shard's spec files (round-robin, line 232); shard 1 also runs `onboarding.spec.ts` first and the `e2e/` golden path | pnpm store | 17.6 to 31.5 min per shard |
| `e2e` (263) | Playwright (web screens + golden path) | gate: passes when all three shards pass | | 0.1 min |

Billable minutes per green run (sum of jobs, each rounded up): 140 to 165. Wall time equals the `checks` job.

### 1.2 Where the hour goes (run 43696503358 on `04a0a509`, job 132758109196)

Typecheck and lint: `Tasks: 50 successful, 50 total. Cached: 0. Time: 8m56s`.

Unit tests, per package, from the vitest summaries in the log (wall seconds while two packages share the runner, each with `--maxWorkers=2`):

| Package | Test files | Tests | Vitest wall s | Sum of per-file s | Comment |
| --- | --- | --- | --- | --- | --- |
| `@foundmill/api` | 152 | 1,500 | 1,944 | 2,850 | 137 files take 10 s or more; median file 15.2 s; `idea-box.test.ts` 176 s (17 tests) |
| `@foundmill/db` | 110 (1 skipped) | 2,660 | 1,173 | 1,914 | median file 13.4 s, p10 10.7 s; `seed/__tests__/seed.test.ts` 252 s, `roll-forward.test.ts` 146 s; `rls/cross-tenant.test.ts` runs 1,495 tests in 36.5 s on one instance |
| `@foundmill/web` | 184 | 1,453 | 726 | 255 | happy-dom; 54% of time is import, not tests |
| `@foundmill/gateway` | 40 | 415 | 717 | 1,158 | `byo-key-connectors-2.test.ts` 205 s for 17 tests, `-buffer` 123 s for 10, `byo-key-connectors.test.ts` 121 s for 10: about 12 s per test, a fresh database per test |
| `@foundmill/orchestrator` | 79 | 728 | 527 | 785 | `pool: "forks"`; Temporal time-skipping server per suite file |
| `@foundmill/modules` | 77 | 641 | 455 | 309 | import 55% |
| `@foundmill/dugout` | 127 | 1,295 | 390 | 199 | import 46% |
| `@foundmill/ingest` | 14 | 121 | 164 | 207 | |
| `@foundmill/composer` | 9 | 68 | 106 | 152 | |
| 15 others | 294 | 4,641 | 462 | 249 | stream 74, connectors 62, widgets 55, evals 50 (20 of 43 files skipped: live), collab 36, agents 33, social 33, events 27, shared 24, journey 24, models 20, policy 11, entity-linker 6, sandbox 6, config 1 |
| **Total** | **1,086 run (1,108 with skipped)** | **about 13,500** | **6,664 (111 min)** | | halves to 58.7 min on the runner because two packages run at once |

Why it is slow, in order of weight:

1. **Migration replay per file.** `createTestDb()` (`packages/db/src/testing/pglite.ts:90-107`) boots an in-memory PGlite and applies every migration file in a loop for each harness. `createApiHarness()` (`apps/api/src/__tests__/harness.ts:59-62`) calls it once per test file, and some suites call it once per test. The floor is visible in the data: db files p10 10.7 s, median 13.4 s; api median 15.2 s; the seven identical `db-boot.test.ts` files take 21 to 23 s each for 3 tests. About 300 PGlite-backed files at roughly 11 s is about 55 of the 111 worker-minutes (**Estimate**).
2. **One runner.** No matrix, no sharding for unit tests. Two packages at a time on one machine.
3. **Nothing is cached.** `turbo.json` declares `typecheck`, `lint` and `test` with `"dependsOn": []` and CI restores no `.turbo` directory, so a docs-only or one-package PR pays for all 24 packages.
4. **A handful of very slow files.** The ten slowest files are 1,493 s (22% of all per-file time): seed 252, byo-key-2 205, idea-box 176, roll-forward 146, byo-key-buffer 123, byo-key 121, gateway 101, session 100, orchestration 88, pglite-client 74.
5. **Duplicate suites.** `db-boot.ts` (88 lines) and `db-boot.test.ts` (70 lines) are byte-identical copies in 7 services (`apps/{collab,composer,gateway,ingest,orchestrator,social,stream}/src/`); the test costs about 22 s in each.

Affected-only runs are not the main lever here. Replaying the last 120 merges against the workspace graph: 17 touch a root file or change every package, `packages/shared` is touched by 48, `packages/db` by 55, and everything depends on both. With a perfect "changed plus dependents" filter the share of unit-test seconds still needed is p25 26%, **p50 86%**, mean 70%. Sharding and the migration snapshot are what bring the hour down; affected-only saves about 30% of minutes on top.

### 1.3 Playwright

- `apps/web/playwright.config.ts`: `workers: 1`, `fullyParallel: false` (specs share one seeded database), `retries: isCI ? 2 : 0`, `timeout: 90_000`, `forbidOnly: isCI`, trace on failure. `e2e/playwright.config.ts`: same, `retries: 1`.
- 71 spec files and 371 `test(` in `apps/web/e2e`; `e2e/tests`: `golden-path.spec.ts` (18), `gate0-screens.spec.ts` (2), `smoke.spec.ts` (1). Latest green main run: 103 + 17 + 144 + 134 = 398 tests passed, 4 skipped, **1 flaky** (`first-days.spec.ts:158`, passed on retry). Summed test time 3,259 s (54 min) plus about 2.5 min of setup per shard.
- Slowest specs: `no-clip.spec.ts` 306 s for 2 tests, `money-legal-distribution.spec.ts` 209 s, `home.spec.ts` 159 s, `team-development.spec.ts` 158 s, `landing.spec.ts` 127 s, golden path 111 s.
- Shards are dealt round-robin by file name, so they are uneven: shard 1 (onboarding first, then its files, then the golden path) 23.0 to 27.0 min; shards 2 and 3 17.6 to 31.5 min.
- The golden path (`e2e/tests/golden-path.spec.ts`, 2 min) covers prompt to deck to compare, commit, Continue, a decision by button and by free text, and Home for the new business, all on mock models; its "spec diff accepted" leg is skipped for lack of a seeded proposal (`docs/GATES.md:63`).
- The stack is web plus api on PGlite, mock models and connectors, `DEV_AUTH_USER_ID` bypass. No Redis, Temporal, gateway, composer, stream, ingest or orchestrator process runs in e2e (`ci.yml:207`: "the api degrades to in-process behaviour").

### 1.4 What never runs in CI

| Thing | Where it lives | Why it does not run |
| --- | --- | --- |
| RLS and migration-lock suites on a real Postgres | `packages/db/src/testing/postgres.ts` (`RLS_TEST_DATABASE_URL`), `packages/db/src/__tests__/{migrate-lock,owner-lock,testing-postgres,date-params}.test.ts`, `apps/api/src/__tests__/{migrate-on-boot,people-races}.test.ts` (`FM_TEST_POSTGRES_URL`, `FM_TEST_POOLER_URL`) | CI defines no Postgres service and none of the variables. The harness file itself says a real Postgres shows "what PGlite, a superuser in one process, cannot show about roles and privileges" |
| Rate-limit script on Redis | `apps/api/src/__tests__/rate-limit.test.ts:108-110` (`REDIS_TEST_URL`; the comment says "CI and local runs set REDIS_TEST_URL") | CI does not set it |
| 20 live eval suites | `evals/src/__tests__/*.eval.test.ts`, `describe.skipIf(!live)` | `MODEL_MODE=mock` in CI. Only typed-reads has a workflow, and only on path changes |
| Outcome evals (THESIS_REVIEW 1.8, `docs/THESIS_REVIEW.md:413`: three end-to-end sessions nightly on live models) | not written | no workflow, no schedule |
| Live smoke of Gate 1 ("100 consecutive live notes with valid links") | `docs/GATES.md:104-106`, HUMAN CHECKPOINT | never run; Gate 1 verdict is still "NOT PASSED yet" (`docs/GATES.md:110`) |
| 32 connector live suites | `packages/connectors/src/connectors/*/**.test.ts`, `describe.skipIf(!envKeysPresent(...))` | no vendor keys in CI |
| Boot of gateway, orchestrator, composer, stream, ingest images | `ci.yml:136` builds and boots `APP=api` only | an orchestrator that cannot bundle its workflows under tsx is found by Railway's healthcheck, not CI |
| `scripts/decisions-index.test.mjs` | asserts the real DECISIONS.md has more than 100 sections | the only one of the eight `scripts/*.test.mjs` not listed in `ci.yml` |
| Prettier | `.prettierrc` exists (`printWidth: 100`) | no `format:check` anywhere |

There are no quarantined tests: no `.skip`, `.fixme` or `.only` without a condition anywhere (`forbidOnly` is on). All 82 skip sites are conditional: 20 evals (`skipIf(!live)`), 32 connectors (keys), 11 real-Postgres or Redis, 15 Playwright `test.skip(cond)` on seed state, 3 golden-path guards, 1 in `packages/shared`. Vitest has no `retry` configured in any of the 24 configs.

### 1.5 Deploy path

- **Trigger.** Push to `main`. Vercel builds `apps/web`; Railway builds each backend service from the root `Dockerfile` with build arg `APP` (`docs/DEPLOY.md:3`). There is one environment: Railway project `founder-manager`, environment `production`, running `APP_ENV=staging` (`docs/DEPLOY.md:43-49`; `Dockerfile:30` bakes `ENV APP_ENV=staging`).
- **Image** (`Dockerfile`, 39 lines). `node:22.23.3-bookworm-slim` plus git, python3, make, g++, tini. Lines 13-24 copy the whole workspace (`apps` including `apps/web`, `packages`, `evals`, `e2e`, `infra`) and then run one `pnpm install --frozen-lockfile` for every package (1,151 packages, dev dependencies included: Next, Storybook, Playwright). Source is copied before the install, so any source change invalidates the install layer. The service runs TypeScript directly: `CMD ["sh","-c","cd apps/${APP} && exec node --import tsx src/index.ts"]` under tini (38-39). In CI: install layer 30 s, "exporting layers" 60 to 93 s, total build 2.1 to 2.9 min; boot to `/health` 12 s. Railway builds this six times per push.
- **Railway config.** `railway.toml` (shared base: Dockerfile builder, `restartPolicyType = "ON_FAILURE"`, 10 retries, `overlapSeconds = 15`, `drainingSeconds = 60`; no healthcheck, no watch patterns). `railway/<service>.toml` for api, gateway, orchestrator, composer, stream, ingest repeat it and add `healthcheckPath` (`/health`; orchestrator `/ready`), `healthcheckTimeout` (180 api and orchestrator, 120 others) and `watchPatterns = ["/apps/<service>/**", "/packages/**", "/patches/**", "/Dockerfile", "/railway/<service>.toml", "/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/.npmrc"]` (`railway/api.toml:11`). `scripts/railway-config.test.mjs` keeps the copies equal (constant `BUILD_INPUTS`, line 16).
- **What is actually in force.** `docs/DEPLOY.md:268` (2026-10-15, Railway API): healthcheck path and timeout are set in each service's own settings; **"Not set: 'Railway config file' (Railway's API now refuses it as deprecated config-as-code; the services keep reading the root `railway.toml` until 2026-12-01) and Watch Paths, so every push to `main` still redeploys all six."** That matches the measurement that all six redeployed in the same minute today. The per-service files and their CI test describe a state that is not deployed.
- **Wait for CI.** `docs/DEPLOY.md:267` still lists Railway "Wait for CI" and branch protection as open (2026-10-11: `checkSuites: false` on all six). Branch protection is clearly on now (PR #38 reads `mergeStateStatus: BLOCKED`; `docs/DECISIONS.md:3116` quotes GitHub's "required status checks are expected"). Whether "Wait for CI" is on is **Unverified** from here.
- **Migrations.** Only the api migrates Postgres, at boot, in one transaction under `pg_advisory_xact_lock(7461, 1)` with a bounded wait (`MIGRATION_LOCK_TIMEOUT_MS`, default 60 s); a lock timeout or deadlock exits 1 and Railway restarts the boot (`apps/api/src/index.ts:59-83`, `packages/db/src/migrator.ts`). **Any other migration failure is logged and the api serves anyway** (`index.ts:80-81`: "migrations failed; serving anyway (health reports db status)"). The other services only probe `appliedMigrationCount` for connectivity (`apps/*/src/db-boot.ts:79-87`) and never compare it with the number of migrations their own image carries.
- **Zero downtime.** Healthcheck-gated switch, 15 s overlap, SIGTERM handled by every service within `SHUTDOWN_TIMEOUT_MS` (45 s), stream closes sockets with 1001, the orchestrator hands running agent sessions to the next worker (`docs/DEPLOY.md:104-108`). A pool watchdog exits a wedged api (`docs/DEPLOY.md:110`). This part is solid.
- **Rollback.** No procedure is written anywhere (`grep -i "rollback\|roll back" docs/DEPLOY.md` finds only the migration-lock text). Migrations are forward-only SQL; nothing checks that the previous release still runs on the new schema.
- **Vercel.** `apps/web/vercel.json` is `{ "regions": ["fra1"] }` only: no `ignoreCommand`, no `git.deploymentEnabled`. Every push to every branch builds a preview (each agent PR carries a `Vercel` check and a preview URL). `docs/DEPLOY.md:19`: project `foundmill` on "the Hobby team `fm-2f083c2b`". `next.config.ts` sets `typescript: { ignoreBuildErrors: true }` (typecheck is CI's job).
- **Environment variables.** `.env.example` lists 134 variables in 13 groups: core 12, ports and service URLs 14, web bundle 10, Supabase and database 6, infra 7, observability 3, orchestrator 11, platform model and tool keys 14, platform billing 4, live connectors 9, platform mail 12 plus 17 connector keys under the same heading, access and seeds 14, development 1. One Zod schema (`packages/shared/src/env.ts`, 329 lines) is parsed by every service; `scripts/env-example.test.mjs` (in CI) proves the example equals what the code reads. Which service must hold which variable exists only as prose tables in `docs/DEPLOY.md:45-81`. Nothing compares Railway or Vercel with either.

### 1.6 Observability: what the code has and what is switched on

| Capability | In code | Configured |
| --- | --- | --- |
| Structured logs | pino JSON on stdout in all 8 services, level as a word (`packages/shared` logger) | yes, readable in Railway only |
| Error reporting | `packages/shared/src/telemetry.ts` (414 lines, no vendor SDK): every `log.error` and uncaught exception becomes a Sentry envelope when `SENTRY_DSN` is set, allow-listed ids only | **no** (`docs/DEPLOY.md:274`: "until then errors are only in Railway's logs") |
| Tracing and metrics | OTLP/HTTP JSON spans for api requests, orchestrator activities, gateway tool calls and model calls (tokens and cost); Temporal SDK metrics | **no** (`OTEL_EXPORTER_OTLP_ENDPOINT` unset) |
| Health | `/health` on every service with real state (db, pool watchdog, transaction gate, outbox relay, worker verdict, `modelBilling`); orchestrator `/ready` for deploys and `/health` that turns 503 on a task-queue backlog "for an uptime monitor" (`docs/DEPLOY.md:93`) | Railway reads it at deploy time only; **no monitor polls it** |
| Alerts | the api logs an error when the orchestrator stops working its queues; `alert: "model_billing"` log line when the Anthropic account is out of credit | a log line nobody is paged by |
| Web errors | `app/global-error.tsx`, `app/b/[bid]/error.tsx`, `app/(live)/error.tsx`, `components/shell/RouteError.tsx` render a message | nothing reports browser errors; no Sentry, analytics or web-vitals dependency in any `package.json` |
| Uptime checks, status page, on-call | none | none |
| Redis `maxmemory` and alert | documented | open (`docs/DEPLOY.md:276`) |

### 1.7 The repo as an agent workspace

- **Root `CLAUDE.md`**: 96 lines, 12,329 bytes. It still says "The full build plan is docs/BUILD.md. Read the relevant section before every task" and "read these before touching code": ARCHITECTURE.md (252 KB, 371 lines, longest line 6,617 characters, about 63k tokens), DESIGN.md (157 KB), DECISIONS.md (1.06 MB, about 265k tokens).
- **Per-package `CLAUDE.md`** (added Nov 15 by #136, 31 to 35 lines each): present in `apps/{api,composer,gateway,ingest,orchestrator}` and `packages/{agents,connectors,db,dugout,events,models,modules}`. Missing: `apps/{collab,social,stream}`, `packages/{config,entity-linker,journey,policy,sandbox,shared,widgets}`, `evals`, `e2e`, `scripts`. `apps/web/CLAUDE.md` is one line, `@AGENTS.md`, plus Next's generated block; `apps/web/AGENTS.md` is in `.gitignore` and does not exist, so the largest app (87k lines) has no guide.
- **`.claude/settings.json`**: two hooks and nothing else (no permissions, no env). `PostToolUse` on `Edit|Write|MultiEdit` runs `.claude/hooks/post-edit.sh`: `pnpm -w turbo run typecheck lint --filter='...[HEAD]'` and, for a migration, `pnpm --filter @foundmill/db test:rls`. `Stop` runs `.claude/hooks/stop.sh`: `pnpm -w turbo run test --filter='...[HEAD]'`. Both exit at once unless `FM_HOOKS=1`, which nothing in the repo sets: they are off in a cloud session unless its environment sets it by hand.
- **`.claude/skills/`** (10, last changed Nov 13 by #107, 11 to 19 lines each): `plan-change` (read the right docs, check other branches for overlap, next free migration number), `ship-change` (rebase, commit, push once, PR body layout), `verify-done` (the definition of done as commands), `gate` (BUILD §16 gate checks), `new-screen`, `new-connector`, `new-event`, `new-agent-template`, `rls-test`, `vet-third-party-skill`.
- **`.claude/agents/`** (6, unchanged since the Oct 5 scaffold): `agent-template-author`, `connector-builder`, `dugout-builder`, `schema-designer`, `security-reviewer`, `test-engineer`.
- **`.claude/workflows/`** (5 wave scripts and `reports.mjs`, 649 lines, last changed Oct 7): `wave1-packages.js` to `wave3c-screen-specs.js`. They show up in every session's skill list as `fm-wave1-packages` ("Build every foundation package of Founder Manager in parallel") and so on.
- **`docs/agent-pack/`** (4 files, Oct 22): the handover and three skills given to the product's own agents.
- **`.mcp.json`** (tracked): vercel, supabase, github (token from `${GITHUB_MCP_PAT}`, no literal) and `playwright` started with `npx -y @playwright/mcp@latest`.

## 2. Findings

Each finding: evidence, impact, fix. YAML and code for the larger fixes are in sections 3 and 4.

### P0

**EH-01 (P0, delivery). The required unit-test job has reached its own 90-minute timeout, and CI time grew 30% in a week.**
- Evidence: `.github/workflows/ci.yml:102` `timeout-minutes: 90`. Last six main runs of `Typecheck, lint, unit tests`: 62.7, 66.8, 68.4, 69.0, 72.7, 89.3 min. Run 43663128650 (main, `d70f5ece`) attempt 1: that job `cancelled` at 90.3 min; main had no finished run from 02:57Z until someone re-ran it at 07:44Z (green at 08:51Z). Successful-run p50 went 49 min (Nov 4 to 11) to 64 min (Nov 12 to 15). The docs still say "about 40 to 50 minutes" (`docs/agent-pack/00-handover.md`, `docs/agent-pack/skill-checks-and-ci.md`).
- Impact: every PR waits an hour or more per push (time to merge p50 1.9 h is two CI cycles). Each new PGlite-backed test file adds about 12 s of worker time (3 to 6 s of job wall time); at the current rate the job times out routinely within days, and a timeout looks like a cancellation, not a failure.
- Fix: section 3. Same day, YAML only: split `checks` into `static` plus a unit matrix on separate runners, and keep `Typecheck, lint, unit tests` as the name of a small gate job so branch protection needs no change. Then the snapshot of EH-04.

**EH-02 (P0, agent memory). The two shared logs were wiped on main on Nov 15 with CI green, and the guard that would have caught it is not wired.**
- Evidence: `d70f5ece` (#142) shows `docs/DECISIONS.md | 4605 +-----` and `docs/PROGRESS.md | 2186 +-----`. At that commit DECISIONS.md was 8 lines (2,120 bytes) and PROGRESS.md 10 lines (2,586 bytes): the PR's own entry and nothing else. `04a0a509` (#137) carries them back (+4,602 and +2,181 lines) without saying so in its message. Main was without 1.7 MB of decisions and build history from 01:26Z to 08:52Z (7 h 25 min). `scripts/decisions-index.test.mjs:41-45` asserts the real DECISIONS.md has more than 100 sections and would have failed, but it is the one script test `ci.yml` does not run. During those hours `node scripts/decisions-index.mjs <words>` returned nothing, so any session that planned from main re-decided blind.
- Impact: 337 recorded decisions are the reason sessions do not re-litigate; losing them is silent and a later squash merge can make it permanent.
- Fix today (two steps in the `checks` job, about 1 s):
```yaml
      - name: Decisions index self-test (the real DECISIONS.md still has its sections)
        run: node --test scripts/decisions-index.test.mjs
      - name: The logs only grow (docs/DECISIONS.md, docs/PROGRESS.md)
        if: ${{ github.event_name == 'pull_request' }}
        run: |
          git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"
          for f in docs/DECISIONS.md docs/PROGRESS.md; do
            base=$(git show "FETCH_HEAD:$f" | wc -l); head=$(wc -l < "$f")
            if [ "$head" -lt $(( base * 98 / 100 )) ]; then echo "::error file=$f::$f shrank from $base to $head lines"; exit 1; fi
          done
```
- Lasting fix: stop editing the two files at all (section 4).

**EH-03 (P0, safety). A founder-facing failure is noticed only if someone happens to read Railway's logs.**
- Evidence: section 1.6. `docs/DEPLOY.md:274` lists `SENTRY_DSN` and the two `OTEL_*` variables as open since 2026-10-12. No uptime monitor is named in any doc; no status page; the web app reports no browser error. History says this matters: the api's pool "wedged silently for four hours" on Oct 19 (`docs/DEPLOY.md:110`), the api "restarted about every five minutes" after #86 (`docs/DEPLOY.md:114`), three red pushes shipped in October (`docs/DEPLOY.md:9`), and main sat without a green run for five hours on Nov 15 (EH-01).
- Fix, in this order, none of it needs code:
  1. Create a Sentry project and set `SENTRY_DSN` on the six Railway services (the exporter exists: `packages/shared/src/telemetry.ts`). Add one alert rule: any new issue, and any issue above 10 events in 5 minutes, to the founder's email and phone.
  2. An external uptime monitor (any vendor) on `https://foundmill.com/login`, `https://api.foundmill.com/health`, `https://stream.foundmill.com/health`, `https://ingest.foundmill.com/health`, 1-minute interval, alert after 2 failures. The api's `/health` already carries the worker verdict, relay state, pool state and `modelBilling`; give the monitor a keyword check on `"ok":true`. The orchestrator's `/health` is private; the api's `worker` field covers it.
  3. GitHub: notify on a failed or cancelled `CI` run on `main` (a 10-line `workflow_run` workflow that opens or updates one issue; or Actions email notifications for the founder).
  4. Then code: browser error reporting from `app/global-error.tsx` and `RouteError.tsx` to the api (which already reports to Sentry), `OTEL_*` to a hosted collector, Redis `used_memory` alert (`docs/DEPLOY.md:276`).

### P1

**EH-04 (P1, delivery and cost). About half of unit-test time is replaying 96 migrations for every test file.**
- Evidence: section 1.2. `packages/db/src/testing/pglite.ts:90-107` (boot, then `for (const m of migrations) await pg.exec(...)`); `apps/api/src/__tests__/harness.ts:62`; per-file floors of 10.7 to 13.4 s; gateway suites that pay it per test (205 s for 17 tests).
- Fix: build the migrated database once and load it. The installed PGlite (`@electric-sql/pglite` 0.5.8) exposes `dumpDataDir()`, the `loadDataDir` option and `clone()`.
  - New `packages/db/src/testing/snapshot.ts`: key = sha256 of `PGLITE_BOOTSTRAP_SQL`, every migration's tag and SQL, the PGlite version and whether pgvector loaded. File `<os.tmpdir()>/foundmill-pglite/<key>.tar`. Build: `bootPglite()`, apply migrations, `await pg.dumpDataDir("none")`, write to a temp name, rename (two workers building at once produce the same bytes). Use: `new PGlite({ loadDataDir: new Blob([bytes]), extensions: <the same list bootPglite passes> })`.
  - `createTestDb()` takes the snapshot path when `options.migrations` is undefined and `options.disableVector` is not set; the migration-point suites (`migration-00NN.test.ts`) and `disableVector` keep today's path. Inside one file, suites that make a database per test can `clone()` the first.
  - Expected: per-file floor from about 11 s to 1 to 2 s; unit total from 111 to roughly 50 to 60 worker-minutes (**Estimate**; measure on `packages/db` first with `pnpm --filter @foundmill/db test:rls` in CI).
  - Also move `db-boot.ts` into `packages/db` (its own header says so: "The same file lives in every service under apps/ until packages/db exports it") and keep one test: saves 6 of 7 copies, about 2 minutes.

**EH-05 (P1, cost). Nothing is cached, and the current `turbo.json` cannot be cached correctly.**
- Evidence: `turbo.json`: `"typecheck": { "dependsOn": [], "outputs": [] }`, same for `lint` and `test`. CI log: `Cached: 0 cached, 50 total` and `0 cached, 24 total`. With `dependsOn: []` a package's task hash covers only its own files, so with any cache switched on, a change in `packages/db` would still be a cache hit for `@foundmill/api:test`. Root files that tests and tools read are not in the hash either (`tsconfig.base.json`, `eslint.config.mjs`, `scripts/**`, `patches/**`). Some tests walk the whole repository from inside one package and so can never be cached per package: `packages/models/src/model-ids.test.ts` (walks `apps`, `packages`, `scripts`), `apps/web/content/legal/__tests__/legal-content.test.ts` (repo root), `packages/agents/src/__tests__/post-draft.test.ts:234` (reads `scripts/banned-terms.mjs`), `packages/shared/src/terms.test.ts:113`, and to be checked `packages/connectors/src/__tests__/platform-secrets.test.ts`, `packages/widgets/src/__tests__/widget-keys.test.ts`, `apps/web/lib/__tests__/{brand-marks,page-titles}.test.ts`.
- Fix (section 3.4): transit node, `globalDependencies`, move repo-walking guards to an uncached root job, then `actions/cache` on `.turbo/cache`. Prefer GitHub's cache over a remote cache: CI runs agent-written test code on `agent/*` branches, and a writable remote-cache token in that job could be used to plant a passing result for main. GitHub scopes caches so a branch can read main's cache and never write to it.

**EH-06 (P1, trust). On main a newer push cancels the run of the previous commit, so a quarter of main's runs never finish and a red main goes unnoticed.**
- Evidence: `ci.yml:16-18` applies `cancel-in-progress: true` to `refs/heads/main`. Main: 44 of 172 runs cancelled, 23 failed. Nov 14: runs 43627045648 and 43639602757 failed on main (Playwright shards 2 and 3) with merges continuing on top; `PROGRESS.md` "Main green again (#140, #141)" was the repair. With 24 merges a day and a 64-minute run, most commits on main never get a verdict, so the breaking merge has to be found by hand.
- Fix: on main never cancel; let GitHub queue. One running and one pending run per group means a burst is verified in batches and every deployed commit has a finished run:
```yaml
concurrency:
  group: ci-${{ github.event_name == 'pull_request' && github.head_ref || github.ref_name }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```
  The group key by branch name also removes the double run of EH-24. Add the `workflow_run` alert of EH-03.

**EH-07 (P1, cost and safety). Every push to main rebuilds and restarts all six services; the watch patterns in the repo are not in force; the file Railway does read stops being read on 2026-12-01.**
- Evidence: `docs/DEPLOY.md:268` (quoted in 1.5); today's observation; `railway.toml:2` and `docs/DEPLOY.md:95,108` ("Railway stops reading config-as-code on 2026-12-01"; this is the repo's statement, **Unverified** against Railway). 49 merges on Nov 13 and 14 means about 294 service builds and 49 orchestrator restarts in two days; each restart hands every running agent session to a new worker (`docs/DEPLOY.md:107`). Even when applied, `/packages/**` in every list means a Storybook-only or CLAUDE.md-only change in a package restarts everything (#136 added twelve `CLAUDE.md` files under `apps/` and `packages/`).
- What narrower patterns buy, replayed over the last 150 merges: no watch paths (today) 150 deploys per service; `/packages/**` as written 111 to 121; each service's real dependency closure without tests and Markdown 86 to 104. `packages/shared` and `packages/db` are in every closure and change in about 45% of merges, so patterns alone remove 30 to 40%; fewer pushes to main (EH-06 batching plus "Wait for CI") removes the rest.
- Fix:
  1. Set Watch Paths in each service's own settings (Railway dashboard: Settings, Build, Watch Paths; or the Railway API or MCP `update-service`, with the founder's approval). Lists from the workspace graph (`package.json` dependencies, transitive):
     - api: `/apps/api/**`, `/packages/{agents,config,connectors,db,entity-linker,events,journey,models,policy,shared}/**`
     - gateway: `/apps/gateway/**`, `/packages/{agents,config,connectors,db,events,journey,models,policy,shared}/**`
     - orchestrator: `/apps/orchestrator/**`, `/infra/**`, `/packages/{agents,config,connectors,db,entity-linker,events,journey,models,policy,sandbox,shared}/**`
     - composer: `/apps/composer/**`, `/packages/{agents,config,db,entity-linker,events,journey,models,shared}/**`
     - stream: `/apps/stream/**`, `/packages/{agents,config,db,events,journey,models,shared}/**`
     - ingest: `/apps/ingest/**`, `/packages/{agents,config,connectors,db,events,journey,models,shared}/**`
     - all: `/patches/**`, `/Dockerfile`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/.npmrc`; and, if Railway's patterns accept gitignore negation (**Unverified**), `!**/*.md`, `!**/__tests__/**`, `!**/*.test.ts`, `!**/*.stories.tsx`. Railway takes one pattern per entry; expand the braces.
     No service depends on `packages/{dugout,widgets,modules}`: UI work stops restarting the backend.
  2. Mirror the lists in `railway/*.toml` and update `scripts/railway-config.test.mjs` (`BUILD_INPUTS`, line 16, and the `matches()` helper, which understands only a trailing `/**`). Better: have the test compute each closure from the `package.json` files so the lists cannot drift.
  3. Turn on "Wait for CI" on the six services if it is still off (`docs/DEPLOY.md:11` has the API call). Before Dec 1, read each service's settings back and confirm healthcheck, teardown (overlap 15, draining 60), restart policy and watch paths are all in the service settings, not only in `railway.toml`.

**EH-08 (P1, safety). A failed migration does not stop a deploy, the other five services never check the schema they need, and there is no rollback procedure.**
- Evidence: `apps/api/src/index.ts:80-81` logs "migrations failed; serving anyway" and returns; `/health` then reports the database as reachable, so the healthcheck passes and the new api takes traffic on the old schema. `apps/gateway/src/db-boot.ts:79-87` (and its six copies) probes `appliedMigrationCount` and discards the number. All six services deploy at once, so for the seconds before the api's migration commits, new gateway and orchestrator code runs against the old schema. No doc describes how to go back a release.
- Fix:
  1. `packages/db`: export `schemaReady(db)`: `appliedMigrationCount(db) >= readMigrations().length`. The api's `/health` answers 503 when `migrateOnBoot` returned false on Postgres; the other services' `/health` (orchestrator `/ready`) answer 503 until `schemaReady`. Railway then keeps the previous deployment serving, which is the behavior the docs already promise.
  2. Rule in `packages/db/CLAUDE.md` and a test: a migration is additive within one release (expand, then contract in a later PR), because the previous deployment keeps serving for 15 s or more and a rollback runs old code on the new schema. A cheap check: fail CI when a new migration contains `drop column`, `drop table`, `rename` or `alter column ... type` without a `-- contract: <PR that removed the last reader>` comment.
  3. `docs/DEPLOY.md` section "Rollback": Railway, redeploy the previous successful deployment of each affected service (dashboard, or the MCP `redeploy`), api last; Vercel, promote the previous production deployment; database, never restore for a code fault; the Postgres volume backups (daily, 6 days) are for data loss only. State who decides and how to confirm (`/health` on the three public hosts).

**EH-09 (P1, product thesis). No agent-written change has ever reached main; seven agent PRs are open, five of them unmergeable.**
- Evidence per PR (`gh pr view <n> --json ...`; all authored by `app/foundmill`, 0 reviews, the only comment is Vercel's bot):

| PR | Opened, last change | Size | State | Why it sits |
| --- | --- | --- | --- | --- |
| #52 API: founder-only handler for merges | Nov 3, Nov 6 | +16 / -2, 2 files | MERGEABLE, CLEAN, all 9 checks green on Nov 6 | Ready for nine days. It waits for one tap from the founder, and the tested head is now 227 commits behind main |
| #49 Rebase the deploy contract branch | Nov 2, Nov 2 | +341 / 0, 6 files | CONFLICTING | A second PR with the same six files as #39, made by a "rebase" task. Conflicts only in `docs/DECISIONS.md` and `docs/PROGRESS.md` |
| #45 Orchestrator: refuse acceptance run outside packages | Nov 2, Nov 6 | +42 / -7, 3 files, draft | CONFLICTING | `session.ts` (9 commits on main since) and `docs/DECISIONS.md`. Body: "I have no git or shell in this session, so I did not rebase or run typecheck/lint/tests" |
| #39 Deploy connector contract and tool schemas | Nov 1, Nov 6 | +341 / 0, 6 files | CONFLICTING | Four new files that do not exist on main, plus one line in PROGRESS.md and seven in DECISIONS.md. **The only conflict is the two logs** (41 commits on main touched each since its base). CI by dispatch was green on Nov 6 |
| #38 Assert no hydration errors in the example spec | Nov 1, Nov 1 | +33 / 0, 1 file | MERGEABLE, BLOCKED | CI ran twice by dispatch (Nov 1, Nov 2), failed both times on a stale base ("date fixes the branches lacked", `docs/PROGRESS.md:1370`), never run again; required checks missing on the head |
| #30 sandbox: no double clone | Oct 30, Nov 6 | +40 / -11, 6 files | CONFLICTING | `session.ts`, DECISIONS.md, PROGRESS.md. Body: "I had no shell, so nothing was run" |
| #24 Example chip hydration mismatch | Oct 27, Nov 2 | +80 / -4, 4 files | CONFLICTING | `BusinessShell.tsx` (14 commits on main since), `example-business.spec.ts`; dispatch CI failed twice |

- Causes, by weight: (1) main moves 5 to 25 merges a day and nothing keeps an agent branch current after its session ends; all 14 `agent/*` branches are 227 to 254 behind and none was touched after Nov 6. (2) The agent pack tells agents to add a line to PROGRESS.md and DECISIONS.md (`docs/agent-pack/skill-repo-and-branches.md` steps 7 and 8), which guarantees a conflict within hours; that alone blocks #39 and #49. (3) Each check costs a full hour and about 150 runner minutes (18 runs on `agent/*`: 9 green, 7 failed, 2 cancelled) for changes of 16 to 341 lines. (4) Agents have no shell, so they cannot run a test; the platform runs acceptance in a sandbox and dispatches CI. (5) Duplicates accumulate: #39 and #49 are the same change; #38 and #24 overlap in one spec file. (6) Nothing closes or re-queues a stale PR, and nothing tells the founder that #52 has been ready since Nov 6. (7) Since Nov 12 the platform cannot even re-check them: four commits on main have touched `.github`, every agent branch still carries the old tree (`afd6054` against `b98644c` on main), and `run_checks` refuses a branch whose `.github` differs from main (section 3.1 item 2).
- Fix:
  1. Remove the two log lines from the agent pack and from the platform's code-task prompt now; an agent's notes go in the PR body (and, after section 4, in a new fragment file, which cannot conflict).
  2. A fast lane for `agent/*` (section 3.5): the same jobs, sharded; target 12 minutes.
  3. An agent-PR sweep, daily, in the platform (it already has `prepareMerge` and `update_branch`, `docs/DECISIONS.md:3107`): behind and clean, update the branch and dispatch checks; conflicting for more than 3 days or superseded by a newer PR for the same task, close with a comment and return the task to the plan; green and unanswered for 24 h, one Inbox reminder; green and unanswered for 7 days, close and re-plan. Until that exists, a weekly scheduled GitHub workflow that labels and comments does the first half.
  4. Decide the seven by hand this week: merge #52 after one update and re-check; close #49 as a duplicate of #39; drop the log lines from #39 and re-check; close #24, #30, #38 and #45 with a note and re-plan them from current main (the code they touch has moved 6 to 14 commits).
  5. Tasks sized so a branch lives hours: one package, no shared files, under about 150 lines. Five of the seven already are; they died of waiting.

**EH-10 (P1, cost of every session). "Update docs/PROGRESS.md after each task; record judgement calls in docs/DECISIONS.md" makes two 1 MB files the busiest merge point in the repo.**
- Evidence: 162 of 263 first-parent commits on main touch PROGRESS.md (62%), 148 touch DECISIONS.md (56%). On all refs: 76 merge-main-into-branch commits and at least a dozen bodies with a `Conflicts:` block, one reading "both sides appended to docs/DECISIONS.md and docs/PROGRESS.md". On Nov 13 and 14 the coordinator stopped the practice: "For two days no PR edited docs/DECISIONS.md or docs/PROGRESS.md; each carried its entries in its body instead" and a later PR folded 30 PRs' entries in by hand (`8d342035`, #136). The next PR after the fold wiped both files (EH-02). The files cannot be read whole (about 265k and 175k tokens); PROGRESS.md has one section of 508 lines and lines up to 12,676 characters, so even `sed -n` ranges are expensive.
- Fix: section 4: one small file per change under `docs/log/`, never an edit to a shared file, with the index script reading both.

**EH-11 (P1, safety). The suites that prove tenancy on a real Postgres, the migration lock, the Redis rate limiter and every live-model behavior never run.**
- Evidence: section 1.4.
- Fix: (a) a `postgres-suites` job in `ci.yml` with `services: postgres` (image `pgvector/pgvector:pg17`) and `redis`, running `pnpm --filter @foundmill/db exec vitest run src/__tests__/rls src/__tests__/migrate-lock.test.ts src/__tests__/owner-lock.test.ts src/__tests__/testing-postgres.test.ts src/__tests__/date-params.test.ts` and the two api files with `RLS_TEST_DATABASE_URL`, `FM_TEST_POSTGRES_URL` and `REDIS_TEST_URL` set (run through `pnpm --filter ... exec vitest`, not turbo: turbo 2 passes only declared variables to a task, and none of these is in `turbo.json`). The harness expects Supabase's roles or creates them (`packages/db/src/testing/postgres.ts`); check its header before choosing the image. Path-filter it to `packages/db/**` and `apps/api/**` on PRs, always on main. (b) `nightly.yml` with `schedule: cron`: the 20 live eval suites (`pnpm --filter @foundmill/evals evals` with `MODEL_MODE=live`), the outcome evals of THESIS_REVIEW 1.8 once written, and the live smoke of GATES.md; a failure opens an issue. Budget it (**Estimate**: the typed-reads workflow comments "a few cents a run"; set a hard monthly cap on the key used).

**EH-12 (P1, cost and exposure). Vercel builds a preview for every push to every branch, on a plan the docs call Hobby.**
- Evidence: `apps/web/vercel.json` has no `ignoreCommand` and no `git.deploymentEnabled`; all seven agent PRs carry a `Vercel` check and a preview URL; about 371 PR runs plus 172 main pushes plus agent-branch pushes in 40 days is roughly 550 or more builds (**Estimate**), 95 CI runs on Nov 13 alone. `docs/DEPLOY.md:19` and `:37` say Hobby. If that is still true, the plan's daily deployment limit is close to what Nov 13 used, and the plan's terms are for non-commercial use (**Unverified**: read the plan in the Vercel dashboard). A preview serves branch code, including agent-written code, and its server rewrites `/api/trpc/*` to the production api (`next.config.ts` `apiRewrites`).
- Fix: in `apps/web/vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "git": { "deploymentEnabled": { "agent/**": false } },
  "ignoreCommand": "bash ../../scripts/vercel-ignore.sh"
}
```
  and `scripts/vercel-ignore.sh` (exit 0 skips the build, anything else builds; a failed `git diff` therefore builds):
```bash
#!/usr/bin/env bash
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- . \
  ../../packages/config ../../packages/shared ../../packages/dugout ../../packages/widgets ../../packages/modules \
  ../../packages/journey ../../packages/entity-linker ../../packages/events ../../apps/api/src \
  ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml
```
  The list is `transpilePackages` in `apps/web/next.config.ts` plus the api's types. 123 of the last 150 merges touch it, so main saves about 18%; backend-only and docs-only branches save all of theirs. Move to a paid plan if the product is live for real users, and consider gating production on CI: disable Git production deploys and call a Deploy Hook from the last job of the main run (Vercel has no wait-for-CI switch, `docs/DEPLOY.md:12`).

### P2

**EH-13 (P2, cost). One fat image, rebuilt from scratch six times per push, and only the api's boot is tested.**
- Evidence: `Dockerfile:13-24` (source copied before `pnpm install`, whole workspace, dev dependencies of the web app, Storybook and Playwright included); CI build 2.1 to 2.9 min with "exporting layers" 60 to 93 s; `ci.yml:136` builds `APP=api` only; services start with tsx (api about 10 s, orchestrator about 20 s to bundle workflows, per `railway/api.toml:15` and `railway/orchestrator.toml:16`).
- Fix (keeps tsx, which is a recorded decision, `docs/DECISIONS.md:41`):
```dockerfile
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
RUN pnpm fetch --frozen-lockfile            # depends on the lockfile only: cached across source changes
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
ARG APP=api
RUN pnpm install --frozen-lockfile --offline --filter "@foundmill/${APP}..."
```
  `tsx` is a devDependency of every service package, so the filtered install still has it; `evals`, `e2e`, `apps/web` and the UI packages leave the image. Have the CI `docker` job build and start `api` and `orchestrator` at least, as two steps of the same job so the required check keeps its name (the orchestrator has no Temporal in CI: assert the process starts and logs its workflow-bundle line, or that `/ready` answers 503 with a reason). Verify image size before and after with `docker image ls` in that job and print it to the summary.

**EH-14 (P2, trust). Flakes are absorbed by retries and not counted.**
- Evidence: Playwright `retries: 2` in CI; the latest green main run reports `1 flaky` (`apps/web/e2e/first-days.spec.ts:158`). Recent repairs: #100 (sub-pixel tap targets), #135 "four CI flakes" (two timing budgets in gateway `large-result` and connectors `quarantine-scan`, two random-id digit collisions), #140 and #141 (three specs with count-then-assert races that had turned main red). 92 of 566 runs failed. Vitest timeouts are generous (30 to 120 s) rather than retried, which is the right call.
- Fix: keep retries, but publish them: add the JSON reporter in CI and a step that writes every `flaky` test to the job summary and fails the gate when the same test is flaky in 3 of the last 10 main runs (a small script over `gh run view --log` output or an artifact). Add a Playwright lint for the two patterns that caused #140 and #141: `expect(await locator.count())` and `nth()` on unsorted lists.

**EH-15 (P2, agent ergonomics). Agent-facing material describes a product and a process that no longer exist.**

| File | Stale content | Evidence |
| --- | --- | --- |
| `CLAUDE.md` ("Always", "Repo guides") | "The full build plan is docs/BUILD.md. Read the relevant section before every task"; "docs/DESIGN.md: the Dugout art direction" | BUILD.md is "Founder Manager: Claude Code Build Instructions, Version 1.0, 5 October 2026" (last changed Oct 21); the roadmap is `docs/THESIS_REVIEW.md` §13 |
| `docs/BUILD.md` §4 (lines 212-245) | an embedded early CLAUDE.md with "Never build mobile layouts" and the football vocabulary | cannot move: code comments cite `BUILD §n` 1,431 times in 921 files |
| `docs/BUILD_RUNBOOK.md` (Oct 7) | "The build runs as waves of parallel agents"; "rename the package scope `@foundmill/*` to `@foundmill/*`"; deploy by `railway up` and `vercel deploy --prod` from a laptop | superseded by push-driven deploys and PR sessions |
| `.claude/workflows/wave*.js` (Oct 7) | five scripts that rebuild whole packages; default root `/Users/reidjackson/code/foundmill` or `/home/user/foundmill` (neither exists) | offered to every session as skills `fm-wave1-packages` ... `fm-wave3c-screen-specs` |
| `.claude/agents/*.md` (Oct 5) | `dugout-builder`: "FM21-sidebar-era look", "Dense, dark, desktop-only"; `agent-template-author`: "Club rules"; `connector-builder`: "requiresKitMode"; all point at BUILD §5, §6, §9, §13.1, §17 | contradicts CLAUDE.md's vocabulary table, the Football Manager ban and the small-screen rule; three skills delegate to these agents |
| `docs/agent-pack/00-handover.md`, `skill-checks-and-ci.md` (Oct 22) | "Desktop only ... Never build mobile layouts"; "about 40 to 50 minutes"; "Staff are the human members"; production "at dc44af6"; "run `pnpm typecheck`" for agents that have no shell | `docs/DECISIONS.md:3100` ("agents have no shell (SEC-3)") |
| `docs/ARCHITECTURE.md:306` (§15) | the e2e job is "`continue-on-error: true` until the golden path is green"; plain-language "in report mode" | `ci.yml:171` `continue-on-error: false`; the e2e gate is a required check |
| `docs/ARCHITECTURE.md` §17, `docs/DEPLOY.md:98` | watch patterns make a push redeploy only what changed | not in force (`docs/DEPLOY.md:268`) |
| `docs/DEPLOY.md` §6 "Staging status (2026-10-08)" | branch protection and Wait for CI listed as open; a mix of rows dated Oct 8 to Nov 8 | PR #38 is BLOCKED by required checks |
| `docs/DESIGN.md:7` (§1) | "A broadcast control room at night, built for one founder ... a financial terminal and the best management sim" | CLAUDE.md "What Foundmill is for" (Nov 11): a first-time founder with no business experience |
| `docs/GATES.md` (Oct 21), `docs/WAVE{1,2,3}_REPORTS.md` (395 KB, Oct 7), `docs/VOCAB_SWEEP.md`, `docs/PLAIN_LANGUAGE_SWEEP.md` (generated; CI uploads fresh copies as artifacts), `docs/NEEDED_DEPS.md` | historical | last-changed dates from `git log -1` |

- Fix: section 4.

**EH-16 (P2). Guides are missing where sessions work most.**
- `apps/web/CLAUDE.md` imports a file that does not exist (`@AGENTS.md`; `apps/web/AGENTS.md` is in `.gitignore`). `apps/web` is the largest app (651 files, 87k lines, changed in 68 of the last 120 merges).
- No guide: `packages/shared` (changed in 48 of 120 merges, everything depends on it), `packages/widgets`, `packages/sandbox`, `packages/policy`, `packages/journey`, `packages/entity-linker`, `packages/config`, `apps/stream`, `apps/collab`, `apps/social`, `evals` (21 of 120), `e2e`, `scripts`.
- Fix: write `apps/web/CLAUDE.md` by hand above Next's generated block (routes, the 1280 and 390 rules, the e2e stack and how to run one spec, `lib/trpc.ts`, where copy linters apply), and 30-line guides for `packages/shared`, `evals`, `e2e`, `scripts`, `packages/widgets`, `packages/sandbox`, `apps/stream`. Add a CI check that every workspace directory has a `CLAUDE.md` that does not consist of an import alone.

**EH-17 (P2). The hooks are off, and would hurt if turned on.**
- Evidence: both scripts start with `[ "${FM_HOOKS:-0}" = "1" ] || exit 0`; nothing sets it. `post-edit.sh` runs typecheck and lint for the edited package **and every dependent** after every edit (`--filter='...[HEAD]'`): one edit in `packages/shared` is all 24 packages, about 9 minutes against a 300 s hook timeout. `stop.sh` runs the same filter for tests (an hour for a shared package, 600 s timeout). `[HEAD]` means uncommitted changes, so after a commit both do nothing. They also need an installed workspace, which a fresh cloud session does not have.
- Fix: replace with (a) `PostToolUse`: for a `.ts` or `.tsx` file, `pnpm --filter <owning package> exec eslint <file>` only (seconds), and for a file under `packages/db/migrations`, a reminder line rather than a suite; (b) `Stop`: print the `verify-done` checklist for the packages changed since `origin/main` (`git diff --name-only origin/main...`), run nothing; (c) a `SessionStart` hook that prints `docs/CURRENT_STATE.md` (section 4) and the three commands a session needs. Turn them on by default and delete the `FM_HOOKS` gate; keep heavy checks in CI where they are sharded.

**EH-18 (P2). Skills cover the October workflow; the November work has none.** Present skills are listed in 1.7. Missing, each a 15 to 25 line `SKILL.md`:

| Skill to add | Why (evidence) | Must say |
| --- | --- | --- |
| `new-migration` | migration numbers already jump to 0107 with 96 files; the rules are spread over `packages/db/CLAUDE.md` | next number after every open branch, `_journal.json` idx and `when`, RLS policy, `rls/tables.ts` row, `EXPORT_TABLES`, a migration-point test, expand then contract (EH-08) |
| `own-key-connector` | three stacked branches `connectors-byo-key`, `-2`, `-buffer`; the Nov 12 founder rule in CLAUDE.md | auth kind `api_key`, vault sealing, no platform-key fallback, "not connected", ask-first hints, the gateway test pattern that shares one database per file |
| `library-skill` | `packages/agents/src/skills/{blueprints,definitions,checks,scenarios,generate}.ts`, `skill-library.ts`, `skill-files.ts` | where a library skill is declared, its 12 to 30 test tasks, grants, the eval |
| `small-screen` | CLAUDE.md "Small screens" rule; 16 specs already test 390 px | the list of outer-product routes, 44 px targets, no horizontal scroll, the `NeedsLargerWindow` rule, the spec pattern (`setViewportSize`) |
| `copy-pass` | four linters and the "subtext, never text" rule | run order, `--fix`, the allow markers, what the linters cannot see (tone, the subtext rule) |
| `log-entry` | EH-10 | how to add a progress or decision fragment (section 4) and never edit the frozen logs |
| `ci-triage` | 92 failed runs; sessions re-run instead of reading | `gh run view <id> --json jobs`, `--log-failed`, flake or real, the rule "same test fails on main means not yours" |
| `after-merge` | no rollback or verification procedure | check `/health` on the three public hosts, the Railway deploy list, how to roll back (EH-08) |
| `agent-pr-triage` | EH-09 | the sweep rules, how to close and re-plan |

**EH-19 (P2). 85 remote branches, 63 of them already merged.** `git branch -r`: 66 `claude/*`, 14 `agent/*`, `connectors-buffer`, `connectors-byo-key`, `connectors-byo-key-2`, `main-emurwq`. 63 have a merged PR, 7 an open one, 13 none (7 `agent/*`, 6 `claude/*`), plus the old integration branch `main-emurwq`. The `plan-change` skill tells every session to diff "each recent unmerged branch" and `packages/db/CLAUDE.md` scans every unmerged branch for migration numbers, so stale branches cost every session. Fix: GitHub setting "Automatically delete head branches"; delete the 63 once (list with `gh pr list --state merged --json headRefName`); a weekly job that lists branches with no PR and no commit for 14 days.

**EH-20 (P2). Lint is syntactic; the architecture rules lean on a few tests.**
- Evidence: `eslint.config.mjs` (83 lines): `js.configs.recommended`, `tseslint.configs.recommended` (not type-checked), one custom rule `fm/no-raw-db` (raw `db.select/insert/update/delete/execute` outside `packages/db/src/repos`, migrations, seeds, tests, the events outbox), `react-hooks`, and `no-explicit-any`, unused vars, type imports and `no-console` as warnings. No `no-floating-promises` or `no-misused-promises` in a codebase of async services; no import-boundary rule for "external calls only through apps/gateway" or "apps never import each other" (`apps/web` depends on `@foundmill/api`, and `apps/api` on `@foundmill/gateway`, as workspace packages). "Model ids only in routing.ts" has a test (`packages/models/src/model-ids.test.ts`). Prettier is configured and never checked.
- Type escapes are low: 28 `any`, 133 `as unknown as` (db 38, connectors 31, web 16), 0 `@ts-ignore` or `@ts-expect-error`, 75 `eslint-disable` (web 27, modules 20, dugout 13) outside tests.
- Fix: add `@typescript-eslint/no-floating-promises` and `no-misused-promises` for `apps/*/src` (needs `parserOptions.projectService`; run it as a separate CI job since typed lint is slower); `no-restricted-imports` for vendor SDKs (`stripe`, `@sendgrid/mail`, `@octokit/*`, `e2b`, `voyageai`) outside `apps/gateway`, `packages/connectors` and `packages/sandbox`; `prettier --check` on changed files only.

**EH-21 (P2, supply chain).** `pnpm audit --prod`: 34 advisories (10 high, 20 moderate, 4 low), reported in the job summary and not gating; no Dependabot or Renovate config; two overrides (`dompurify`, `zod`) and one patch (`patches/postgres@3.4.9.patch`, relied on by `createDb`, see `docs/DEPLOY.md:100`). `.mcp.json` starts `npx -y @playwright/mcp@latest` in every session that loads it: an unpinned package executed on the founder's machine and in cloud sessions, against the repo's own rule for outside tools and its `minimumReleaseAge` policy. Fix: pin the MCP version; triage the 10 high advisories and make `--audit-level high` the gate; add a weekly grouped update PR (Renovate or a scheduled session).

**EH-22 (P2). Duplication and size hot spots.**
- `apps/{collab,composer,gateway,ingest,orchestrator,social,stream}/src/db-boot.ts` and its test: 7 identical copies (1,106 lines).
- 24 near-identical `vitest.config.ts`; `apps/web/playwright.config.ts` and `e2e/playwright.config.ts` repeat `STACK_ENV`, `WEB_ENV`, the server commands and the Chromium path; 6 `railway/*.toml` kept equal by a test.
- `apps/social` is a skeleton that returns 501 for its routers (`apps/social/src/index.ts:1-8`), is not deployed, and the network work landed in `apps/api`; `apps/collab` is not deployed either (`docs/DEPLOY.md:249`: "there is no collab service in staging"). Both still cost test time and a `db-boot` copy. Decide: delete `apps/social`, or mark both as parked in `docs/CURRENT_STATE.md`.
- `apps/orchestrator/src/activities/session.ts`: 2,805 lines, 187,772 bytes, changed by 9 commits in the last 9 days and the conflict point of agent PRs #30 and #45. It is the file to split first (workspace preparation, acceptance run, save and push, result settlement are separable by the comments at lines 972, 1284, 1970, 2353, 2503).

**EH-23 (P2). Environment drift has no detector.** 134 variables, one schema, prose tables per service. The docs already record drift found by hand: `DATA_REGION` still set and read by nothing (`docs/DEPLOY.md:66`), `SESSION_TOKEN_SECRET` and `DEV_MASTER_KEY` on services that must not hold them (`:245`), `INGEST_URL` unset on the api (`:273`), connector keys to delete from the api (`:74`). Fix: a manifest `packages/shared/src/env-manifest.ts` (`service -> { required, optional, forbidden }`), a test that it covers the schema, and each service logging at boot (and exposing on `/health` as counts only, never values) `envMissing` and `envForbidden`; later a read-only script that compares the manifest with Railway's variable names.

**EH-24 (P2, cost). Agent branches can pay for CI twice, and pay the full hour for a 16-line change.** On `agent/4e78440a...` (PR #52) on Nov 6 a `pull_request` run and a `workflow_dispatch` run started within two seconds of each other on the same commit, twice (4 runs, about 600 runner minutes). The concurrency group in EH-06 makes them one. Separately `checksState` (`packages/connectors/src/connectors/github/tools.ts:188-201`) reads every check run on the head, so a cancelled duplicate, a failed non-required `Security scans` job or a failed Vercel preview each read as "failure" to the product; see section 5.

### P3

- **EH-25.** Actions are pinned by tag (`actions/checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`, `upload-artifact@v4`) and the log warns "Node.js 20 is deprecated ... forced to run on Node.js 24". Move to the current majors and pin by commit SHA in the workflows that hold secrets (`evals-typed-reads.yml`, `e2b-template.yml`).
- **EH-26.** Rename leftovers are small: the Railway project is still `founder-manager` (`docs/DEPLOY.md:11,43`), `docs/BUILD.md` title, the three wave scripts ("Founder Manager"), root `package.json` description says "squad of AI agents", `packages/agents/src/club-rules.ts` keeps its file name. No `@founder-manager` scope remains in code. The local checkout directory is `founder-manager` while the remote is `reidjxn/foundmill`.
- **EH-27.** `.gitignore` ends with `.env*` after `!.env.example`, which re-ignores the example for a fresh clone's tooling (the file stays tracked). `scripts/decisions-index.mjs:5` says "about 4,000 lines" (4,610). `apps/web/e2e/README.md` says "Desktop only" while 16 specs test 390 px. A local `.impeccable/hook.cache.json` exists in the checkout (excluded through `.git/info/exclude`): a third-party plugin's hook has written inside the repo directory, which the vetting rule in CLAUDE.md is meant to prevent.
- **EH-28. Debt is not written in the code.** `git grep -w -E "TODO|FIXME|HACK|XXX"` finds 33 hits and none is a real marker (linter word lists, test fixtures named `TODO.md`, a mock code-review rule). The deferred work that does exist is in comments and docs:

| Deferred item | Where |
| --- | --- |
| `legacyBusinessFoundations` and `legacyDraftActs` to delete once pre-patch workflows have finished | `apps/orchestrator/src/workflows/businessFoundations.ts:83,141-154`, `activities/foundations.ts:18,167`, `activities/types.ts:716` |
| `legacyFounder` patch branch | `apps/orchestrator/src/workflows/incorporation.ts:45,71` |
| deprecated 1 to 10 `rating`, "dropped next release" | `apps/api/src/routers/team.ts:89,120,138`, `packages/modules/src/team/types.ts:70`, `packages/widgets/src/widgets/agent-of-the-week.tsx:30` |
| api validates event payloads itself "until the events package is fixed" | `apps/api/src/services/events.ts:4` |
| `db-boot.ts` "until packages/db exports it" | `apps/gateway/src/db-boot.ts:16` and 6 copies |
| deprecated `base64` archive copy in the GitHub mock | `packages/connectors/src/connectors/github/mock.ts:259`, `tools.ts:238` |
| `LinkButton` workaround | `apps/web/components/new/LinkButton.tsx:5` |
| social service: 501 placeholders | `apps/social/src/index.ts:4` |
| account export and closure "by request for now" (a promise in the Privacy Policy) | `apps/web/content/legal/privacy.ts:233` |
| golden path leg "spec diff accepted" skipped: seed has no proposal with hunks | `docs/GATES.md:63` |
| Gate 1 "NOT PASSED yet"; live smoke never run | `docs/GATES.md:104-110` |
| open founder steps: Sentry and OTLP, Redis `maxmemory`, `INGEST_URL`, live connectors, secrets to remove from stream and composer, mobile sign-in config push | `docs/DEPLOY.md:245,255,256,271,273,274,276` |

### 2.1 Code health data

Package sizes (tracked `.ts`, `.tsx`, `.mjs`, `.sql`, `.css`; 3,375 files, 543,871 lines, of which 1,229 test files with 197,236 lines and about 10,600 `it(`/`test(` sites):

| Package | Files | Lines | Test files | Test lines | `as unknown as` | `eslint-disable` |
| --- | --- | --- | --- | --- | --- | --- |
| apps/web | 651 | 87,257 | 258 | 36,561 | 16 | 27 |
| packages/dugout | 553 | 81,466 | 127 | 18,916 | 4 | 13 |
| packages/db | 368 | 64,526 | 116 | 22,017 | 38 | 7 |
| apps/api | 293 | 59,512 | 154 | 29,904 | 9 | 1 |
| packages/modules | 203 | 37,087 | 95 | 12,702 | 3 | 20 |
| apps/orchestrator | 166 | 33,975 | 81 | 16,252 | 6 | 0 |
| packages/connectors | 251 | 31,539 | 60 | 10,656 | 31 | 1 |
| packages/agents | 168 | 27,494 | 31 | 6,049 | 0 | 2 |
| packages/shared | 158 | 24,539 | 69 | 7,757 | 1 | 3 |
| apps/gateway | 79 | 15,434 | 41 | 8,093 | 5 | 0 |
| packages/models | 87 | 15,269 | 29 | 4,532 | 3 | 0 |
| packages/events | 34 | 9,929 | 15 | 3,296 | 4 | 0 |
| evals | 74 | 8,745 | 43 | 2,605 | 2 | 0 |
| others (15) | 290 | 47,099 | 110 | 17,896 | 11 | 1 |

Largest source files (lines): `apps/orchestrator/src/activities/session.ts` 2,805; `packages/events/src/catalogue.ts` 2,475; `apps/orchestrator/src/__tests__/session-live.test.ts` 1,844; `packages/dugout/src/components/data/DataTable.tsx` 1,780; `packages/agents/src/skills/blueprints/channels.ts` 1,573; `packages/db/src/repos/social.ts` 1,251; `packages/db/src/repos/entities.ts` 1,223; `packages/agents/src/skills/blueprints/engineering.ts` 1,152; `apps/api/src/services/conversation.ts` 1,148; `packages/connectors/src/connectors/github/github.test.ts` 1,113; `apps/web/components/onboarding/OnboardingScreen.tsx` 1,091; `packages/journey/src/synthetic.ts` 1,034; `packages/dugout/src/components/journey/ribbon/JourneyRibbon.tsx` 989; `apps/web/components/new/commit/CommitScreen.tsx` 976; `packages/agents/src/conversation.ts` 960; `apps/web/components/agents/logic.ts` 956; `apps/web/components/shell/BusinessShell.tsx` 943; `apps/web/components/inbox/logic.ts` 939; `apps/gateway/src/pipeline.ts` 931; `packages/shared/src/terms.ts` 919; `packages/db/src/repos/agents.ts` 907; `packages/agents/src/skills/blueprints/specialists.ts` 903; `packages/shared/src/logo-svg.ts` 897; `packages/shared/src/personas.ts` 882; `packages/agents/src/prompts/team-call.ts` 868. Lines are long (session.ts averages 67 characters and holds comment lines far past Prettier's 100), so byte size ranks the same files higher: session.ts 188 KB, session-live.test.ts 132 KB, catalogue.ts 115 KB.

Dependencies: one pnpm catalog (`pnpm-workspace.yaml`, about 130 entries), `minimumReleaseAge` with a reviewed exclude list, `allowBuilds` for four packages, Node `>=22.23.3`, pnpm 12.9.1, turbo 2.11.7, TypeScript 5.9.3, Vitest 5.0.3, Playwright 1.63.0, Next 16.4.3. Freshness against the registry was not checked (no network calls allowed).

### 2.2 Cost of the current way of working

All figures here are **Estimates** from measured durations; no billing page was read.

| Item | Measured | Estimate |
| --- | --- | --- |
| CI runner minutes | 566 `CI` runs in 40 days; 276 in Nov 9 to 15. A green run is 140 to 165 runner minutes; a cancelled run still burns 4 to 9 parallel jobs until it is cancelled | about 61,000 runner minutes in 40 days; about 32,900 in Nov 9 to 15, of which about 7,500 went to 100 runs that were cancelled; Nov 13 alone about 11,200. At the standard Linux rate ($0.006 to $0.008 a minute; check the current price list and the plan's included minutes) that week is roughly $200 to $260 |
| CI per merged PR | 371 `pull_request` runs and 172 main runs for 134 merged PRs: 2.8 PR runs plus 1.3 main runs each | 400 to 600 runner minutes and two to three hours of waiting per merged PR |
| CI per agent change | 18 runs on `agent/*` for 7 PRs, none merged | about 2,300 runner minutes spent, zero lines landed |
| Vercel | one build per push to any branch: about 550 in 40 days, about 95 on Nov 13 | at or near a Hobby plan's daily deployment allowance on the busiest days (**Unverified**) |
| Railway | six image builds and six restarts per push to main: 134 merges is about 800 service deploys in 40 days, 294 on Nov 13 and 14 | each build 2 to 3 min of Railway build time; 49 orchestrator restarts in two days, each handing every live agent session to a new worker |
| Session time | time to merge p50 1.9 h, p90 16.5 h; 76 merge-main-into-branch commits; a 5-hour red main overnight | most of a session's elapsed time on a PR is waiting for the hour-long job, twice |
| Model spend, inferred | commit trailers: 991 commits co-authored by an Opus-class model, 383 by Fable-class, 28 Sonnet, 14 Haiku; 22 distinct cloud sessions, 16 since Nov 8. Reading ARCHITECTURE.md whole is about 63k tokens, DESIGN.md about 39k, DECISIONS.md about 265k (not possible in one read), PROGRESS.md about 175k | the avoidable part is context: sessions that follow root CLAUDE.md literally pay 100k tokens or more before the first edit, and every conflict in the two logs costs a rebase turn with megabyte files in the diff. On the product side, `docs/DECISIONS.md:3111` records 23 of 25 agent sessions ending blocked on Nov 2, each a paid session |

The five changes that most reduce time to merge and cost without lowering safety, in order:

1. **Shard the unit tests and stop cancelling main (section 3.2, EH-01, EH-06).** One PR, YAML only. Wall time 64 to about 13 minutes; removes the 90-minute timeouts; every commit on main gets a verdict. Safety goes up: the same tests, plus the guards of EH-02.
2. **Snapshot the migrated database (section 3.3, EH-04).** About half of unit worker time. Brings the lane under 10 minutes and pays back the extra runner minutes of step 1.
3. **Stop writing to two shared megabyte files (section 4, EH-10, EH-02).** Removes the conflict that 62% of merges touch, the sole blocker of two agent PRs, and the possibility of the Nov 15 wipe.
4. **Deploy only what changed, after CI (EH-07, EH-12).** Watch paths per service, "Wait for CI", Vercel `ignoreCommand` and no previews for `agent/**`. 30 to 40% fewer service deploys from patterns alone, far fewer orchestrator restarts with batching, about 18% fewer web builds on main and nearly all preview builds for backend branches.
5. **Give agent PRs a lifecycle (EH-09).** No log edits, the 13-minute lane, a daily sweep that updates, reminds, closes and re-plans. This is the difference between 0 of 7 merged and a working loop.

Next in line, for safety rather than speed: alerting (EH-03, an afternoon of dashboard work), the health gate on schema version and a rollback page (EH-08), the real-Postgres job (EH-11), turbo caching (EH-05).

## 3. Proposed CI redesign, with target times

### 3.1 Constraints the redesign must keep

1. The file stays `.github/workflows/ci.yml` and keeps `workflow_dispatch`: the product dispatches exactly that workflow on `agent/*` branches (`CI_WORKFLOW = "ci.yml"`, `packages/connectors/src/connectors/github/tools.ts:173`; `run_checks` in `packages/connectors/src/connectors/github/index.ts:377-390`) and reads the newest run of it for the head commit (`ciState`, `tools.ts:212`).
2. `run_checks` refuses a branch whose `.github` tree differs from main's (`index.ts:386-387`). Every change to a workflow therefore makes all open agent branches unrunnable until they are rebuilt on main. Land the CI change in one PR, not five.
3. The required checks on main keep their names so nobody has to edit branch protection (per `docs/DEPLOY.md:12`: "Typecheck, lint, unit tests", "Playwright (web screens + golden path)", "Banned terms, vocabulary and US English", "Storybook build", "Docker image (build and boot)"; which of these are set in GitHub today is **Unverified**). A required job that is skipped at job level counts as passed; a workflow that does not start at all (workflow-level `paths:` filter) leaves the check "Expected" forever. So filter inside the workflow, never on `on:`.
4. `checksState` passes only `success`, `neutral` and `skipped` (`tools.ts:188`). A `cancelled` job reads as failure to the product: gates must end `success`, not be cancelled, when their inputs were skipped.
5. Mock mode and no secrets in `ci.yml` (it runs agent-written code).
6. GitHub's merge queue is, as far as I know, not offered for a private repository owned by a user account (**Unverified**; `reidjxn/foundmill` is one). The design below does not need it. If the repo moves to an organization that has it, add `merge_group:` to `on:` and make the PR lane the reduced one in 3.6.

### 3.2 Phase A: same day, YAML only. Wall time 64 min to about 13 min

Replace the `checks` job (lines 99-125) with three jobs, widen the Playwright matrix, fix concurrency. Sketch (unchanged steps elided):

```yaml
concurrency:
  group: ci-${{ github.event_name == 'pull_request' && github.head_ref || github.ref_name }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

jobs:
  changes:
    name: Changed areas
    runs-on: ubuntu-latest
    timeout-minutes: 3
    outputs:
      code: ${{ steps.f.outputs.code }}
      web: ${{ steps.f.outputs.web }}
      image: ${{ steps.f.outputs.image }}
      stories: ${{ steps.f.outputs.stories }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: f
        env:
          EVENT: ${{ github.event_name }}
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          BEFORE: ${{ github.event.before }}
        run: |
          if [ "$EVENT" = "pull_request" ]; then BASE="$PR_BASE"
          elif [ "$GITHUB_REF" = "refs/heads/main" ] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then BASE="$BEFORE"
          else BASE="$(git merge-base origin/main HEAD)"; fi
          FILES="$(git diff --name-only "$BASE" HEAD)"
          has() { if echo "$FILES" | grep -qE "$1"; then echo true; else echo false; fi; }
          ROOT='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig\.base\.json|eslint\.config\.mjs|\.github/)'
          echo "code=$(has "^(apps|packages|evals|e2e|scripts|patches)/|$ROOT")" >> "$GITHUB_OUTPUT"
          echo "web=$(has "^(apps/(web|api)|packages|e2e)/|$ROOT")" >> "$GITHUB_OUTPUT"
          echo "image=$(has "^(apps/(api|gateway|orchestrator|composer|stream|ingest)|packages|patches|infra)/|^Dockerfile|$ROOT")" >> "$GITHUB_OUTPUT"
          echo "stories=$(has "^packages/(dugout|shared|config)/|$ROOT")" >> "$GITHUB_OUTPUT"

  static:
    name: Typecheck and lint
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      # checkout, pnpm, node, install as today (ci.yml:104-110)
      - run: node --test scripts/railway-config.test.mjs scripts/env-example.test.mjs scripts/supabase-config.test.mjs scripts/decisions-index.test.mjs
      - name: Typecheck and lint (all packages)
        env: { NODE_OPTIONS: --max-old-space-size=4096 }
        run: pnpm exec turbo run typecheck lint --continue --concurrency=4 --output-logs=new-only

  unit:
    name: Unit (${{ matrix.name }})
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 25
    strategy:
      fail-fast: false
      matrix:
        include:
          - { name: "api 1 of 3",     run: "pnpm --filter @foundmill/api exec vitest run --shard=1/3" }
          - { name: "api 2 of 3",     run: "pnpm --filter @foundmill/api exec vitest run --shard=2/3" }
          - { name: "api 3 of 3",     run: "pnpm --filter @foundmill/api exec vitest run --shard=3/3" }
          - { name: "db 1 of 2",      run: "pnpm --filter @foundmill/db exec vitest run --maxWorkers=2 --shard=1/2" }
          - { name: "db 2 of 2",      run: "pnpm --filter @foundmill/db exec vitest run --maxWorkers=2 --shard=2/2" }
          - { name: "gateway 1 of 2", run: "pnpm --filter @foundmill/gateway exec vitest run --maxWorkers=2 --shard=1/2" }
          - { name: "gateway 2 of 2", run: "pnpm --filter @foundmill/gateway exec vitest run --maxWorkers=2 --shard=2/2" }
          - { name: "web 1 of 2",     run: "pnpm --filter @foundmill/web exec vitest run --shard=1/2" }
          - { name: "web 2 of 2",     run: "pnpm --filter @foundmill/web exec vitest run --shard=2/2" }
          - { name: "orchestrator",   run: "pnpm --filter @foundmill/orchestrator test" }
          - { name: "dugout",         run: "pnpm --filter @foundmill/dugout test" }
          - { name: "modules, widgets", run: "pnpm exec turbo run test --continue --concurrency=1 --output-logs=new-only --filter=@foundmill/modules --filter=@foundmill/widgets" }
          - { name: "services",       run: "pnpm exec turbo run test --continue --concurrency=1 --output-logs=new-only --filter=@foundmill/ingest --filter=@foundmill/composer --filter=@foundmill/stream --filter=@foundmill/collab --filter=@foundmill/social -- --maxWorkers=2" }
          - { name: "libraries",      run: "pnpm exec turbo run test --continue --concurrency=2 --output-logs=new-only --filter=@foundmill/connectors --filter=@foundmill/evals --filter=@foundmill/agents --filter=@foundmill/events --filter=@foundmill/shared --filter=@foundmill/journey --filter=@foundmill/models --filter=@foundmill/policy --filter=@foundmill/entity-linker --filter=@foundmill/sandbox --filter=@foundmill/config" }
    steps:
      # checkout, pnpm, node, install
      - run: ${{ matrix.run }}

  checks:
    # The required check keeps its name; it is now a gate, like the Playwright one.
    name: Typecheck, lint, unit tests
    needs: [static, unit]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          for r in "${{ needs.static.result }}" "${{ needs.unit.result }}"; do
            case "$r" in success|skipped) ;; *) echo "a needed job ended: $r"; exit 1 ;; esac
          done
```

Also in Phase A:
- A CI guard that the matrix covers every workspace package (a `node --test` in `scripts/` that reads `pnpm-workspace.yaml`, lists packages with a `test` script and fails when one appears in no `--filter`), so a new package cannot silently go untested.
- `e2e-shard`: `shard: [1, 2, 3, 4, 5, 6]`, the awk modulus `% 3` to `% 6` (line 232), the name to `Playwright shard ${{ matrix.shard }} of 6`, `timeout-minutes: 45`, `if: needs.changes.outputs.web == 'true'`. Deal files by weight, not by name: order them with `grep -c 'test(' e2e/*.spec.ts | sort -t: -k2 -rn | cut -d: -f1` before the round-robin, and give the golden path to the last shard (`matrix.shard == 6`). Cache the browser: `actions/cache` on `~/.cache/ms-playwright` keyed on the Playwright version.
- `e2e` gate (line 271): accept `skipped` the same way as above.
- `docker`: `if: needs.changes.outputs.image == 'true'`; `storybook`: `if: needs.changes.outputs.stories == 'true'`. Both names are required checks; a job-level skip satisfies them.
- The two steps of EH-02 in `static`.
- `banned-terms` and `plain-language` stay as they are (they must run on docs-only changes: they scan `docs/DESIGN.md` and `docs/ARCHITECTURE.md`).

Expected per-job times in Phase A, from today's measurements (unit numbers are each package's vitest wall time while sharing a runner; a dedicated runner should do no worse):

| Job | Basis | Expected wall |
| --- | --- | --- |
| static | 8.9 min today for 50 tasks | 9 to 10 min |
| api shards | 1,944 s over 3 | 11 min each |
| db shards | 1,173 s over 2 (seed 252 s and roll-forward 146 s may share a shard) | 9 to 12 min |
| gateway shards | 717 s over 2 | 5 to 8 min |
| web shards | 726 s over 2 | 6 to 7 min |
| orchestrator | 527 s | 9 to 10 min |
| dugout | 390 s | 7 to 8 min |
| modules, widgets | 510 s | 9 to 10 min |
| services | 413 s | 7 to 8 min |
| libraries | 264 s | 5 min |
| Playwright shard (6) | 3,259 s of tests over 6, plus 2.5 min setup | 11 to 13 min |
| **Wall time of the run** | the slowest shard | **about 13 min (from 64)** |
| **Runner minutes per run** | unit 75 to 128 (59 today), Playwright about 70 (63 today), the rest about 20 | **165 to 220 (140 to 165 today)** |

Phase A buys time, not minutes: until Phase B the bill per run can rise by up to a third. The number of runs falls at the same time (no cancelled main runs to repeat, no double agent runs, docs-only runs take 2 minutes).

### 3.3 Phase B: the migrated-database snapshot (EH-04). Unit worker time about halves

Code in `packages/db/src/testing/` as described in EH-04, then in each unit job:

```yaml
      - name: Migrated PGlite snapshot (rebuilt only when a migration changes)
        uses: actions/cache@v4
        with:
          path: ${{ runner.temp }}/foundmill-pglite
          key: pglite-${{ hashFiles('packages/db/migrations/**', 'packages/db/src/pglite.ts', 'pnpm-lock.yaml') }}
      - run: pnpm --filter @foundmill/db exec tsx src/testing/build-snapshot.ts
        env: { FM_PGLITE_SNAPSHOT_DIR: "${{ runner.temp }}/foundmill-pglite" }
```

Then merge shards: api 2, db 1, gateway 1, web 2, orchestrator 1, ui 1 (dugout, modules, widgets), services plus libraries 1. Nine unit jobs of 5 to 8 minutes. Add `packages/db` tests proving the snapshot equals a fresh migrate (same `pg_dump --schema-only` text or the same catalog query result) so the shortcut cannot drift.

### 3.4 Phase C: cache what did not change (EH-05)

Order matters; each step is a prerequisite of the next.

1. `turbo.json`:
```json
{
  "globalEnv": ["APP_ENV", "INTEGRATIONS_MODE", "MODEL_MODE", "NODE_ENV", "CI"],
  "globalDependencies": ["tsconfig.base.json", "eslint.config.mjs", ".prettierrc", "scripts/**", "patches/**"],
  "tasks": {
    "transit": { "dependsOn": ["^transit"] },
    "typecheck": { "dependsOn": ["transit"], "outputs": [] },
    "lint": { "outputs": [] },
    "test": { "dependsOn": ["transit"], "outputs": ["coverage/**"] },
    "test:guards": { "cache": false }
  }
}
```
   `transit` needs no script in any package: it exists so a package's hash includes the packages it depends on.
2. Move the tests that read outside their package (list in EH-05; find the rest with `git grep -n -E "readdirSync|REPO_ROOT|\.\./\.\./\.\./\.\." -- '*.test.ts' '*.test.tsx'`) into a root `guards` vitest project or `scripts/*.test.mjs`, run by an uncached job that always runs.
3. Run every unit job through turbo so it can hit the cache (`pnpm exec turbo run test --filter=@foundmill/api --output-logs=new-only --cache-dir=.turbo/cache -- --shard=1/2`; pass-through arguments are part of the hash), and restore the cache:
```yaml
      - uses: actions/cache@v4
        with:
          path: .turbo/cache
          key: turbo-${{ github.job }}-${{ matrix.name }}-${{ github.sha }}
          restore-keys: turbo-${{ github.job }}-${{ matrix.name }}-
```
   A PR or an agent branch reads main's cache and writes only its own; main never reads theirs. Do not add a remote cache token to these jobs.
4. Prove it once: a PR that changes only `packages/db` must show cache misses for every dependent package's `test` and `typecheck`; a PR that changes only `packages/dugout` must show hits for `api`, `db`, `gateway`, `orchestrator`.

Expected: on the last 120 merges, a perfect affected set needs 70% of unit seconds on average (26% at the first quartile, 86% at the median). So about a third of unit and typecheck minutes go away, and a quarter of PRs finish their unit lane in under 3 minutes.

### 3.5 Agent branches

Nothing separate: `workflow_dispatch` on `agent/<id>` runs the same jobs, gets main's cache for packages it did not touch, and finishes in the same 10 to 13 minutes. With the concurrency group above a second dispatch on the same branch cancels the first; `ciState` reads the newest run. If cost per agent change still matters after Phase C, add a dispatch input `scope` with a `packages` list that the platform fills from the task's changed files and that the `changes` job turns into the matrix; do that only with a full run before merge.

### 3.6 Phase D: run what never runs (EH-11), and optionally split fast and full lanes

```yaml
  postgres-suites:
    name: Real Postgres and Redis suites
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env: { POSTGRES_PASSWORD: postgres }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7
        ports: ["6379:6379"]
    env:
      RLS_TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
      FM_TEST_POSTGRES_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
      REDIS_TEST_URL: redis://127.0.0.1:6379
    steps:
      # checkout, pnpm, node, install
      - run: pnpm --filter @foundmill/db exec vitest run src/__tests__/rls src/__tests__/migrate-lock.test.ts src/__tests__/owner-lock.test.ts src/__tests__/testing-postgres.test.ts src/__tests__/date-params.test.ts
      - run: pnpm --filter @foundmill/api exec vitest run src/__tests__/migrate-on-boot.test.ts src/__tests__/people-races.test.ts src/__tests__/rate-limit.test.ts
```
Not required at first (expect findings on the first run; the pooler cases need `FM_TEST_POOLER_URL` and a PgBouncer container, add later). `nightly.yml` (`on: schedule: - cron: "17 3 * * *"`, plus dispatch): the live eval suites with `MODEL_MODE=live` and a capped key, the outcome evals when written, a build-and-boot of all six images, and `pnpm audit --prod --audit-level high`; on failure, open or update one issue.

If a merge queue becomes available: PR lane = `static`, `unit` (cache does the narrowing), text linters, Playwright for the golden path plus the specs whose names match changed directories; `merge_group` lane = everything. Target under 8 minutes for the PR lane.

### 3.7 Targets

| Stage | Wall time per run | Runner minutes per run (**Estimate**) | Notes |
| --- | --- | --- | --- |
| Today | p50 64 min, p90 85, timeouts at 90 | 140 to 165 | one long job |
| Phase A | 12 to 14 min | 165 to 220 | 14 unit jobs, 6 Playwright shards |
| Phase B | 10 to 12 min (Playwright is now the long pole) | 135 to 160 | 9 unit jobs of 5 to 8 min |
| Phase B with 8 Playwright shards | **under 10 min** | 140 to 165 | 2.5 min setup plus about 7 min of specs per shard |
| Phase C | under 10 min; a quarter of PRs under 5 for unit | about 110 to 130 on average | cache hits, conditional docker, storybook, Playwright |
| Docs-only change | 2 min | 3 | text linters and gates only |

Acceptance for the planner: three consecutive green main runs under 15 minutes after Phase A; `Typecheck, lint, unit tests` and `Playwright (web screens + golden path)` still appear as checks with those exact names; a deliberately broken test in `packages/shared` fails the gate; `run_checks` from the product on a fresh `agent/` branch returns `success` on a green run.

## 4. Proposed docs and agent-ergonomics restructure

### 4.1 What must not change

| Keep exactly | Why |
| --- | --- |
| The paths `docs/DECISIONS.md` and `docs/PROGRESS.md`, and every existing `## ` heading in them | 223 mentions in 176 non-doc files quote decisions by title ("docs/DECISIONS.md 'Cloud-first build and deploy'"); 47 mention PROGRESS |
| `docs/BUILD.md` at its path with its section numbers | code comments cite `BUILD §n` 1,431 times in 921 files |
| `docs/ARCHITECTURE.md` and `docs/DEPLOY.md` section numbers and names | 223 and 64 citations; the per-package guides point at sections by name |
| `node scripts/decisions-index.mjs <words>`, `--sub`, `--file <path>`, its `start–end  title` output and the exports `sections`, `filter`, `render` | used by 12 package guides, the `plan-change` skill and `scripts/decisions-index.test.mjs` |
| `docs/DESIGN.md` and `docs/ARCHITECTURE.md` as scanned prose | `scripts/banned-terms.mjs` and `scripts/us-english.mjs` read them |
| `docs/VOCAB_SWEEP.md`, `docs/PLAIN_LANGUAGE_SWEEP.md` paths, or change `ci.yml:45` and `:90` with them | written by `--sweep` in CI and uploaded as artifacts |
| `docs/THESIS_REVIEW.md` (134 files cite it), `docs/NETWORK.md` (110), `docs/UX_AUDIT_AND_PLAN.md` (103), `docs/TEAM_CALL.md` (77), `docs/IDEA_BOX.md` (44), `docs/SECURITY_REVIEW.md` (29) | cited from code |
| `docs/agent-pack/` path | referenced from `apps/orchestrator/src/activities/session.ts` and gateway tests |

### 4.2 One file per change, never an edit to a shared log

```
docs/
  CURRENT_STATE.md              at most 150 lines; read after CLAUDE.md; owned by the coordinator, never by a feature PR
  log/
    README.md                   the rules below, 20 lines
    2026-11/
      2026-11-16-claude-pglite-snapshot.md
  DECISIONS.md                  frozen: a banner at the top, never edited again
  PROGRESS.md                   frozen: same
  archive/                      WAVE1_REPORTS.md, WAVE2_REPORTS.md, WAVE3_REPORTS.md, BUILD_RUNBOOK.md, NEEDED_DEPS.md
```

A log file, named `YYYY-MM-DD-<branch name with slashes as dashes>.md` (a branch name is known before the PR exists and is unique, so two sessions can never write the same path):

```markdown
---
date: 2026-11-16
branch: claude/pglite-snapshot
pr: 143                # added when known; optional
title: Unit tests load a migrated PGlite snapshot
areas: [packages/db, ci]
supersedes: []         # headings or file names of decisions this one replaces
---
## What changed
Three to ten lines: what a founder or the next session can now rely on, and the tests that prove it.

## Decisions
### Snapshot keyed by the migrations' hash
What was considered, what was chosen, why. One `###` per judgment call.

## Not done
What was left out and where it is tracked.
```

Rules: lines under 400 characters; one file per branch (later pushes edit the same file); nothing else under `docs/` is touched for bookkeeping. This is what the coordinator already improvised on Nov 13 and 14 ("each carried its entries in its body instead", `8d342035`), made permanent.

Script work (`scripts/decisions-index.mjs`, about 40 lines): with no `--file`, index the frozen `docs/DECISIONS.md` as today **and** every `docs/log/**/*.md` (one section per file: `date — title`, its `###` parts as subs, the body searched); print a fragment as `docs/log/2026-11/<file>  <date> — <title>` in place of a line range; add `--since <date>` and `--area <path>`; `--file docs/PROGRESS.md` keeps working for the frozen build log. Extend the test with a fixture directory.

CI (in `static`, replacing the interim "logs only grow" step of EH-02 once the freeze lands):

```yaml
      - name: The frozen logs are not edited (new entries go in docs/log/)
        if: ${{ github.event_name == 'pull_request' }}
        run: |
          git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"
          git diff --quiet FETCH_HEAD HEAD -- docs/DECISIONS.md docs/PROGRESS.md || { echo "::error::docs/DECISIONS.md and docs/PROGRESS.md are frozen; add a file under docs/log/ (skill: log-entry)"; exit 1; }
      - name: Log entries are well formed
        run: node --test scripts/log-entries.test.mjs   # front matter keys, date matches the file name, no line over 400 characters
```
(For a PR, `HEAD` is the merge commit, so a branch that is merely behind does not trip the first step.) A PR that changes `apps/` or `packages/` and adds no log file gets a warning in the job summary for the first two weeks, then a failure.

Instructions to change in the same PR, all found with `git grep -n -E "PROGRESS\.md|DECISIONS\.md"`:

| File | Line | Change |
| --- | --- | --- |
| `CLAUDE.md` | 79 | "Add one file under docs/log/ for each change: what changed and the judgment calls (skill `log-entry`). Never edit docs/DECISIONS.md or docs/PROGRESS.md; they are frozen history, searched with `node scripts/decisions-index.mjs`." |
| `CLAUDE.md` | 89 | "PROGRESS.md updated" becomes "a docs/log entry" |
| `.claude/skills/plan-change/SKILL.md` | 12 | judgment calls go in the branch's log file |
| `.claude/skills/verify-done/SKILL.md` | 17 | same |
| `docs/ARCHITECTURE.md` | 310 | rule 1 of §16 ("plus docs/PROGRESS.md (your rows) and docs/DECISIONS.md (append only)") |
| `docs/agent-pack/00-handover.md` | 28, 29, 87 | agents write no docs bookkeeping; their notes go in the PR body, which the platform already writes (`apps/orchestrator/src/activities/merge.ts:93`) |
| `docs/agent-pack/skill-repo-and-branches.md` | 27, 28 | delete steps 7 and 8 |
| 12 package `CLAUDE.md` files | their "Decisions:" line | unchanged: the command still works |

### 4.3 `docs/CURRENT_STATE.md`: the page a session reads instead of the logs

At most 150 short lines, regenerated by the coordinating session (or a weekly scheduled session) from the last 14 days of `docs/log/`, `gh pr list` and `docs/THESIS_REVIEW.md` §13; feature PRs never edit it, so it cannot become the next conflict file. Sections: what is deployed (commit, date, `APP_ENV`, which connectors are live); the roadmap phase in progress and what is next; open PRs and who owns which area this week; ten known traps (for example: the per-service Railway files are not in force; tests replay migrations; agents have no shell; previews proxy to the production api); a table "you are touching X, read Y" pointing at the package guides and doc sections; the eight commands a session needs. Replace `CLAUDE.md` "The full build plan is docs/BUILD.md. Read the relevant section before every task." with: "Read docs/CURRENT_STATE.md, then the CLAUDE.md of each package you touch. docs/BUILD.md is the October build plan; its section numbers are cited across the code. Where it disagrees with this file or docs/THESIS_REVIEW.md §13, they win." Put a three-line banner saying the same at the top of `docs/BUILD.md` and `docs/BUILD_RUNBOOK.md`.

### 4.4 Long lines hide text from sessions

A file-reading tool that truncates lines at about 2,000 characters silently drops the rest of the line. Lines over 2,000 characters today: `docs/PROGRESS.md` 62 (longest 12,676), `docs/ARCHITECTURE.md` 31 (longest 6,617), `docs/DECISIONS.md` 5, `docs/DEPLOY.md` 4 (longest 3,330). The frozen logs stay as they are (use the index script and `sed | cut`). For the two living documents, split those 35 lines into sub-bullets in one small PR when few branches are open, and add a check to `scripts/log-entries.test.mjs`: no line over 1,500 characters in `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `docs/DESIGN.md`, `docs/CURRENT_STATE.md` or any `CLAUDE.md`. Add `scripts/doc-section.mjs <file> <section number or words>` that prints one section, so guides can say "run this" instead of "grep the heading, then sed".

### 4.5 `.claude/` and guides

| Change | Detail |
| --- | --- |
| Remove `.claude/workflows/` (history keeps it) | takes `fm-wave1-packages` ... `fm-wave3c-screen-specs` out of every session's skill list; move `reports.mjs` with them |
| Rewrite the six `.claude/agents/*.md` | drop "FM21", "Club rules", "requiresKitMode", "desktop-only" and the BUILD § pointers; each agent's prompt becomes: read the package `CLAUDE.md`, follow skill X, finish with `verify-done`. Rename `dugout-builder` to `ui-builder` and update `new-screen` |
| Hooks | EH-17: cheap per-file lint, a Stop checklist, a SessionStart print of `CURRENT_STATE.md`; delete the `FM_HOOKS` gate |
| `settings.json` | add `permissions.allow` for the read-only commands sessions run constantly (`node scripts/decisions-index.mjs:*`, `gh run view:*`, `gh run list:*`, `gh pr view:*`, `gh pr list:*`, `git log:*`, `git diff:*`) |
| New skills | EH-18: `new-migration`, `own-key-connector`, `library-skill`, `small-screen`, `copy-pass`, `log-entry`, `ci-triage`, `after-merge`, `agent-pr-triage` |
| Guides | EH-16: a real `apps/web/CLAUDE.md`; guides for `packages/shared`, `evals`, `e2e`, `scripts`, `packages/widgets`, `packages/sandbox`, `apps/stream`; a CI check that every workspace directory has one |
| `docs/agent-pack/` | regenerate from `CLAUDE.md` and `CURRENT_STATE.md`: the people words, the small-screen rule, "you have no shell: the platform runs the acceptance tests, brings the branch up to date, runs CI and opens the pull request", current CI time; remove the log steps |
| `docs/ARCHITECTURE.md:306`, §17; `docs/DEPLOY.md` §6 | correct the statements listed in EH-15; split §6 into "open founder steps" (short, current) and a dated history moved to `docs/archive/` |
| `.mcp.json` | pin `@playwright/mcp` to a version |
| Branches | auto-delete merged heads; delete the 63 merged ones |

Order: (1) the CI guard of EH-02 today; (2) freeze, `docs/log/`, index script, instruction edits and `CURRENT_STATE.md` in one PR, merged when the open PR count is low, after telling open sessions to move their pending entries; (3) `.claude` cleanup and new skills; (4) long-line fixes and archive moves.

## 5. Interfaces a planner must know

### 5.1 Commands

| Purpose | Command |
| --- | --- |
| All checks (root scripts) | `pnpm typecheck`, `pnpm lint`, `pnpm test` (each `turbo run ...`), `pnpm test:rls` (`pnpm --filter @foundmill/db test:rls` = `vitest run --dir src/__tests__/rls`), `pnpm test:e2e` (`pnpm --filter @foundmill/e2e test`), `pnpm evals`, `pnpm storybook:build` |
| One package | `pnpm --filter @foundmill/<dir> typecheck`, `lint`, `test`; one file: `pnpm --filter @foundmill/<dir> exec vitest run <path>`; shard: add `--shard=i/n` |
| Text linters | `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs` (`--fix <paths>`), `node scripts/plain-language.mjs --gate --summary`, `node scripts/focus-visible.mjs`; self-tests `node --test scripts/<name>.test.mjs` |
| Config tests | `node --test scripts/railway-config.test.mjs scripts/env-example.test.mjs scripts/supabase-config.test.mjs` |
| One screen spec | `pnpm --filter @foundmill/web exec playwright test e2e/<spec>.ts` (stack in `apps/web/e2e/README.md`; `E2E_BASE_URL=http://localhost:3000` to reuse running servers) |
| Decisions | `node scripts/decisions-index.mjs <words>`; `--sub`; `--file docs/PROGRESS.md` |
| Database | `pnpm db:migrate`, `pnpm db:seed`; e2e seed `SEED_TARGET=pglite SEED_PGLITE_DIR=./.pglite/e2e SEED_VOLUME_SCALE=0.1 pnpm --filter @foundmill/db seed` |
| CI reading | `gh run list --workflow=CI --branch main`, `gh run view <id> --json jobs`, `gh run view <id> --job <job id> --log` |
| Service start | `cd apps/<app> && node --import tsx src/index.ts` (what the image runs); `pnpm --filter @foundmill/<app> start` locally |

The laptop must not build or test (memory note "No local builds"); verification is the CI run of the commit (`docs/DEPLOY.md:15`).

### 5.2 CI job and check names today

Workflow `CI` (`ci.yml`): `Banned terms, vocabulary and US English`; `Plain-language linter (undefined jargon and developer notes in user-facing text)`; `Typecheck, lint, unit tests`; `Docker image (build and boot)`; `Storybook build`; `Playwright shard 1 of 3`, `2 of 3`, `3 of 3`; `Playwright (web screens + golden path)`. Workflow `Security scans`: `Secret scan (gitleaks, the commits this change adds)`, `Dependency audit (pnpm audit)`. Workflow `Typed-read injection evals (live)`: `Typed-read injection evals (live model)`. Also on every PR: `Vercel`, `Vercel Preview Comments`.

Required on main according to `docs/DEPLOY.md:12`: the five named in 3.1 item 3. The plain-language job and the security scans are not on that list. Read the live rule before renaming anything (GitHub: Settings, Branches).

### 5.3 What the product itself expects from CI and GitHub

- `packages/connectors/src/connectors/github/tools.ts:173` `CI_WORKFLOW = "ci.yml"`; `index.ts:377-390` `run_checks`: private repository only, never the default branch, `.github` tree identical to main's, then `createWorkflowDispatch` on `refs/heads/agent/<id>`.
- `index.ts:391-404` `get_checks`: every check run on the branch head (`checks.listForRef`) plus the newest `ci.yml` run for that commit; `tools.ts:188-216`: pending until that run completes; failure unless its conclusion is `success` and every check run on the head concluded `success`, `neutral` or `skipped`.
- Agent commits carry `[skip ci]` (`docs/agent-pack/skill-checks-and-ci.md`), so the push starts nothing; a branch updated through GitHub's update-branch gets a merge commit without it, which does start `pull_request` CI.
- Branch names: `agent/<task uuid>` for product agents, `claude/<slug>` for Claude Code sessions. PR bodies are written by `apps/orchestrator/src/activities/merge.ts:93`.
- Commit identity: commits must be authored as the founder's GitHub noreply address or Vercel blocks the deployment (`docs/DEPLOY.md:7`).

### 5.4 Deploy triggers

| Target | Trigger | Gate | Config |
| --- | --- | --- | --- |
| Vercel `foundmill` (root `apps/web`, region `fra1`) | every push: production from `main`, a preview from any other branch | none on Vercel's side; branch protection on `main` is the only gate | `apps/web/vercel.json`, `apps/web/next.config.ts`; env in the Vercel dashboard |
| Railway `founder-manager` / `production`: api, gateway, orchestrator, composer, stream, ingest | every push to `main`, all six (watch paths not set) | healthcheck at deploy (`/health`; orchestrator `/ready`); "Wait for CI" **Unverified** | root `railway.toml` (read until 2026-12-01 per the repo), service settings; `railway/*.toml` are not in force |
| Railway `temporal` (`temporalio/auto-setup:1.29.3`), `temporal-ui` (`temporalio/ui:2.55.0`), Redis, Postgres (Temporal's store) | manual | | pinned 2026-10-15 (`docs/DEPLOY.md:275`) |
| Database schema (Supabase Postgres, pooler port 6543) | api boot | advisory lock, 60 s bound; failure "serves anyway" | `packages/db/migrations/*.sql` (96 files, numbers to 0107), `meta/_journal.json` |
| E2B sandbox template | `gh workflow run e2b-template.yml`, or the orchestrator's Railway pre-deploy command | | `infra/e2b/` |
| Supabase auth config | by hand (`supabase config push`) | `scripts/supabase-config.test.mjs` | `supabase/config.toml` |

Public hosts: `foundmill.com` (Vercel), `api.foundmill.com`, `stream.foundmill.com`, `ingest.foundmill.com` (Railway). Private: `http://<service>.railway.internal:<port>`. Ports: api 4000, gateway 4001, composer 4002, stream 4003, collab 4004, ingest 4005, social 4006, orchestrator 4007 (`PORT` wins on Railway).

### 5.5 Environment variables by service (names only; `docs/DEPLOY.md:45-81` and `.env.example`)

| Where | Variables |
| --- | --- |
| All six services | `APP`, `APP_ENV` (`staging`), `INTEGRATIONS_MODE`, `LIVE_CONNECTORS`, `MODEL_MODE`, `APP_URL`, `DATABASE_URL`, `REDIS_URL`, `SUPABASE_URL`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS`, optional `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` |
| api | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (api and collab only), `SUPABASE_JWT_SECRET`, `SESSION_TOKEN_SECRET`, `DEV_MASTER_KEY` or `KMS_KEY_ID`, `ANTHROPIC_API_KEY`, `COMPOSER_URL`, `GATEWAY_URL`, `INGEST_URL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `SIGNUP_ALLOWLIST`, `SIGNUP_OPEN`, `SIGNUP_DAILY_CEILING`, `SEED_ON_BOOT`, `SEED_OWNER_EMAILS`, `LIVE_MODE`, `API_DB_POOL_MAX`, `MIGRATION_LOCK_TIMEOUT_MS`, `IDEA_COOKIE_DOMAIN`, `IDEA_BOX_DAILY_CEILING_CENTS`, `PLATFORM_MAIL_*` |
| gateway | `SESSION_TOKEN_SECRET`, `DEV_MASTER_KEY`, every platform connector key (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `TURNSTILE_SECRET_KEY`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `VOYAGE_API_KEY`, `BROWSERBASE_API_KEY`, the registry and bank keys), `PLATFORM_MAIL_*` |
| orchestrator | `SESSION_TOKEN_SECRET`, `DEV_MASTER_KEY`, `ANTHROPIC_API_KEY`, `TEMPORAL_*`, `GATEWAY_URL`, `COMPOSER_URL`, `SANDBOX_MODE`, `E2B_API_KEY`, `E2B_TEMPLATE`, `ORCHESTRATOR_MAX_ACTIVITIES`, `ORCHESTRATOR_MAX_SESSIONS`, `ORCHESTRATOR_MAX_WORKFLOWS`, `APPROVAL_WAIT_MINUTES`, `SESSION_PAUSE_HOLD_MINUTES`, `ORCHESTRATOR_SCHEDULES`, `ORCHESTRATOR_WORKSPACE_DIR`, `TEMPORAL_RETRY_SECONDS` |
| composer | `ANTHROPIC_API_KEY`; must not hold `SESSION_TOKEN_SECRET` or `DEV_MASTER_KEY` |
| stream | `SUPABASE_JWT_SECRET`, `SIGNUP_ALLOWLIST`, `SIGNUP_OPEN`; must not hold `SESSION_TOKEN_SECRET` or `DEV_MASTER_KEY` |
| ingest | `SESSION_TOKEN_SECRET`, `DEV_MASTER_KEY`, `COMPOSER_URL`, `TEMPORAL_*`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_WEBHOOK_SECRET`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `SENDGRID_INBOUND_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `PLATFORM_MAIL_INBOUND_TOKEN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY`, `INGEST_PUBLIC_URL` |
| Vercel (web) | `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_URL`, `NEXT_PUBLIC_INGEST_URL`, `NEXT_PUBLIC_COLLAB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_INTEGRATIONS_MODE`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_APP_URL` (leave unset), `NEXT_PUBLIC_AUTH_GOOGLE`, `IDEA_COOKIE_DOMAIN` |
| CI (`ci.yml`) | `CI`, `APP_ENV=test`, `INTEGRATIONS_MODE=mock`, `MODEL_MODE=mock`; e2e: `DATABASE_URL=pglite:./.pglite/e2e`, `DEV_AUTH_USER_ID`, `API_PORT`, `LIVE_MODE=1`, `PLATFORM_MAIL_DOMAIN`, `MODEL_LIMIT_SCALE=50`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_ENV=test`, `E2E_BASE_URL`, `E2E_EXPECT_PROFILE_GATE`, `SEED_*` |
| Test-only switches no workflow sets | `RLS_TEST_DATABASE_URL`, `RLS_TEST_ALLOW_REMOTE`, `FM_TEST_POSTGRES_URL`, `FM_TEST_POOLER_URL`, `REDIS_TEST_URL`, `DOMAIN_TEST_LIVE`, `E2E_GATEWAY_RECORDER_PORT`, `E2E_SIGNUP_CEILING` |
| Repository secrets | `ANTHROPIC_API_KEY` (typed-read evals), `E2B_API_KEY` (template build) |

The exact split of connector keys between gateway and ingest is in `docs/DEPLOY.md` §5.6; treat the table above as an index, not the source.

## 6. Surprises

1. **The unit-test job has already hit its 90-minute timeout on main** (run 43663128650, attempt 1). The hour is not a steady state; it is the last stop before the pipeline fails by the clock.
2. **Both logs were reduced to 8 and 10 lines on main for 7 h 25 min on Nov 15, with CI green**, and came back as a side effect of the next merge. The test that would have failed (`scripts/decisions-index.test.mjs`) exists and is the only script test CI does not run.
3. **No agent-written change has ever reached main.** 134 merged PRs, all by the founder's sessions; 7 agent PRs, 0 merged; two are blocked by nothing except the two lines the agent pack tells agents to add to PROGRESS.md and DECISIONS.md.
4. **Affected-only runs would save only about 30%** because `packages/shared` and `packages/db` sit under everything and change in almost half of all merges. The usual first recommendation is the wrong first move here; sharding and the migration snapshot are.
5. **About half of unit-test time is the same 96 migrations replayed some 300 times**, and some suites replay them for every test (17 tests, 205 s).
6. **The per-service Railway files, their watch patterns and the CI test that keeps them equal describe a configuration that is not deployed.** Railway's API refused the config-file setting in October; every push still restarts six services, including the orchestrator that runs agent sessions. `docs/ARCHITECTURE.md` §17 says otherwise.
7. **A migration that fails does not fail the deploy.** The api logs it and serves; its health stays green.
8. **Nothing pages anyone.** The exporters for errors and traces are written and tested; the three variables that switch them on have been open founder steps since Oct 12.
9. **The product's own check reader is stricter than branch protection**: any failed or cancelled check run on the head, required or not (Vercel, the security scans, a cancelled duplicate), reads as failure. Adding a non-blocking job to CI can block every agent merge.
10. **Any change under `.github/` makes every open agent branch unrunnable** until it is rebuilt on main (`run_checks` compares the trees). Four commits have touched `.github` since Nov 12; all 14 agent branches carry the old tree today (`afd6054` against `b98644c` on main), so the platform could not re-run checks on any of them.
11. **The codebase has no TODO, FIXME or HACK**: 33 matches, none real. Debt lives in prose in the docs, which is why the docs' health matters more here than in most repos.
12. **There is one environment.** Railway's `production` environment runs `APP_ENV=staging`; the image bakes `APP_ENV=staging`; every merge to main goes straight to it, and preview deployments of any branch proxy reads to the same api.
13. **`apps/web/CLAUDE.md` points at a file that is git-ignored and absent**, so the most-edited app has no guide, while twelve smaller packages got one on Nov 15.
14. **Five October "wave" scripts are offered as skills in every session** ("Build every foundation package of Founder Manager in parallel"), with a default path that does not exist.
15. **`.mcp.json` runs `@playwright/mcp@latest` through `npx -y`** in a repo whose CLAUDE.md forbids unvetted outside tools and whose pnpm config enforces a minimum release age.
16. **Type hygiene is better than the process around it**: 28 `any`, no `@ts-ignore`, strict mode with `noUncheckedIndexedAccess`, 13,500 tests, zero unconditional skips. The repo is slow and hard to merge into, not sloppy.

## Not verified in this audit

Runner size (the `ci.yml` comment assumes 16 GB; a private repository's standard runner may be smaller, which changes shard counts, not the design). Whether Railway "Wait for CI" is on, and the live watch-path and healthcheck settings of each service. The Vercel plan and its limits. Which checks branch protection requires today. Whether Railway watch patterns accept `!` negation. Whether GitHub's merge queue is available to this repository. Actions and Railway billing. Image size (no build was run; only CI's layer-export time was read). Dependency freshness against the registry. Unused api procedures and web routes (not traced; only the unused services `apps/social` and `apps/collab` were confirmed). The 10 high advisories by package (the list is in the Security scans job summary, which these commands cannot read).
