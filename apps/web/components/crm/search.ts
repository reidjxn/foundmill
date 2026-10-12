/**
 * CRM universal search (BUILD §11.12 "Search"): the operators `kind:` `role:` `stage:` `owner:` `department:` (parsed
 * by Dugout's `parseSearchQuery`), plus a deterministic natural-language pass that turns phrases such as
 * "churned customers in Growth owned by Mara" into editable filter chips. The chips map onto the same server-side
 * filters in `crm.search` (with text) and `crm.entity.list` (chips only).
 */
import { plainWords } from "@/lib/format";
import { newFilterChipId, parseSearchQuery, type FilterChipValue, type FilterField } from "@foundmill/dugout";
import { ENTITY_KINDS, type EntityKind } from "@foundmill/shared/constants";

export const CRM_FILTER_FIELDS = ["kind", "role", "stage", "owner", "department"] as const;
export type CrmFilterField = (typeof CRM_FILTER_FIELDS)[number];

/** Roles the list knows about when nothing is typed (seeded + importer roles); custom roles still show on their profiles. */
export const KNOWN_ROLES = ["customer", "lead", "champion", "supplier", "supplier_contact", "investor", "partner", "advisor", "candidate", "staff", "co_founder", "founder", "press", "vendor"] as const;

export const ROLE_WORDS: Record<string, string> = {
  customer: "customer",
  customers: "customer",
  buyer: "customer",
  buyers: "customer",
  lead: "lead",
  leads: "lead",
  prospect: "lead",
  prospects: "lead",
  champion: "champion",
  champions: "champion",
  supplier: "supplier",
  suppliers: "supplier",
  investor: "investor",
  investors: "investor",
  partner: "partner",
  partners: "partner",
  advisor: "advisor",
  advisors: "advisor",
  candidate: "candidate",
  candidates: "candidate",
  staff: "staff",
  employee: "staff",
  employees: "staff",
  founder: "founder",
  founders: "founder",
  journalist: "press",
  journalists: "press",
  press: "press",
};

export const KIND_WORDS: Record<string, EntityKind> = {
  person: "person",
  people: "person",
  persons: "person",
  contact: "person",
  contacts: "person",
  individual: "person",
  individuals: "person",
  organisation: "organisation",
  organisations: "organisation",
  organization: "organisation",
  organizations: "organisation",
  company: "organisation",
  companies: "organisation",
  org: "organisation",
  orgs: "organisation",
  business: "organisation",
  businesses: "organisation",
  agent: "agent",
  agents: "agent",
  venue: "venue",
  venues: "venue",
  community: "community",
  communities: "community",
};

export const STAGE_WORDS: Record<string, string> = {
  churned: "churned",
  cancelled: "churned",
  lost: "churned",
  activated: "activated",
  active: "activated",
  "signed up": "signed_up",
  signed_up: "signed_up",
  new: "signed_up",
  paying: "customer",
  paid: "customer",
  shortlisted: "shortlisted",
  qualified: "qualified",
  negotiating: "negotiating",
};

export const KIND_LABELS: Record<EntityKind, string> = { person: "People", organisation: "Organizations", agent: "Agents", team_member: "Team", platform_member: "Members", community: "Communities", venue: "Venues" };

export function chip(field: CrmFilterField, value: string): FilterChipValue {
  return { id: newFilterChipId(), field, op: "eq", value };
}

export interface ParsedCrmQuery {
  /** Free text left after operators and recognised phrases were removed. */
  text: string;
  chips: FilterChipValue[];
}

/**
 * Natural-language filters → chips. Recognises role and kind nouns, stage adjectives ("churned", "signed up"),
 * "owned by X" / "assigned to X", "in <department>" and "at stage X". Anything else stays as search text.
 */
export function parseNaturalLanguage(text: string, options: { departments?: readonly string[] } = {}): ParsedCrmQuery {
  const chips: FilterChipValue[] = [];
  let rest = ` ${text.trim().replace(/\s+/g, " ")} `;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = rest.match(re);
    if (m) {
      fn(m);
      rest = rest.replace(re, " ");
    }
  };
  take(/\s(?:owned by|assigned to|owner)\s+("[^"]+"|[\p{L}][\p{L}'-]*(?:\s[\p{L}][\p{L}'-]*)?)\s/iu, (m) => chips.push(chip("owner", m[1]!.replace(/^"|"$/g, "").toLowerCase())));
  take(/\s(?:at|in)\s+stage\s+("[^"]+"|[\w-]+)\s/i, (m) => chips.push(chip("stage", m[1]!.replace(/^"|"$/g, "").toLowerCase())));
  for (const dept of options.departments ?? []) {
    const re = new RegExp(`\\s(?:in|from|of)\\s+${dept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`, "i");
    take(re, () => chips.push(chip("department", dept.toLowerCase())));
  }
  for (const [word, stage] of Object.entries(STAGE_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    take(new RegExp(`\\s${word.replace(" ", "[\\s_-]")}\\s`, "i"), () => {
      if (!chips.some((c) => c.field === "stage")) chips.push(chip("stage", stage));
    });
  }
  for (const [word, role] of Object.entries(ROLE_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    take(new RegExp(`\\s${word}\\s`, "i"), () => {
      if (!chips.some((c) => c.field === "role")) chips.push(chip("role", role));
    });
  }
  for (const [word, kind] of Object.entries(KIND_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    take(new RegExp(`\\s${word}\\s`, "i"), () => {
      if (!chips.some((c) => c.field === "kind")) chips.push(chip("kind", kind));
    });
  }
  rest = rest.replace(/\s(?:all|every|show|find|list|the|me|with|who|that|are|is)\s/gi, " ").replace(/\s+/g, " ").trim();
  return { text: rest, chips };
}

/** Full parse: operators first (they win), then the natural-language pass over the remaining text. */
export function parseCrmQuery(raw: string, options: { departments?: readonly string[] } = {}): ParsedCrmQuery {
  const q = parseSearchQuery(raw);
  const chips: FilterChipValue[] = [];
  for (const field of CRM_FILTER_FIELDS) {
    const v = q.filters[field];
    if (!v) continue;
    const value = field === "kind" ? (KIND_WORDS[v] ?? v) : field === "role" ? (ROLE_WORDS[v] ?? v) : v;
    chips.push(chip(field, value));
  }
  const nl = parseNaturalLanguage(q.text, options);
  for (const c of nl.chips) if (!chips.some((x) => x.field === c.field)) chips.push(c);
  return { text: nl.text, chips };
}

export function mergeChips(existing: readonly FilterChipValue[], incoming: readonly FilterChipValue[]): FilterChipValue[] {
  const out = existing.slice();
  for (const c of incoming) {
    const i = out.findIndex((x) => x.field === c.field);
    if (i >= 0) out[i] = { ...out[i]!, op: c.op, value: c.value };
    else out.push(c);
  }
  return out;
}

export function chipValue(chips: readonly FilterChipValue[], field: CrmFilterField): string | undefined {
  const c = chips.find((x) => x.field === field);
  if (!c || c.value === undefined) return undefined;
  if (Array.isArray(c.value)) return c.value.length ? String(c.value[0]) : undefined;
  return String(c.value);
}

/** The role filters `crm.search` and `crm.entity.list` share (matched against each record's active roles). */
export interface CrmChipFilters {
  kinds?: EntityKind[];
  role?: string;
  stage?: string;
  ownerId?: string;
  departmentId?: string;
}

export interface CrmSearchInput extends CrmChipFilters {
  q: string;
  limit: number;
}

export interface SearchResolvers {
  ownerId?: (nameOrId: string) => string | undefined;
  departmentId?: (nameOrSlug: string) => string | undefined;
}

/**
 * A role or stage as the filters compare it ("Signed up" → "signed_up", "Account manager" → "account_manager"). The API
 * normalizes stored values the same way, so a chip matches whether it holds the key or the words.
 */
export const roleKey = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, "_");

/**
 * The agent or department an owner chip names, so the API can filter on its id: an exact name (or the id) first, else
 * the only owner whose name contains the words ("owned by sourcing" → "Sourcing and Manufacturing Specialist"). A name
 * several owners share resolves to none, and the screen then matches it against the loaded rows (`applyChipFilters`).
 */
export function matchOwner(value: string, owners: readonly { id: string; name: string }[]): string | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  const exact = owners.find((o) => o.id === value.trim() || o.name.toLowerCase() === v);
  if (exact) return exact.id;
  const partial = owners.filter((o) => o.name.toLowerCase().includes(v));
  return partial.length === 1 ? partial[0]!.id : undefined;
}

/**
 * Chips → the API's filters. A chip the API cannot take (an owner or department name that resolves to no id, a kind
 * that does not exist) comes back in `unresolved`, so the screen applies it to the rows itself instead of dropping it.
 */
export function chipFilters(chips: readonly FilterChipValue[], resolvers: SearchResolvers = {}): { filters: CrmChipFilters; unresolved: FilterChipValue[] } {
  const filters: CrmChipFilters = {};
  const unresolved: FilterChipValue[] = [];
  for (const c of chips) {
    const v = chipValue([c], c.field as CrmFilterField);
    if (!v) continue;
    const ownerId = c.field === "owner" ? resolvers.ownerId?.(v) : undefined;
    const departmentId = c.field === "department" ? resolvers.departmentId?.(v) : undefined;
    if (c.field === "kind" && (ENTITY_KINDS as readonly string[]).includes(v)) filters.kinds = [v as EntityKind];
    else if (c.field === "role") filters.role = roleKey(v);
    else if (c.field === "stage") filters.stage = roleKey(v);
    else if (ownerId) filters.ownerId = ownerId;
    else if (departmentId) filters.departmentId = departmentId;
    else unresolved.push(c);
  }
  return { filters, unresolved };
}

/** `crm.search` input for the box text + chips, or null when there is no text (the list then reads `crm.entity.list`). */
export function toSearchInput(text: string, chips: readonly FilterChipValue[], resolvers: SearchResolvers = {}, limit = 50): CrmSearchInput | null {
  const q = text.trim();
  if (!q) return null;
  return { q, limit, ...chipFilters(chips, resolvers).filters };
}

/** `crm.entity.list` filters for the chips (no text): the server filters every record, not just one loaded page. */
export function toListFilter(filters: CrmChipFilters): { kind?: EntityKind[]; role?: string; stage?: string; ownerId?: string; departmentId?: string } {
  const { kinds, ...rest } = filters;
  return { ...(kinds ? { kind: kinds } : {}), ...rest };
}

/** Filter fields for the editable chips (FilterChips). */
export function crmFilterFields(options: { roles?: readonly string[]; departments?: readonly { id: string; name: string }[]; owners?: readonly { id: string; name: string }[] } = {}): FilterField[] {
  const roles = [...new Set([...(options.roles ?? []), ...KNOWN_ROLES])];
  return [
    { id: "kind", label: "Kind", kind: "select", options: ENTITY_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })) },
    { id: "role", label: "Role", kind: "select", options: roles.map((r) => ({ value: r, label: plainWords(r) })) },
    { id: "stage", label: "Stage", kind: "text" },
    { id: "owner", label: "Owner", kind: options.owners?.length ? "select" : "text", options: options.owners?.map((o) => ({ value: o.name.toLowerCase(), label: o.name })) },
    { id: "department", label: "Department", kind: options.departments?.length ? "select" : "text", options: options.departments?.map((d) => ({ value: d.name.toLowerCase(), label: d.name })) },
  ];
}

/** The box text that reproduces a chip set (so the chips stay editable as text too). */
/**
 * A chip value as the founder reads and types it. Stored kinds are enum keys ("organisation"); the operator text says
 * "organization" (US English), which `KIND_WORDS` parses back to the same key.
 */
const OPERATOR_WORDS: Partial<Record<CrmFilterField, Record<string, string>>> = { kind: { organisation: "organization" } };

export function operatorValueWord(field: string, value: string): string {
  return OPERATOR_WORDS[field as CrmFilterField]?.[value] ?? value;
}

export function chipsToOperators(chips: readonly FilterChipValue[]): string {
  return chips
    .map((c) => {
      const raw = chipValue([c], c.field as CrmFilterField);
      if (!raw) return "";
      const v = operatorValueWord(c.field, raw);
      return `${c.field}:${/\s/.test(v) ? `"${v}"` : v}`;
    })
    .filter(Boolean)
    .join(" ");
}
