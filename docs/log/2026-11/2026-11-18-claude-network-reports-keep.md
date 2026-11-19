---
date: 2026-11-18
branch: claude/network-reports-keep
title: Reports outlive the reporter's account
areas: [db, web, docs]
---
**Founder decision (Nov 18, 2026):** a closed account's reports are kept for the operator, with the reporter removed.

## What changed
- Migration `0142_reports_keep_reporter` makes `reports.reporter_user_id` nullable, and its foreign key to `auth.users` now sets null on delete instead of cascading (0136 cascaded it, so closing an account erased every report the person had filed).
- The schema mirror, `OpenReport.reporterUserId` (now `string | null`) and `ACCOUNT_COLUMNS["reports.reporter_user_id"]` (`onDelete: "set null"`) follow it. The account export still gives a reporter their own reports without the operator's handling.
- The operator's queue shows "Account closed" where the reporter's name was.

## Decisions
- The two open-report unique indexes still hold: a null reporter is distinct in a unique index, so kept reports never collide, and a closed account cannot file new ones. `reports_not_self` passes when either side is null.

## Not done
- Reports the cascade already deleted are not restored.

## Checks
- db: `rls/reports.test.ts` (a deleted reporter's report is kept with nobody named and stays in the open queue), `account-portability.test.ts` (the foreign key's real action matches the classification), `migrations.test.ts`; on PGlite and on Postgres 16.
