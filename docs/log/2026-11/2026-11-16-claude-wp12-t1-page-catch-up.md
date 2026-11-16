---
date: 2026-11-16
branch: claude/wp12-t1-page-catch-up
title: A nightly page catch-up for projects older than public pages
areas: [db, orchestrator, api, shared, docs]
supersedes: []
---
## What changed
WP-12 T1. The new schedule `page-catch-up` (3:30 AM UTC) runs `draftMissingProjectPages`: for up to 25 real, committed, running projects with no `project_pages` row it runs the same page step as a first session (a model draft, else the starter) and writes an unpublished page and the Product lead's note. Nothing is published. `repos.pages.listMissingTeamDraft` picks the projects.
The note's decision carries `catch_up: true`. The notify pass emails about it like any waiting decision; `PAGE_CATCH_UP_EMAIL=off` on the api leaves it out. Built with the default off, and turned to on after the founder's yes to D6 (Nov 16).
Tests: `page-catch-up.test.ts`, `pages-missing-draft.test.ts`, and a case in `notify-email-pass.test.ts`.

## Decisions
### The email switch defaults on (D6: yes)
D6 (may the note email about 10 founders who have not been back) was answered yes. The hourly email pass sends about the note unless `PAGE_CATCH_UP_EMAIL=off`. The marker is on the note, so a first-session page note still emails as before.
### A marker on the decision, not a new column
`catch_up` is an optional key in the decision JSON. No migration. Turning the switch on also covers notes written earlier, because the pass reads the marker at send time.
### The one-hour floor is a constant in the activity
`PAGE_CATCH_UP_MIN_AGE_MS`: a project committed less than an hour ago is drafting its own page.
### Stacked on T0/T2
The test uses `soloGuardViolations` from the T0/T2 branch, so this branch is based on it.

## Not done
Step 5 (read the Done-when query the morning after deploy and record the count) is for the Desktop session. Done-when 1 reaches 0 only after the job has run enough nights: 25 a night covers the 13 in one run.
