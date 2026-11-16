---
date: 2026-11-16
branch: claude/wp11-account-portability
title: Account export and closing, by request (operator path)
areas: [db, api, docs]
supersedes: []
---
## What changed
**WP-11 T16 (A8-13).** The Privacy Policy promises export and closing by request, and deletion within 30 days. This is the operator's path; the founder still deletes the auth user (F6).
- `accountPortabilityRepo` (`packages/db/src/repos/account-portability.ts`, imported by subpath only):
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

### Security review (security-reviewer agent)
No hard-gate bypass and no injection path: table and column names come only from the map, and the id is a bound UUID. Fixed here:
- **Medium:** a blocked person's export showed who blocked them. A connection someone else blocked is now left out, as 0016 hides it.
- **Medium:** threads and messages carried other people's state (`muted_ids`, `left_ids`, `read_by`). Each entry now has an `omit` list, and these columns are dropped.
- **Low:** the same `omit` lists now cover `idempotency_key`, `referrer_user_id`, a post's moderation fields and `action_token_hash`.
- **Medium:** `closingPlan` skipped archived projects, which can be restored, so they would have been left with no owner. They are counted now.
- **Low:** the test checks each column's real delete action against the map.
- **Low:** the module is off the shared `repos` object; only the script imports it.
- **Low:** the runbook sends the export to the account's own email, never a reply-to address.
- **Low:** the script's entry check uses `pathToFileURL`.
- **Note:** a purge by `fm_purge_business` skips the 7-day wait and is founder-only, on a request in writing.

## Not done
- F6, and a test account closed end to end on production, are the founder's.
