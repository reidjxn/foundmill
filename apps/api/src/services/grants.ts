/**
 * Nobody gives access they do not have (security audit, 2026-11-13). Someone without an owner's standing who manages the
 * project's people (an admin with Team write) may set another person's role and section permissions, and may add
 * someone; neither may reach past their own access:
 *
 *   - no section above the grantor's own level on it (none < read < write), measured as the walls are enforced when the
 *     section is opened (@foundmill/shared `hasSectionAccess`: the role's default where no entry is set, write only for a
 *     role that writes);
 *   - no role ranked above the grantor's own (`ROLE_RANK`).
 *
 * Narrowing and lowering stay free: a level or a role that does not rise above what the person already has is never
 * refused, even where it is above the grantor's (an owner gave it; the grantor leaves it, or takes it down). An owner is
 * not limited by this. One rule for every path that sets a role or sections: `team.humans.role` and `team.humans.invite`.
 */
import { ForbiddenError, hasSectionAccess, SECTIONS, type MembershipRole, type Section, type SectionAccess, type SectionMembership } from "@foundmill/shared";

/** How far a role reaches beyond its sections: an owner's standing, then administering, then writing everywhere it may. */
export const ROLE_RANK: Readonly<Record<MembershipRole, number>> = Object.freeze({
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
  advisor: 1,
});

const LEVEL_RANK: Readonly<Record<SectionAccess, number>> = { none: 0, read: 1, write: 2 };

/** Whether a role carries an owner's standing (main has one: the owner). */
const hasOwnerStanding = (role: MembershipRole): boolean => role === "owner";

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
 * membership as it is now; null for a new one). Null when it does not, and always null for an owner.
 */
export function grantOverreach(grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null): GrantOverreach | null {
  if (hasOwnerStanding(grantor.role)) return null;
  const rises = (to: number, mine: number, now: number | null) => to > mine && (now === null || to > now);
  const role = rises(ROLE_RANK[grant.role], ROLE_RANK[grantor.role], current ? ROLE_RANK[current.role] : null);
  const sections = SECTIONS.filter((s) => rises(LEVEL_RANK[sectionAccessOf(grant, s)], LEVEL_RANK[sectionAccessOf(grantor, s)], current ? LEVEL_RANK[sectionAccessOf(current, s)] : null));
  return role || sections.length > 0 ? { role, sections } : null;
}

/** Whether `grantor` may give `grant` (over `current`, the membership as it is now, or null for a new one). */
export const withinGrantorAccess = (grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null): boolean => grantOverreach(grantor, grant, current) === null;

export const GRANT_BEYOND_OWN_ACCESS = "You can only give access you have yourself.";

/** `withinGrantorAccess`, refusing with a plain ForbiddenError (`message` for a path that says more). */
export function assertWithinGrantorAccess(grantor: SectionMembership, grant: SectionMembership, current: SectionMembership | null = null, message = GRANT_BEYOND_OWN_ACCESS): void {
  if (!withinGrantorAccess(grantor, grant, current)) throw new ForbiddenError(message);
}
