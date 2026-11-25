---
date: 2026-11-25
branch: claude/hopeful-bohr-h0bw4w
title: A daily cap on hand-dispatched live eval runs
areas: [ci, evals]
supersedes: []
---
## What changed
On Nov 24, 2026 about 25 hand-dispatched live eval runs (16 of `evals-models-live.yml`, 8 of `evals-agents-e2e.yml`) spent the $100 Anthropic credit balance; the last two runs failed on "credit balance is too low". A new composite action, `.github/actions/live-eval-daily-cap`, now runs right after checkout in the four hand-run live workflows (models-live, agents-e2e, training-live, free-plan).

It counts the workflow's `workflow_dispatch` runs created today (UTC), this run included, and fails before any model call when the count is over the repository variable `LIVE_EVAL_DAILY_MAX` (default 3). The four workflows gain `actions: read` for the count.

## Decisions
### A per-workflow daily count, not a dollar budget
The runs already log Estimate costs, but none of them knows what the other runs spent. A count of today's runs needs only the GitHub API and stops a fix-and-rerun loop, which is what drained the balance.

### Only the hand-run workflows
The scheduled live evals (outcomes, go-to-market) have their own small budgets and run once a night; typed-read runs on pull requests for a few cents. They are left as they were.

## Not done
- Making grader agreement opt-in in `evals-models-live.yml` and defaulting the launch gate to one pass were proposed and held for the founder: both weaken a check.
- The firm cap is a monthly spend limit on the key in the Anthropic Console, which only the founder can set.
