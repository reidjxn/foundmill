# Invitations and roles: judgment calls

Notes for the PR description of `claude/waitlist-invitations`. DECISIONS.md and PROGRESS.md are not edited on this branch; the calls below move there when it merges.

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

**The grantor's access is read from the request** (`ctx.membership`), not locked. Under RLS, `for share` on one's own memberships row returns nothing, because the update policy excludes one's own row. A demotion that commits during the request is the usual race of any permission check. The invitation's accept still locks the inviter's row, on the service connection, as before.

**Invitations are refused, not narrowed.** An invitation has no section permissions of its own (0089 stores the role only). A walled admin either holds a collaborator's access (Product, Development, Distribution and CRM write; Inbox and Team read) or cannot invite one. An owner or a cofounder can. Narrowed collaborator invitations would need a column on `invitations` and a screen; that is left for when someone asks.

**The database is left to the api.** 0026 and 0090 let an admin write any `section_permissions` on a row they may edit, so a guard trigger was considered and not added:
- No policy reads `section_permissions`. The walls are the api's alone, as 0090's header says. An admin walled from Finance can already read and write the Finance tables over their own RLS connection, so a trigger on granting walls would guard a boundary the database does not hold.
- It would need a second copy, in plpgsql, of `effectivePermission`, the section list, the role defaults and the collaborator caps, which would drift from @foundmill/shared.
- The Data API is off in production.

The role half is already in the database: an admin cannot grant an owner's standing (0090), and admin is the only role below it that manages people.

**Settings screens.** The Staff screen (packages/modules, `StaffScreen.tsx`) still offers every level to an admin and shows the api's refusal. Hiding the options above the viewer's own access is a follow-up.

## `is_member_not_collaborator(uuid)` grants (0093)

0092 granted this security-definer helper to anon. On Supabase, postgres's default privileges also grant it to anon directly. anon never needs it: with no `auth.uid()` it is always false. 0093 now revokes it from public and anon and grants it explicitly to authenticated (the row policies call it as authenticated) and service_role. This matches main's structural client-grants test (#101). That test is not on this branch yet; the helper joins its authenticated list at the merge.

The other functions 0089–0093 add or replace were checked:
- `is_member` and `has_role` are replaced, which keeps their grants; both are already on that test's lists.
- `fm_memberships_keep_owner`, `fm_founder_profiles_public_guard` and `fm_invitations_guard` are trigger functions, which the test leaves out.
- `admission_existing_before()` is not security definer and is service-only already (0091).
