---
date: 2026-11-18
branch: claude/trusting-goldberg-28k3rx
title: Account export and closing classify the three account columns of the reports table
areas: [db]
---
## What changed
`ACCOUNT_COLUMNS` (packages/db/src/repos/account-portability.ts) gains `reports.reporter_user_id`,
`reports.resolved_by` and `reports.target_user_id`. Main's db unit suite was red since Nov 17: #264 (account export and
closing) was checked on a main without #208 (report and block, migration 0136), and its test requires every foreign
key to `auth.users` to be classified.

## Decisions
- The foreign-key actions are 0136's own and are not changed; the entries mirror them.
- A report the person filed is exported with the rest of their data, without `resolved_by` (an operator's id), as
  `post_reports.reporter_user_id` already is.
- A report about the person is never exported, so an export cannot reveal who reported them; the row stays for safety
  review with the person set null, as 0136 intends.
- `resolved_by` follows every other "a reference inside a project's own records" column: not exported, cleared.
- Built by the coordinating session because the WP-11 session was out of its weekly limit.

## Not done
- Nothing else in account export or closing changed.
