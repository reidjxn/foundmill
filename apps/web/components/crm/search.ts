/**
 * CRM universal search (BUILD §11.12 "Search"): the operators `kind:` `role:` `stage:` `owner:` `department:` (parsed
 * by Dugout's `parseSearchQuery`), plus a deterministic natural-language pass that turns phrases such as
 * "churned customers in Growth owned by Mara" into editable filter chips. The chips map onto `crm.search`'s input;
 * when the box is empty the list falls back to role listings filtered client-side by the same chips.
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

export const KIND_LABELS: Record<EntityKind, string> = { person: "People", organisation: "Organisations", agent: "Agents", team_member: "Team", platform_member: "Members", community: "Communities", venue: "Venues" };

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

export interface CrmSearchInput {
  q: string;
  kinds?: EntityKind[];
  role?: string;
  stage?: string;
  ownerId?: string;
  departmentId?: string;
  limit: number;
}

export interface SearchResolvers {
  ownerId?: (nameOrId: string) => string | undefined;
  departmentId?: (nameOrSlug: string) => string | undefined;
}

/** `crm.search` input for the box text + chips, or null when there is no text (the list then uses role listings). */
export function toSearchInput(text: string, chips: readonly FilterChipValue[], resolvers: SearchResolvers = {}, limit = 50): CrmSearchInput | null {
  const q = text.trim();
  if (!q) return null;
  const kind = chipValue(chips, "kind");
  const owner = chipValue(chips, "owner");
  const dept = chipValue(chips, "department");
  const input: CrmSearchInput = { q, limit };
  if (kind && (ENTITY_KINDS as readonly string[]).includes(kind)) input.kinds = [kind as EntityKind];
  const role = chipValue(chips, "role");
  if (role) input.role = role;
  const stage = chipValue(chips, "stage");
  if (stage) input.stage = stage;
  if (owner) {
    const id = resolvers.ownerId?.(owner);
    if (id) input.ownerId = id;
  }
  if (dept) {
    const id = resolvers.departmentId?.(dept);
    if (id) input.departmentId = id;
  }
  return input;
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
export function chipsToOperators(chips: readonly FilterChipValue[]): string {
  return chips
    .map((c) => {
      const v = chipValue([c], c.field as CrmFilterField);
      if (!v) return "";
      return `${c.field}:${/\s/.test(v) ? `"${v}"` : v}`;
    })
    .filter(Boolean)
    .join(" ");
}
