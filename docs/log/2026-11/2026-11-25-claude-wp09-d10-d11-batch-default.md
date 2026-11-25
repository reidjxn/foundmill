---
date: 2026-11-25
branch: claude/wp09-d10-d11-batch-default
title: Training checks default to half price, and the $1.00 target applies there (WP-09 D10, D11)
areas: [config, web, evals, docs]
supersedes: []
---
## What changed
- `TRAINING_DEFAULT_MODE` (packages/config `pricing.ts`) is "batch". The Train dialog's primary, focused button is now
  "Run within a day at half price". "Run now" stays next to it, and both prices show before the run.
- After a half-price start, the notice says that results come back within a day.
- The live eval (`training-batch.eval.test.ts`) applies the $1.00 cap to the half-price run (`MAX_BATCH_MINOR`). The
  run-now cost is still printed, with no cap.
- WP-09 Done-when item 4 and D11 in `docs/holistic-plan/WP-09-models-and-money.md` record the decision and the
  measured figures.
- `agent-profile.spec.ts` expects the dialog to open with focus on the half-price button.

## Decisions
- The founder decided on Nov 25, 2026, relayed by the coordinating session. These are its words, not the founder's
  own: "option A. The $1.00 target applies to the half-price (batch) path, measured at $0.75. Run now stays available
  as the faster, dearer choice (about $1.55, Estimate). The default (D11) is 'within a day at half price' on every
  plan. Both prices are shown before the run."
- The api's `training.run` input still defaults to `mode: "now"` when a caller sends none. The dialog always sends a
  mode, and a retry of a failed run reruns it now. The half-price timeout message tells the founder to "Run it now,
  or try again", so a retry that runs now keeps that promise.
- The Training tab's progress ring still assumes a run of a few minutes. For a half-price run it can show near
  complete for hours. That is noted here and left for a later change.

## Not done
- The launch-gate freeze on main: this waits as a draft pull request until the coordinating session gives the
  all-clear.
- Neither `agent-profile.spec.ts` nor the live eval was run in this session. CI runs the spec, and the coordinating
  session dispatches the eval.
