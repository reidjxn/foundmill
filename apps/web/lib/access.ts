/**
 * What the signed-in person may see and do in this business (audit RUI-05): their role and per-section permissions
 * (BUILD §11.9), read from `business.get`'s membership with the same rules the API enforces (@foundmill/shared
 * permissions). The shell hides what a role cannot open (walled departments, the CRM) and disables, with a reason, what
 * it cannot change, so nobody meets a raw "You do not have read access" error. The API still refuses on its own.
 *
 * An example membership (0065, "Explore an example": a viewer of a seeded demo business) is a viewer with its own
 * reason line, so every disabled control says "look around, then start your own" instead of naming staff roles.
 */
import { WRITE_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { effectivePermission, SECTIONS, type Section, type SectionMembership } from "@foundmill/shared/permissions";

export interface Access {
  role: MembershipRole;
  /** Owner or admin: modes, vacation, the kill switch, staff, keys, billing. */
  isAdmin: boolean;
  /** Owner, admin or member: may change anything at all (viewers and advisors only read). */
  canChange: boolean;
  /** An example viewer (0065): the Example frame, and the example wording on every read-only reason. */
  isExample: boolean;
  canRead(section: Section): boolean;
  canWrite(section: Section): boolean;
}

/** The membership as the shell reads it: role, section walls and, since 0065, how the row came to be. */
export type AccessMembership = SectionMembership & { source?: string | null };

/** A module key or surface that is a permission section, else null (custom modules are not walled). */
export function sectionOf(key: string): Section | null {
  return (SECTIONS as readonly string[]).includes(key) ? (key as Section) : null;
}

/** Everything allowed: the founder before the membership has loaded, and stories. */
export const FULL_ACCESS: Access = { role: "owner", isAdmin: true, canChange: true, isExample: false, canRead: () => true, canWrite: () => true };

/**
 * True for an example viewer: the viewer membership business.example.open writes (`source: "example"`; 0065 holds
 * every example row to the viewer role, and the server only ever opens a demo business). A demo's own owner and an
 * invited viewer of a demo are not exploring. When the business is known and is not a demo, never an example.
 */
export function isExampleViewer(membership: AccessMembership | null | undefined, business?: { isDemo?: boolean | null } | null): boolean {
  if (!membership || membership.role !== "viewer" || membership.source !== "example") return false;
  return business?.isDemo !== false;
}

export function accessFor(membership: AccessMembership | null | undefined, business?: { isDemo?: boolean | null } | null): Access {
  if (!membership) return FULL_ACCESS;
  const canChange = WRITE_ROLES.includes(membership.role);
  return {
    role: membership.role,
    isAdmin: membership.role === "owner" || membership.role === "admin",
    canChange,
    isExample: isExampleViewer(membership, business),
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

/** The line every disabled control shows in the example business (the Example frame, docs/UX_AUDIT_AND_PLAN.md §12 item 5). */
export const EXAMPLE_READ_ONLY_REASON = "This is an example business: look around, then start your own.";
/**
 * The quiet "Sample business" marker beside a seeded demo business's name (first-time founder report, Phase 3 group K:
 * "the sample business says it is a sample"): its one line says the figures are made up. It shows on every demo
 * business (`businesses.is_demo`, which only the seed sets), whoever opens it, and never on a founder's own business.
 */
export const SAMPLE_BUSINESS_LABEL = "Sample business";
export const SAMPLE_BUSINESS_LINE = "Its figures are made up for the example: nothing here is real money or real customers.";

/** The tooltip of the sample marker for an example viewer, and the line under the example's row in Your businesses. */
export const EXAMPLE_CHIP_TOOLTIP = `${SAMPLE_BUSINESS_LINE} Nothing you do here is saved.`;

export interface SampleMarker {
  label: typeof SAMPLE_BUSINESS_LABEL;
  /** The tooltip: the made-up figures, and for an example viewer that nothing is saved. */
  tooltip: string;
}

/**
 * The marker for the open business: only for a visitor exploring the example (an example-source membership) on a demo
 * business (`isDemo === true`, which only the seed sets), with the line that the figures are made up and nothing is
 * saved. The demo's own owner and invited members don't see it (founder, Nov 12, 2026). Never on any other business,
 * whatever the membership says (an example-source row on a founder's business, or a business not loaded yet).
 */
export function sampleMarker(business: { isDemo?: boolean | null } | null | undefined, access: Pick<Access, "isExample">): SampleMarker | null {
  if (business?.isDemo !== true || !access.isExample) return null;
  return { label: SAMPLE_BUSINESS_LABEL, tooltip: EXAMPLE_CHIP_TOOLTIP };
}

/** The line a disabled control shows when the role only reads. */
export function readOnlyReason(access: Pick<Access, "role" | "isExample">): string {
  if (access.isExample) return EXAMPLE_READ_ONLY_REASON;
  return `As ${access.role === "advisor" ? "an advisor" : "a viewer"} you can follow the business; an owner, admin or member makes changes.`;
}

/** The line a control only owners and admins use shows to everyone else. */
export const ADMIN_ONLY_REASON = "Only an owner or admin can do this.";
