---
date: 2026-11-18
branch: claude/wp09-t9-training
title: WP-09 T9, training says a true price, checks it against the balance, and the grader's move has its eval
areas: [models, api, db, orchestrator, web, modules, dugout, evals, ci]
supersedes: []
---
## What changed
- **One price for a training run.** `trainingEstimate({ tests, agentModel, batch })` lives in packages/models, with
  `REFERENCE_TEST_USAGE` and `REFERENCE_GRADE_USAGE`, which moved there from the agent router.
  - It prices the grader at whatever `skillGrader` resolves to, not at a fixed Opus, so moving the grader moves the
    price.
  - `batch` prices both calls at half.
  - It rounds up.
  - The api adds the 30% credit markup for a project on credits, and none on a project's own key.
  - `agent.training.estimate` returns `costMinor` and `batchCostMinor`.
- **The check against the balance.** Never stop a team mid-task because a balance ran out (CLAUDE.md): a training run,
  or a model change's retests, that the spendable credits cannot cover is refused before anything is queued. The
  refusal is a 402 `training_unaffordable` with `estimateMinor` and `spendableMinor`, and the sentence "This check costs
  about $1.40 (Estimate) and $1.00 of credits is left. Check fewer skills, or add credits or your own key." A project
  on its own key is not checked.
- **Retests are priced and chosen.**
  - `agent.model.retestEstimate({ agentId, modelKey, applyScope })` returns the agents, tests and price, decided as
    `changeAgentModels` decides: unlocked agents not already on the model.
  - `agent.model.set` gains `retest`. It is on by default for one agent. For every agent of its type, or all agents, it
    is off unless chosen (TS-03 c).
  - `changeAgentModels` takes `{ retest: false }`.
- **The two model dialogs** (apps/web and packages/modules) show the retest's price under the scope choice, as an
  Estimate. For a wider scope, a checkbox reads "Also re-test N agents, about $X". The design system's
  `ApplyScopeDialog` gains an `extra` slot for this, with a story (`WithRetestNote`).
- **The cache breakpoint.** `cacheSystem` takes a block index. The training candidate call passes `0`, so the agent's
  prompt is one cached block shared by every test, and the training block after it changes without a new cache write.
- **The grader's eval.** `evals/src/__tests__/grader-agreement.eval.test.ts` answers 30 golden tasks once and grades
  each answer three times: the judge (Opus at medium effort), Haiku 5.5 at low and Sonnet at low. It prints the
  agreement figures and the verdict. `gradeGoldenOutput` is factored out of `runGoldenTask` for it. The suite runs as
  a step of `evals-models-live.yml`, and the run Estimate in the workflow header is now about $8.

## Decisions
1. **The grader is not moved here.** `skillGrader` stays on Opus until the eval runs live (the coordinator, Nov 18,
   2026). The move is one line in `routing.ts`, in its own change, with the figures.
2. **The reference usage is not recalibrated.** Step 2 asks for the cost report's `trainingRuns` figures, which come
   from production; this session has no access. The Estimate now rounds up and includes the markup, and the
   calibration waits for the report.
3. **No "untested" marking for an agent changed without a retest.** WP-06 has not built that mark yet. The agent keeps
   its ratings, and the founder chose not to re-test.
4. **A model change through an approved plan action (`plans.ts`) is not price-checked.** It still queues its retests as
   before. Checking it means refusing an approval, which is a wider change.

## The first live run of evals-models-live.yml (run 44408226277, Nov 18, 2026, on main before this change)
- **T5, the fallback call: passed.** Anthropic accepts the fallback beta on an Opus route, so the request shape is right.
- **Source Watcher: 1 of 3 passed.**
  - `competitor_pricing` scored 0: Pricing was not flagged and no proposal was drafted.
  - `interview_features` scored 0.45: it rewrote an existing line and put the feature in the wrong block.
- **Golden tasks: 38 of 58 passed.** Most failures score 0.00, which means a deterministic check failed; the log does
  not say which check. Many of those answers say honestly that no tool was available in the session to read, save or
  send, which the eval harness does not give them.
- **What it means for WP-09.** The change these suites first ran on was only the price table and the fallback, and
  neither touches a prompt or a route, so none of these scores move with it. T4's route-effort step, which these suites
  were meant to gate, is not built. The failures are the suites' and the templates' baseline, for their owners.
- **Cost:** about $3.67 (Estimate): Source Watcher 10 cents, golden tasks $3.57, the fallback call under a cent.

## Not done
- The live run of the grader eval, and the move it decides.
- The calibration against the cost report (needs production).
- T10 (training on the batch path) waits for WP-06 T10.
