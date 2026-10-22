# Skill: run the real checks and read the result

Use this after you push a branch and before you open or update a pull request.

## What the checks are

The CI workflow `.github/workflows/ci.yml` runs on pull requests, pushes, and when started by hand. Its jobs:

- **Typecheck, lint, unit tests**: the longest job, about 40 to 50 minutes.
- **Playwright** in three shards, plus the golden path. These run the real app against a seeded database. They take about 15 to 30 minutes each.
- **Storybook build**, **Docker image (build and boot)**, **Banned terms, vocabulary and US English**, **Plain-language linter**: short jobs.

Your branch's commits carry `[skip ci]`. That means a push does not start CI. The only run on your branch is the one you start with `run_checks`.

## How to start the checks

1. Make sure the branch is pushed, and that `.github` on it matches `main`. `run_checks` refuses otherwise, and says why.
2. Call `run_checks` with the repository, owner and your `agent/` branch.
3. Wait. Call `get_checks` for the same branch every few minutes. It reports `pending` until the newest CI run on the head commit has finished.

## How to read the result

`get_checks` returns a `state` and a list of checks.

- `pending`: a run is queued or still going, or none has started yet. Wait. Do not treat it as passing.
- `success`: the CI run finished and every check passed. Only then say the branch is green.
- `failure`: at least one check failed, or the CI run did not succeed. Find out which.

When a check fails:
1. Open its log (the `url` on the check). Find the first error, not the last.
2. Decide whether your change caused it. If the same test fails on `main`, it is not your change; say so in the pull request.
3. If your change caused it, fix it on the same branch, commit, and run the checks again.
4. Do not retry a failing job just to see if it passes. A failing test is a fact about the code. A job that died before any test ran (a download timeout, a runner loss) can be re-run once, by the founder.
5. Never skip, disable or quarantine a test to get green.

## What not to do

- Do not claim a change works from a passing typecheck alone. Say which checks ran and what they covered.
- Do not start `run_checks` repeatedly. Each run uses CI minutes. Start it once per change, and again only after a new commit.
- Do not treat `get_checks` returning `success` as proof the change is right. It proves the existing checks passed. Say what the checks do not cover.
