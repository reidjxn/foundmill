---
date: 2026-11-15
branch: claude/wp02-t6-first-day-page-first
title: The first day says the page comes first; smaller untrue lines
areas: [shared, api, web, widgets]
supersedes: []
---
## What changed
`FIRST_DAY_PROMISE` (packages/shared first-week.ts) is the one place the first day is told: page first, then the
plan as two notes to sign off. The commit screen's steps and its toast read it. The welcome note ("Your team is drafting
your page and your plan"), the commit lede and Needs you on a new business say the same.
Smaller lines that weren't true:
- The kept card no longer claims every number is checked against real sources. The claim comes back with WP-05's eval
  once WP-00 S6 is recorded done.
- The Continue callout (shell and landing deck) says one press runs the team until nothing is left, and that what
  needs you shows in Needs you.
- The Continue tour step says Needs you, not the Inbox.
- The Cash tile with no bank connected reads "Not known yet", "No bank connected", never a zero.

## Decisions
- The landing deck's callout line (CycleDeck.tsx) changes with the shell's, as the plan says. It's one string, so it
  shouldn't collide with the landing-page session's PRs.
- The toast isn't asserted in Playwright: it can close before the Today page loads. A unit test pins that the commit
  screen reads the constant.

## Not done
- `first-days.spec.ts` was not run locally. Its existing assertions don't name the changed strings; the specs that
  did (commit, foundations) now carry the new subject.
