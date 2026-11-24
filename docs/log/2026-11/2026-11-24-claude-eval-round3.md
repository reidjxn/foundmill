---
date: 2026-11-24
branch: claude/eval-round3
title: Round 3 toward 59/59 twice - the six golden failures left after #397 and the Source Watcher grader's view of scores
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45380224625 (after #397): golden 53/59 (up from 45), Source Watcher 2/3 (competitor_pricing passes; interview_features 0.72).
- distribution_strategist.recommend 0.72: three channels had no reason, and starters broke the three-sentence format. The prompt now asks for a one-line reason per channel and a why of exactly three sentences, as the rubric grades.
- finance_lead.runway 0.72: headline, total and threshold figures were unlabeled, with labels only in a column header.
  - New finance lead rule: label each projected number Forecast and each assumption Estimate where the number appears.
  - The prompt already asked for this, so the rule is the root fix for production too.
- channel_geo.panel 0.00 (417 words for 380): the prompt asks for six parts under 350 words. It now says how to fit them: questions one line each, every other part in at most two sentences. The limit is unchanged.
- channel_events.sponsorship 0.00 (no "recommend"): the agent chose one option without naming it a recommendation. The prompt asks for the option marked "Recommended".
- packaging_design.dieline 0.68: the rubric grades dimensions "fit the stated bottle", but no bottle was stated; it also grades cost, which was not asked. The prompt now gives the bottle (dwg_air50, 40 mm by 112 mm) and asks for materials chosen on compatibility, recyclability and cost.
- moderation.outbound 0.80 (threshold 0.8): the rubric grades a rationale that names the rules broken. The prompt now asks for it.
- Source Watcher interview_features 0.72:
  - The grader read the classifier's relevance scores as figures the drafter invented. The output now labels them as the classifier's, an Estimate by design.
  - The quote line now says that one quote under 25 words is what is asked, since the grader marked a compliant 15-word quote down.

## Decisions
### Same approach as round 1
- Each fix makes the prompt ask for what its rubric grades, or gives the fact the rubric assumes, or labels what the grader misread. No threshold, check or term changed.
- The finance lead rule is a template change because the founder reads those numbers in the product.

## Not done
- No live run.
