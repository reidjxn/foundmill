---
date: 2026-11-17
branch: claude/wp11-reports-portability
title: Account export and closing classify the reports table's three keys
areas: [db]
supersedes: []
---
## What changed
#264 (account export and closing) and #208 (0136, `reports`) merged on the same afternoon, each checked on a main
without the other. 0136 added three foreign keys to `auth.users` that `ACCOUNT_COLUMNS` did not name, so main's db
suite failed "classifies every foreign key to auth.users exactly once" (55 against 58). This classifies them:
- `reports.reporter_user_id` (cascade): the reports a person filed are in their export, without how an operator
  handled them (`resolved_by`, `resolution`, `resolved_at`). Closing deletes them, as 0136 decided.
- `reports.target_user_id` (set null): never exported, because a report about someone would name who reported them,
  and 0136 promises the person reported never learns that. On closing, the report stays for safety with the id cleared.
- `reports.resolved_by` (set null): never exported. The operator's id is cleared and the report kept, as for
  `post_reports.resolved_by`.

A new test files a report and checks all three: the reporter's export has it without the operator fields, the person
reported sees nothing, and the operator's export holds no report.

## Decisions
- **What closing does.** Closing follows each key's own `on delete`, as every other column here does. The schema is
  unchanged in this fix.
- **Kept for safety.** A report about a person who closes their account is kept, so a pattern can still be seen.

## Not done
A reporter who closes their account takes their reports with them (0136's choice). Whether the operator should keep
those, with the reporter cleared, is for the network session to decide: it would be a migration.
