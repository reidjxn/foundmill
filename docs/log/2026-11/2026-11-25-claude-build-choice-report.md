---
date: 2026-11-25
branch: claude/build-choice-report
title: The build choice's information notes are reports, so the welcome note stays
areas: [db, api, agents, e2e]
supersedes: []
---
## What changed
- The Chief of Staff's "Your idea needs no app built" note, written with the plan for an idea with no software to build, is now a `report`, not an `update`. This covers `repos.foundations.apply` and `dev.seedBuildChoice`.
- The note after "Build it with Lovable" (the link, or why Lovable was not used) is now a `report` too (`apps/api/src/services/build-choice.ts`).
- Regression tests:
  - `inbox-first-week.test.ts`: a Chief of Staff report leaves the agent's current update open.
  - `apps/api build-choice.test.ts`: the outcome note is a report, and the note-writer's earlier update stays unread.
- Comments in the golden-path, foundations and Inbox specs now say report.

## Decisions
### A report, not an update
`inbox.createItem` keeps one current update per agent (`supersedeUpdates`, Nov 7, 2026). The build choice's update therefore archived the Chief of Staff's welcome note on day one, and main went red at `golden-path.spec.ts:240` (#436). Whether it failed depended on the sample idea.
A Chief of Staff report is delivered as it is (`noteVerdict`), supersedes nothing and needs no answer. So the welcome note and the note of the day stay, and the Needs you counts do not change.

## Not done
- Nothing else changes during the launch freeze.
