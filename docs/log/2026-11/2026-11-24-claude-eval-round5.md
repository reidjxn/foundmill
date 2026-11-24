---
date: 2026-11-24
branch: claude/eval-round5
title: Round 5 toward 100% twice - a reply over the task's word limit is rewritten once, and the dieline facts
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45394632453 (after #402): golden 56/60, Source Watcher 3/3.
- Three of the four failures were length, after five rounds of rules and layout guidance: lead_generation.batch (337 words for 320), follower_update (236 for 220) and seo.hosted_page (248 for 220).
  - Models do not count their own words, so a rule alone does not hold.
  - The coordinating session asked for a hard length check before the answer goes out (Nov 24, 2026).
- `packages/agents` `skills/checks.ts`:
  - `statedWordLimit(task)` reads the word limit a task gives for the whole reply. "Under 300 words." and "in under 150 words:" count. A limit on one part ("a pitch under 150 words that", "a quote under 25 words)") does not.
  - `lengthRetryMessage(words, limit)` is the one follow-up turn.
  - This is the pattern the showcase script already uses ("Write it again in fewer words").
- `evals/src/harness.ts`: a text golden reply over its task's stated limit goes back once to be rewritten, and the rewrite is what is checked and graded. Its cost is counted.
- `follower_update` states a whole-reply limit, "under 200 words"; its 80-140 words applies to the body only.
- `packaging_design.dieline` 0.66: the prompt now gives the bottle's materials (PP body, PP and steel pump), which compatibility is reasoned from. It asks for minimum text size and the barcode in the handoff checklist, as its rubric grades.

## Decisions
### A rewrite, not a cut
- A platform-side trim could drop a required part or a record id. One rewrite turn keeps the agent in charge of what stays.
- Every stated whole-reply limit sits below its case's word_count maximum, so the check is unchanged and still authoritative.
### Production
- The same two functions are for the session runtime's founder-facing reports. Wiring them into `apps/orchestrator` is the follow-up; this change uses them in the eval harness only.

## Not done
- The runtime wiring above. No live run.
