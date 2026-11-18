---
date: 2026-11-17
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T8 (second part), the platform suites on Haiku 5.5, and a cycle test that no longer races
areas: [evals, orchestrator, ci]
supersedes: []
---
## What changed
- **`EVAL_FREE_PLAN=1`** (`evals/src/harness.ts`, `packages/shared` env): `createEvalClient` runs every route as an account not on a paid plan does, on Haiku 5.5. The grader (`skillGrader`) keeps its own model, so the scores compare with a paid plan's run.
- **`.github/workflows/evals-free-plan.yml`**, dispatch only. It runs these suites with that switch, on the repository's Anthropic key, each step on its own so a failure shows which:
  - the injection suites (gate 100%);
  - moderation;
  - ideation, foundations, logo and second read;
  - conversation, goal proposal and the composer's Inbox notes.
- **`businessCycle.test.ts`**, "a session that cost more than its reserve ends the dispatching": the two other sessions now cost their 500 reserve instead of 5.

## Decisions
- **Founder, Nov 17, 2026** (relayed by the coordinating session at about 17:16 UTC):
  - free sessions stay on Haiku 5.5, so `FREE_SESSION_MODEL` stays `haiku`;
  - go for one run of the platform suites on Haiku 5.5, keeping the spend small and stating the total.
- **Why the run goes through a workflow:** this sandbox cannot use a Foundmill Anthropic key. The run happens in CI on the repository secret, and a dispatched workflow must be on main first, so the run follows this change's merge.
- **What the run covers:** the work package's list for the platform routes, minus the golden agent-template suite (agent work runs in sessions, measured on GLM on Nov 17) and plus the composer's notes. The suites are as written for Claude: this run measures whether they hold on Haiku 5.5.
- **The cycle test:** with the cheap sessions costing 5, the order the three sessions finished in decided the result. When the two cheap ones finished before task 1, they gave back 990, task 1's overspend left 90, and task 2 started (the failure on #286). At their reserve, any order leaves -900. With that order forced, the old costs fail and the new ones pass.

## Not done
- The run itself, and its scores and cost: after merge, in a log entry of its own.
