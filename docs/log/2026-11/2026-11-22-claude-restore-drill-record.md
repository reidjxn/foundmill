---
date: 2026-11-22
branch: claude/restore-drill-record
title: The first restore drill passed and is recorded
areas: [docs, ops]
supersedes: []
---
## What changed
The first restore drill (WP-11 T3, the founder's step F2) ran on Nov 22, 2026, and docs/DEPLOY.md records it.

- The backup of 6:08:28 AM UTC was restored into a new Supabase project in the same region, ready in under 9 minutes.
- Migrations: 126, with the same hashes as production's first 126. The api build live at that time (`83f6ea9c`) has 126 in its journal.
- Projects: 16, with the same ids as production. `audit_log_verify` was null for all 16.
- Also compared: 9,786 audit rows and 3,954 events by id, 20 sign-in accounts by count, and row-level security on all 147 tables.
- The copy was deleted on the founder's yes. The project list confirmed it at 9:14 PM UTC, and production still answered.

## Decisions
### The founder kept the password, the cost and the deletion; the Desktop session did the rest
The founder signed in, set the copy's database password, and approved the cost and the deletion.
The restore was already started in the dashboard when the session went to click it. The session ran the checks read-only and deleted the copy.

### Rows are compared by id, never by created_at
Counting production's projects created before the backup gave 14 against the copy's 16, and events differed by 12.
`rollDemoForward` had moved the two sample projects' dates forward a day at 3:03 and 3:04 PM UTC, after the backup.
By id both matched exactly, so this was not a failed step. The runbook now says so.

## Not done
- The app was not run against the restored database, and decrypting sealed credentials there was not tried: the key lives outside the database.
- Row contents were not compared beyond ids, migration hashes and counts.
- Files and secrets kept outside Supabase were not part of the drill. Supabase file storage was empty in production.
- Point-in-time recovery stays off, so a restore can lose up to about a day.
