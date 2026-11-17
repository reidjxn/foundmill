---
date: 2026-11-16
branch: claude/wp05-t15-cap-floor
title: A capped night gets one session it can afford
areas: [orchestrator]
supersedes: []
---
## What changed
WP-05 T15 (AR-06, the floor only), the last step of the session.ts chain. The overnight round's 15 cents used to be
split across every free slot: four sessions with 3, 4, 4 and 4 cents, none able to finish anything. It now starts one
session with all 15.

- `MIN_SESSION_CAP_MINOR = 10` (US cents, an Estimate) in `apps/orchestrator/src/cycle-contract.ts`.
- `businessCycle`, behind `patched("cycle-cap-floor")` (`CYCLE_CAP_FLOOR_PATCH`): a capped cycle runs
  `capSlots(cap, maxConcurrent) = max(1, min(maxConcurrent, floor(cap / MIN_SESSION_CAP_MINOR)))` sessions at a time,
  and each session's share is split over those slots, not over every free one. An uncapped cycle never calls the patch
  and is unchanged.
- `runLiveSession`: a session whose `spendCapMinor` is under the floor ends `blocked` / `budget` before any SDK or model
  call. The founder reads `UNDER_FLOOR_SUMMARY` (`activities/session-budget.ts`): "Paused: what was left of Autopilot's
  own spend for today (an Estimate) was too little to start this task, so nothing was spent. The task carries on in the
  next round, or raise Autopilot's own limit in Settings › What the team can do."
- Tests: "a capped cycle under the floor runs one session with the whole cap" and "a capped cycle runs as many
  sessions at a time as its cap pays for at the floor" (`businessCycle.test.ts`, both failed on `main`: shares of 5 and
  three at a time); the first also replays its own new history. `businessCycle.replay.test.ts` replays
  `fixtures/legacy-cycle-capped.json`, recorded at 48d649fa on the time-skipping test server with stub activities (a
  15-cent cap, four free slots, children started with 3, 4, 4 and 4). `session-live.test.ts`: a share of 9 cents is
  blocked with no SDK call; a share of 10 starts with a $0.10 budget.

## Decisions
- The slots are counted from what the cycle may really spend at its start, the smaller of the cap and the credits
  left, not the cap alone as the spec writes it. With fewer credits than the cap, the cap is not what pays.
- The floor check in `runLiveSession` sits right after the existing `budget.remainingMinor <= 0` refusal, so used-up
  credits, a wage cap or a model budget keep their own, more useful words; both happen before any model call.
- The cycle still starts a second session from what the first left behind (15 less its cost), as the spec asks; if
  that is under the floor, `runLiveSession` blocks it before spending anything. Not skipping it in the cycle keeps the
  change to what T15 names.
- `followUpStarts` still asks for up to `maxConcurrent` tasks: they wait in `pending` until a slot frees, so the limit
  changes nothing a founder sees and stays out of the patch.
- D7 (founder, Nov 16: keep $0.15, run every third night) is WP-09 T12's to build. Nothing here touches the cadence or
  `OVERNIGHT_SHIFT`; the floor's value stays an Estimate until T12 sets it from the cost report.

## Not done
- WP-09 T12: the every-third-night cadence and the measured value of the floor.
- "a session that cost more than its reserve ends the dispatching" in `businessCycle.test.ts` is timing-dependent (three
  sessions sleep 100 ms each and the result depends on which completion the cycle sees first). An uncapped cycle never
  reaches the new code, but on this loaded machine it failed in 3 of 6 full runs of the file on this branch and 0 of 3
  with main's workflow; it passed alone and in the full orchestrator run (811 of 811). The test is unchanged; if CI
  shows it flaky, give its task-1 session a longer sleep than the others.

## Checks
- With the patch made unconditional, `legacy-cycle-capped` fails to replay with a non-determinism error (checked once
  by hand), so the fixture proves the guard.
