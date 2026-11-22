---
date: 2026-11-20
branch: claude/lucid-euler-msx3pg
title: The for-all write policies are split into insert, update and delete
areas: [db]
supersedes: [2026-10-05 packages/db: schema, RLS and test harness choices (only the line that makes T_write a for-all policy)]
---
## What changed
**WP-11 T6 (A8-04).**
- `0152_split_write_policies`: each of the 58 `<t>_write` policies (`for all`) becomes `<t>_insert`, `<t>_update` and `<t>_delete` with the same expressions: insert takes the old `with check` (or `using` when it had none), update takes `using` and `with check`, delete takes `using`.
  `fm_tenant_table` and `fm_idea_table` are redefined the same way, so a table made later is born split.
  `posts_moderate`, `community_members_moderate` and the single `*_own` policies stay `for all`.
- Two guards in the migration make it fail, not guess: a table that already has a per-command policy, and a table with a `_write` policy and no select policy.
- `rls/permissive-policies.test.ts` (new): for select, insert, update and delete, a table with two permissive policies for one command must be in `MULTIPLE_PERMISSIVE_ALLOWED` (`posts`, `community_members`, each with its reason); no `<t>_write` remains; a table made by each helper is born split (in a transaction that rolls back).
- `people-roles.test.ts` expects `_select`, `_insert`, `_update`, `_delete` on the seven Money and Legal tables, with the one writers expression on the write policies; `founder-departures.test.ts` reads `suppression_list_update`.
- docs/BUILD.md §7.1, docs/ARCHITECTURE.md and `packages/db/CLAUDE.md` follow.

## Decisions
### Why writers keep their reads
An `update ...
where` or `returning` also needs the select policy.
In every one of the 58 pairs the writers are among the readers, in four shapes: `has_role` implies `is_member` (35 tables, and 8 and 3 with the owner/admin roles); the seven 0095 tables pair `has_role and is_member_not_collaborator` with a select of `is_member_not_collaborator`;
`skill_definitions` and `suppression_list` pair `business_id is not null and has_role(...)` with `business_id is null or is_member(...)`; the three idea tables pair owner-or-writer with owner-or-member.
No pair falls outside these.
### A new test file, not `advisors.test.ts`
The plan adds the assertion to `rls/advisors.test.ts`, which exists only in PR #238 (still open and conflicting on Nov 20). A separate file avoids a conflict with it. Whoever merges second keeps both.
### Helpers do not wrap `auth.uid()` here
`fm_idea_table` keeps the bare `auth.uid()` that main has; wrapping it in a select is T5 (PR #238's 0118).
Both helpers carry `set search_path = pg_catalog, public, pg_temp` in their own text.
**When #238 is renumbered after this, its `fm_idea_table` redefinition must carry the split policies from 0152** (`_insert`, `_update`, `_delete`) with its `(select auth.uid())`, or the helper goes back to `for all`; `permissive-policies.test.ts` fails if it does.
Its 0118 loop wraps the policies this migration made, as it wraps any other.
### Migration numbers
0151 (T9's `real_businesses`) and 0152 are the next free numbers after main's 0150 and every open branch's, on Nov 21.
### The security reviewer's note on T9 stays open
Reviewed once on the T9 diff; the T6 diff was reviewed separately (see the pull request).

## Not done
- Reading the advisors on production after deploy (320 findings to the two allow-listed tables) is the founder's or the Desktop session's. T6 rewrites about 60 tables' policies in one transaction: deploy at a quiet hour, after T3's restore drill (still waiting on the founder).
- The run on a real Postgres 17 (`RLS_TEST_DATABASE_URL`) is CI's `postgres-suites` job once it exists on main; this session ran PGlite.
