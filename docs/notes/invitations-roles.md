# Invitations and roles: judgment calls

Notes for the PR description of `claude/waitlist-invitations`. DECISIONS.md and PROGRESS.md are not edited on this branch; the calls below, and the branch's entries saved in `docs/notes/invitations-roles-log-entries.md`, move there when the coordinating session says so.

**Migration numbers.** The notes use the numbers after main was merged in (Nov 13, 2026): 0091_invitations, 0092_people_roles, 0093_admission_cutover, 0094_collaborator_reads, 0095_collaborator_money_legal, 0096_membership_grant_guards. The branch's commits before that merge name them 0089 to 0094.

## Nobody gives access they do not have (security audit, Nov 13, 2026)

**The finding.** An admin with section walls could give another person, or a second account of their own, more access than they had: Finance write while their own Finance was none, or an admin role with no walls. The path was `team.humans.role`. Its only checks were that nobody edits their own row, and that only an owner or a cofounder touches an owner's or a cofounder's row or grants that standing.

**On main too.** main's `team.humans.role` has the same two checks (owner only, before cofounders existed), with nothing on sections. main also still has `team.humans.invite`, the silent add, which takes any non-owner role and any `sectionPermissions` from a Team admin. That is the same hole on a second path: a walled admin could add a second account straight in as an admin with no walls. This branch removed `team.humans.invite` already. Whatever lands on main before this branch should carry the same rule, or wait for this branch.

**Every path that sets a role or section permissions:**

| Path | Before | Now |
| --- | --- | --- |
| `team.humans.role` (role, sections, end date) | Open to a walled admin | `assertWithinGrantorAccess` |
| `invitation.create` (collaborator) | A walled admin's link gave the collaborator's full access, e.g. Product and Customers write | Refused when the role's access is wider than the inviter's |
| `invitation.byToken` / `accept` / `decline` (`workingInvitation` → `inviterStillMay`, also re-checked inside the accept's transaction) | Re-checked the role and Team write only | Also re-checks `withinGrantorAccess`, so narrowing an inviter stops their links, as narrowing their Team access already did |
| `invitation.create` (cofounder) | An owner's or a cofounder's only | Unchanged; the rule does not limit an owner's standing |
| `repos.memberships.add` / `renewEnded` | Called only from accept (above), Commit (the founder's own owner row) and the seeds | Covered through accept |
| `repos.memberships.setRole` / `setSectionPermissions` / `setExpiry` | Called only from `team.humans.role` | Covered |
| `business.example.open` | Gives the caller a viewer row of the sample business | Not a grant from one person to another; unchanged |

The people router (`routers/people.ts`) is `invitation.*` alone. No other app writes memberships: collab, stream, gateway and orchestrator only read them.

**The rule** (`apps/api/src/services/grants.ts`). It binds only people without an owner's standing. Owners and cofounders are not limited.
- **Sections.** For each section, the person's access after the change (none < read < write) may not rise above the grantor's own and above what the person has now.
- **Roles.** The role may not rise above the grantor's rank: owner = cofounder 4, admin 3, member 2, collaborator = viewer = advisor 1.
- **Narrowing and lowering stay free.** A level or role that does not rise above what the person already has is allowed, even when it is above the grantor's own. An owner gave it, and the admin only leaves it as it is or takes it down. This is why "the result must fit within the grantor's access" was not chosen: under that rule, a walled admin could not narrow Product on a member who writes Finance.
- **Refusal.** A plain `ForbiddenError`: "You can only give access you have yourself." An invitation adds what a collaborator gets, so the inviter knows which access they are missing.

**Effective access** is measured as the walls are enforced when a section is opened: `hasSectionAccess` from @foundmill/shared, the function behind `sectionRead` / `sectionWrite`.
- A section with no entry takes the role's default.
- A collaborator is capped at `COLLABORATOR_SECTIONS`.
- Write counts only for a role that writes.

So a viewer's stored Finance "write" counts as read. A role change that would switch on a stored wider entry counts as a widening: viewer → member, or collaborator → member.

**End dates.** A collaborator whose access has ended holds nothing now. Giving them a new date, or a role that clears the date, is judged as a fresh grant against the grantor's access, not against what the row holds. Removing or extending a running collaborator's end date is not limited. That is time, not access, and no admin has an end date of their own to compare against.

**The grantor's access is read inside the transaction, under a lock** (review of PR #113, follow-up 1). `team.humans.role` used to judge the change against `ctx.membership` and `ctx.role`, read before its transaction began, and read the person's row without a lock. A walled admin racing an owner who was lowering them could be judged on levels they no longer had. Now, inside the transaction, in this order:
1. The business's owner lock (`lockOwners`, the advisory lock `setRole`, `remove` and 0035's trigger already take). Every change to a business's people through the api takes it first, so two of them take turns and never wait on each other's row locks in a cycle.
2. The editor's own row, held `for share` and read after the lock (`repos.memberships.getMineForShare`). Under RLS a locking read must also pass the update policy, and that policy never lets anyone change their own row (0026, 0092). So `select … for share` on one's own row finds nothing (checked on PGlite), and the lock is taken by 0096's `lock_my_membership(bid)`: security definer, about `auth.uid()` only, executable by authenticated and service_role, not anon. Then the plain read sees the latest commit and keeps seeing it.
3. The person's row, held `for update` (`repos.memberships.getForUpdate`). Under RLS it comes back only when the editor may change it. When it does not, a plain read still tells "not a member" apart from "an owner's row", so the words stay as they were.

The editor's fresh row is then checked again for an admin's role and Team write ("You can no longer change people's access in this business"). The owner checks and `assertWithinGrantorAccess` read that row, not the request. Tests (`grant-access.test.ts`, "judges the rows as they are inside its transaction") change the editor's row between the request's read and the transaction: walled, lowered to member, Team narrowed, removed. A last test fixes the lock order. A real two-connection race needs a Postgres run; PGlite has one connection.

**The invitation's accept already did this.** Inside its transaction it re-reads the inviter with `getActive(…, { lock: "share" })` and re-checks `mayMakeInvitation` and `withinGrantorAccess` on that row. That runs on the service connection, where the lock works (invitations-admission.test.ts checks the lock is taken). Nothing changed there. The accepter's own row is read without a lock, which is safe: `renewEnded` is a conditional update, re-checked under the row lock, and `add` is `on conflict do nothing`.

**Invitations are refused, not narrowed.** An invitation has no section permissions of its own (0091 stores the role only). A walled admin either holds a collaborator's access (Product, Development, Distribution and CRM write; Inbox and Team read) or cannot invite one. An owner or a cofounder can. Narrowed collaborator invitations would need a column on `invitations` and a screen; that is left for when someone asks.

**The database is left to the api: no trigger on widening** (asked again in review follow-up 3, kept). 0026 and 0092 let an admin write any `section_permissions` on a row they may edit. The review asked, at minimum, for a trigger refusing an `authenticated` caller who widens another member's levels beyond their own stored ones, "only if the role defaults can be expressed in SQL from one source". They cannot:
- The levels a row opens come from `effectivePermission` and `hasSectionAccess` in @foundmill/shared. That is the role defaults (write for `WRITE_ROLES`, else read), the collaborator caps (`COLLABORATOR_SECTIONS`), an owner's standing never walled, and write only for a role that writes. A trigger needs all of that again in plpgsql. That is a second copy of logic, not of a list, and the TS copy is the one the browser bundles also import. A parity test over every role and section would catch drift, but it would still be two sources, which is what the condition rules out.
- Comparing the stored levels alone, without the defaults, would not be faithful. A missing key means the role's default, so an admin with `{}` writes Finance, and a viewer's stored `write` opens read only. A key-by-key comparison of the stored JSON would refuse narrowings the api allows and let through widenings that come from a role change.
- No policy reads `section_permissions`. The walls are the api's alone, as 0092's header says. An admin walled from Finance can already read and write the Finance tables over their own RLS connection, so such a trigger would guard a boundary the database does not hold.

**This is safe only while the Supabase Data API stays off.** docs/DEPLOY.md records that condition (§4 Supabase, "The two conditions invitations ship under in production", item 2: `/rest/v1/` and `/graphql/v1` answer 503 with the anon key; off since Oct 10, 2026). The product reaches Postgres only through apps/api's direct connection. With the Data API on, an admin's own `authenticated` session could write any levels on any non-owner row, and every section wall would rest on RLS, which does not have them.

The role half is already in the database: an admin cannot grant an owner's standing (0092), and admin is the only role below it that manages people. The section keys are in the database too, from 0096 (below).

**Settings screens.** The Staff screen (packages/modules, `StaffScreen.tsx`) still offers every level to an admin and shows the api's refusal. Hiding the options above the viewer's own access is a follow-up.

## Section keys only from `SECTIONS` (0096, review follow-up 2)

**The finding.** `SectionPermissions` (packages/db `repos/memberships.ts`) was `z.record(z.string(), …)`, so any key was stored. A key such as `{"marketing":"write"}` opens nothing today. On the day a section of that name joined `SECTIONS`, it would have opened that section without anyone having given it.

**The api.** `SectionPermissions` is now `z.partialRecord(z.enum(SECTIONS), …)`, the list the walls and the Staff screen already use. An unknown key is refused as a validation error that names it ("No such section: money"): a `BAD_REQUEST` from `team.humans.role`, a `ValidationError` from the repo's `add`, `renewEnded` and `setSectionPermissions`.

**The database.** 0096 adds `memberships_section_permissions_known`. The value must be a JSON object whose keys are all in the section list and whose values are all "read", "write" or "none". There are no subqueries: jsonb `-` text[] for the keys, `jsonb_path_exists` for the values. The list in the CHECK is a copy of `SECTIONS`. Unlike the role defaults it is a flat list, so `migration-0096.test.ts` reads it back from `pg_get_constraintdef` and fails when the two differ. Adding a section now means a migration that redefines the CHECK, and the test says so.

**Existing rows.** In this repository nothing stores an unknown key. The seeds set no section permissions, and every literal in tests and fixtures uses known sections (billing, crm, development, distribution, finance, inbox, legal, live, product, settings, team). Production rows cannot be checked from here, so 0096 handles both cases:
- Unknown keys are removed and the known ones kept. An unknown key opens nothing, so removing it changes no one's access.
- A value other than read, write or none stops the migration with a count, before anything is applied. Removing such a value would change access: today `effectivePermission` passes it through, and it reads as "not none".

The test runs 0096 over a 0095 database that has both kinds of row.

**Numbering.** Written as 0094; renumbered to 0096 when main (#93, ending at 0090_page_dates_recorded) was merged in on Nov 13, 2026, with the branch's other five (0091 to 0095, journal idx 79 to 84). The test names it in one place (`TAG`) and its file is `migration-0096.test.ts`. `lock_my_membership(uuid)` is on the authenticated list of main's client-grants test (#101), with `is_member_not_collaborator`.

## The rank check is not reachable through the router (review follow-up 4)

The test "a higher role is refused" passed because of the older owner check, not because of `grantOverreach(...).role`. The rank path cannot be reached through `team.humans.role`:
- The procedure is `sectionAdmin("team")`, so only an admin or someone with an owner's standing calls it.
- An owner's standing is not limited.
- The only roles ranked above an admin are owner and cofounder, which the owner check refuses first.

Invitations are the same: an admin may invite only a collaborator (rank 1), and a cofounder invitation is `mayMakeInvitation`'s to refuse. So the rank cases stay at the helper level ("refuses a role ranked above the grantor's own": member → admin, collaborator → member, admin → cofounder). The router tests now say why. The existing test asserts the owner check's own words. A new one shows that a member, a collaborator, a viewer and an advisor cannot edit roles at all, and that owner and cofounder are the only roles ranked above admin. The check stays as defense in depth, for a future caller below admin that manages people.

## `is_member_not_collaborator(uuid)` grants (0095)

0094 granted this security-definer helper to anon. On Supabase, postgres's default privileges also grant it to anon directly. anon never needs it: with no `auth.uid()` it is always false. 0095 now revokes it from public and anon and grants it explicitly to authenticated (the row policies call it as authenticated) and service_role. This matches main's structural client-grants test (#101). That test is not on this branch yet; the helper joins its authenticated list at the merge.

The other functions 0091–0095 add or replace were checked:
- `is_member` and `has_role` are replaced, which keeps their grants; both are already on that test's lists.
- `fm_memberships_keep_owner`, `fm_founder_profiles_public_guard` and `fm_invitations_guard` are trigger functions, which the test leaves out.
- `admission_existing_before()` is not security definer and is service-only already (0093).
