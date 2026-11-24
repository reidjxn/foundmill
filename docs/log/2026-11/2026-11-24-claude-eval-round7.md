---
date: 2026-11-24
branch: claude/eval-round7
title: Round 7 toward 100% twice - the two cases that flipped in round 6
areas: [evals]
supersedes: []
---
## What changed
- Read live run 45414444026 (after #406): golden 58/60, Source Watcher 3/3.
  - Both of round 5's failures now pass (own_buffer_account, and hosted_page's "isn't connected").
  - Two cases that passed in round 5 flipped.
- channel_seo.hosted_page 0.00. The reply proposed the pitch and the about text and said "the founders must approve the edit". The check wanted the word "wait".
  - The check now takes "wait" or "approv" (`any`). Both say the proposal is pending the founders, and that is what the case measures.
  - The rubric still grades that it waits and that nothing changed.
- logistics.freight 0.60. The rubric grades a sourced view on UK duty and VAT, but the prompt gave no tariff source, so the agent rightly said it had none.
  - The prompt now gives a tariff lookup, trf_3304: UK Global Tariff 3304.99.00, duty 0%; import VAT 20%, reclaimable through postponed VAT accounting. trf_3304 is a source id.
  - The rubric also grades everything unconfirmed labeled Estimate, and the prompt said only "label estimates". It now says to label every figure or claim that is not in a fixture Estimate.

## Decisions
### One check widened, with the reason
- "the founders must approve" and "waits for the founders" state the same fact. Matching one verb made the case flip on wording.
- Neither term would pass a reply that claims the edit was made. The rubric line and the 0.7 threshold are unchanged.

## Not done
- No live run.
- The run's grader-agreement step said to move the skill grader to Sonnet at low effort. That decision is not in this change.
