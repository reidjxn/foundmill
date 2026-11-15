---
date: 2026-11-15
branch: claude/fix-autopilot-pause-test-race
title: The Autopilot Pause test no longer races the next round
areas: [orchestrator]
supersedes: []
---
## What changed
The test "Pause ends the run: the round in progress finishes and no new one starts" (autopilot.test.ts) failed in CI
run 43753063102 with 3 cycles instead of 2. It waited for round 2's plan, then sent Pause; on a slow runner round 2
finished and round 3 started before the signal reached the workflow, and round 3 was then correctly the round in
progress. A real-time delay of 100 ms before the signal reproduces the CI failure locally (300 ms gives 5 cycles).
The test now holds round 2's `completeCycle` until `handle.signal(...)` has resolved, so Pause is in the history
while round 2 is still open. The three assertions are unchanged.

## Decisions
- The workflow is right and is not changed: it checks a Pause at the top of every round and starts nothing after it.
  The failure was only the signal arriving late, so there is no `patched()` change.
- Hold the round in progress (cycle 2's `completeCycle`), not round 3: holding round 3's plan would still record it.
- With the hold, the same injected 2 s delay passes; the file passed 5 runs in a row.

## Not done
- The businessCycle child in these tests calls `pendingMerges`, which the mocks do not register; it fails, retries and
  falls back to `[]`, filling the log with NotFound errors. Left as is.
