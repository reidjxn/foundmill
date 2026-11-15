/**
 * Where an entity mention goes, and what its hover card says (audit GTM-19, VFR3-X1, GTM-26).
 *
 * Mentions carry an id and sometimes a kind. An agent is mentioned two ways: by its agent id (the composer's manifest
 * lists agents by agent id) or by its CRM record, whose `agentId` names the agent. Either way the mention opens the
 * agent's profile; every other record opens its CRM profile. One helper builds the href for the shell's
 * EntityLinkProvider, the Inbox's About links and the palette's records, so no surface routes an agent to the CRM.
 *
 * Pure, so it is unit-tested; the hook that feeds it lives in lib/entity-resolver.tsx.
 */
import type { EntityDetails, EntityVerb } from "@foundmill/dugout";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";

export interface EntityTarget {
  id: string;
  kind?: string | null;
  /** The agent an agent's CRM record stands for. */
  agentId?: string | null;
}

/** The agent's profile for an agent (by agent id or by its record's `agentId`); the CRM profile for anything else. */
export function entityHref(businessId: string, target: EntityTarget, isAgentId: (id: string) => boolean = () => false): string {
  if (target.agentId) return routes.agent(businessId, target.agentId);
  if (isAgentId(target.id)) return routes.agent(businessId, target.id);
  return routes.crm(businessId, target.id);
}

/** An agent of the business, as the department lists carry it. */
export interface AgentSummary {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
  modelKey?: string | null;
  avatarSeed?: string | number | null;
  /** `agents.persona_key`: the first name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
  /** `utility`: a background helper, which keeps its role name with anthropomorphic agents on. */
  layer?: string | null;
  departmentName?: string | null;
  dept?: DeptColourToken | null;
}

/** A record as `crm.entity.lookup` returns it. */
export interface EntityLookupRow {
  id: string;
  kind: string;
  displayName: string;
  agentId: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  domain?: string | null;
  roles: readonly { role: string; stage: string | null }[];
}

const words = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Right-click verbs per kind: an agent is messaged or opened; a record can also get an agent or join a list. */
export const AGENT_VERBS: EntityVerb[] = ["message", "open_profile"];
export const RECORD_VERBS: EntityVerb[] = ["message", "assign_agent", "add_to_list", "open_profile"];

/** Hover card for an agent: role, department, status and model. */
export function agentDetails(businessId: string, agent: AgentSummary): EntityDetails {
  const facts = [agent.departmentName ? { label: "Department", value: agent.departmentName } : null, agent.status ? { label: "Status", value: words(agent.status) } : null, agent.modelKey ? { label: "Model", value: agent.modelKey } : null].filter((f): f is { label: string; value: string } => f !== null);
  return {
    id: agent.id,
    kind: "agent",
    name: agent.name,
    href: routes.agent(businessId, agent.id),
    ...(agent.avatarSeed !== undefined && agent.avatarSeed !== null && agent.dept ? { portrait: { type: "agent" as const, seed: agent.avatarSeed, dept: agent.dept, personaKey: agent.personaKey ?? null } } : {}),
    personaKey: agent.personaKey ?? null,
    layer: agent.layer ?? null,
    role: agent.role ?? null,
    subtitle: agent.role ?? undefined,
    chips: agent.departmentName ? [{ label: agent.departmentName }] : undefined,
    facts,
    verbs: AGENT_VERBS,
  };
}

/** Hover card for a CRM record: its roles as chips and up to three facts (stage, email, domain). */
export function recordDetails(businessId: string, row: EntityLookupRow, isAgentId: (id: string) => boolean = () => false): EntityDetails {
  const stage = row.roles.find((r) => r.stage)?.stage ?? null;
  const facts = [stage ? { label: "Stage", value: words(stage) } : null, row.email ? { label: "Email", value: row.email } : null, row.domain ? { label: "Domain", value: row.domain } : null].filter((f): f is { label: string; value: string } => f !== null);
  const agent = Boolean(row.agentId) || row.kind === "agent";
  return {
    id: row.id,
    kind: row.kind as EntityKind,
    name: row.displayName,
    href: entityHref(businessId, row, isAgentId),
    ...(row.avatarUrl && row.kind === "person" ? { portrait: { type: "person" as const, src: row.avatarUrl } } : {}),
    chips: row.roles.length ? row.roles.map((r) => ({ label: words(r.role) })) : undefined,
    facts,
    verbs: agent ? AGENT_VERBS : RECORD_VERBS,
  };
}
