---
date: 2026-11-16
branch: claude/wp11-account-portability
title: Account export and closing, by request (operator path)
areas: [db, api, docs]
supersedes: []
---
## What changed
**WP-11 T16 (A8-13).** The Privacy Policy promises export and closing by request, and deletion within 30 days. This is the operator's path; the founder still deletes the auth user (F6).
- `repos.accountPortability` (`packages/db/src/repos/account-portability.ts`):
  - `ACCOUNT_COLUMNS` classifies the 56 foreign keys to `auth.users` (32 cascade, 24 set null) plus `message_threads.participant_ids`.
  - `export` returns the person's own rows, at most 10,000 per column.
  - `closingPlan` lists the real projects the person is the only unexpired owner or cofounder of.
  - `leftovers` lists the classified columns that still hold the id.
- `apps/api/src/scripts/account.ts`, run as `pnpm --filter @foundmill/api account export|check|verify <userId>`. `check` exits 1 while the person is a project's only owner. `verify` exits 1 while rows that go with the account remain, and otherwise removes the `ae:` stream.
- docs/DEPLOY.md §4, "Closing an account by request": the six steps, with F6 marked as the founder's, and the orphan query.
- Tests:
  - `account-portability.test.ts`, on PGlite and real Postgres: every foreign key is classified; an export holds one account only; a sole owner is named first; after the auth user is deleted only set-null and "none" columns keep the id.
  - `account-script.test.ts`: the export, check and usage exit codes.

## Decisions
### What is not exported
Rows that go with the account but are no use to the person, or are a credential, are left out, each with its reason in the map: the delivery queue of their own events, one-time link token hashes, phone push tokens, handles kept for 90 days, and the admission record. Set-null columns are references inside a project's own records: the project keeps them, and only the id is cleared.
### Nothing deletes
The script reads and checks; deleting the auth user stays the founder's action in the Supabase dashboard (permanent deletion is on CLAUDE.md's Never list for agent code). No route, procedure or agent tool calls this module.
### Operator path, not self-serve
A8-13 proposed self-serve procedures with re-authentication. The policy promises closing and export by request, so this builds what was promised (WP-11 "Corrections to the audits" 9).

## Not done
- F6, and a test account closed end to end on production, are the founder's.
