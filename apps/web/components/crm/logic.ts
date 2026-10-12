/**
 * Pure helpers for the CRM list and entity profiles (BUILD §11.12): row models from listed records and search hits,
 * grouped saved views, client-side chip filters, relationship strength (1–20), lead score stars (Estimate), intro
 * paths, activity/document/commercial derivations, the data-duties export and the merge banner. Unit-tested.
 */
import type { FilterChipValue, SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import type { RouterOutputs } from "@/lib/trpc";
import { formatDate, plainWords } from "@/lib/format";
import { chipValue, type CrmFilterField } from "./search";

export type EntityGet = RouterOutputs["crm"]["entity"]["get"];
export type EntityRecord = EntityGet["entity"];
export type EntityRoleRecord = EntityGet["roles"][number];
export type RelationshipRecord = EntityGet["relationships"][number];
export type InteractionRecord = EntityGet["interactions"][number];
export type MentionRecord = EntityGet["mentions"][number];
export type ConversionRecord = EntityGet["conversions"][number];
export type MergeLogRecord = EntityGet["mergeHistory"][number];
export type SearchHitRecord = RouterOutputs["crm"]["search"]["hits"][number];

export type Iso = Date | string | null | undefined;
export function toIso(d: Iso): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
const ms = (d: Iso) => {
  const iso = toIso(d);
  return iso ? Date.parse(iso) : 0;
};

export { ENTITY_TABS, ENTITY_TAB_IDS, isEntityTab, type EntityTab } from "./tabs";

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

export interface OwnerRef {
  kind: "agent" | "user" | "department";
  id: string;
}

export interface CrmRow {
  id: string;
  kind: EntityKind;
  name: string;
  email: string | null;
  domain: string | null;
  roles: string[];
  /** Stage of the primary (most recent) active role. */
  stage: string | null;
  owner: OwnerRef | null;
  lawfulBasis: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  /** Search score 0–1 when the row came from `crm.search`. */
  score?: number;
  matchedOn?: string;
}

type EntityLike = Pick<EntityRecord, "id" | "kind" | "displayName" | "identifiers" | "lawfulBasis" | "source" | "createdAt" | "updatedAt">;

function identifier(e: EntityLike, key: string): string | null {
  const v = (e.identifiers as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v ? v : null;
}

type RoleLike = Pick<EntityRoleRecord, "role" | "stage" | "ownerRef" | "startedAt" | "endedAt">;

/** Which role a row speaks for when the list is filtered by role or stage (else its most recent active role). */
export interface RowFocus {
  role?: string;
  stage?: string;
}

export function rowFromEntity(e: EntityLike, roles: readonly RoleLike[] = [], focus: RowFocus = {}): CrmRow {
  const active = roles.filter((r) => !r.endedAt).sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
  const same = (a: string | null | undefined, b: string | undefined) => !b || (a ?? "").toLowerCase() === b.toLowerCase();
  const primary = active.find((r) => (focus.role || focus.stage) && same(r.role, focus.role) && same(r.stage, focus.stage)) ?? active[0];
  return {
    id: e.id,
    kind: e.kind,
    name: e.displayName,
    email: identifier(e, "email"),
    domain: identifier(e, "domain"),
    roles: [...new Set(active.map((r) => r.role))],
    stage: primary?.stage ?? null,
    owner: ((primary?.ownerRef ?? active.find((r) => r.ownerRef)?.ownerRef) as OwnerRef | null | undefined) ?? null,
    lawfulBasis: e.lawfulBasis ?? null,
    source: e.source ?? null,
    createdAt: toIso(e.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(e.updatedAt) ?? toIso(e.createdAt) ?? new Date(0).toISOString(),
  };
}

export function rowsFromSearch(hits: readonly SearchHitRecord[], focus: RowFocus = {}): CrmRow[] {
  return hits.map((h) => ({ ...rowFromEntity(h.entity, h.roles, focus), score: h.score, matchedOn: h.matchedOn }));
}

export interface RowResolvers {
  ownerName?: (ref: OwnerRef) => string | undefined;
  departmentName?: (id: string) => string | undefined;
}

/**
 * Client-side chip filters over rows that carry their roles. The API applies every chip it can (`chipFilters`); the
 * screen runs this only for the rest, such as an owner name that resolves to no agent or department id.
 */
export function applyChipFilters(rows: readonly CrmRow[], chips: readonly FilterChipValue[], resolvers: RowResolvers = {}): CrmRow[] {
  const want = (f: CrmFilterField) => chipValue(chips, f)?.toLowerCase();
  const kind = want("kind");
  const role = want("role");
  const stage = want("stage");
  const owner = want("owner");
  const department = want("department");
  return rows.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (role && !r.roles.includes(role)) return false;
    if (stage && (r.stage ?? "").toLowerCase() !== stage) return false;
    if (owner) {
      if (!r.owner) return false;
      const name = resolvers.ownerName?.(r.owner)?.toLowerCase() ?? r.owner.id.toLowerCase();
      if (!name.includes(owner) && r.owner.id.toLowerCase() !== owner) return false;
    }
    if (department) {
      if (!r.owner || r.owner.kind !== "department") return false;
      const name = resolvers.departmentName?.(r.owner.id)?.toLowerCase() ?? r.owner.id.toLowerCase();
      if (!name.includes(department) && r.owner.id.toLowerCase() !== department) return false;
    }
    return true;
  });
}

export type GroupBy = "kind" | "role" | "stage";

export function groupCounts(rows: readonly CrmRow[], by: GroupBy): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const keys = by === "kind" ? [r.kind] : by === "role" ? (r.roles.length ? r.roles : ["no role"]) : [r.stage ?? "no stage"];
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export const CRM_VIEWS: SavedView[] = [
  { id: "all", name: "All", builtIn: true, columns: ["name", "kind", "roles", "stage", "owner", "email", "updatedAt"], sort: [{ id: "updatedAt", desc: true }], filters: [] },
  { id: "by-kind", name: "By kind", builtIn: true, columns: ["kind", "name", "roles", "stage", "owner", "updatedAt"], sort: [{ id: "kind", desc: false }, { id: "name", desc: false }], filters: [] },
  { id: "by-role", name: "By role", builtIn: true, columns: ["roles", "name", "kind", "stage", "owner", "updatedAt"], sort: [{ id: "roles", desc: false }, { id: "name", desc: false }], filters: [] },
  { id: "by-stage", name: "By stage", builtIn: true, columns: ["stage", "name", "kind", "roles", "owner", "updatedAt"], sort: [{ id: "stage", desc: false }, { id: "updatedAt", desc: true }], filters: [] },
  { id: "data-duties", name: "Data duties", builtIn: true, columns: ["name", "kind", "lawfulBasis", "source", "createdAt"], sort: [{ id: "createdAt", desc: false }], filters: [{ id: "dd1", field: "kind", op: "eq", value: "person" }] },
];

/** The grouping a view implies (its first sort column when it is a grouping column). */
export function groupByForView(view: SavedView | null | undefined): GroupBy | null {
  const first = view?.sort[0]?.id;
  return first === "kind" || first === "roles" || first === "stage" ? (first === "roles" ? "role" : first) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Profile derivations
// ---------------------------------------------------------------------------------------------------------------------

/** numeric(4,3) 0–1 → 1–20 (DESIGN §5 rating ramp). */
export function strengthRating(strength: string | number | null | undefined): number {
  const n = typeof strength === "number" ? strength : Number(strength ?? 0);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(20, Math.round(1 + 19 * Math.max(0, Math.min(1, n)))));
}

/** Relationship strength of the entity: the strongest tie to the business's own people and agents, else to anyone. */
export function relationshipStrength(relationships: readonly RelationshipRecord[]): { rating: number; via: RelationshipRecord | null } {
  if (!relationships.length) return { rating: 1, via: null };
  const own = relationships.filter((r) => r.other.kind === "team_member" || r.other.kind === "agent" || r.other.kind === "platform_member");
  const pool = own.length ? own : relationships;
  const best = pool.slice().sort((a, b) => strengthRating(b.strength) - strengthRating(a.strength))[0]!;
  return { rating: strengthRating(best.strength), via: best };
}

const STAGE_SCORE: Record<string, number> = { signed_up: 1.5, activated: 3, customer: 4.5, champion: 5, churned: 1, qualified: 2.5, shortlisted: 2.5, negotiating: 3.5 };

export interface LeadScore {
  /** 0–5 in halves. */
  stars: number;
  reasons: string[];
}

/** Lead score (Estimate): stage weight + recent activity + relationship strength, capped at five stars. */
export function leadScore(roles: readonly Pick<EntityRoleRecord, "role" | "stage" | "endedAt">[], interactions: readonly Pick<InteractionRecord, "occurredAt">[], strength: number, now: Date = new Date()): LeadScore {
  const active = roles.filter((r) => !r.endedAt);
  const reasons: string[] = [];
  let score = 0;
  const stage = active.map((r) => r.stage ?? "").find((s) => STAGE_SCORE[s] !== undefined);
  if (stage) {
    score += STAGE_SCORE[stage]!;
    reasons.push(`Stage: ${plainWords(stage).toLowerCase()}`);
  } else if (active.some((r) => r.role === "customer")) {
    score += 4;
    reasons.push("Customer");
  } else if (active.some((r) => r.role === "lead")) {
    score += 1.5;
    reasons.push("Lead");
  }
  const recent = interactions.filter((i) => now.getTime() - ms(i.occurredAt) < 30 * 86_400_000).length;
  if (recent) {
    score += Math.min(1, recent * 0.25);
    reasons.push(`${recent} ${recent === 1 ? "interaction" : "interactions"} in 30 days`);
  }
  if (strength >= 11) {
    score += 0.5;
    reasons.push(`Relationship ${strength}/20`);
  }
  return { stars: Math.max(0, Math.min(5, Math.round(score * 2) / 2)), reasons };
}

export interface IntroPath {
  via: RelationshipRecord["other"];
  type: string;
  strength: number;
  /** "You → Mara (agent) → Acme" */
  label: string;
}

/** Intro paths: who in the business (or the network) can introduce the founder to this entity, strongest first. */
export function introPaths(entityName: string, relationships: readonly RelationshipRecord[], max = 5): IntroPath[] {
  return relationships
    .filter((r) => r.other.kind !== "venue")
    .map((r) => ({ via: r.other, type: r.type, strength: strengthRating(r.strength), label: `You → ${r.other.displayName} → ${entityName}` }))
    .sort((a, b) => b.strength - a.strength || a.via.displayName.localeCompare(b.via.displayName))
    .slice(0, max);
}

export function primaryRole(roles: readonly EntityRoleRecord[]): EntityRoleRecord | null {
  return roles.filter((r) => !r.endedAt).sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0] ?? null;
}

export const STAGE_TONE: Record<string, "good" | "warn" | "bad" | "info" | "neutral"> = { customer: "good", champion: "good", activated: "info", signed_up: "info", churned: "bad", negotiating: "warn", shortlisted: "info", qualified: "info" };

/** Where a mention lives, in words ("inbox_item" → "an inbox note"). */
const CONTAINER_WORDS: Record<string, string> = { inbox_item: "an inbox note", spec_block: "the specification", spec: "the specification", document: "a document", doc: "a document", contract: "a contract", proposal: "a proposal", task: "a task", note: "a note", roadmap_item: "the roadmap" };

export function containerWord(kind: string): string {
  return CONTAINER_WORDS[kind] ?? plainWords(kind).toLowerCase();
}

export function stageWord(stage: string | null | undefined): string {
  return stage ? plainWords(stage) : "No stage";
}

/** A role in words: "design_partner" → "Design partner". */
export function roleWord(role: string): string {
  return plainWords(role);
}

/** One record's kind, singular, for a table cell or a profile chip ("Organisation", never "Organisations"). */
export const KIND_WORD: Record<EntityKind, string> = { person: "Person", organisation: "Organization", agent: "Agent", team_member: "Staff", platform_member: "Member", community: "Community", venue: "Venue" };

/** Where a record came from, in words. The agents' own records were filed under "squad" before the rename. */
const SOURCE_WORDS: Record<string, string> = { squad: "Your team", team: "Your team", manual: "Added by hand", import: "Import", agent: "An agent", membership: "Membership", conversions: "Payments", stripe: "Stripe", hubspot: "HubSpot", affinity: "Affinity", salesforce: "Salesforce", pipedrive: "Pipedrive", attio: "Attio", gmail: "Gmail", outlook: "Outlook" };

export function sourceWord(source: string | null | undefined): string {
  if (!source) return "";
  return SOURCE_WORDS[source.toLowerCase()] ?? plainWords(source);
}

/** Who can see a record, in words. */
export const VISIBILITY_WORD: Record<string, string> = { private: "Only this business", connections: "Connections", community: "Communities", public: "Public" };

export interface ActivityItem {
  id: string;
  at: string;
  kind: "email" | "meeting" | "call" | "message" | "note" | "mention" | "conversion";
  title: string;
  description?: string;
  direction?: "inbound" | "outbound" | "internal" | null;
  agentId?: string | null;
  href?: string;
}

export function activityItems(get: Pick<EntityGet, "interactions" | "mentions" | "conversions">, links: { inbox: (id: string) => string; journey: (conversionId: string) => string }): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const i of get.interactions) {
    items.push({ id: `i-${i.id}`, at: toIso(i.occurredAt) ?? new Date(0).toISOString(), kind: i.kind, title: `${i.kind.charAt(0).toUpperCase() + i.kind.slice(1)}${i.direction ? ` · ${i.direction}` : ""}`, description: i.summary || undefined, direction: i.direction, agentId: i.agentId });
  }
  for (const m of get.mentions) {
    items.push({ id: `m-${m.id}`, at: toIso(m.createdAt) ?? new Date(0).toISOString(), kind: "mention", title: `Mentioned in ${containerWord(m.containerKind)}`, href: m.containerKind === "inbox_item" ? links.inbox(m.containerId) : undefined });
  }
  for (const c of get.conversions) {
    const won = isCustomerWin(c);
    items.push({ id: `c-${c.id}`, at: toIso(c.occurredAt) ?? new Date(0).toISOString(), kind: "conversion", title: c.kind === "payment" ? (won ? "Payment" : "Repeat payment") : c.kind === "activation" ? "Activated" : "Signed up", description: c.kind === "payment" ? `${(Number(c.amountMinor) / 100).toFixed(2)} ${c.currency}` : undefined, href: won ? links.journey(c.id) : undefined });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A conversion that won a customer and so has a Customer Update; a renewal or a repeat order is revenue only (no replay). */
export const isCustomerWin = (c: Pick<ConversionRecord, "firstPayment">): boolean => c.firstPayment !== false;

export interface DocumentItem {
  id: string;
  at: string;
  title: string;
  kind: string;
  encrypted: boolean;
  href?: string;
}

/** Documents = interactions with an encrypted body plus mentions in documents/specs (bodies never leave the vault). */
export function documentItems(get: Pick<EntityGet, "interactions" | "mentions">, links: { inbox: (id: string) => string }): DocumentItem[] {
  const out: DocumentItem[] = [];
  for (const i of get.interactions) {
    if (!i.contentRef) continue;
    out.push({ id: `i-${i.id}`, at: toIso(i.occurredAt) ?? new Date(0).toISOString(), title: i.summary || `${plainWords(i.kind)} (content encrypted)`, kind: i.kind, encrypted: true });
  }
  for (const m of get.mentions) {
    if (m.containerKind === "inbox_item" || /doc|spec|contract|proposal/.test(m.containerKind)) out.push({ id: `m-${m.id}`, at: toIso(m.createdAt) ?? new Date(0).toISOString(), title: plainWords(containerWord(m.containerKind)), kind: m.containerKind, encrypted: false, href: m.containerKind === "inbox_item" ? links.inbox(m.containerId) : undefined });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export interface CommercialSummary {
  payments: number;
  totalMinor: number;
  currency: string;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
  /** Average monthly revenue over the active months (Estimate). */
  monthlyMinor: number | null;
  signedUpAt: string | null;
  activatedAt: string | null;
}

export function commercialSummary(conversions: readonly ConversionRecord[], fallbackCurrency = "EUR"): CommercialSummary {
  const payments = conversions.filter((c) => c.kind === "payment").sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
  const total = payments.reduce((s, p) => s + Number(p.amountMinor), 0);
  const first = payments[0] ? toIso(payments[0].occurredAt) : null;
  const last = payments.length ? toIso(payments[payments.length - 1]!.occurredAt) : null;
  const months = first && last ? Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / (30 * 86_400_000)) + 1) : null;
  return {
    payments: payments.length,
    totalMinor: total,
    currency: payments[0]?.currency ?? fallbackCurrency,
    firstPaymentAt: first,
    lastPaymentAt: last,
    monthlyMinor: months ? Math.round(total / months) : null,
    signedUpAt: toIso(conversions.find((c) => c.kind === "signup")?.occurredAt),
    activatedAt: toIso(conversions.find((c) => c.kind === "activation")?.occurredAt),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Data duties (BUILD §11.12 "Data duties")
// ---------------------------------------------------------------------------------------------------------------------

export const LAWFUL_BASES = ["consent", "contract", "legitimate_interest", "legal_obligation", "vital_interest", "public_task"] as const;
export const LAWFUL_BASIS_LABEL: Record<string, string> = { consent: "Consent", contract: "Contract", legitimate_interest: "Legitimate interest", legal_obligation: "Legal obligation", vital_interest: "Vital interest", public_task: "Public task" };

/** Everything the business holds on the person, as a JSON document (bodies stay encrypted: only their references). */
export function exportEntityJson(get: EntityGet, exportedAt: Date = new Date()): string {
  const { entity, roles, relationships, interactions, mentions, conversions, mergeHistory } = get;
  return JSON.stringify(
    {
      exportedAt: exportedAt.toISOString(),
      entity: { id: entity.id, kind: entity.kind, displayName: entity.displayName, aliases: entity.aliases, identifiers: entity.identifiers, lawfulBasis: entity.lawfulBasis, source: entity.source, visibility: entity.visibility, createdAt: entity.createdAt, updatedAt: entity.updatedAt },
      roles: roles.map((r) => ({ role: r.role, stage: r.stage, owner: r.ownerRef, startedAt: r.startedAt, endedAt: r.endedAt })),
      relationships: relationships.map((r) => ({ type: r.type, strength: r.strength, with: r.other })),
      interactions: interactions.map((i) => ({ kind: i.kind, occurredAt: i.occurredAt, direction: i.direction, summary: i.summary, bodyRef: i.contentRef })),
      mentions: mentions.map((m) => ({ in: m.containerKind, id: m.containerId, at: m.createdAt })),
      conversions: conversions.map((c) => ({ kind: c.kind, amountMinor: c.amountMinor, currency: c.currency, occurredAt: c.occurredAt })),
      merges: mergeHistory.map((m) => ({ keptId: m.keptId, mergedId: m.mergedId, at: m.createdAt, revertedAt: m.revertedAt })),
    },
    null,
    2,
  );
}

export function deletionRequestNote(requestedBy: string, now: Date = new Date()): string {
  return `Deletion requested by ${requestedBy} on ${formatDate(now)}. Runs in the scheduled, audited deletion job approved by the founder at setup; suppression entry kept so the person is not re-imported.`;
}

export const RETENTION_COPY = "Leads who never became customers are deleted after 24 months by a scheduled job you approved at setup, and every run is logged. Export and deletion requests for one person start from their profile.";

/** The open (not reverted) merge that produced this record, if any, and the merges it absorbed. */
export function mergeBanner(get: Pick<EntityGet, "entity" | "mergeHistory" | "redirectedFrom">): { redirected: boolean; absorbed: MergeLogRecord[]; open: MergeLogRecord[] } {
  const open = get.mergeHistory.filter((m) => !m.revertedAt);
  return { redirected: !!get.redirectedFrom, absorbed: open.filter((m) => m.keptId === get.entity.id), open };
}

/** Sort rows so grouped views read as groups: group key first, then name. Used by the group summary strip. */
export function groupLabel(by: GroupBy, key: string): string {
  if (by === "kind") return ({ person: "People", organisation: "Organizations", agent: "Agents", team_member: "Staff", platform_member: "Members", community: "Communities", venue: "Venues" } as Record<string, string>)[key] ?? plainWords(key);
  return plainWords(key);
}
