---
date: 2026-11-16
branch: claude/ci-fewer-minutes
title: CI bills fewer runner minutes - affected unit entries, Playwright only for screens, a smoke set on main
areas: [ci, scripts, docs]
supersedes: []
---
## What changed
The founder said yes to three changes in one pull request on Nov 16, 2026. `.github/workflows` is WP-01's; this was
done on that yes. Measured the same day: one full CI run bills about 176 runner minutes (Playwright's 8 shards and the
golden path about 85, the 13 unit entries about 68, typecheck about 9, the rest about 14), and there were about 40 runs
in 11 hours (24 pull_request, 16 push to main), so about 7,000 minutes.

- **Unit entries only for affected packages on a pull request.** New `scripts/ci-affected.mjs` reads the diff (the
  "Changed areas" job pipes `git diff --name-only <base> HEAD` into it) and the workspace graph from every
  package.json. Output `unit` is `all` or the affected packages: the changed ones, their dependents (turbo's
  `...<pkg>`), and packages whose tests read what changed (`TEST_READS`). Root config (package.json, the lockfile,
  pnpm-workspace.yaml, turbo.json, a root tsconfig or vitest config, eslint.config.mjs, `.github/`, `patches/`, the
  script itself) gives `all`. Each matrix entry now names its packages (`pkgs`); its first step checks them against
  `unit` and, when none is affected, writes a notice and every later step is skipped, so the entry ends green.
  Main, the nightly run and dispatch always get `all`.
- **Playwright only when a screen can see the change.** Output `screens` is true when the affected set reaches
  `@foundmill/web`, `@foundmill/api` or `@foundmill/e2e` through the graph, or the change touches the scripts the
  Playwright job runs (`e2e-shard.mjs`, `test-inventory.mjs`), or root config. The shards' `if:` reads it instead of
  the old hand-written `web` regex. The gate "Playwright (web screens + golden path)" says in a notice why it is green
  when the shards were not needed.
- **A smoke set on push to main, the full suite nightly.** A push gets `shards=["smoke"]`: one Playwright entry,
  seeded with the founder profile like shards 2 to 8, that skips the apps/web specs and runs the e2e/ golden path and
  smoke. Docker image and Storybook do not run on a push (`image`/`stories` false). Linters, typecheck and lint, every
  unit entry and Real Postgres run as before. ci.yml gains `schedule: 43 4 * * *` (the full suite, all 8 shards) in a
  concurrency group of its own (`ci-nightly`), so a push never replaces it. `workflow_dispatch` stays full.
  ci-alert.yml already listens to every CI run on main; its issue body now says which run failed (nightly full run,
  push smoke set). nightly.yml's header points to it.
- Both required gates ("Typecheck, lint, unit tests", "Playwright (web screens + golden path)") now also need
  "Changed areas" and fail unless it succeeded: before, a failed `changes` job skipped everything and read as green.
- Tests: new `scripts/ci-affected.test.mjs` (in the static job's self-test line) and one more in
  `scripts/ci-matrix.test.mjs`. The workflow files pass `@action-validator/cli` 0.6.0 and parse with js-yaml.
- Docs: ci.yml's header and the `changes`, `unit`, shard and gate comments; docs/ARCHITECTURE.md §15; docs/DEPLOY.md
  §1 (what a main commit's CI covers, what Railway's Wait for CI waits for).

## Decisions
- **The graph is read by a small script, checked against turbo, not by turbo in the job.** `turbo ls --affected`
  (turbo 2.11.7) works, but it does not count root package.json, tsconfig.base.json or `.github/` changes (tried:
  zero packages), it does not see test-only cross-package imports, and it would need pnpm and turbo in the
  "Changed areas" job, which every other job waits for. The script uses Node's standard library only. A self-test
  runs `turbo ls --filter=...<pkg>` for every package and fails if the script's dependents differ.
- **The screens rule is the graph, not a list.** It follows that apps/api imports gateway, connectors, agents, models
  and policy, so a change to packages/connectors or apps/gateway does run Playwright (the brief's examples assumed
  otherwise; anything the servers import must count). Changes confined to apps/orchestrator, apps/composer,
  apps/stream, apps/ingest, apps/collab, apps/social, packages/sandbox, evals, infra/ or docs skip Playwright. A new
  workspace dependency of web or api counts from the first commit, with no list to update; the self-test asserts
  this for every package and every direct dependency of the two servers.
- **Hidden reads are found, not guessed.** The self-test scans every package's source for `../` paths that leave the
  package; each must land in a dependency or a `TEST_READS` entry. It found: orchestrator's contract tests importing
  apps/gateway, db's seed test importing entity-linker, agents and shared running `scripts/banned-terms.mjs` and
  `scripts/us-english.mjs`, and two whole-repo scans (models' model-id guard over apps/, packages/ and scripts/; web's
  legal-content test over apps/ and packages/). A reader's tests run, its dependents do not.
- **The price of web's legal scan.** Because of it, web's two unit entries (and models, in "libraries") run on nearly
  every code pull request. Kept for correctness; moving that guard into scripts/ would save about 10 minutes a PR.
- **Entries skip by step, not by job.** A matrix job's `if:` cannot read `matrix`, and a dynamic matrix would move
  the entries out of ci.yml and break ci-matrix.test.mjs. An unaffected entry still bills about 1 minute (GitHub
  rounds each job up), about 9 to 12 minutes a PR at most.
- **Smoke reuses the shard job** (`matrix.shard == 'smoke'`), so the stack setup is one copy. It seeds with the
  profile, the state shard 1's golden path meets after onboarding.spec.ts.
- **Docker image and Storybook also leave the push run**, beyond the brief's list: both ran on the pull request,
  Railway builds the image again, and the nightly run builds both.
- **Real Postgres stays on main** (about 3 minutes), and the linters run on every event as before.
- Kept: the required check names, `cancel-in-progress`, the `code`, `image` and `stories` filters, no secrets.

Savings, all Estimates from the numbers above (unit entry about 5 minutes, smoke entry about 10, Docker and
Storybook about 6 together):
- Per merge to main: about 176 to about 95 minutes, about 80 saved.
- Per pull request: outside the screens (orchestrator, evals, composer) about 176 to about 55, about 120 saved;
  apps/web only about 40 saved (unit); packages/shared, packages/config or root config about 0 (everything runs).
- Per 11 hours at today's pace: about 1,300 saved on the 16 pushes and, at 40 to 60 a PR, 1,000 to 1,400 on the 24
  pull requests; the nightly run adds about 176 a day. About 7,000 to about 4,500 to 5,000 minutes.

## Not done
- Not run on GitHub: nothing was triggered from here. The pull request's own CI run is the test (WP-01): it changes
  `.github/`, so it runs everything; the first narrow pull request and the first push and nightly runs after the
  merge should be read with `gh run view <id> --json jobs`.
- A screen regression that only the 8 shards catch now ships to main's deploy (Railway waits for the smoke set) and
  is reported by the next nightly run, within a day, as the founder accepted.
- Hidden reads the scan cannot see (paths built at run time, not `../` literals) are caught by main's full unit run
  after the merge, not on the pull request.
- Moving web's legal-content scan out of the unit suite; a dynamic matrix that skips unaffected entries for free.
