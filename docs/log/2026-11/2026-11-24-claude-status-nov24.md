---
date: 2026-11-24
branch: claude/status-nov24
title: STATUS.md and the launch plan: the launch gate, #368 and the Nov 23 to 24 merges
areas: [docs]
supersedes: []
---
## What changed
- `docs/holistic-plan/LAUNCH_EVALUATION.md`: a section for the founder's launch gate of Nov 24. Every agent template passes a live end-to-end session eval, the golden suite is 59 of 59 and both Source Watcher cases pass, each in two consecutive live runs, before `SIGNUP_OPEN`.
- `docs/holistic-plan/STATUS.md`: the gate on Session 11's row; #368 recorded as merged, with the tool-scout session's two warnings (the skill library budget and a flaky follower-update test); rows for WP-05 T0 and T1, WP-06 T10, T11 and T13, and WP-11 T18; the open pull request table (#303, #372).

## Decisions
- The decision and the #368 facts are the other sessions' reports, recorded as reported. Row states come from pull request titles, not diffs.
- The "Unknown" list lost two items that merged (WP-05 T0 and T1, WP-11 T18 step 1).

## Not done
- WP-08 T6 and T12 and WP-14 T9 keep their earlier states; #372 and #303 are still open.
