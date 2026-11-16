---
date: 2026-11-16
branch: claude/wp11-split-write-policies
title: One write policy per command instead of `for all`
areas: [db]
supersedes: []
---
## What changed
**WP-11 T6 (A8-04).** Stacked on `claude/wp11-advisor-fixes` (it rewrites the `fm_idea_table` that 0118 defines).
- `0120_split_write_policies`: each of the 58 `<table>_write` policies (`for all`, permissive) becomes `<table>_insert`, `_update` and `_delete` with the same roles and expressions, then is dropped. Two guards raise instead of guessing: a table that already has a per-command policy, and a table with no select policy.
- `fm_tenant_table` and `fm_idea_table` create the three policies, so a table made later is born split. Signatures unchanged; both carry the pinned `search_path` in their own text.
- `rls/advisors.test.ts`: the advisor's lint 0006 (no table has two permissive policies for one command outside `MULTIPLE_PERMISSIVE_ALLOWED`, which holds `posts` and `community_members`), and a table made by `fm_tenant_table` reads `_select`, `_insert`, `_update`, `_delete`. Before the migration the first listed 58 tables.
- `people-roles.test.ts` (the seven Money and Legal tables now expect four policies, the writers' expression on each write policy) and `founder-departures.test.ts` (reads `suppression_list_update`); a comment in `example-memberships.test.ts`. docs/BUILD.md §7.1 and docs/ARCHITECTURE.md §4.
- This supersedes the one line of 2026-10-05 "packages/db: schema, RLS and test harness choices" that made `T_write` a `for all` policy.

## Decisions
### Why writers keep their reads
An `update ... where` and a `returning` need the select policy too. The 58 pairs, read from a migrated database, fall in five shapes, and in each the writers are among the readers:
- 35 tables: select `is_member`, write `has_role(owner, admin, member)`; 3 more with `has_role(owner, admin)`.
- 7 tables (0095): select `is_member_not_collaborator`, write `has_role(owner, admin, member) and is_member_not_collaborator`.
- 8 tables: select `is_member_not_collaborator`, write `has_role(owner, admin)`. Not one of the plan's four shapes as written, but the same rule: an owner or admin is never a collaborator, so `has_role(owner, admin)` implies `is_member_not_collaborator`.
- 3 idea tables: select owner or member, write owner or writer.
- `skill_definitions` and `suppression_list`: select `business_id is null or is_member`, write `business_id is not null and has_role(...)` (suppression_list also excludes the hard reasons).
### No rule moved
Every RLS suite passes with only the two edits the plan names, on PGlite and on a real Postgres with Supabase's roles. Two suites failed once in the full real-Postgres run on this machine and passed alone; nothing in them reads policy names, so I read it as the local cluster under load. CI's job will say.
### Deploy
About 60 tables get new policies in one transaction, with a brief exclusive lock on each. Deploy at a quiet hour, after T2 (merged: a failed migration keeps the old deployment) and T3's restore drill (the founder's).

## Not done
- Reading the advisor on production after deploy (it should fall to the two allow-listed tables).
