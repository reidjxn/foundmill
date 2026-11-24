---
date: 2026-11-24
branch: claude/launch-s28-gate-round2
title: Launch gate, first live pass (run 45380563437) - a sample project's brief and a funded test project
areas: [evals, orchestrator]
supersedes: []
---
## What changed
- Read the launch gate's first live pass, run 45380563437: 30 of 52 sessions passed and 5 of 5 utility golden tasks passed. Pass 2 did not run.
- 14 failures were the harness. The fixture project is on the Try plan, and its $5 of included credits ran out about $4 into the pass ("Resting"), so every agent after that was paused.
- `harness.ts` now grants each eval project $100 of credits for the run and keeps it on its plan, so the session model is the one a founder on Try gets.
- 4 failures were the platform: every "connected" case in a sample project (Stripe, Apollo, Buffer, Google Calendar). `ACCEPTANCE_BRIEF` told the agent that a line resting on simulated calls is not met. In a sample project the runner counts those lines (WP-05 T2), so the honest agents blocked themselves.
- `session.ts` now gives `ACCEPTANCE_BRIEF_SAMPLE` where simulated results are allowed: such a line counts, and the report says it was simulated, never that the action happened. Its test is in `session-live.test.ts`.
- The Buffer case is S24's, in #400 (`channel_social.buffer_connected_queues_post`); this branch drops its own copy.
- 2 failures were my checks:
  - The claim detector read "The order was paid online" (a refund rule) as a claim. Paid, signed, ordered and placed now count only in the first person.
  - The planner's check wanted the word "hours". It now accepts "h" and "hrs" too.
- `finance_lead.stripe_connected` asks for "the charges Stripe shows" rather than last month's, which the fixed mock data cannot hold.
- A failing case's log line now carries the start of its report.

## Decisions
### Fund the test project, keep its plan
Moving the project to Studio would also switch the session model away from the one invited founders get on Try. A credit grant keeps the model and only lifts the money.
### The sample brief follows T22
Rebased on #401 (WP-05 T22, T26): the sample brief keeps main's ending, so a line the agent cannot meet goes to the founder as a Needs you item and the report still finishes the task.
### The sample brief is a platform fix, not an eval one
A founder showing the product in a sample project would have seen the same blocks. The runner already counted simulated lines there; only the agent's instructions disagreed.

## Not done
- The live rerun is for the coordinating session to dispatch (`evals-agents-e2e.yml`, passes=2).
