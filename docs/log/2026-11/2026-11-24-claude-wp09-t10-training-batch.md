---
date: 2026-11-24
branch: claude/wp09-t10-training-batch
title: Training tests on the half-price batch path (WP-09 T10)
areas: [orchestrator, api, web, config]
supersedes: []
---
## What changed
- `trainingRun` takes `input.batch`. Behind `patched("training-batch")`, a batch run submits every candidate answer
  as one batch, looks every two minutes until it ends, runs the deterministic checks, submits the grades as a second
  batch, waits again, collects and finalizes as before. A batch that has not ended a day after the run started fails
  the run with "The half-price check did not finish in a day. Run it now, or try again." A run without `batch`, and
  any run recorded before this change, keeps the old path.
- Four activities in `activities/training.ts`: `submitTrainingCandidates`, `trainingBatchEnded`,
  `submitTrainingGrades` and `collectTrainingOutcomes`, on T8's `submitBatch`, `batchEnded` and `collectBatch`.
  `runSkillTests` was split into helpers that both paths share (`prepareSkill`, `candidateRequest`, `checksFor`,
  `graderRequest`, `skillOutcome`), so a request is built the same way whether it runs now or in a batch.
- `agent.training.run` takes `mode: "now" | "batch"` (default "now"). The batch price is checked against the balance
  and the workflow starts with `batch: true`.
- The Train dialog offers "Run now, about $X (Estimate)" and "Run within a day at half price, about $Y (Estimate)",
  with both prices in its rows.
- `TRAINING_DEFAULT_MODE` in `packages/config/src/pricing.ts` decides which button is primary and focused.

## Decisions
- D11 (which option is the default) is the founder's to make. Until they answer, the default is "now", and changing
  it is one value.
- Each activity rebuilds the batch items from the run (custom ids `c-<skill>-<arm>-<test>` and `g-…`). Only the
  batch ids pass through workflow history, never test payloads.
- In the batch path, a candidate answer that errored or expired is left out of the score instead of scoring 0. Only a
  refusal scores 0, as on the run-now path.
- A run that is canceled, or whose team stops, before its grades submits no grader batch. It still waits for the
  candidate batch it already sent and collects it, because Anthropic charges for that batch, so the cost is booked
  on the run.
- Collecting again books nothing twice. Batch results carry their own idempotency keys (T8), and each skill's marker
  row is keyed `training:<run>:<skill>`.
- The skill check (`agent.skills.measure`) and model retests still run now. The batch activities handle both arms,
  but no caller sends `batch` for them yet.

## Not done
- Step 4, the live three-skill check each way, was not run. The coordinating session dispatches the live runs, and
  their costs replace the Estimates in Done-when item 4.
- `workflows/trainingRun.test.ts` (two new cases) and Playwright's `agent-profile.spec.ts` were not run in this
  session, because the Temporal test server download is blocked here. CI runs both.
- In mock mode the mock client prices batch items at full price when they are submitted. The tests compare scores,
  not costs.
