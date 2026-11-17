---
date: 2026-11-16
branch: claude/wp08-t1-foundations-step
title: The team drafts the positioning notes in the first foundations run (WP-08 T1, the held step)
areas: [orchestrator]
supersedes: []
---
## What changed
- `draftPositioning` in `apps/orchestrator/src/activities/foundations.ts`, run right after the page in
  `businessFoundations` behind `patched("foundations-positioning")`. A failure is swallowed, as the page's is. It writes
  the Product lead's draft of the positioning notes (or the one-line starter when the call fails) as the copy waiting
  for the founder, with one note. It asks the model nothing when the project already has a copy, so a retry writes
  nothing. Approving stays the founder's press on Product › Vision.
- The page step's context now receives the approved notes (`repos.positioning.approvedText`). That is none on a first run.
- Tests: the activity test (one draft and one note; a second run asks nothing; a failed call writes the starter) and
  the foundations replay test (the new patch marker and the activity, in order).

## Decisions
- This is the part of WP-08 T1 that #241 held back while WP-04 T5 (#239) rewrote the foundations activity. It ships on
  its own now that #239 has merged.
- The step runs before the plan (the vision). The page and the notes are both short calls, and neither may hold up the
  plan note whose approval starts the first round of work (WP-04 T5).

## Not done
- Nothing else of T1 is outstanding.
