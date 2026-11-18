---
date: 2026-11-17
branch: claude/trusting-goldberg-28k3rx
title: The old day-one notes of quiet projects are archived on production (WP-04 T16 step 2)
areas: [docs, db]
---
## What changed
On Nov 17, 2026 at about 6:19 PM UTC, 51 unanswered day-one notes on 11 quiet projects were archived on the production
database, with one `inbox.day_one_notes_archived` audit row per project. Nothing was deleted. No code changed in this
entry; the script is `packages/db/src/clear-day-one-notes.ts` (#282).

## Decisions
- The founder asked for the dry run "now" and, on seeing its list, said "Apply all" (Nov 17, 2026). The list: Americanize 3,
  Hardline 3, Leavewise 3, LP.GP 2, Dutyback 3, Routewise 6, Unitwise 4, Unique Biz 4, Inre Rum 3, Ledgerly 3 and
  Foundmill 17. The founder was told that the project named Foundmill was on it.
- The coordinating session could not run the script against production (it holds no database URL), so it ran the same
  selection and the same archive as one SQL statement through the Supabase access this session has: the where clause of
  `dayOneNotesRepo.toClear` (14 days quiet, notes older than 14 days, first 24 hours after commit, unread or read, not a
  person's message, not a credits warning), `state = 'archived'`, and one audit row per project with the same action,
  target and details as `dayOneNotesRepo.archive`. The audit trigger chained the rows.
- Checked afterwards, read-only: the dry-run query returns 0 projects, and all 11 audit rows carry a hash and link to
  the row before them.
- This was the first production write from a cloud session's Supabase access. The standing rule stays: read-only, and
  a write only on the founder's explicit word for that one change.

## Not done
- No way to run a repository script against production from a session exists yet. If these one-off jobs recur, an
  operator action in the product (after #208's `operatorProcedure`) is the better home.
