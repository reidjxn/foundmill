---
date: 2026-11-16
branch: claude/wp11-demo-and-profiles
title: real_businesses for cross-project numbers; public_profiles for the service alone
areas: [db, api, ci]
supersedes: []
---
## What changed
**WP-11 T9 (A8-06) and T18 step 1 (A8-21).** Stacked on `claude/wp11-split-write-policies`. T18's other three steps are on `claude/wp11-api-ingest-hygiene`.
- `0121_real_businesses`: the view `real_businesses(id, is_house)`, every project that is not a sample. `is_house` is true for `HOUSE_BUSINESS_ID` alone. Only `service_role` may select it. Mirrored as `realBusinesses` in `schema/accounts.ts`.
- `repos.presence.retentionReport` joins the view and drops its own `is_demo` filter; the house stays in, as before.
- `repos/demo-isolation.test.ts`: `CROSS_BUSINESS_REPORTS` (the retention report, the cost report, the metric facts). Every entry gives the same answer before and after a sample with the same activity is added, and the test shows the guard is live by turning the sample real. It also checks `is_house`, and that the client roles are refused.
- `0122_public_profiles_service_only`: no client role reads `public_profiles`; `repos/social.ts` reads it on the service connection. `client-grants.test.ts` holds it; `user-scoped.test.ts` now reads the view as the service and expects the anon role to be refused.
- `rollDemoBusinesses` logs `ms` with "sample businesses rolled forward with the calendar"; `sample-numbers.test.ts` reads it.
- `scripts/ci/supabase-like.sql` adds `auth.users.last_sign_in_at`, which `PGLITE_BOOTSTRAP_SQL` already adds and Supabase has: the metric facts read it, so they failed on the real-Postgres harness.
- packages/db CLAUDE.md: a cross-project repo function joins the view and is listed in `CROSS_BUSINESS_REPORTS`.
- This supersedes the 2026-10-05 line that left `public_profiles` readable by anyone, under the Nov 11 person-profile review's rule that public views are the service's.

## Decisions
### WP-02's reports are listed, not rewritten
The plan says the cost report and the metric facts join the view in whichever package merges second. They read other columns of `businesses` (`created_at`, `plan_tier`, `committed_at`), and the metric facts count samples on purpose (`demo`). Rewriting twelve queries of another package's SQL is more than the finding needs. They are listed in `CROSS_BUSINESS_REPORTS`, which is the guard the plan's "done when" asks for. The metric facts' `demo` field is left out of the comparison.
### The sample in the test has a commit date, not every kind of activity
The real and the sample business share the fixture's members and agents and the same commit date, so a report that forgot the filter shows the difference (the test proves it by turning the sample real). A report that counts only activity the fixture does not create, such as usage rows, is not exercised; a new entry can add its own activity.
### The roll's timing
After three days in production, the three `ms` figures go in DEPLOY §6. Above 60 seconds, the founder chooses between the off switch and a weekly roll. That reading is not done here.

## Not done
- T9 step 4 (read the house's id on production) is F3, the Desktop session's or the founder's.
