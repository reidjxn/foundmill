---
date: 2026-11-24
branch: claude/launch-s28-gate-trail
title: Launch gate run 45394597522 - stopped by the Anthropic account's credit balance, and a failing case now logs its tool calls
areas: [evals]
supersedes: []
---
## What changed
- Read the gate's pass 1, run 45394597522. 32 of the 33 sessions that reached the model passed.
- About $4.19 into the pass, Anthropic refused every call: "the account's credit balance is too low (400)". That stopped 21 sessions and all 5 utility golden tasks, so pass 2 did not run.
- The one real failure is `product_lead.revision_saves_report` (WP-05 T23, from #401). The session ended without a report or `complete_task`, and the log could not say why.
- A failing case's log line, in the gate (`agents-e2e.eval.test.ts`) and in the nightly outcome evals (`sessions.eval.test.ts`), now carries the session's tool calls in order (`connector:tool/status/policy`) next to the start of its report.

## Decisions
### Billing is the founder's, not a code fix
The refusal comes from the repository's Anthropic account, not from a plan or a budget in the product. Nothing in code can lift it. The gate is rerun once the account has credit.

## Not done
- The root cause of `product_lead.revision_saves_report` waits for a run that logs its tool calls.
