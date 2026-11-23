---
date: 2026-11-23
branch: claude/grader-opus-low
title: The grader-agreement eval also tries Opus at low
areas: [evals, models]
supersedes: []
---
## What changed
- `evals/src/__tests__/grader-agreement.eval.test.ts` grades each of its thirty answers a fourth time, by Opus at low effort, beside the judge (Opus at medium) and the Haiku 5.5 and Sonnet candidates at low.
- Opus at low may replace Opus at medium on `skillGrader` when it agrees with the judge on pass or fail for at least 24 of 30 answers (the figure Sonnet at low reached) and the mean score differs by at most 0.1. The cheaper models keep their bar of 27 of 30.
- The verdict now reads "keep Opus at medium" when nothing qualifies.
- The workflow header (`evals-models-live.yml`) puts the run at about $4 instead of $3 (Estimate: one more Opus grading of thirty answers).

## Decisions
- **Why:** the run of Nov 22 (45028669051) measured Haiku at low (22 of 30) and Sonnet at low (24 of 30) only. Its "keep Opus and set effort low" verdict was the suite's fallback text, not a measurement, so `skillGrader` stays on Opus at medium (written down by #334) until Opus at low is measured. Coordinating session agreed on Nov 23.
- **The move itself is not in this change.** If the next run says to set low, that is one line in `routing.ts` and its pinned test, in its own pull request citing the run.

## Not done
- The run itself: the coordinating session dispatches `evals-models-live.yml` once after this merges.
