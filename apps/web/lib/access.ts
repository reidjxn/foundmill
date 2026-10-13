/**
 * What the signed-in person may see and do in this business (audit RUI-05): their role and per-section permissions
 * (BUILD §11.9), read from `business.get`'s membership with the same rules the API enforces (@foundmill/shared
 * permissions). The shell hides what a role cannot open (walled departments, the CRM) and disables, with a reason, what
 * it cannot change, so nobody meets a raw "You do not have read access" error. The API still refuses on its own.
 */
import { WRITE_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { effectivePermission, SECTIONS, type Section, type SectionMembership } from "@foundmill/shared/permissions";

export interface Access {
  role: MembershipRole;
  /** Owner or admin: modes, vacation, the kill switch, staff, keys, billing. */
  isAdmin: boolean;
  /** Owner, admin or member: may change anything at all (viewers and advisors only read). */
  canChange: boolean;
  canRead(section: Section): boolean;
  canWrite(section: Section): boolean;
}

/** A module key or surface that is a permission section, else null (custom modules are not walled). */
export function sectionOf(key: string): Section | null {
  return (SECTIONS as readonly string[]).includes(key) ? (key as Section) : null;
}

/** Everything allowed: the founder before the membership has loaded, and stories. */
export const FULL_ACCESS: Access = { role: "owner", isAdmin: true, canChange: true, canRead: () => true, canWrite: () => true };

export function accessFor(membership: SectionMembership | null | undefined): Access {
  if (!membership) return FULL_ACCESS;
  const canChange = WRITE_ROLES.includes(membership.role);
  return {
    role: membership.role,
    isAdmin: membership.role === "owner" || membership.role === "admin",
    canChange,
    canRead: (section) => effectivePermission(membership, section) !== "none",
    canWrite: (section) => canChange && effectivePermission(membership, section) === "write",
  };
}

/** A department is open to the person when at least one of its modules is (a department with no module always is). */
export function canOpenDepartment(access: Access, department: { moduleKeys?: readonly string[] | null }): boolean {
  const sections = (department.moduleKeys ?? []).map(sectionOf);
  if (sections.length === 0 || sections.some((s) => s === null)) return true;
  return sections.some((s) => access.canRead(s!));
}

/** The line a disabled control shows when the role only reads. */
export function readOnlyReason(access: Access): string {
  return `As ${access.role === "advisor" ? "an advisor" : "a viewer"} you can follow the business; an owner, admin or member makes changes.`;
}

/** The line a control only owners and admins use shows to everyone else. */
export const ADMIN_ONLY_REASON = "Only an owner or admin can do this.";
