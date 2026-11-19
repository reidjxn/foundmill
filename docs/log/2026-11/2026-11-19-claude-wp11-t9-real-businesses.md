---
date: 2026-11-19
branch: claude/lucid-euler-msx3pg
title: real_businesses: sample projects stay out of every cross-project number
areas: [db, api]
supersedes: []
---
## What changed
**WP-11 T9 (A8-06).**
- `0145_real_businesses`: the view `real_businesses(id, is_house)`, every project that is not a sample; `is_house` is true for `HOUSE_BUSINESS_ID` alone. Service role only; anon and authenticated are refused. Mirrored as `realBusinesses` in `schema/accounts.ts`.
- `presence.retentionReport` joins the view and no longer filters `is_demo` itself (the house project stays in it, as before).
- `demo-isolation.test.ts` exports `CROSS_BUSINESS_REPORTS` and compares each listed report with and without a demo project; it also checks the view's rows, `is_house` and the refusal for client roles. `packages/db/CLAUDE.md` carries the rule.
- `rollDemoBusinesses` logs `ms` on its "sample businesses rolled forward with the calendar" line; `sample-numbers.test.ts` reads it.

## Decisions
### The existing demo-isolation test was extended, not recreated
The plan says to create `repos/demo-isolation.test.ts`. `src/__tests__/demo-isolation.test.ts` already exists (WP-02 T10) with a metrics fixture that builds the database twice, with and without the demo. The listed reports run against that fixture instead of a second one.
### The list holds the two reports that exist today
`CROSS_BUSINESS_REPORTS` has `metrics.snapshot` and `presence.retentionReport`. `metrics.ts` and `cost-report.ts` still filter `is_demo` in their own SQL; WP-02 joins the view and adds the cost report to the list, in whichever of the two packages merges second (as the plan says). The view test and the with/without comparison already cover their current result.
### Other readers of `is_demo` stay for now
`day-one-notes.toClear` (reads every project) and `account-portability` (one account's projects) still filter `is_demo` by hand; neither feeds a platform number, so they are left and named here. They join the view when next touched. `ms` times `rollDemoForward` only, not the daily-rows refresh after it, and is logged only when something moved.
### Migration number
0145 is the next free number after main's 0144 and every open branch (rebased on Nov 20; PR #238 had not landed).

## Not done
- Step 3's figures (three days of roll durations in docs/DEPLOY.md §6) need three days in production; the Desktop session or the founder reads them.
- Step 4 (read-only SQL for the house project's id on production) needs F3; the statement is in WP-11 T9 step 4.
