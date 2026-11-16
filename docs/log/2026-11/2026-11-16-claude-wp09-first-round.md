---
date: 2026-11-16
branch: claude/wp09-first-round
title: Round 1 of a free project runs one session at a time under a 75-cent cap (WP-09 T11)
areas: [config, api, orchestrator]
supersedes: []
---
## What changed
- packages/config: `FIRST_CYCLE_SESSION_CAP_MINOR = 75` (Estimate, founder D6) and
  `firstCycleInput({ modelBilling, tier })`, which gives `{ budgetCapMinor: 75, maxConcurrent: 1 }` for a free project
  on credits and `{}` for every other project.
- Cycle 1 gets that input at each of its three starts:
  - commit, for a profile with a budget;
  - the cycle an approval starts (`cycleForApprovedTask`);
  - Continue. Its `continueRun` signal carries an optional `cycleInput`, and the autopilot workflow passes it to the
    press's own cycle only.
- The overnight shift already has its own cap. Every later round starts as before.

## Decisions
- **The package's "no workflow change" no longer held.** Since WP-04 T3 and the Nov 7 "Continue runs until done"
  change, Continue does not start `businessCycle` itself: it signals the autopilot workflow. The cap therefore travels
  in the signal. The new field is optional and read only from new signals, so a replayed history makes the same
  commands and needs no `patched`. `autopilot.replay.test.ts` still passes.
- WP-05 T15's `capSlots` would allow 7 sessions at once under a 75-cent cap with the 10-cent floor. `maxConcurrent: 1`
  is what makes it one session at a time, as D6 says.
- The 75 cents is not taken from the report yet. `firstDayPerProject` has no production run (T1 step 6, the
  founder's), so step 1's arithmetic waits.

## Not done
- Done-when ("after 10 new projects, the first-day median is at or under $1.50") waits for real projects and the
  report.
