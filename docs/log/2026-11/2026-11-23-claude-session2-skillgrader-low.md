---
date: 2026-11-23
branch: claude/skillgrader-low
title: The skill grader runs at low effort
areas: [models]
supersedes: []
---
## What changed
- `skillGrader` in `packages/models/src/routing.ts` goes from `medium` to `low` effort, still on Opus. `routing.test.ts` pins it.

## Decisions
- **Evidence:** the live grader-agreement run 45221162185 (`evals-models-live.yml`, Nov 23, 2026, after #376), graded against Opus at medium on thirty answers: Opus at low agreed on pass or fail for 29 of 30 with a mean score gap of 0.002.
  Sonnet at low agreed on 26 (gap 0.061) and Haiku 5.5 at low on 24 (gap 0.064), so neither replaces Opus. The bar for Opus at low was 24 of 30 and a gap of at most 0.1.
- **Why not a cheaper model:** the grader stays on Opus because Sonnet and Haiku at low are below the 27 of 30 bar.
- The judge in the evals stays Opus at medium, so moving the product's grader does not move the yardstick.

## Not done
- Nothing else moves: no other route changes level on this evidence.
