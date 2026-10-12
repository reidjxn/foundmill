/**
 * Per-section staff permissions (BUILD §11.9): one definition for every service that enforces them (apps/api's
 * procedures, apps/collab's spec blocks, the Inbox's redaction). Zod-free, so a browser bundle may import it.
 */
import { WRITE_ROLES, type MembershipRole } from "./constants";

/** Sections a membership can be restricted on: module keys plus fixed surfaces. */
export const SECTIONS = ["product", "development", "distribution", "finance", "team", "legal", "inbox", "crm", "settings", "billing", "live"] as const;
export type Section = (typeof SECTIONS)[number];
export type SectionAccess = "none" | "read" | "write";
export type PermissionLevel = "read" | "write";

export interface SectionMembership {
  role: MembershipRole;
  sectionPermissions: Record<string, SectionAccess>;
}

/** Effective permission of a membership on a section: owner is never restricted; viewers/advisors read only. */
export function effectivePermission(membership: SectionMembership, section: Section): SectionAccess {
  if (membership.role === "owner") return "write";
  const explicit = membership.sectionPermissions[section];
  if (explicit) return explicit;
  return WRITE_ROLES.includes(membership.role) ? "write" : "read";
}

/**
 * Whether the membership holds `level` on `section`. Writing also needs a write role: an explicit "write" on a viewer or
 * an advisor never lets them change anything (the API's `sectionWrite` is `writeProcedure` + the section check).
 */
export function hasSectionAccess(membership: SectionMembership, section: Section, level: PermissionLevel): boolean {
  const have = effectivePermission(membership, section);
  if (level === "read") return have !== "none";
  return have === "write" && WRITE_ROLES.includes(membership.role);
}
