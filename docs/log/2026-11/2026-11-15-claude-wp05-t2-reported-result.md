---
date: 2026-11-15
branch: claude/wp05-t2-reported-result
title: A task that is not code is done only when its agent reported a result on real tools
areas: [orchestrator, events]
supersedes: []
---
## What changed
WP-05 T2 (AR-03, AR-25). A live session on a task that is not code used to end `done` whenever the SDK's last turn
ended cleanly, even when the agent reported nothing or every outside call was simulated.
- `SessionRecorder` tracks `completedOwnTask` (a `complete_task` on its own task that went through, like
  `trackBlockTask`) and `outside` (results of every connector but `platform` and `quarantine`, with how many were
  simulated or `integration_not_connected`), read from the full tool result, not the 1,000-character stream copy.
- An agent that is about to end without `complete_task` or `block_task` gets one more turn: "You ended without
  reporting. Call complete_task with what you found or made, or block_task with what stopped you."
- After the SDK ends: on a real project (`mockResultsAllowed` false) a session whose outside calls were all simulated
  or not connected ends `blocked` / `not_connected`; else one with no `complete_task` ends `blocked` / `no_result`;
  else it ends done with progress 1, so `task.completed` reads `success` and the ring shows 100%.
- `no_result` and `not_connected` join `TASK_BLOCKED_REASONS` and `SessionResult.blockedReason`.
- `loadDispatchFacts`: a task whose latest `task.blocked` is `not_connected` is not retried on a timer; it waits for
  the founder's Start or Continue. The deferral reads "blocked once" instead of "blocked 1 times in a row".
- The task prompt's closing line now tells the agent to block in its first turn on a missing or unconnected tool, and
  that a session without `complete_task` or `block_task` is not counted as done.

## Decisions
- Founder-facing summaries: "Blocked: <names> not connected for this project, so nothing real was read or sent." and
  "Blocked: <agent> ended the session without reporting a result on "<title>"." Names come from the connector
  catalog's display names (falling back to the key); the reason keeps the keys ("not connected: web, ecb_rates").
- A `complete_task` without a `taskId` counts as the session's own task, the same rule as `block_task`.
- The report turn is also offered where a Resume with nothing held would close the input, the other `inputDone` site.
- No exhaustive switch over the reason existed (merge.ts, cycle.ts, the inbox test and the composer only compare
  with `needs_update` or pass the payload), so none needed a new case.
- The latest `task.blocked` per task is read the way `stopToollessTasks` reads it (the newest 300 events), not with a
  new repo function.
- The live tests' scripts that expect `done` on a research task now call `complete_task` (the `reported()` helper).

## Not done
- The golden eval `channel_email_automation.not_connected_is_not_sent` (T6) and reports (`save_report`, T3).
