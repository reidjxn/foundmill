# WP-01: Fast lane for delivery

**Goal:** a pull request gets a trustworthy answer in under 15 minutes, a push redeploys only the services whose code changed, and the two log files stop conflicting.

**Why:** `audits/a10-engineering-health.md` EH-01 (the required unit job hit its own 90-minute timeout on main), EH-02 (both logs were wiped on main for 7 h 25 min with CI green), EH-04, EH-06, EH-07, EH-09, EH-10, EH-12, EH-14, EH-24, and its sections 3 (CI redesign) and 4 (docs redesign). Measured Nov 12 to 15: CI p50 64 min, p90 85; 44 of 172 runs on main cancelled; every push rebuilt six services; 162 of 263 commits on main touched `docs/PROGRESS.md`; 7 agent pull requests open, 0 merged.

**Done when (each is measured, not judged):**
1. Three consecutive green `CI` runs on `main` finish in under 15 minutes wall time (`gh run list --workflow=CI --branch main --json databaseId,conclusion,createdAt,updatedAt`), and a pull request that touches code does the same.
2. A pull request that changes only `docs/**` or `*.md` finishes in under 3 minutes, with `Typecheck, lint, unit tests`, `Playwright (web screens + golden path)`, `Docker image (build and boot)` and `Storybook build` all reported (success or skipped), so it can merge.
3. A deliberately broken test in `packages/shared` turns `Typecheck, lint, unit tests` red; the check names branch protection requires are unchanged.
4. `node scripts/railway-watch.mjs --print` prints one watch-path list per service, and `--replay origin/main~150..origin/main` shows a docs-only commit redeploying nothing and an `apps/ingest`-only commit redeploying only ingest. WP-00 S4 applies those lists before Dec 1, 2026.
5. A pull request that edits `docs/DECISIONS.md` or `docs/PROGRESS.md` fails CI; a new file under `docs/log/` is found by `node scripts/decisions-index.mjs <words>`; the old headings are still found with the same line ranges.
6. The founder has a written recommendation for each of #24, #30, #38, #39, #45, #49, #52 (T8) and has answered it.
7. `.github/workflows/nightly.yml` exists, runs at night, calls `scripts/check-production.mjs` when WP-02 has written it, and opens one issue on failure.
8. Every CI run prints the count of skipped test sites by reason and the names of tests that passed only on retry.

**Scope, in:** `.github/workflows/ci.yml`, a new `nightly.yml` and `ci-alert.yml`, `scripts/` (new guards and the two new scripts), `packages/db/src/testing/` (snapshot), `railway/*.toml`, `scripts/railway-config.test.mjs`, `apps/web/vercel.json`, `docs/log/**`, `scripts/decisions-index.mjs`, the instructions that tell a session to edit the two logs, `apps/web/playwright.config.ts` and `e2e/playwright.config.ts` (reporter only).

**Scope, out (with the owner):**
- Real Postgres and Redis suites in CI (EH-11a): WP-11 (its first task, A8-01). T1 leaves room for that job and does not add it.
- Live evals at night, outcome evals (EH-11b): the packages that write them (WP-05, WP-06, WP-08) add a job to the `nightly.yml` this package creates.
- `scripts/check-production.mjs` itself and the docs/DEPLOY.md record: WP-02. Sentry, uptime monitor, spend limits (EH-03 items 1, 2): WP-00 S12, S13.
- Applying watch paths and "Wait for CI" in Railway: WP-00 S4 (Desktop session). This package writes and proves the lists.
- Not planned anywhere, listed so the planner can place them: a failed migration that still serves (EH-08), the image diet (EH-13), turbo caching (EH-05, a10 §3.4), typed lint (EH-20), dependency triage (EH-21), env manifest (EH-23), `docs/CURRENT_STATE.md`, hooks, new skills other than `log-entry`, stale agent definitions and `.claude/workflows/` (EH-15 to EH-18). None is needed for the eight results above. Turbo caching is the next step if runner minutes matter after T3; it needs the repo-walking tests moved first (a10 EH-05) and is M to L.

**Depends on:** nothing. Do first, beside WP-00.

**Collides with:**
- `claude/blissful-fermat-q03yq1` (1 commit on `04a0a509`, no pull request): in `ci.yml` it changes only the `storybook` job (`timeout-minutes: 30` to `45`, and two steps after the build: "Install Chromium", "Accessibility of every story (axe)" running `pnpm --filter @foundmill/dugout test:a11y`). T1 keeps the `storybook` job's steps untouched and adds only `needs:` and `if:`, so either order rebases with a two-line conflict at most. It also adds 9 lines to each of `docs/DECISIONS.md` and `docs/PROGRESS.md`: it must merge before T6, or move those lines to a `docs/log/` file.
- `claude/holistic-review-plan` (this plan): edits `CLAUDE.md`. T6 edits two lines of `CLAUDE.md`; cut T6's branch after the plan branch merges.
- Every session with an open branch: T6 freezes the two logs. Tell open sessions the day before.
- Any open `agent/*` branch: `run_checks` refuses a branch whose `.github` tree differs from main's (`packages/connectors/src/connectors/github/index.ts`, `githubTreeSha` comparison). T1, T2, T3, T6 and T7 each change `.github`. All 14 `agent/*` branches are already stale (T8), so nothing is lost now; once agents work again, the platform must bring a branch up to date before it dispatches checks.

**Setup it needs:** none to build. T4's lists are applied by WP-00 S4. T8 needs the founder. The GitHub setting "Automatically delete head branches" is a founder step (T8).

**Order:** T1, then T4 (Dec 1 deadline), T2, T6, T3, T5, T7. T8's table is ready now and waits only for the founder.

**Recording:** until T6 merges, record each task the old way (one line in `docs/PROGRESS.md`, judgment calls in `docs/DECISIONS.md`). From T6 on, one file under `docs/log/`.

---

## Tasks

### [x] T1: Split the hour into parallel lanes  [M] [ships alone]

**Why:** EH-01, EH-06, EH-24, EH-02 (the unwired guard); a10 §3.1 and §3.2.

**Files**
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/ci-matrix.test.mjs`

**Interfaces, existing (do not break)**
- `CI_WORKFLOW = "ci.yml"` and `run_checks` (`packages/connectors/src/connectors/github/tools.ts:173`, `index.ts` `run_checks`): the product dispatches `ci.yml` by `workflow_dispatch` on `refs/heads/agent/<id>`. Keep the file name and the trigger.
- `checksState(checks, complete)` (`tools.ts:197`) passes only `success`, `neutral`, `skipped`. A gate job must end `success`; it must never be cancelled or fail because its inputs were skipped.
- Required check names (docs/DEPLOY.md §1 item 2): `Typecheck, lint, unit tests`, `Playwright (web screens + golden path)`, `Banned terms, vocabulary and US English`, `Storybook build`, `Docker image (build and boot)`. A job skipped by a job-level `if:` satisfies a required check; a workflow-level `paths:` filter does not. Filter inside the workflow only.
- Test scripts: every package's `test` is `vitest run --passWithNoTests`; today CI runs `pnpm exec turbo run test --continue --concurrency=2 --output-logs=new-only --filter='!@foundmill/e2e' -- --maxWorkers=2` (`ci.yml:125`).
- Recorded decisions: "2026-10-06 — Cloud-first build and deploy" (CI is the verification machine; mock mode, no secrets), "2026-10-12 — Deploys wait for CI".

**Interfaces, new**
- Job `changes` ("Changed areas") with outputs `code`, `web`, `image`, `stories` (`"true"` or `"false"`). On `push` to `main` and on `workflow_dispatch` all four are `"true"`: main and agent branches always run the full lane. On `pull_request` they come from the diff against the base.
- Jobs `static` ("Typecheck and lint"), `unit` ("Unit (<name>)", a matrix), and `checks` kept as the name of a gate.
- `scripts/ci-matrix.test.mjs`: fails when a workspace package with a `test` script is in no `unit` matrix entry.

**Steps**
1. Write `scripts/ci-matrix.test.mjs` first. It reads `pnpm-workspace.yaml` globs (`apps/*`, `packages/*`, `evals`, `e2e`), collects each `package.json` `name` that has `scripts.test`, drops `@foundmill/e2e`, reads `.github/workflows/ci.yml` as text and asserts each name appears in a `--filter @foundmill/<x>` or `--filter=@foundmill/<x>` inside the `unit:` job.
   verify: `node --test scripts/ci-matrix.test.mjs` fails on today's `ci.yml` (there is no `unit` job).
2. Concurrency, replacing `ci.yml:16-18`:
   ```yaml
   concurrency:
     group: ci-${{ github.event_name == 'pull_request' && github.head_ref || github.ref_name }}
     cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
   ```
   On main nothing running is cancelled; GitHub keeps one run going and one waiting, and a newer push replaces the waiting one. A pull request run and a dispatch on the same branch share a group (EH-24).
   verify: read the expression back; `github.head_ref` is empty outside `pull_request`, so main's group is `ci-main`.
3. Add the `changes` job exactly as in a10 §3.2 with one change: after computing `BASE`, when `EVENT` is not `pull_request` write `true` for all four outputs and skip the diff. Checkout with `fetch-depth: 0`. `timeout-minutes: 3`.
   The four patterns (a10 §3.2), with `ROOT='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig\.base\.json|eslint\.config\.mjs|\.github/)'`:
   - `code`: `^(apps|packages|evals|e2e|scripts|patches)/|$ROOT`
   - `web`: `^(apps/(web|api)|packages|e2e)/|$ROOT`
   - `image`: `^(apps/(api|gateway|orchestrator|composer|stream|ingest)|packages|patches|infra)/|^Dockerfile|$ROOT`
   - `stories`: `^packages/(dugout|shared|config)/|$ROOT`
   verify: in the pull request for this task, the job log shows the changed files and `code=true`.
4. Replace the `checks` job (`ci.yml:99-125`) with `static`, `unit` and the gate. Every `unit` entry keeps today's `--maxWorkers=2` (the audit's sketch drops it for api and web; the runner size is not verified, so keep what is known to fit).
   ```yaml
   static:
     name: Typecheck and lint
     needs: changes
     if: ${{ needs.changes.outputs.code == 'true' }}
     runs-on: ubuntu-latest
     timeout-minutes: 25
     steps:
       # checkout, pnpm/action-setup, setup-node 22 with cache: pnpm, pnpm install --frozen-lockfile (as ci.yml:104-110)
       - name: Config and guard self-tests
         run: node --test scripts/railway-config.test.mjs scripts/env-example.test.mjs scripts/supabase-config.test.mjs scripts/decisions-index.test.mjs scripts/ci-matrix.test.mjs
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
           - { name: "api 1 of 3", run: "pnpm --filter @foundmill/api exec vitest run --maxWorkers=2 --shard=1/3" }
           - { name: "api 2 of 3", run: "pnpm --filter @foundmill/api exec vitest run --maxWorkers=2 --shard=2/3" }
           - { name: "api 3 of 3", run: "pnpm --filter @foundmill/api exec vitest run --maxWorkers=2 --shard=3/3" }
           - { name: "db 1 of 2", run: "pnpm --filter @foundmill/db exec vitest run --maxWorkers=2 --shard=1/2" }
           - { name: "db 2 of 2", run: "pnpm --filter @foundmill/db exec vitest run --maxWorkers=2 --shard=2/2" }
           - { name: "gateway 1 of 2", run: "pnpm --filter @foundmill/gateway exec vitest run --maxWorkers=2 --shard=1/2" }
           - { name: "gateway 2 of 2", run: "pnpm --filter @foundmill/gateway exec vitest run --maxWorkers=2 --shard=2/2" }
           - { name: "web 1 of 2", run: "pnpm --filter @foundmill/web exec vitest run --maxWorkers=2 --shard=1/2" }
           - { name: "web 2 of 2", run: "pnpm --filter @foundmill/web exec vitest run --maxWorkers=2 --shard=2/2" }
           - { name: "orchestrator", run: "pnpm --filter @foundmill/orchestrator exec vitest run --maxWorkers=2" }
           - { name: "dugout", run: "pnpm --filter @foundmill/dugout exec vitest run --maxWorkers=2" }
           - { name: "modules, widgets", run: "pnpm exec turbo run test --continue --concurrency=1 --output-logs=new-only --filter=@foundmill/modules --filter=@foundmill/widgets -- --maxWorkers=2" }
           - { name: "services", run: "pnpm exec turbo run test --continue --concurrency=1 --output-logs=new-only --filter=@foundmill/ingest --filter=@foundmill/composer --filter=@foundmill/stream --filter=@foundmill/collab --filter=@foundmill/social -- --maxWorkers=2" }
           - { name: "libraries", run: "pnpm exec turbo run test --continue --concurrency=2 --output-logs=new-only --filter=@foundmill/connectors --filter=@foundmill/evals --filter=@foundmill/agents --filter=@foundmill/events --filter=@foundmill/shared --filter=@foundmill/journey --filter=@foundmill/models --filter=@foundmill/policy --filter=@foundmill/entity-linker --filter=@foundmill/sandbox --filter=@foundmill/config -- --maxWorkers=2" }
     steps:
       # checkout, pnpm, node, install
       - run: ${{ matrix.run }}
   checks:
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
   The 24 packages with a `test` script, checked against the matrix: api, db, gateway, web, orchestrator, dugout, modules, widgets, ingest, composer, stream, collab, social, connectors, evals, agents, events, shared, journey, models, policy, entity-linker, sandbox, config.
   verify: `node --test scripts/ci-matrix.test.mjs` passes.
5. The interim log guard of EH-02, as a step in `static` after the self-tests (T6 replaces it):
   ```yaml
       - name: The logs only grow (docs/DECISIONS.md, docs/PROGRESS.md)
         if: ${{ github.event_name == 'pull_request' }}
         run: |
           git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"
           for f in docs/DECISIONS.md docs/PROGRESS.md; do
             base=$(git show "FETCH_HEAD:$f" | wc -l); head=$(wc -l < "$f")
             if [ "$head" -lt $(( base * 98 / 100 )) ]; then echo "::error file=$f::$f shrank from $base to $head lines"; exit 1; fi
           done
   ```
   `static` is skipped on a docs-only change, which is exactly when a log could shrink, so put the same step, with a plain checkout, in the `banned-terms` job as well (it always runs). verify: a scratch commit that truncates `docs/PROGRESS.md` fails `Banned terms, vocabulary and US English`; drop the commit.
6. Playwright, `e2e-shard` (`ci.yml:161-261`): add `needs: changes` and `if: ${{ needs.changes.outputs.web == 'true' }}`; `shard: [1, 2, 3, 4, 5, 6]`; name `Playwright shard ${{ matrix.shard }} of 6`; `timeout-minutes: 45`. Shard 1 keeps `onboarding.spec.ts` first and the `e2e/` golden path last (it is the shard seeded without a founder profile, `SEED_OWNER_PROFILE` line 205; moving the golden path to another shard changes the state it starts from, which the audit's sketch overlooks). Deal the other files by weight so shard 1 gets the lightest of each round; replace line 232 with:
   ```bash
   mapfile -t files < <(grep -c 'test(' e2e/*.spec.ts | grep -v '/onboarding.spec.ts:' | sort -t: -k2,2nr -k1,1 | cut -d: -f1 | awk -v n="${{ matrix.shard }}" '(NR - 1) % 6 == (n + 4) % 6')
   ```
   (`n=2` takes the heaviest file of each round of six, `n=1` the lightest.) Cache the browser before "Install Chromium": `actions/cache@v4`, path `~/.cache/ms-playwright`, key `pw-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`; keep the install step (it is a no-op for the download on a hit and still installs system libraries).
   verify: the six "this shard runs N spec files" lines sum to 70 (71 specs minus onboarding), and no shard's summed `test(` count is more than 1.5 times another's.
7. Gate `e2e` (`ci.yml:263-274`): accept `success` or `skipped`, same `case` as step 4; rename the step "All six shards passed or were not needed".
8. `docker`: add `needs: changes`, `if: ${{ needs.changes.outputs.image == 'true' }}`. `storybook`: add `needs: changes`, `if: ${{ needs.changes.outputs.stories == 'true' }}`. Change nothing else in either job (blissful-fermat edits `storybook`).
9. Leave `banned-terms` and `plain-language` unconditional: they scan `docs/DESIGN.md` and `docs/ARCHITECTURE.md`.
10. Update the two stale statements about CI time: `docs/agent-pack/00-handover.md` and `docs/agent-pack/skill-checks-and-ci.md` ("about 40 to 50 minutes" becomes "about 15 minutes"), and `docs/ARCHITECTURE.md` §15 where it says the e2e job is `continue-on-error: true` (it is `false`, `ci.yml:171`).
    verify: `node scripts/banned-terms.mjs && node scripts/us-english.mjs && node scripts/plain-language.mjs --gate --summary`.

**Tests and evals**
- `scripts/ci-matrix.test.mjs` (new): the assertion in step 1, plus a fixture case where a package is missing and the test reports its name.
- The pull request's own CI run is the test of the workflow. Record in the pull request: wall time, runner minutes (sum of job durations from `gh run view <id> --json jobs`), and each required check's conclusion.
- One scratch commit on the branch that breaks an assertion in `packages/shared/src/` must turn `Unit (libraries)` and the gate red; remove it before review.

**Done when:** results 1, 2 and 3 of the header hold on this pull request and on the first three main runs after merge. If the slowest job is over 14 minutes, split it (api to 4 shards, or Playwright to 8) in the same pull request.

**Estimate:** wall 12 to 14 min; runner minutes per run 165 to 220 against 140 to 165 today, until T3.

---

### [x] T2: A red main opens an issue; a nightly lane exists  [S] [ships alone]

**Why:** EH-06 (a red main went unnoticed for five hours), EH-03 item 3, WP-00 S12, the OUTLINE's "nightly production check hook for WP-02's script".

**Files**
- Create: `.github/workflows/ci-alert.yml`, `.github/workflows/nightly.yml`, `scripts/open-or-update-issue.sh`

**Interfaces, new**
- `scripts/open-or-update-issue.sh <label> <title> <body-file>`: with `GH_TOKEN` set, finds the open issue carrying `<label>` (`gh issue list --label <label> --state open --json number --jq '.[0].number'`); comments on it, or creates it with that label. Creates the label if missing (`gh label create <label> --force`). No other side effect.
- Contract for WP-02's `scripts/check-production.mjs` (WP-02 writes it; this is what the lane gives it): run as `node scripts/check-production.mjs` on Node 22 after `pnpm install --frozen-lockfile`; no secret in its environment (it checks the public half: health answers, robots, headers); exit 0 is a pass, any other exit a failure; whatever it writes to the file named by `GITHUB_STEP_SUMMARY` is the report and becomes the issue body.
- Other packages add jobs to `nightly.yml` (live evals, outcome evals); each new job ends with the same failure step.

**Steps**
1. `ci-alert.yml`:
   ```yaml
   name: CI alert
   on:
     workflow_run:
       workflows: [CI]
       branches: [main]
       types: [completed]
   permissions: { contents: read, issues: write }
   jobs:
     alert:
       if: ${{ github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out' }}
       runs-on: ubuntu-latest
       timeout-minutes: 5
       steps:
         - uses: actions/checkout@v4
         - env: { GH_TOKEN: "${{ github.token }}", RUN_URL: "${{ github.event.workflow_run.html_url }}", SHA: "${{ github.event.workflow_run.head_sha }}" }
           run: |
             printf 'CI failed on main at %s\n%s\n' "$SHA" "$RUN_URL" > body.md
             bash scripts/open-or-update-issue.sh ci-red-main "CI is red on main" body.md
   ```
   Not `cancelled`: with step 2 of T1 a waiting run that a newer push replaces ends `cancelled`, which is normal. `workflow_run` workflows run the default branch's copy with the repository token; this one runs no code from the commit it reports on except the shell script on main.
   verify: `gh workflow run` cannot trigger it; prove it by reading the first failure after merge, or by `act`-free review of the expression. State this limit in the pull request.
2. `nightly.yml`:
   ```yaml
   name: Nightly
   on:
     schedule:
       - cron: "17 3 * * *"
     workflow_dispatch:
   permissions: { contents: read, issues: write }
   jobs:
     production-check:
       name: Production check
       runs-on: ubuntu-latest
       timeout-minutes: 15
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22, cache: pnpm }
         - run: pnpm install --frozen-lockfile
         - name: scripts/check-production.mjs (WP-02)
           run: |
             if [ -f scripts/check-production.mjs ]; then node scripts/check-production.mjs
             else echo "scripts/check-production.mjs is not written yet (WP-02)" >> "$GITHUB_STEP_SUMMARY"; fi
         - name: Open or update the issue
           if: ${{ failure() }}
           env: { GH_TOKEN: "${{ github.token }}" }
           run: |
             { echo "Nightly production check failed: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"; cat "$GITHUB_STEP_SUMMARY" 2>/dev/null || true; } > body.md
             bash scripts/open-or-update-issue.sh nightly-red "The nightly production check failed" body.md
   ```
   verify: after merge, `gh workflow run nightly.yml` then `gh run watch`: green, with the "not written yet" line in the summary.
3. A closing step is not added: a person closes the issue when it is fixed.

**Tests and evals:** `scripts/open-or-update-issue.sh` is exercised by the dispatch in step 2 with a temporary `exit 1` on the branch (run from the branch with `gh workflow run nightly.yml --ref <branch>` once the file is on main; before that, state "not run" in the pull request). No unit test: the script is three `gh` calls.

**Done when:** result 7 of the header; a failed `CI` run on main produces one issue labeled `ci-red-main`, and a second failure comments on the same issue.

---

### [x] T3: Tests load a migrated database instead of replaying 96 migrations  [M] [ships alone]

**Why:** EH-04; a10 §3.3. About 300 test files each pay 11 to 13 s to replay every migration; some suites pay it per test (`apps/gateway/src/__tests__/byo-key-connectors-2.test.ts`, 205 s for 17 tests).

**Files**
- Create: `packages/db/src/testing/snapshot.ts`, `packages/db/src/testing/build-snapshot.ts`, `packages/db/src/__tests__/testing-snapshot.test.ts`
- Modify: `packages/db/src/pglite.ts` (`BootPgliteOptions`, `bootPglite`), `packages/db/src/testing/pglite.ts` (`createTestDb`), `.github/workflows/ci.yml` (cache step, fewer shards)

**Interfaces, existing**
- `bootPglite(options: BootPgliteOptions = {}): Promise<BootedPglite>` (`packages/db/src/pglite.ts:190`): builds `extensions` (`pg_trgm`, `vector` when `loadVectorExtension()` finds it), `PGlite.create({ extensions, relaxedDurability: true })`, then `pg.exec(PGLITE_BOOTSTRAP_SQL)`.
- `createTestDb(options: CreateTestDbOptions = {}): Promise<TestHarness>` (`packages/db/src/testing/pglite.ts`): options `migrations?`, `disableVector?`, `pglite?`; returns `appliedMigrations: string[]`.
- `readMigrations(dir?): MigrationFile[]` (`packages/db/src/migrations.ts:49`), each `{ tag, when, path, sql, statements }`.
- PGlite 0.5.8 (`pnpm-workspace.yaml` catalog): `dumpDataDir(compression?): Promise<File | Blob>`, option `loadDataDir?: Blob | File`, `clone(): Promise<PGliteInterface>` (read from the installed type file).

**Interfaces, new**
- `BootPgliteOptions.loadDataDir?: Blob`: passed to `PGlite.create`; when set, `bootPglite` skips `PGLITE_BOOTSTRAP_SQL` (the dump already holds the roles and the `auth` stub).
- `packages/db/src/testing/snapshot.ts`:
  - `snapshotKey(migrations: MigrationFile[], hasVector: boolean): string`: sha256 over `PGLITE_BOOTSTRAP_SQL`, each `tag` and `sql`, the PGlite version string from its `package.json`, and `hasVector`.
  - `snapshotDir(): string`: `process.env.FM_PGLITE_SNAPSHOT_DIR ?? path.join(os.tmpdir(), "foundmill-pglite")`.
  - `loadOrBuildSnapshot(): Promise<{ bytes: Uint8Array; tags: string[]; hasVector: boolean }>`: reads `<dir>/<key>.tar`; on a miss boots, applies every migration (the loop now in `createTestDb`), `dumpDataDir("none")`, writes to `<key>.tar.<pid>.tmp`, renames. Two workers building at once write the same bytes under different temp names. Cached in a module variable per process.
- `packages/db/src/testing/build-snapshot.ts`: calls `loadOrBuildSnapshot()` and prints the key and size. Run with `pnpm --filter @foundmill/db exec tsx src/testing/build-snapshot.ts`.
- Env: `FM_PGLITE_SNAPSHOT_DIR` (tests and CI only; not read by any service, so it does not belong in `.env.example`; confirm `scripts/env-example.test.mjs` scans only what services read, and if it flags the name, add it to that test's test-only list beside `RLS_TEST_DATABASE_URL`), and `FM_PGLITE_SNAPSHOT=0` to force today's path.

**Steps**
1. Test first, `packages/db/src/__tests__/testing-snapshot.test.ts`: (a) a database from the snapshot and one from a fresh replay (`createTestDb({ migrations: readMigrations() })`, which keeps the replay path) return the same rows for `select table_schema, table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema in ('public','auth') order by 1,2,3`, for `select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies order by 1,2,3`, and for `select tablename, rowsecurity from pg_tables where schemaname='public' order by 1`; (b) `appliedMigrations` equals the journal's tags on both; (c) changing one migration's SQL changes `snapshotKey`; (d) a row inserted in one snapshot database is absent from the next (no shared state).
   verify: fails (module missing).
2. Add `loadDataDir` to `bootPglite`; write `snapshot.ts` and `build-snapshot.ts`.
3. `createTestDb`: when `options.migrations === undefined`, `!options.disableVector`, real Postgres is not selected and `FM_PGLITE_SNAPSHOT !== "0"`, boot with `loadDataDir: new Blob([bytes])` and set `appliedMigrations` from the snapshot's tags. Every other call keeps today's loop. No caller changes.
   verify: `pnpm --filter @foundmill/db exec vitest run src/__tests__/testing-snapshot.test.ts` and `pnpm --filter @foundmill/db test:rls` in CI; compare the db shards' wall time with the previous run and put both numbers in the pull request.
4. `ci.yml`, in `unit` before the run step:
   ```yaml
       - name: Migrated PGlite snapshot (rebuilt only when a migration changes)
         uses: actions/cache@v4
         with:
           path: ${{ runner.temp }}/foundmill-pglite
           key: pglite-${{ hashFiles('packages/db/migrations/**', 'packages/db/src/pglite.ts', 'pnpm-lock.yaml') }}
       - run: pnpm --filter @foundmill/db exec tsx src/testing/build-snapshot.ts
         env: { FM_PGLITE_SNAPSHOT_DIR: "${{ runner.temp }}/foundmill-pglite" }
   ```
   and `env: { FM_PGLITE_SNAPSHOT_DIR: "${{ runner.temp }}/foundmill-pglite" }` on the run step. Agent-written test code can write this cache only for its own branch (GitHub scopes caches by branch; main never reads a branch's cache).
5. Only after step 3's numbers are in: merge shards to fit the measurement (the audit's guess is api 2, db 1, gateway 1, web 2; follow the numbers, keep every job under 10 minutes) and update `scripts/ci-matrix.test.mjs` fixtures if needed.
6. Not in this task: `clone()` inside suites that make a database per test, and moving the seven `db-boot.ts` copies into `packages/db` (a10 EH-04 last bullet, EH-22). Each is its own small change once this one is measured.

**Tests and evals:** step 1's file. The whole unit lane is the regression test: the same 13,500 tests must pass on the snapshot.

**Done when:** median PGlite-backed test file drops from about 13 s to under 3 s in the db shard's log; runner minutes per green run are at or below today's 140 to 165 (**Estimate** from a10 §3.7: 135 to 160).

---

### [x] T4: Watch paths per service, written out and proven  [S] [ships alone; WP-00 S4 applies it before Dec 1, 2026]

**Why:** EH-07. Watch paths are set on no service (docs/DEPLOY.md §6, row "Healthchecks and watch patterns": Railway's API refused the config-file setting), every push restarts the orchestrator and hands every running agent session to a new worker, and the repo says `railway.toml` stops being read on 2026-12-01 (`railway.toml:2`; **Unverified** against Railway).

**Files**
- Create: `scripts/railway-watch.mjs`
- Modify: `scripts/railway-config.test.mjs`, `railway/{api,gateway,orchestrator,composer,stream,ingest}.toml` (the `watchPatterns` line and its comment), `docs/DEPLOY.md` §3 "Watch patterns" and the §6 row, `docs/ARCHITECTURE.md` §17 (say the lists live in service settings, applied by WP-00 S4)

**Interfaces, existing**
- `scripts/railway-config.test.mjs`: `SERVICES` (line 14), `BUILD_INPUTS` (line 16), `matches(pattern, path)` (line 88, understands a trailing `/**` or an exact path), and the assertion at line 70 that each list is exactly `/apps/<service>/**`, `/railway/<service>.toml` and `BUILD_INPUTS`.
- `Dockerfile`: copies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `patches`, `apps`, `packages`, `evals`, `e2e`, `infra`. `tsconfig.base.json` is not in the image.
- Each service's `package.json` `dependencies` (not `devDependencies`: `apps/api` lists `@foundmill/gateway` under `devDependencies` and no file in `apps/api/src` imports it).

**Interfaces, new**
- `scripts/railway-watch.mjs`, exports `closure(service): string[]` (workspace directories reached through `dependencies`, transitively), `watchPaths(service): string[]`, `redeploys(paths: string[]): string[]` (services whose list matches any path). CLI: `--print` (one block per service, one pattern per line, ready to paste), `--replay <git range>` (per commit: the services that would redeploy; then totals per service).
- The lists it must print today (computed from the workspace at `04a0a509`; the test in step 1 pins them so a new dependency shows up as a diff):

| Service | Its own paths | Workspace packages (`/packages/<name>/**`) |
| --- | --- | --- |
| api | `/apps/api/**` | agents, config, connectors, db, entity-linker, events, journey, models, policy, shared |
| gateway | `/apps/gateway/**` | agents, config, connectors, db, events, journey, models, policy, shared |
| orchestrator | `/apps/orchestrator/**`, `/infra/**` | agents, config, connectors, db, entity-linker, events, journey, models, policy, sandbox, shared |
| composer | `/apps/composer/**` | agents, config, db, entity-linker, events, journey, models, shared |
| stream | `/apps/stream/**` | agents, config, db, events, journey, models, shared |
| ingest | `/apps/ingest/**` | agents, config, connectors, db, events, journey, models, shared |

  Every service also gets: `/patches/**`, `/Dockerfile`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/.npmrc`. One pattern per entry, no braces. Written out for api, as the Desktop session will paste it:
  ```
  /apps/api/**
  /packages/agents/**
  /packages/config/**
  /packages/connectors/**
  /packages/db/**
  /packages/entity-linker/**
  /packages/events/**
  /packages/journey/**
  /packages/models/**
  /packages/policy/**
  /packages/shared/**
  /patches/**
  /Dockerfile
  /package.json
  /pnpm-lock.yaml
  /pnpm-workspace.yaml
  /.npmrc
  ```
  `/infra/**` is the orchestrator's alone: its pre-deploy command builds the E2B template from `infra/e2b` (Dockerfile comment). `/railway/<service>.toml` leaves the lists: a file Railway no longer reads should not restart a service. No service depends on `packages/dugout`, `packages/widgets` or `packages/modules`, so UI work stops restarting the backend.
- Optional second list, not applied until proven on one service: `!**/*.md`, `!**/__tests__/**`, `!**/*.test.ts`. Whether Railway's watch paths accept `!` is **Unverified**; WP-00 S4 tries them on ingest first with a Markdown-only commit under `packages/shared`. `--print --with-negation` adds them; `--replay --with-negation` shows what they would save.

**Steps**
1. Test first, in `scripts/railway-config.test.mjs`: replace the line-70 assertion with `assert.deepEqual([...patterns].sort(), watchPaths(service).sort())`; add a pinned expectation of the table above; keep the "must not redeploy on" cases and add `/packages/dugout/src/index.ts`, `/packages/shared/CLAUDE.md` only under `--with-negation`, and `/railway/<service>.toml`; add `redeploys(["docs/PROGRESS.md"])` is `[]`, `redeploys(["apps/ingest/src/index.ts"])` is `["ingest"]`, `redeploys(["packages/sandbox/src/worktree.ts"])` is `["orchestrator"]`, `redeploys(["pnpm-lock.yaml"])` is all six.
   verify: `node --test scripts/railway-config.test.mjs` fails.
2. Write `scripts/railway-watch.mjs` (Node built-ins only; reuse the test's `matches` by moving it into the script and importing it back). Update the six `watchPatterns` lines to the script's output and their comments ("its app and the packages it imports").
   verify: the test passes.
3. Dry run: `node scripts/railway-watch.mjs --replay origin/main~150..origin/main`. Put the totals in the pull request beside the audit's estimate (86 to 104 deploys per service of 150, against 150 today).
4. docs/DEPLOY.md §3 "Watch patterns": state that the lists are produced by `node scripts/railway-watch.mjs --print`, live in each service's settings (Settings, Build, Watch Paths), and that the `railway/*.toml` copies are a mirror kept equal by the test. Leave the §6 row open with today's date and "WP-00 S4".
   verify: `node scripts/us-english.mjs` and `node scripts/banned-terms.mjs`.

**Tests and evals:** `scripts/railway-config.test.mjs` (already in CI; T1 keeps it in `static`).

**Done when:** result 4 of the header. Applied state is WP-00 S4's check: a docs-only commit on `main` redeploys nothing, an `apps/ingest` commit redeploys only ingest.

---

### [x] T5: Fewer web builds  [S] [ships alone]

**Why:** EH-12. `apps/web/vercel.json` is `{ "regions": ["fra1"] }`: every push to every branch builds a preview, including agent branches whose preview proxies `/api/trpc/*` to the production api. WP-00 §1 records the team on the Hobby plan.

**Files**
- Modify: `apps/web/vercel.json`
- Create: `scripts/vercel-ignore.sh`, `scripts/vercel-ignore.test.mjs`

**Interfaces, existing:** `apps/web/package.json` workspace dependencies: `@foundmill/{dugout,config,shared,widgets,modules,journey,entity-linker,events,api}`; `transpilePackages` in `apps/web/next.config.ts:50`. Vercel runs `ignoreCommand` in the project root (`apps/web`); exit 0 skips the build, anything else builds; `VERCEL_GIT_PREVIOUS_SHA` is the last deployed commit of the branch when there is one.

**Interfaces, new**
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "git": { "deploymentEnabled": { "agent/**": false } },
  "ignoreCommand": "bash ../../scripts/vercel-ignore.sh"
}
```
```bash
#!/usr/bin/env bash
# Exit 0 = skip the build. A failed git diff exits non-zero, so the build runs.
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- . \
  ../../packages/config ../../packages/shared ../../packages/dugout ../../packages/widgets ../../packages/modules \
  ../../packages/journey ../../packages/entity-linker ../../packages/events ../../apps/api/src \
  ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml
```

**Steps**
1. Test first, `scripts/vercel-ignore.test.mjs`: reads `apps/web/package.json`, asserts every `@foundmill/*` dependency's directory appears in `scripts/vercel-ignore.sh` (so a new dependency cannot be forgotten), and that `apps/web/vercel.json` names the script. Add it to T1's "Config and guard self-tests" line.
   verify: fails.
2. Add the two files. verify: the test passes; on the pull request, the Vercel check builds (this change touches `apps/web`).
3. After merge, push a docs-only commit in the next task's branch and read the Vercel check: "Canceled by Ignored Build Step". Record it.

**Risk named in the pull request:** `checksState` reads every check run on an agent branch's head. With `agent/**` deployments off there is no Vercel check on those heads, which removes one way a preview failure reads as a failed change (a10 surprise 9). Whether a skipped build reports as `neutral` or `skipped` on `claude/*` branches does not matter to the product (it reads only agent branches).

**Done when:** a docs-only or backend-only push builds no preview; an `agent/*` push creates no deployment.

---

### [x] T6: One small file per change; the two logs are frozen  [M] [ships alone; announce a day ahead]

**Why:** EH-10, EH-02 (lasting fix), EH-09 cause 2 (the agent pack tells agents to edit both logs, the only conflict in #39 and #49); a10 §4.1, §4.2.

**Files**
- Create: `docs/log/README.md`, `docs/log/2026-11/<date>-claude-wp01-t6.md` (this task's own entry, the first), `scripts/log-entries.test.mjs`, `scripts/fixtures/log/2026-01/2026-01-05-claude-example.md`, `.claude/skills/log-entry/SKILL.md`
- Modify: `scripts/decisions-index.mjs`, `scripts/decisions-index.test.mjs`, `.github/workflows/ci.yml`, `docs/DECISIONS.md` and `docs/PROGRESS.md` (one banner line each, in a two-line pull request merged just before this one: step 3), `CLAUDE.md`, `.claude/skills/plan-change/SKILL.md`, `.claude/skills/verify-done/SKILL.md`, `docs/ARCHITECTURE.md` §16 rule 1, `docs/agent-pack/00-handover.md`, `docs/agent-pack/skill-repo-and-branches.md`, `docs/agent-pack/skill-product-rules.md`, `docs/holistic-plan/README.md` rule 8

**What must not change (a10 §4.1):** the paths `docs/DECISIONS.md` and `docs/PROGRESS.md` and every `## ` heading in them (176 non-doc files cite decisions by title); `node scripts/decisions-index.mjs <words>`, `--sub`, `--file <path>`, the `start–end  title` output for the frozen files, and the exports `sections`, `filter`, `render` (used by 12 package guides, `plan-change` and the test).

**Interfaces, new**
- A log file, `docs/log/YYYY-MM/YYYY-MM-DD-<branch with slashes as dashes>.md`. One per branch; later pushes edit the same file. Lines under 400 characters.
  ```markdown
  ---
  date: 2026-11-16
  branch: claude/wp01-t6
  pr: 150            # optional, added when known
  title: The two logs are frozen; entries go in docs/log
  areas: [docs, scripts, ci]
  supersedes: []     # titles of decisions this one replaces
  ---
  ## What changed
  Three to ten lines: what the next session can rely on, and the tests that prove it.

  ## Decisions
  ### <one heading per judgment call>
  What was considered, what was chosen, why.

  ## Not done
  What was left out and where it is tracked.
  ```
- `scripts/decisions-index.mjs`: new export `fragments(dir): Section[]`, one section per file with `title` = `<date> — <title>`, `file` = the repo-relative path, `subs` = its `### ` headings, `body` = the whole text. With no `--file`, `main` indexes the frozen `docs/DECISIONS.md` and then `fragments("docs/log")`, oldest first. `render` prints a fragment as `<file>  <title>` in place of a line range. New flags `--since <YYYY-MM-DD>` and `--area <word>` filter fragments only. `--file docs/PROGRESS.md` is unchanged. Nothing is written to disk (the script's own header gives the reason: a committed index would conflict). This is the "assembly": the two megabyte files and the fragments read as one log at query time; nothing folds fragments back into the frozen files.
- CI, in `static` and in `banned-terms` (so a docs-only change is checked), replacing T1's "logs only grow" step:
  ```yaml
      - name: The frozen logs are not edited (new entries go in docs/log/)
        if: ${{ github.event_name == 'pull_request' }}
        run: |
          git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"
          git diff --quiet FETCH_HEAD HEAD -- docs/DECISIONS.md docs/PROGRESS.md || { echo "::error::docs/DECISIONS.md and docs/PROGRESS.md are frozen; add a file under docs/log/ (skill: log-entry)"; exit 1; }
  ```
  On a pull request `HEAD` is the merge commit, so a branch that is merely behind does not trip it. `scripts/log-entries.test.mjs` joins the self-tests line.

**Copy changes (before, after)**

| File | Before | After |
| --- | --- | --- |
| `CLAUDE.md` "Always" | "Update docs/PROGRESS.md after each task; record judgement calls in docs/DECISIONS.md." | "Add one file under docs/log/ for each change: what changed and the judgment calls (skill `log-entry`). Never edit docs/DECISIONS.md or docs/PROGRESS.md: they are frozen history, searched with `node scripts/decisions-index.mjs`." |
| `CLAUDE.md` "Definition of done" | "… eval for any new agent behaviour, PROGRESS.md updated." | "… eval for any new agent behavior, a docs/log entry." |
| `CLAUDE.md` "Repo guides" | "docs/DECISIONS.md — decisions already taken (versions, substitutions). Do not re-decide them." | "docs/DECISIONS.md and docs/log/ — decisions already taken. Find them with `node scripts/decisions-index.mjs <words>`. Do not re-decide them." |
| `.claude/skills/plan-change/SKILL.md` step 5 | "**Judgment calls** go to `docs/DECISIONS.md` with the date, in the same change." | "**Judgment calls** go in the branch's file under `docs/log/` (skill `log-entry`), in the same change." |
| `.claude/skills/verify-done/SKILL.md` step 8 | "`docs/PROGRESS.md` has a line for the change; judgment calls are in `docs/DECISIONS.md`." | "The branch has its file under `docs/log/` with what changed and the judgment calls; neither frozen log is edited." |
| `docs/ARCHITECTURE.md` §16 rule 1 | "… plus `docs/PROGRESS.md` (your rows) and `docs/DECISIONS.md` (append only)." | "… plus your branch's file under `docs/log/`." |
| `docs/agent-pack/skill-repo-and-branches.md` steps 7, 8 | "Update `docs/PROGRESS.md` with one line …", "… add it to `docs/DECISIONS.md`." | Both steps deleted; one line added: "Write what you did and any judgment call in your final report. The platform puts it in the pull request. Do not edit any file under `docs/` for bookkeeping." |
| `docs/agent-pack/00-handover.md` items 4, 5, the "Every change" line, the last line | "Add new judgment calls here.", "Update it after every task.", "… and an update to `docs/PROGRESS.md`.", "… record the difference in `docs/PROGRESS.md`." | "Do not edit it.", "Do not edit it.", the clause removed, "… say so in your final report." |
| `docs/agent-pack/skill-product-rules.md` line 54 | "… and an update to `docs/PROGRESS.md`. A judgment call goes in `docs/DECISIONS.md`." | "… A judgment call goes in your final report." |
| `docs/holistic-plan/README.md` rule 8 | "one line in `docs/PROGRESS.md` per merged task, judgment calls in `docs/DECISIONS.md`" | "one file under `docs/log/` per task with what changed and the judgment calls" |
| Top of `docs/DECISIONS.md` and `docs/PROGRESS.md` | (none) | "> Frozen on <date>. New entries are files under docs/log/ (skill `log-entry`). Search both with `node scripts/decisions-index.mjs <words>`." |

The agent-pack files are given to the product's agents; `apps/gateway/src/__tests__/platform-skills.test.ts` uses its own in-test file bodies, so these edits break no test (checked by grep for `agent-pack` in `*.ts`).

**Steps**
1. Tests first. `scripts/decisions-index.test.mjs`: `fragments("scripts/fixtures/log")` returns one section with the fixture's title, file and `###` parts; `filter` finds it by a body word; `render` prints its path; the real `docs/DECISIONS.md` still has more than 100 sections and its sections keep their titles. `scripts/log-entries.test.mjs`: every `docs/log/**/*.md` except `README.md` has front matter with `date`, `branch`, `title`, `areas`; `date` equals the file name's date and the folder's month; no line over 400 characters; the three `## ` headings are present.
   verify: both fail.
2. Extend the script (about 40 lines); add the fixture, `docs/log/README.md` (the format and the three rules, 20 lines), the `log-entry` skill (15 lines: file name from `git branch --show-current`, the template, "never edit the frozen logs", how to search).
   verify: `node --test scripts/decisions-index.test.mjs scripts/log-entries.test.mjs`; `node scripts/decisions-index.mjs deploys wait` prints the same two sections as before (lines 1438–1445 and 1497–1506 at `04a0a509`, shifted by the banner).
3. Banners first, as their own two-line pull request ("Banners on the frozen logs"), merged before this one: the freeze step compares the two files with the base, so a pull request that both adds the banners and the step would fail its own check. T1's "only grow" guard lets the banner pull request through. It is the last edit either log gets.
   verify: `node scripts/decisions-index.mjs deploys wait` still prints two sections (each range moves down by the banner's lines).
4. Make the copy changes and swap the CI step. verify: a scratch commit touching `docs/PROGRESS.md` fails; removing it passes.
5. Tell open sessions (the founder relays): pending log lines move to a `docs/log/` file on their own branch.

**Tests and evals:** the two script tests; the CI step.

**Done when:** result 5 of the header, and one week of merges with no `Conflicts:` block naming a file under `docs/` (`git log --first-parent --since=<merge date> --grep=Conflicts`).

---

### [x] T7: Skipped and flaky tests are counted on every run  [S] [ships alone]

**Why:** EH-14 (retries hide flakes: `apps/web/playwright.config.ts:120` `retries: isCI ? 2 : 0`, `e2e/playwright.config.ts:93` `retries: 1`), a10 §1.4 (what never runs), the OUTLINE's "skipped/flaky test inventory".

**Inventory at `04a0a509` (re-counted against the code; no unconditional `.skip`, `.only`, `.fixme` or `.todo` exists)**

| Reason | Sites | Where | Runs when |
| --- | --- | --- | --- |
| Live model needed | 20 | `evals/src/__tests__/*.eval.test.ts`, `describe.skipIf(!live)` | never in CI (`MODEL_MODE=mock`); one suite in `evals-typed-reads.yml` |
| Vendor keys needed | 32 | `packages/connectors/src/connectors/**`, `describe.skipIf(!envKeysPresent(...))` | never |
| Real Postgres, pooler or Redis needed | 11 | `packages/db/src/__tests__/{date-params,migrate-lock (4),owner-lock,testing-postgres}.test.ts`, `apps/api/src/__tests__/{migrate-on-boot (2),people-races:124,rate-limit}.test.ts` | never; WP-11 A8-01 adds the job |
| Runs only on PGlite | 1 | `apps/api/src/__tests__/people-races.test.ts:251` | always today |
| Script not importable | 1 | `packages/shared/src/terms.test.ts:113` | runs in CI |
| Seed state (Playwright) | 13 | `apps/web/e2e/{finance-legal-fixes (3),founder-notices:124,home,invitations (5),product,settings-plain,shell-resilience}.spec.ts` | 4 skipped on the latest green main run |
| Stack switch (Playwright) | 2 | `founder-notices.spec.ts:87` (`E2E_GATEWAY_RECORDER_PORT`), `invitations.spec.ts:189` (`E2E_SIGNUP_CEILING`) | never: no workflow sets either |
| Golden path guards | 3 | `e2e/tests/golden-path.spec.ts:270,305,346` | only if Commit fails |
| Known flaky | 1 | `apps/web/e2e/first-days.spec.ts:158` (passed on retry on the latest green main run) | |

Recent flake repairs for context: #100, #135, #140, #141 (a10 EH-14).

**Files**
- Create: `scripts/test-inventory.mjs`, `scripts/test-inventory.test.mjs`
- Modify: `apps/web/playwright.config.ts:123` and `e2e/playwright.config.ts:96` (reporter), `.github/workflows/ci.yml` (two steps)

**Interfaces, new**
- `scripts/test-inventory.mjs`: `--skips` walks tracked `*.test.ts`, `*.test.tsx`, `*.spec.ts` (via `git ls-files`), counts `skipIf(`, `runIf(`, `test.skip(` by the reasons above (matched on the condition text: `live`, `envKeysPresent`, `DIRECT|POOLER|url|onPostgres|base`, everything else "seed or stack state") and exits 1 on any `.only(`, `.fixme(`, `.todo(` or a `.skip(` with no arguments. `--flaky <report.json>...` reads Playwright JSON reports and prints every test whose final status is `flaky`, with file and line. Both write Markdown to `GITHUB_STEP_SUMMARY` when set, else stdout.
- Reporter in CI for both configs: `[["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/report.json" }]]`.

**Steps**
1. Test first, `scripts/test-inventory.test.mjs`: fixture strings for each reason; an unconditional `it.skip("x", …)` makes `--skips` exit 1; a fixture JSON report with one flaky test is listed.
   verify: fails.
2. Write the script; add the JSON reporter.
3. `ci.yml`: in `static`, `node scripts/test-inventory.mjs --skips`; in `e2e-shard` after the Playwright steps, with `if: ${{ always() }}`: `node scripts/test-inventory.mjs --flaky apps/web/test-results/report.json e2e/test-results/report.json` (missing files are skipped quietly). The upload step already takes `test-results`.
   verify: the pull request's run summary shows the skip table and "0 flaky" or the names.
4. Cut from the audit's fix, and why: failing the gate when a test is flaky in 3 of the last 10 main runs needs stored history and a second script; do it when the summary shows the same name twice in a week. The Playwright lint for `expect(await locator.count())` is WP-10's if it wants it.

**Done when:** result 8 of the header.

---

### T8: The seven stale agent pull requests  [S] [needs the founder]

**Why:** EH-09. All seven were opened by the product's own agents (`app/foundmill`) between Oct 27 and Nov 6; none was reviewed; all 14 `agent/*` branches are 227 or more commits behind main. States re-read with `gh pr list` on Nov 15.

| PR | What it is | State | Recommendation | Reason |
| --- | --- | --- | --- | --- |
| #52 API: founder-only handler for merges | +16 / −2 in `apps/api/src/routers/team.ts` and its test: `team.responsibilities.set` refuses any handler but the founder for `merge_to_main`, and `get` always reports the founder | mergeable, green on Nov 6 | **Merge**, after "Update branch" and a green run on the fast lane | Small, tested, matches the rule in CLAUDE.md that agent code never merges on its own; the first agent-written change on main |
| #49 Rebase the deploy contract branch | The same six files as #39 | conflicting | **Close** as a duplicate of #39 | A "rebase" task that produced a second pull request |
| #39 Deploy connector contract and tool schemas | +341 in four new files under `apps/gateway/src/connectors/deploy/` plus log lines | conflicting only in the two logs | **Close** | The directory does not exist on main and nothing imports it; connectors live in `packages/connectors` with a real and a mock implementation (CLAUDE.md "Always"); WP-07 designs publishing differently. The audit suggests dropping the log lines and re-checking instead: do that only if the founder wants this contract kept |
| #45 Orchestrator: refuse an acceptance run outside packages | +42 / −7 in `session.ts`, draft, "nothing was run" | conflicting | **Close**; hand the idea to WP-05 | `session.ts` has moved (main already has `documentationOnly` and the `loose` scope at `changedScope`), and WP-05 sequences every edit to that file |
| #38 Assert no hydration errors in the example spec | +33 in `apps/web/e2e/example-business.spec.ts` | mergeable, blocked: required checks never ran on a current base | **Update once and run; merge if green, close if red** | A test-only change; one fast-lane run costs about 15 minutes |
| #30 sandbox: no double clone | +40 / −11 in `session.ts`, `packages/sandbox/src/worktree.ts` and tests, "nothing was run" | conflicting | **Close**; hand the finding to WP-05 | Untested change to the workspace path; WP-05 re-checks whether `prepareAgentWorkspace` still clones twice on main |
| #24 Example chip hydration mismatch | +80 / −4 in `apps/web/components/shell/BusinessShell.tsx` and tests | conflicting | **Close**; hand the bug to WP-10 | 14 commits on main have changed the file; WP-10 re-cuts the shell and checks whether the nested button is still there |

**Steps (after the founder's yes, per row)**
1. For each "Close": the founder closes it, or says go and the session runs `gh pr close <n> --comment "<the reason from the table, one line>"`. Never without that yes: a comment on a pull request is a message sent in the founder's name.
2. #52 and #38: the founder presses "Update branch" (that merge commit has no `[skip ci]`, so `pull_request` CI starts), then merges when green.
3. Founder, in GitHub settings: turn on "Automatically delete head branches". Then, on a go, delete the closed `agent/*` branches and the 63 branches whose pull request merged (`gh pr list --state merged --limit 300 --json headRefName --jq '.[].headRefName'`, one `git push origin --delete` per name; list them in the pull request first). Deleting a merged branch loses nothing: its commits are on main.
4. Add the three hand-offs as one line each to WP-05 and WP-10 (in their work package files, under the task they belong to), in a docs-only pull request.

**Not in this task:** the daily sweep of agent pull requests (update, remind, close, re-plan; a10 EH-09 fix 3) is product code in the orchestrator and belongs with WP-05's work on sessions that finish. What this package gives it: a 15-minute lane, no log conflicts (T6), no previews (T5).

**Done when:** result 6 of the header; `gh pr list --author app/foundmill --state open` is empty or holds only what the founder chose to keep.

---

## Corrections to the audits

1. a10 EH-03 and §3.2 propose alerting on a failed **or cancelled** main run. With `cancel-in-progress: false`, GitHub still cancels a waiting run when a newer one arrives, so `cancelled` is normal on a busy main. T2 alerts on `failure` and `timed_out` only.
2. a10 §3.2 moves the golden path to the last Playwright shard. `ci.yml:205` seeds shard 1 without a founder profile and the golden path runs after `onboarding.spec.ts` there; T1 keeps it on shard 1 and weights the deal instead.
3. a10 §3.2 drops `--maxWorkers=2` for the api and web shards. Today's command passes it to every package (`ci.yml:125`) and the runner size is unverified; T1 keeps it.
4. a10 EH-07 says to compute each service's closure "from the `package.json` files". Only `dependencies` may be followed: `apps/api` lists `@foundmill/gateway` under `devDependencies` and nothing in `apps/api/src` imports it. The audit's own lists are right.
5. a10 EH-07 keeps `scripts/railway-config.test.mjs` line 70's shape; that assertion also requires `/railway/<service>.toml` in every list. T4 removes it from the lists.
6. a10 §1.4 counts 82 conditional skip sites. The code has 83: the audit's list leaves out `apps/api/src/__tests__/people-races.test.ts:251`, which is skipped on a real Postgres and runs on PGlite. Two of the 15 Playwright skips are stack switches no workflow sets (`E2E_GATEWAY_RECORDER_PORT`, `E2E_SIGNUP_CEILING`), so those tests never run. No unconditional skip, as the audit says.
7. a10 EH-09 fix 4 recommends keeping #39 (drop its log lines, re-check). Its four files sit in `apps/gateway/src/connectors/deploy/`, a directory that does not exist on main and that nothing imports; T8 recommends closing it and leaves the choice with the founder. The audit recommends closing #38; T8 recommends one cheap run first.
8. a10 §4.2 cites `CLAUDE.md` lines 79 and 89. Those are the lines on the plan's branch; find the strings, not the numbers.
9. OUTLINE says `claude/blissful-fermat-q03yq1` "touches `.github/workflows/ci.yml`": it changes only the `storybook` job (timeout and two steps), which T1 leaves alone apart from `needs:` and `if:`.
10. a10 §3.1 item 6: no merge queue is assumed. The "full lane" of this package is every job on every push to `main` (the `changes` job answers `true` to all four on a push); the pull request lane is the same jobs behind path filters.

## Decisions for the founder

1. The seven pull requests (T8 table): yes or no per row.
2. "Automatically delete head branches" on, and a go to delete the 63 merged branches and the closed agent branches.
3. Runner minutes rise by up to a third between T1 and T3 (**Estimate**: 165 to 220 a run against 140 to 165), while the number of runs falls. Accept, or hold T1 until T3 is ready (not recommended: the 90-minute timeout is already being hit).
4. No previews for `agent/**` branches (T5). The founder then reviews an agent's web change from the diff and CI, not a preview URL.
5. T6's freeze day: pick a moment with few open branches.
6. Confirm in GitHub (Settings, Branches) that the required checks are the five named in docs/DEPLOY.md §1; T1 keeps those names. `Plain-language linter …` and the security scans are not required today; leave as is.

## Risks

- **Runner size.** The audit could not verify it. If shards run slower alone than they did sharing, T1's "Done when" says to split further in the same pull request.
- **`checksState` and cancelled duplicates.** A dispatch and a pull request run on the same agent branch now share a group, so one is cancelled. Whether GitHub's `checks.listForRef` (latest per name) hides the cancelled run's checks from `get_checks` is not proven. Check on the first live agent branch after T1: `run_checks`, then `get_checks`, must reach `success` on a green run. If it reads failure, the fix is in `checksState`'s caller (WP-05), not in CI.
- **"Wait for CI" and new workflows.** Railway waits for every Actions run on the commit. `ci-alert.yml` runs on `workflow_run`, attached to main's head; if Railway counts it, a deploy waits a few seconds more. Read one deployment's "Waiting for CI" state after WP-00 S4.
- **Snapshot drift.** A snapshot that differs from a fresh replay would hide a migration bug. T3's first test compares both on every run, and the migration-point suites keep the replay path.
- **Watch-path syntax.** Negation and exact matching rules are Railway's; the lists without negation use only `/dir/**` and exact files, the two forms `docs/DEPLOY.md` already relies on.
- **Freeze fallout.** A session that never heard about T6 fails CI with a message naming the skill; nothing is lost. The banner pull request must land before the freeze step.
- **`.github` changes strand agent branches** (see "Collides with"). Five tasks here change it; do them before agents are writing code again.

## Starting prompt

```
You are executing docs/holistic-plan/WP-01-fast-lane.md in the Foundmill repo. Read, in this order: CLAUDE.md, docs/holistic-plan/README.md (the rules for executing sessions), the work package, and docs/holistic-plan/audits/a10-engineering-health.md sections 2 (EH-01, 02, 04, 06, 07, 09, 10, 12, 14, 24), 3 and 4. Use the plan-change skill before writing anything, and follow the karpathy-guidelines skill on every change.

Start with T1. One task is one pull request on a branch named claude/wp01-t<n>; never push to main and never merge. Write the failing test named in the task first. You cannot prove a workflow change locally: push once, read the run with `gh run view <id> --json jobs`, and put wall time, runner minutes and each required check's conclusion in the pull request. Keep the required check names exactly as they are. If claude/blissful-fermat-q03yq1 has merged, rebase on it and leave its storybook steps untouched.

After T1 is open, do T4 (it has a Dec 1 deadline and touches no workflow), then T2, T6, T3, T5, T7. Do not start T6 until I say the freeze day. Do not close, comment on or update any pull request in T8, and do not delete any branch, until I answer its table row by row; show me the table first. Do not change anything in Railway, Vercel or GitHub settings: write the lists and tell me what WP-00 S4 must apply.

Run verify-done before you call a task finished, report each check with its result and say what the checks do not cover. Record each task as the work package's "Recording" line says, and tick the task in the work package file in the same pull request.
```
