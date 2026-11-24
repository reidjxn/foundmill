---
date: 2026-11-24
branch: claude/wp09-t10-training-live
title: A live eval for training now and on the batch path (WP-09 T10 step 4)
areas: [evals, ci]
supersedes: []
---
## What changed
- New eval `evals/src/__tests__/training-batch.eval.test.ts`. It runs one agent's three-skill check now and then
  through the batch activities, using the real training activities on PGlite with no production data. It prints both
  runs' `cost_minor` next to the Estimates and fails when the run now costs more than $1.00.
- New workflow `.github/workflows/evals-training-live.yml`, `workflow_dispatch` only, on the repository secret
  `ANTHROPIC_API_KEY`. Estimated cost: about $1.50 a run.

## Decisions
- The eval has its own workflow, not a step in `evals-models-live.yml`, so a batch that takes hours never holds up the
  other live evals (the coordinating session's call).
- The batch is polled every two minutes for at most 340 minutes, not 24 hours. A GitHub-hosted job stops at six hours.
  If a batch takes longer, the run fails with the batch id, and it can be dispatched again. The product's own workflow
  keeps its one-day limit.
- Costs are at list price before the credit markup. They are read from the outcomes, since the eval client books
  nothing to a ledger.

## Not done
- The eval has not run live yet. The coordinating session dispatches it once. The measured figures then go to
  docs/DECISIONS.md's successor (a docs/log entry) and replace the Estimates in WP-09 Done-when item 4.
