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

export const isSection = (value: string): value is Section => (SECTIONS as readonly string[]).includes(value);

/** The sections the membership may not read at all (permission "none"); empty for an owner. */
export function walledSections(membership: SectionMembership): Section[] {
  return SECTIONS.filter((section) => !hasSectionAccess(membership, section, "read"));
}

/** Where agent sessions are watched and replayed (Development › Live sessions, `dev.sessions.*`). */
export const SESSION_SECTION: Section = "development";

/**
 * The sections an agent session's live output belongs to: Development, plus the modules of the department its work is
 * filed under (a Finance agent's terminal shows Finance's figures). Reading a session (`dev.sessions.*` in apps/api,
 * `as:<sessionId>` in apps/stream) needs read access to every one of them.
 */
export function sessionSections(moduleKeys: readonly string[]): Section[] {
  return [...new Set<Section>([SESSION_SECTION, ...moduleKeys.filter(isSection)])];
}
