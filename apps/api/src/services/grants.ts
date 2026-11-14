/**
 * Nobody gives access they do not have (security audit, 2026-11-13). Someone without an owner's standing who manages the
 * project's people (an admin with Team write) may set another person's role and section permissions, and may invite a
 * collaborator; neither may reach past their own access:
 *
 *   - no section above the grantor's own level on it (none < read < write), measured as the walls are enforced when the
 *     section is opened (@foundmill/shared `hasSectionAccess`: the role's default where no entry is set, a collaborator
 *     capped at `COLLABORATOR_SECTIONS`, write only for a role that writes);
 *   - no role ranked above the grantor's own (`ROLE_RANK`).
 *
 * Narrowing and lowering stay free: a level or a role that does not rise above what the person already has is never
 * refused, even where it is above the grantor's (an owner gave it; the grantor leaves it, or takes it down). People with
 * an owner's standing (an owner or a cofounder) are not limited by this. One rule for every path that sets a role or
 * sections: `team.humans.role` and invitations (made, read and accepted: services/invitations.ts).
 */
import { ForbiddenError, hasSectionAccess, isOwnerRole, SECTIONS, type MembershipRole, type Section, type SectionAccess, type SectionMembership } from "@foundmill/shared";

/** How far a role reaches beyond its sections: an owner's standing, then administering, then writing everywhere it may. */
export const ROLE_RANK: Readonly<Record<MembershipRole, number>> = Object.freeze({
  owner: 4,
  cofounder: 4,
  admin: 3,
  member: 2,
  collaborator: 1,
  viewer: 1,
  advisor: 1,
});

const LEVEL_RANK: Readonly<Record<SectionAccess, number>> = { none: 0, read: 1, write: 2 };

/** What a membership actually opens on a section: what `sectionRead` and `sectionWrite` let through. */
export function sectionAccessOf(membership: SectionMembership, section: Section): SectionAccess {
  if (hasSectionAccess(membership, section, "write")) return "write";
  return hasSectionAccess(membership, section, "read") ? "read" : "none";
}

/** Where a grant would reach past the grantor's own access: the role, and the sections, that rise above it. */
export interface GrantOverreach {
  role: boolean;
  sections: Section[];
}

/**
 * Where `grant` (the membership as it would become) reaches past `grantor`'s own access, rising above `current` (the
 * membership as it is now; null for a new one). Null when it does not, and always null for an owner's standing.
 */
export function grantOverreach(grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null): GrantOverreach | null {
  if (isOwnerRole(grantor.role)) return null;
  const rises = (to: number, mine: number, now: number | null) => to > mine && (now === null || to > now);
  const role = rises(ROLE_RANK[grant.role], ROLE_RANK[grantor.role], current ? ROLE_RANK[current.role] : null);
  const sections = SECTIONS.filter((s) => rises(LEVEL_RANK[sectionAccessOf(grant, s)], LEVEL_RANK[sectionAccessOf(grantor, s)], current ? LEVEL_RANK[sectionAccessOf(current, s)] : null));
  return role || sections.length > 0 ? { role, sections } : null;
}

/** Whether `grantor` may give `grant` (over `current`, the membership as it is now, or null for a new one). */
export const withinGrantorAccess = (grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null): boolean => grantOverreach(grantor, grant, current) === null;

export const GRANT_BEYOND_OWN_ACCESS = "You can only give access you have yourself.";

/** `withinGrantorAccess`, refusing with a plain ForbiddenError (`message` for a path that says more, such as an invitation). */
export function assertWithinGrantorAccess(grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null, message = GRANT_BEYOND_OWN_ACCESS): void {
  if (!withinGrantorAccess(grantor, grant, current)) throw new ForbiddenError(message);
}
