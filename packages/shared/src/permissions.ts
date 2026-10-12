/**
 * Per-section staff permissions (BUILD §11.9): one definition for every service that enforces them (apps/api's
 * procedures, apps/collab's spec blocks, the Inbox's redaction). Zod-free, so a browser bundle may import it.
 */
import { CHANNEL_KEYS, WRITE_ROLES, type MembershipRole, type PlanActionType } from "./constants";

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

const isChannelKey = (v: unknown): boolean => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);

/**
 * The section a plan action changes (BUILD §11.9; audit RUI-01). A plan compiled from an Inbox decision, a confirmation,
 * an agent's hand-off or a decision the Chief of Staff takes on vacation runs as the person it acts for, so they need
 * write access to every section it changes, exactly as that section's own screen requires (distribution.channels.*,
 * finance, team.agents.*, product.spec.*, crm). Null: nothing beyond Inbox write (a reply, a founder task, a plain task
 * for the agent who asked). The API and the orchestrator both read it, so the walls are the same everywhere.
 */
export function planActionSection(action: { type: PlanActionType; params?: unknown }): Section | null {
  const p = (action.params ?? {}) as Record<string, unknown>;
  switch (action.type) {
    case "enable_channel":
    case "disable_channel":
      return "distribution";
    case "set_budget":
      // A channel's budget is set on the Distribution screen; a department's or the business's is Finance's.
      return isChannelKey(p.channel) ? "distribution" : "finance";
    case "approve_spend":
      return "finance";
    case "create_task":
      return isChannelKey(p.channel) ? "distribution" : p.kind === "code" ? "development" : null;
    case "update_spec":
    case "update_roadmap":
      return "product";
    case "send_message":
    case "schedule_meeting":
      return "crm";
    case "hire_agent":
    case "train_agent":
    case "set_agent_model":
    case "create_playbook":
      return "team";
    case "request_human_action":
    case "reply_only":
      return null;
  }
}

/** The sections a plan's actions change that this person cannot write to, with the actions that need each. */
export function planSectionWalls(membership: SectionMembership, actions: readonly { type: PlanActionType; params?: unknown }[]): { section: Section; actionTypes: PlanActionType[] }[] {
  const walls = new Map<Section, PlanActionType[]>();
  for (const action of actions) {
    const section = planActionSection(action);
    if (!section || hasSectionAccess(membership, section, "write")) continue;
    const types = walls.get(section) ?? [];
    if (!types.includes(action.type)) types.push(action.type);
    walls.set(section, types);
  }
  return [...walls].map(([section, actionTypes]) => ({ section, actionTypes }));
}
