---
date: 2026-11-15
branch: claude/wp05-t5-planner-context
title: The Planner sees the specification's text, the team it plans for, and whether code can land
areas: [agents, orchestrator, api, db, models, evals]
supersedes: []
---
## What changed
WP-05 T5 (A4-05; AR-05 part 3; A4-01 step 3; founder decision D3). The Planner used to get the goal, the roadmap
item and only the names of the specification's sections, never their text, the team or whether code could go live.
- `packages/agents` `prompts/planner.ts`: `buildPlannerRequest` (goal, roadmap item, each section's text cut to
  `PLANNER_SPEC_TEXT_BUDGET` = 6,000 characters in total (Estimate), `destination`, `worker_types`);
  `plannerSpecSections` (blocks joined per section with `docText`), `plannerDestination` (`github` only with a chosen
  repository that pushing is on for, else `none`), `plannerWorkerTypes` (the team's agent types, background helpers
  left out). `PLANNER_SYSTEM_PROMPT` gains the spec's sentence as `PLANNER_NO_DESTINATION_RULE`.
- `apps/api` `planTaskGraph` and `apps/orchestrator` `planRoadmap` both build their message with it.
- `packages/db` `writePlannedGraph` keeps test expectations after the criteria as "Test: ..." (jsonb, no migration).
- `packages/models` mock planner follows the rule: with `destination: "none"` it plans the scope task, any task of
  another kind and a "Write the build plan" task whose goal says building starts once the project has a place to
  publish; no code task.
- `evals/src/planner.ts`: two fixtures (no destination; a repository), a rubric, the mock run in the unit suite and a
  live suite (`planner.eval.test.ts`) that skips without a key.

## Decisions
- Sections are grouped by name before the budget is applied (the old message repeated a section's name per block).
  The budget cuts later sections first; every section keeps its name, with empty text once the budget is spent.
- A repository chosen with pushing off counts as `none`, as the spec's `writeEnabled` says: code could not land there.
- `worker_types` leaves out the background helpers (`isBackgroundHelper`), which never take tasks (`pickAssignee`).
- The rule is in the prompt only; no code drops a code task the model plans anyway. The spec asks for the prompt
  sentence, and the eval is the check. A code guard would need a fallback for a plan that is all code.
- The mock planner was taught the rule, so mock-mode founders get what the prompt promises and the eval's mock run
  passes. The orchestrator's fixture business has no repository, so its existing roadmap test now plans without code
  (still at least two tasks and one edge).
- The base `plannerPrompt` template (version 1, `{spec_excerpt}`) is not used by either caller and is left alone.

## Not done
- The live run of `planner.eval.test.ts` (needs the key); to record in the pull request.
- Under RLS a collaborator cannot read `integrations` (0094), so a plan a collaborator starts reads `destination:
  "none"` even with a repository. `signoff.ts` and `today.ts` read it the same way; left as it is.
- `destination: "site"` is WP-07's.
