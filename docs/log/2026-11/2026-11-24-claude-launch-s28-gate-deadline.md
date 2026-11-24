---
date: 2026-11-24
branch: claude/launch-s28-gate-deadline
title: The report turn names save_report, and a gate session is cancelled at ten minutes with its trail on record
areas: [orchestrator, evals]
supersedes: []
---
## What changed
- `session.ts` `REPORT_TURN`: the one extra turn an agent gets when it ends without reporting now asks it to save what it found or made with `save_report`, put what only the founder can give under "## Needs you", then call `complete_task`. The old line named only `complete_task` and `block_task`, though under WP-05 T22 a saved report is what ends the task done.
- In run 45408711835, `product_lead.revision_saves_report` read the product notes and its task, then answered in prose with no tool call and ended blocked. The session-live test now checks the turn by its constant.
- `evals/src/sessions/harness.ts`: each session runs inside a mock Temporal activity and is cancelled at `CASE_DEADLINE_MS` (10 minutes), as Temporal cancels an activity.
- In run 45408711835, `channel_lead_generation.apollo_connected` ran into the test runner's 15 minutes and left no result or trail. A case that runs long now ends `stopped` with its tool calls and notes in the log, and a hung session can no longer run on into the next case.
- `@temporalio/testing` joins the evals' dev dependencies (the catalog version the orchestrator uses).

## Decisions
### The turn, not the case
The fixture's specification is nearly empty, so "nothing to revise" was a fair reading. Saying so in a saved report is still the right end, and the turn that asks for a report now names the tool that makes one. If the agent still answers in prose, the case's notes will show it.
### Cancel, don't extend
A longer test timeout would only wait longer. Cancelling through the activity's signal is how production ends a session, so the eval sees the product's own stopped path and records it.

## Not done
- Why the Apollo session ran long: the next run's trail will show it.
