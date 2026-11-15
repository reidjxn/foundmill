---
date: 2026-11-15
branch: claude/wp02-t4-mock-cleanup
title: Remove fabricated results from real projects, and guard the generators
areas: [orchestrator, db, shared]
supersedes: []
---
## What changed
A nightly job, `mock-results-cleanup` (03:30 UTC, also run at boot), counts or removes the generated results left on
projects that are not samples: leads with an `.example` address and a channel as source, `channel_metrics` rows with
`source = 'estimate'`, `mock` integration rows, campaigns left `live` on a channel the product sends for, and their
open launch approvals. `MOCK_RESULTS_CLEANUP` (orchestrator, default `report`) picks the mode: `report` logs
`{ platformReport: "mock_results", …counts }` and writes nothing; `apply` removes them per business in one
transaction (`repos.mockResults.find` / `remove`), records each expired approval with T1's helper, and writes one audit
row (`data_fix.mock_results_removed`, counts only) and one note from the Chief of Staff, "We removed sample figures from
your project". A second run finds nothing and writes nothing.
`assertMockResultsAllowed` (packages/shared) is the first line of `recordMockLeads`, now a module function, and runs
right before the estimated `upsertMetric`, so a second caller cannot skip the call site's check.

## Decisions
- The job does nothing in development and test, where any project may hold simulated results; only staging and
  production are cleaned.
- Leads are archived and their open `lead` roles ended, never deleted: their `lead.created` events keep pointing at
  them. Mock integrations go through the Disconnect path (`repos.integrations.archive`); a mock row has no credential.
- The note is not deduplicated with a key: a second `apply` finds zero rows and writes nothing, so it stays one note.
- Only committed businesses are covered (`listForSchedules`): an uncommitted project never ran an engine.

## Not done
- Step 4 needs the founder: after deploy, read the logged counts, show them, and on a yes set
  `MOCK_RESULTS_CLEANUP=apply` for one run, then back to `report`, and record it in docs/DEPLOY.md §6.
- Step 5 (remove the schedule and the variable a week after the nightly numbers show zero) is a later PR.
