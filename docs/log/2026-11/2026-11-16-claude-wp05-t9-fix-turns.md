---
date: 2026-11-16
branch: claude/wp05-t9-fix-turns
title: A failing test goes back to the author, twice, before the session ends (WP-05 T9)
areas: [orchestrator, db, evals]
supersedes: []
---
## What changed
- A live code session runs its acceptance tests at the agent's turn end (`acceptanceAtTurnEnd` in
  `apps/orchestrator/src/activities/session.ts`), after the design check, not only after the SDK ends. A run that fails
  on the agent's code goes back to it with `acceptanceFixTurn`: the command, the counts and the last 4,000 characters of
  the output. At most `ACCEPTANCE_FIX_TURNS = 2` fix turns; the run after the last one is the verdict.
- The block that judged the work (adopt the pushed branch, `nothingWritten`, the changed scope, the run) is now
  `judgeWork`, shared by the turn end and the end of the session. After the SDK ends the last judgment is reused when
  the workspace, the agent's pushes and its block are unchanged; otherwise the work is judged there as before.
- `AcceptanceVerdict` gains `testsRun` and `status` (`passed`, `failed`, `not_verified`). `not_verified` is a run that
  exited 0 and ran no test; the session notes "The acceptance command finished without running any test, so no
  automatic check covers this change."
- A live session's progress ring starts at 0 tests, not at the number of acceptance criteria (`prepareSession`).
- `lastAttemptNote` replaces `latestHandBack`: the latest `task.blocked` detail for any reason, unless the task
  completed since. A retried task's prompt carries it as `## Last attempt`, framed as a record, not instructions. A
  merge hand-back (`needs_update`) keeps `## Why this task is back` and still starts from the default branch.
- The release approval reads "No automatic check covers this change." where it read "There was nothing in it to check."
  (`packages/db/src/approvals.ts`).
- Eval case `backend_engineer.fixes_failing_test` (`evals/src/sessions/cases.ts`): a sales tax setting of 0.8 where the
  test expects 0.08. The harness gains code cases: a codebase saved on the task, a fixture sandbox that reads the copied
  files and answers the test command (it runs nothing), script steps that write files and end turns, and the turns,
  test runs and tested files in the observation. Mock tests only; the live run was not made here.

## Decisions
- Step 1 on main: (a) confirmed, a failing run ended `blocked` with no further turn. (b) confirmed: a task with two
  criteria whose run exited 0 with no test started at 2 tests, read 0 of 2, and was booked `done` with no merge and
  `landed: null`, even with a push-enabled repository. The work stayed on its branch.
- Two fix turns means three runs, not two. The spec says the turn-end check runs "at most 2 times" and also that the
  test goes back "twice"; only three runs give two fix turns that are each checked. The third failing run in a row is
  also the loop detector's (its signature has no failure names, so the counts do not break the streak). The session then
  ends `blocked` with the output, as before, not `failed`: the agent's health does not change.
- No fix turn for a run that never started (no sandbox, workspace not copied, install failed, network not closed):
  `exitCode` is null and the agent cannot fix it.
- A fix turn is not sent while paused, ending or waiting on an approval, like the design check's.
- The pushed branch is brought down again only for pushes after the last time, and only when no local file changed.
- Found by the ring change: a code session that changed documentation only, on a push-enabled repository, was booked
  `done` with no merge for the same reason as (b). It now waits in review for its merge with no test count. The test
  that pinned "done" now says so.
- `progress.ts` is unchanged: the ring start lives in `prepareSession`, and `max(state, total)` holds once it starts
  at 0.

## Not done
- The live run of `backend_engineer.fixes_failing_test` and its cost; to run after merge.
- A run whose output names no count (for example `node --test`'s "# pass 1") reads as `not_verified` when it exits 0.
  That is honest (nothing says what ran) but reads no count for a suite that did run.
