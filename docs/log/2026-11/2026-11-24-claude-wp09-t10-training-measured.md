---
date: 2026-11-24
branch: claude/wp09-t10-training-cost
title: The first live three-skill training check, measured (WP-09 T10 step 4)
areas: [models, evals]
supersedes: []
---
## Measured
Run 45428368258 of `evals-training-live.yml`, Nov 24, 2026. One agent on Sonnet checked three skills (api_design,
data_modelling, testing), 36 tests, with the grader on Opus at low effort. Costs are at list price, before the credit
markup.

| Path | Cost | Per test | Estimate before this change |
| --- | --- | --- | --- |
| Run now | $1.53 (152.9 cents) | 4.25 cents | $1.37 |
| Within a day (batch) | $0.75 (75.1 cents) | 2.09 cents | $0.69 |

The batch finished inside the run, in about 14 minutes. The run now is over WP-09's Done-when item 4 cap of $1.00, so
the eval failed on that assertion. The cap was not raised.

## What changed
- `REFERENCE_TEST_USAGE` and `REFERENCE_GRADE_USAGE` (packages/models `training-estimate.ts`) are 12% higher. The
  Estimate for that check is now $1.54 run now and $0.77 in a batch, so it is no longer below the measured cost.
  `training-estimate.test.ts` pins both figures.
- The live eval now prints each route's calls, input, output, cache write and cache read tokens and cost for both
  paths, so the next run shows where the spend goes.

## Decisions
Where the spend goes, and why it is not cut here:
- Repeated context is small. In mock mode the candidate's system prompt is about 6.5k characters (about 1.6k tokens),
  cached on block 0 since T9, and the grader's prompt is about 230 characters. Most of the cost is output, thinking
  included, on Sonnet at high effort for the candidate and Opus at low for the grader. By the reference figures the
  grader is about 47% of each test. That split is an Estimate until the instrumented eval runs.
- A cheaper grader would make training worse. The Nov 22 agreement run (45028669051) measured Haiku at low at 22 of 30
  and Sonnet at low at 24 of 30, both under the bar of 27. Even Sonnet would leave the check at about $1.15
  (Estimate).
- A lower effort for the candidate, or fewer tests per skill, would measure the agent less faithfully, or with more
  noise.
- The batch path does the same check for $0.75.

## Not done
- The run now is still over $1.00. Whether the cap applies to the run now, to the batch, or rises is a D10 question
  for the founder.
