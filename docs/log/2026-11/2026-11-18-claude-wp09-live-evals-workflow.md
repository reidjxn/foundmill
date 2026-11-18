---
date: 2026-11-18
branch: claude/wp09-live-evals
title: WP-09, a hand-run workflow for the live model checks this package still owes
areas: [evals, ci]
supersedes: []
---
## What changed
- `.github/workflows/evals-models-live.yml` runs only by hand (`workflow_dispatch`), on the repository secret
  `ANTHROPIC_API_KEY`, with the paid routing (no `EVAL_FREE_PLAN`). It has three steps, each its own so one failure
  shows which:
  - **T5:** `evals/src/__tests__/fallback.eval.test.ts`. One Opus call (route `planCompiler`) carries the server-side
    fallback beta. It passes when Anthropic accepts that request shape and the answer names a model that served it:
    Opus, or one of `FALLBACK_SERVED_MODELS`.
  - **T4 step 5:** the Source Watcher and golden-task suites. These are the two that `evals-free-plan.yml` does not
    already run.
- The cost Estimate is in the workflow header: about $5 a run, of which under $0.05 is the fallback call.

## Decisions
1. **A new workflow, not steps in an existing one.** `evals-free-plan.yml` runs every route on Haiku, and these checks
   need the paid routing. `evals-outcomes.yml` and `evals-typed-reads.yml` have other purposes.
2. **No session in this environment holds an Anthropic key.** The coordinator dispatches the workflow once, on the
   founder's go, and this session reads the results.

## Not done
- The run itself, and its figures in the WP-09 log.
- T9 (the training price check and the grader agreement eval) comes in its own pull request.
