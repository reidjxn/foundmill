---
date: 2026-11-25
branch: claude/launch-s28-gate-round10
title: Launch gate runs 45639102820 and 45641352552 - a refused block is not a block; the inventory gains security_engineer
areas: [evals, docs]
supersedes: []
---
## What changed
- Read run 45639102820 (6548b59). Pass 1 passed all 56. Pass 2 passed 51 of 56: the Anthropic account's credit ran out at `packaging_design.cup_sleeve`, which stopped 4 sessions and the 5 utility golden tasks.
- Read run 45641352552 (e89f119). The account was empty from its first model call: only `isolation.refused_tools`, which calls no model, passed. Neither run is a gate result.
- The one failure that was not billing was `chief_of_staff.plans_the_week` in 45639102820's pass 2. The Chief of Staff tried `block_task` on two of the tasks it had just created, so that they would wait for the founder. The platform refused ("only the assigned agent puts a task on hold"), and the agent messaged the two assignees instead. Its own task ended done with its plan.
- The check counted any `block_task` whose call went through, even one the platform refused. It now counts only a block that took effect (no `ok: false`), like every other tool check in the file.
- `docs/holistic-plan/audits/agents-end-to-end.md` gains the `security_engineer` row (49 templates) with its case.

## Decisions
### A check misread, not a product cause
The platform's refusal was right: a lead holds a teammate's task through the task's own dependencies, not by blocking it. The agent did the honest thing and ended done. No product change.

## Not done
- A draft PR, held for the coordinating session to merge with S22's golden fixes and run the gate once.
