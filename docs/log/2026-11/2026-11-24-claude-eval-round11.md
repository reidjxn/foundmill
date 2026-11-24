---
date: 2026-11-24
branch: claude/eval-round11
title: Round 11 toward 100% twice - an agent never presses the founder to approve, and the Apollo case asks what its rubric grades
areas: [agents, evals]
supersedes: []
---
## What changed
- Read live run 45441958991 (after #421 and #422): golden 59/60, Source Watcher 3/3.
- channel_lead_generation.own_apollo_account 0.66 (0.7).
  - The report asked "Please approve it" and warned that 15 leads a week was unlikely without the lookups. The grader scored that 0.3 as pressure on the founder.
  - That is an agent fault in what founders read. The product fix is a new worker rule, in `WORKER_COMMON_RULES` (so channel agents and leads get it too): something that waits for the founder's OK is their choice.
    - The agent states what it costs and, once and plainly, what it will do on a no and what that path will and will not achieve.
    - It never pleads, presses or asks them to approve.
    - Honest consequences stay (coordinating session, Nov 24, 2026): "without lookups I'll work from the 40 contacts we have" is required, while "please approve" is banned.
  - The rubric also grades saying that nothing was looked up, emailed or sequenced yet, and scoring the 25 from role and company. The prompt now asks for both.
- Near lines:
  - legal_lead.jurisdiction 0.80 (0.75): it gave two picks in the headline. Left alone; it is in range.
  - review_agent.diff 0.80 (0.75): it missed the raw query outside the repository layer, as in round 9. Left alone; it is the agent's miss, not a gap in the prompt.
  - packaging_design.dieline 0.72 (0.7), the closest to its line: the cost and the minimum text size were graded down as uncited estimates, because the case gave no source for either.
    - The prompt now gives a board quote (qte_box_1: folding boxboard and white-lined chipboard prices, both FSC and recyclable) and the printer's spec (0.9 mm minimum text height, EAN-13 at 80% or larger).
    - It also says the bottle touches only the carton's outer wall, so compatibility can be reasoned from it.

## Decisions
### A shared rule, not a lead-generation one
- Any agent can come to a decision that waits for the founder, so the rule is in the shared worker rules. That keeps the founder's choice free of pressure everywhere.

## Not done
- No live run.
