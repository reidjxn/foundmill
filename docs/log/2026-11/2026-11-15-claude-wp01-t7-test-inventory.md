---
date: 2026-11-15
branch: claude/wp01-t7-test-inventory
title: Skipped and flaky tests are counted on every run
areas: [ci, tests, scripts]
supersedes: []
---
## What changed
**WP-01 T7: skipped and flaky tests are counted on every run** (branch `claude/wp01-t7-test-inventory`, stacked on T1). `scripts/test-inventory.mjs --skips`
counts the conditional skip sites by reason in the run summary (today 83: live model 20, vendor keys 32, real Postgres, pooler or Redis 12, seed or stack state
19) and fails on an unconditional skip, `.only`, `.fixme` or `.todo`; `--flaky` lists the Playwright tests that passed only on a retry, from the JSON report
both configs now write in CI. Unit tests have no retries, so a vitest flake still shows as a failure (one did on T1's second run: `apps/orchestrator`
`autopilot.test.ts:407`, 3 of 3 green locally).

## Decisions
None beyond the pull request.

## Not done
See the pull request's "Not verified" section.
