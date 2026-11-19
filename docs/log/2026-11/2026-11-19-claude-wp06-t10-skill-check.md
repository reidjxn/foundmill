---
date: 2026-11-19
branch: claude/sharp-shannon-0a434k
title: The scoped per-agent check (WP-06 T10)
areas: [db, api, orchestrator]
supersedes: []
---
## What changed
- **Migration 0146** (`training_run_kind`): `training_runs.kind` (`training`, `model_retest` or `skill_check`, default `training`), `skill_keys text[]` and `measured_skill_key`. A model change's retest run is now written as `model_retest`. RLS is unchanged.
- **`agent.training.run` and `agent.training.estimate`** take `skillKeys` (1 to 3). The run grades only those skills, the estimate prices only those, and a key the agent does not carry is a 400. The run's affordability check (from #330) uses the same count.
- **`agent.skills.measure({ agentId, skillKey })`** queues a `skill_check` run for a library skill the agent carries. Its keys are the rated skills the skill `improves` that the agent carries (at most 3). It returns the run and its price (`estimate`: tests, arms 2, cost, labeled Estimate) and refuses, before queuing, a run the credits cannot finish (402).
- **The orchestrator** loads a `skill_check` run without a draft: the live version is the candidate. `runSkillTests` runs two arms over the same tests, with the measured skill loaded and with it taken out, and books both. The run's results store the arm without the skill as `old` and the arm with it as `new`, so a rating moves only if the skill made the difference.
- **`repos.training.decide`** accepts a `skill_check` with no candidate version: accepting writes the ratings and nothing goes live. `agent.training.promote` skips the `agent.promoted` event for it. Discarding changes nothing, as for any run.
- Tests: `agent-skill-check.test.ts` (api), a skill-check case in the orchestrator's `activities.test.ts` (both arms, two candidate answers per test, both recorded, nothing goes live, accepting needs no version), the migration list.

## Decisions
- **A third column.** The spec named two columns. The orchestrator also has to know which skill to take out, and the run's `skill_keys` are the rated skills, so `measured_skill_key` holds it. The alternative was reading it from the audit row.
- **Old and new.** Showing the without-skill arm as "old" matches what the founder asked ("what did this skill change"). The agent's current rating is not used as `old` for a check.
- **Price.** One improved skill is its tests twice, at the training price (`trainingPrice`, which includes the credit markup). The "$0.90 on Sonnet" figure in the plan is from before WP-09 T9's price table; the shown price follows the table.
- **The workflow's change is not behind `patched`.** It only passes two more values to activities that ignore them for old runs, and it adds no command.
- The migration number is the next free one after the open branches (0145); renumber on rebase if another branch lands first.
- This branch contains #330's commits, because the check needs its affordability code. Merge #330 first.

## Not done
- The button for it (WP-10 places it) and any screen for a check's result: the run appears in the existing run list and results panel.
- A `skill_check` whose measured skill is not a library skill is refused at the api only; the orchestrator trusts the run row.
- Playwright was not run; no screen changed for this task.
