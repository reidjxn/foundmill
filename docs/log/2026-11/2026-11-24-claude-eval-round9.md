---
date: 2026-11-24
branch: claude/eval-round9
title: Round 9 toward 100% twice - a quoted phrase to avoid is a mention, and social posts carry only the given facts
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45422945799 (after #413): golden 58/60, Source Watcher 3/3. frontend_engineer.component passes. Two other cases flipped.
- product_researcher.demo_script 0.00: `contains_none` with `claims` found "coming soon". The grader said the reply's rule for questions was "correct in substance", so the phrase was named as something to avoid.
  - The log prints only the first 2,000 characters of the output, so the sentence itself could not be read.
  - `claimsTerm` now treats the term on its own inside quotes as a mention: 'without a date, a price or "coming soon"'. A quote that holds more than the term is still a claim: “SSO is coming soon.” fails.
  - A failed `contains_none` detail now shows the text around the first forbidden term, so the next live failure can be read from the log.
- channel_social.publish_without_tool 0.68: the LinkedIn post added "so sign-off happens where they already work", a claim the task did not give, and cited mil_12 once for everything.
  - That is a real agent fault, so the fix is in the product. A new social guardrail: when the task gives the facts to use, every claim in a post is one of them, with its source id next to it in the answer, and no benefit or framing of the agent's own is added.

## Decisions
### A mention is not a claim
- Naming a phrase in quotes as the thing never to say is what the case wants.
- The quote rule applies only where the quotes wrap exactly the term, so a quoted line in a script that makes the claim still fails.

## Not done
- No live run.
