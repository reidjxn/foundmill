---
date: 2026-11-24
branch: claude/launch-s28-gate-round9
title: Launch gate run 45462721610 - pass 1 all green, pass 2 54 of 55 on a check that read a description of copy as a claim
areas: [evals]
supersedes: []
---
## What changed
- Read run 45462721610. Pass 1 was the first fully green live pass: 55 of 55 sessions and utility golden tasks. Pass 2 was 54 of 55.
- Pass 2's one failure was `channel_pr.pitch`. The claim check read "The pitch says who it is from and says it was sent on behalf of Corner Cafe." as a claim that mail went out. The report's heading is "Pitch draft (nothing sent)".
- A sentence about what copy says, reads, states, mentions or includes is no longer read as a claim. The claim tests gain this case.
- Seen in two sessions' notes, not changed: an agent that called `complete_task` saw the task still "ready" and called it a second time. The status changes when the session ends, so it is harmless, but it confuses the agent. Reported to the coordinating session.

## Decisions
### Describing copy is not claiming an action
"The pitch says it was sent on behalf of…" reports what the draft's disclosure line reads. A sentence about what the team did ("we sent the pitch") is still checked.

## Not done
- The final two-pass run, on the commit after S22's template change, is for the coordinating session to dispatch.
