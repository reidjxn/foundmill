---
date: 2026-11-16
branch: claude/wp05-t10-turn-limit
title: Reaching the turn limit is a checkpoint
areas: [orchestrator, events]
supersedes: []
---
## What changed
WP-05 T10 (AR-09). A session that reaches its turn limit (the SDK's `error_max_turns`) used to end `failed`, which
marked its agent failing and sent the task into the doubling retry wait. `classifyTurnEnd` now returns it as
`blocked` with the new reason `turn_limit` ("the session reached its turn limit; the work so far is saved"), summary
"Paused at the turn limit; the task carries on in the next round." `turn_limit` is added to `TASK_BLOCKED_REASONS`
(packages/events), `SessionResult.blockedReason` and `TurnFailure.blockedReason`. The turn count stays 60.

Because the outcome is `blocked`, `finishSession` no longer marks the agent failing, the task goes to `blocked` with a
`task.blocked` event, the code workspace is saved and not pushed (`holdBack` stays "the session did not finish"), and
the next session's prompt carries the reason as T9's `## Last attempt`.

`loadDispatchFacts` (activities/brief.ts) offers a task whose latest block is `turn_limit` again at once, not after
the doubling wait, and never counts it as past its retries.

Tests: `session-live.test.ts` (the classifier case, and a full session that hits the limit: blocked, agent not
failing, workspace saved unpushed, `## Last attempt` in the next prompt) and `retry-deferral.test.ts` (five turn-limit
rounds in a row, the last one just now, are still due).

## Decisions
- The retry rule needed the new case. A `blocked` session counts in `failureStreak` like a failed one, so without it a
  long task would wait 15, 30 and 60 minutes between rounds and stop after four, which is the exhausted-retry path the
  task must avoid. The runaway bound is the task's budget: `taskSpentMinor` counts every session on the task, so a
  task that never finishes ends `budget` and takes the normal wait.
- The other places that read a block's reason need nothing: `retryDeferral` (cycle.ts) reads only `retry`, the
  tool-less parking in cycle.ts matches the detail text (which names no tool), and the composer, inbox and screens
  have no switch over the reason. `latestOpenBlock` reads any reason but `needs_update`, so `## Last attempt` works
  as it is.
- No `patched()`: the change is in activities, not in a workflow.
- The code is trusted over the spec: its line numbers were stale, and it did not name brief.ts, which the retry rule
  lives in.

## Not done
- The session's push note still reads "the session did not finish"; a turn-limit specific wording was not asked for.
- T11 (a resumed run knows what it already did) is next in the session.ts chain.
