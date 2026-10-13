/**
 * entities, entity_roles, relationships, interactions, mentions, field_provenance, merge_log — the CRM
 * (BUILD §7.2 "CRM", §11.12; routers crm.search / entity.get / update / merge / unmerge / notes / roles).
 *
 * `search` is the hybrid typeahead: pg_trgm similarity on display_name and aliases (GIN-indexed), the
 * trigger-maintained `search` tsvector (name A, aliases B, email/domain C) and, when the caller supplies a
 * query embedding, pgvector cosine similarity. One score per row (the best signal wins, exact identifier
 * and prefix matches rank first) and the result is grouped by kind for the picker.
 *
 * `merge`/`unmerge` are reversible (AC-11.12.3): the merge_log row keeps a snapshot of both entity rows
 * as they were before the merge and the ids of every CRM child row it re-pointed. `unmerge` reverts only
 * what the merge itself changed (the aliases, identifiers and empty fields it filled, where they still hold
 * what the merge wrote, and the child rows it moved), so edits made since and later merges survive; it
 * refuses, with the reason, while a later merge relies on what this one brought in. Journey rows (visitors,
 * touches, conversions) are never re-pointed — they are service-written and resolve through
 * `merged_into_id` (`resolve`).
 */
import { AppError, ENTITY_KINDS, INTERACTION_KINDS, ValidationError, VISIBILITY, type EntityKind } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  ACTOR_BY_KINDS, entities, entityRoles, fieldProvenance, interactions, INTERACTION_DIRECTIONS, mentions, mergeLog, relationships,
  type Entity, type EntityRole, type FieldProvenance, type Interaction, type Mention, type MergeLogEntry, type Relationship,
} from "../schema";
import { DateRange, defined, Id, IsoDateInput, numericText, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const STRONG_IDENTIFIERS = ["email", "domain", "linkedin", "reg_no", "stripe_id"] as const;
export type StrongIdentifier = (typeof STRONG_IDENTIFIERS)[number];

export const Identifiers = z.record(z.string(), z.unknown()).refine((o) => Object.values(o).every((v) => v === null || typeof v === "string"), { message: "identifiers are strings" });

export const CreateEntityInput = z.object({
  /** A caller-chosen id (ingest keys a payer's record by a business-scoped id derived from the vendor's customer id). */
  id: Id.optional(),
  kind: z.enum(ENTITY_KINDS),
  displayName: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).default([]),
  avatarUrl: z.string().max(2048).nullable().optional(),
  identifiers: Identifiers.default({}),
  lawfulBasis: z.string().max(80).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  embedding: z.array(z.number()).length(1024).nullable().optional(),
  visibility: z.enum(VISIBILITY).default("private"),
  agentId: Id.nullable().optional(),
});
export type CreateEntityInput = z.input<typeof CreateEntityInput>;

export const UpdateEntityInput = patchSchema(CreateEntityInput.omit({ id: true, kind: true }));
export type UpdateEntityInput = z.input<typeof UpdateEntityInput>;

export const EntityListFilter = PageInput.extend({
  kind: z.union([z.enum(ENTITY_KINDS), z.array(z.enum(ENTITY_KINDS))]).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  /** `role:` / `stage:` / `owner:` / `department:` filters on the entity's active roles (as in `SearchInput`). */
  role: z.string().max(80).optional(),
  stage: z.string().max(80).optional(),
  ownerId: Id.optional(),
  departmentId: Id.optional(),
  includeArchived: z.boolean().default(false),
  includeMerged: z.boolean().default(false),
});
export type EntityListFilter = z.input<typeof EntityListFilter>;

export const SearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  kinds: z.array(z.enum(ENTITY_KINDS)).optional(),
  /** `role:` / `stage:` / `owner:` / `department:` operators (BUILD §11.12). */
  role: z.string().max(80).optional(),
  stage: z.string().max(80).optional(),
  ownerId: Id.optional(),
  departmentId: Id.optional(),
  /** Query embedding (1024-d) for the meaning leg; omitted = lexical only. */
  embedding: z.array(z.number()).length(1024).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  /** Minimum score to return (0–1). */
  minScore: z.number().min(0).max(1).default(0.2),
  /** Hits to skip (best first): page through every match with `limit` and the result's `nextOffset`. */
  offset: z.number().int().min(0).max(100_000).default(0),
});
export type SearchInput = z.input<typeof SearchInput>;

/** An active role as the CRM list shows it (role, stage, owner); newest first per entity. */
export type ActiveRole = Pick<EntityRole, "id" | "role" | "stage" | "ownerRef" | "startedAt" | "endedAt">;
export type EntityWithRoles = Entity & { roles: ActiveRole[] };

export type SearchMatch = "identifier" | "prefix" | "name" | "alias" | "text" | "meaning";
export interface SearchHit {
  entity: Entity;
  /** The entity's active roles, so a result row shows role, stage and owner like a listed one. */
  roles: ActiveRole[];
  score: number;
  matchedOn: SearchMatch;
}
export interface SearchResult {
  hits: SearchHit[];
  groups: { kind: EntityKind; hits: SearchHit[] }[];
  /** Hits in this page. */
  total: number;
  /** The `offset` of the next page; null when these hits were the last. */
  nextOffset: number | null;
}

export const AddRoleInput = z.object({
  role: z.string().trim().min(1).max(80),
  stage: z.string().max(80).nullable().optional(),
  ownerRef: z.object({ kind: z.enum(["agent", "user", "department"]), id: Id }).nullable().optional(),
  startedAt: IsoDateInput.optional(),
});
export type AddRoleInput = z.input<typeof AddRoleInput>;

export const UpsertRelationshipInput = z.object({
  fromEntity: Id,
  toEntity: Id,
  type: z.string().trim().min(1).max(80),
  strength: z.number().min(0).max(1).default(0.5),
});
export type UpsertRelationshipInput = z.input<typeof UpsertRelationshipInput>;

export const CreateInteractionInput = z.object({
  kind: z.enum(INTERACTION_KINDS),
  occurredAt: IsoDateInput.optional(),
  entityIds: z.array(Id).min(1),
  agentId: Id.nullable().optional(),
  /** Pointer to the encrypted body; the body itself never enters this table. */
  contentRef: z.string().max(2048).nullable().optional(),
  summary: z.string().max(4000).default(""),
  direction: z.enum(INTERACTION_DIRECTIONS).nullable().optional(),
});
export type CreateInteractionInput = z.input<typeof CreateInteractionInput>;

export const InteractionListFilter = PageInput.extend(DateRange.shape).extend({
  entityId: Id.optional(),
  kind: z.union([z.enum(INTERACTION_KINDS), z.array(z.enum(INTERACTION_KINDS))]).optional(),
});
export type InteractionListFilter = z.input<typeof InteractionListFilter>;

export const RecordProvenanceInput = z.object({
  field: z.string().min(1).max(80),
  source: z.string().min(1).max(120),
  sourceRef: z.string().max(2048).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  observedAt: IsoDateInput.optional(),
});
export type RecordProvenanceInput = z.input<typeof RecordProvenanceInput>;

export const MergeOptions = z.object({ byKind: z.enum(ACTOR_BY_KINDS).default("user"), byId: Id.nullable().optional() });
export type MergeOptions = z.input<typeof MergeOptions>;

export type RelationshipWithOther = Relationship & { other: Pick<Entity, "id" | "kind" | "displayName"> };
export interface EntityProfile {
  entity: Entity;
  roles: EntityRole[];
  relationships: RelationshipWithOther[];
  recentInteractions: Interaction[];
  mentionCount: number;
}

/** What a merge_log row records so `unmerge` can put everything back. */
interface MergeSnapshot {
  /** Both rows as they were before the merge (SNAPSHOT_FIELDS, dates as ISO strings). */
  kept: Record<string, unknown>;
  merged: Record<string, unknown>;
  /**
   * The child rows the merge re-pointed. `sharedInteractions` (absent on merges logged before it existed) are the
   * moved interactions that already listed the kept record: undoing the merge adds the merged record back to them
   * instead of swapping the kept one out.
   */
  moved: { roles: string[]; relationships: string[]; mentions: string[]; provenance: string[]; interactions: string[]; sharedInteractions?: string[] };
}

const SNAPSHOT_FIELDS = ["displayName", "aliases", "avatarUrl", "identifiers", "lawfulBasis", "source", "visibility", "agentId", "mergedIntoId", "archivedAt"] as const;

/** The kept record's fields a merge reads or writes. */
interface MergeFields {
  displayName: string;
  aliases: string[];
  identifiers: Record<string, unknown>;
  avatarUrl: string | null;
  lawfulBasis: string | null;
  source: string | null;
}
/** Fields a merge fills on the kept record when they are empty there. */
const FILLED_FIELDS = ["avatarUrl", "lawfulBasis", "source"] as const;
type FilledField = (typeof FILLED_FIELDS)[number];

/** A later merge that has to be undone before this one (it relies on what this one brought in). */
export interface UnmergeBlocker {
  mergeLogId: string;
  /** "later_merge": a later merge into the same record; "absorbed": the kept record was itself merged away since. */
  kind: "later_merge" | "absorbed";
  /** The record the later merge absorbed, or the one the kept record was merged into. */
  recordName: string;
  /** What the later merge relies on, in words ("the email", "the name “Jon”"); empty for "absorbed". */
  reasons: string[];
}
export type MergeHistoryEntry = MergeLogEntry & {
  /** Why this open merge cannot be undone yet (a later merge relies on it), or null. */
  undoBlocked: string | null;
};

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const fieldsOf = (s: Record<string, unknown>): MergeFields => ({
  displayName: s.displayName as string,
  aliases: (s.aliases as string[] | undefined) ?? [],
  identifiers: (s.identifiers as Record<string, unknown> | undefined) ?? {},
  avatarUrl: (s.avatarUrl as string | null | undefined) ?? null,
  lawfulBasis: (s.lawfulBasis as string | null | undefined) ?? null,
  source: (s.source as string | null | undefined) ?? null,
});
const namesOf = (e: Pick<MergeFields, "displayName" | "aliases">) => [e.displayName, ...e.aliases];

/** What a merge writes on the kept record: the merged record's names become aliases; identifiers and empty fields are filled. */
function mergedFields(kept: MergeFields, merged: MergeFields): Omit<MergeFields, "displayName"> {
  const keptIdentifiers = Object.fromEntries(Object.entries(kept.identifiers).filter(([, v]) => !isEmpty(v)));
  return {
    aliases: uniq([...kept.aliases, ...namesOf(merged)].filter((a) => a !== kept.displayName)),
    identifiers: { ...merged.identifiers, ...keptIdentifiers },
    avatarUrl: kept.avatarUrl ?? merged.avatarUrl,
    lawfulBasis: kept.lawfulBasis ?? merged.lawfulBasis,
    source: kept.source ?? merged.source,
  };
}

/**
 * What undoing a merge changes on the kept record now. The merge's own changes are recomputed from its snapshot
 * (`mergedFields` over the two pre-merge rows) and each is put back only where the record still holds what the merge
 * wrote: the aliases it added go, the identifiers and empty fields it filled return to their pre-merge value. Anything
 * edited since (a rename, a new email) and anything a later merge added is left alone.
 */
function revertPlan(snap: MergeSnapshot, current: MergeFields) {
  const before = fieldsOf(snap.kept);
  const after = mergedFields(before, fieldsOf(snap.merged));
  const aliases = after.aliases.filter((a) => !before.aliases.includes(a) && current.aliases.includes(a));
  const identifierKeys = uniq([...Object.keys(before.identifiers), ...Object.keys(after.identifiers)]).filter((k) => {
    const changed = has(before.identifiers, k) !== has(after.identifiers, k) || before.identifiers[k] !== after.identifiers[k];
    const stillAsMerged = has(current.identifiers, k) === has(after.identifiers, k) && current.identifiers[k] === after.identifiers[k];
    return changed && stillAsMerged;
  });
  const fields = FILLED_FIELDS.filter((f) => before[f] !== after[f] && current[f] === after[f]);

  const identifiers = { ...current.identifiers };
  for (const k of identifierKeys) {
    if (has(before.identifiers, k)) identifiers[k] = before.identifiers[k];
    else delete identifiers[k];
  }
  const patch: Partial<Pick<Entity, "aliases" | "identifiers" | FilledField>> = { aliases: current.aliases.filter((a) => !aliases.includes(a)), identifiers: identifiers as Entity["identifiers"] };
  for (const f of fields) patch[f] = before[f];
  return { patch, aliases, identifierKeys, fields };
}

/** An identifier or filled field in words, for the reason Unmerge has to wait. */
const IDENTIFIER_WORDS: Record<string, string> = { email: "email", domain: "domain", linkedin: "LinkedIn profile", reg_no: "company number", stripe_id: "Stripe customer", phone: "phone number" };
const FIELD_WORDS: Record<FilledField, string> = { avatarUrl: "photo", lawfulBasis: "lawful basis", source: "source" };
const identifierWord = (key: string) => IDENTIFIER_WORDS[key] ?? key.replace(/[_-]+/g, " ");
const joinWords = (words: readonly string[]) => (words.length <= 2 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** The founder-facing explanation of why a merge cannot be undone yet. */
export function describeUnmergeBlockers(blockers: readonly UnmergeBlocker[]): string {
  return blockers
    .map((b) =>
      b.kind === "absorbed"
        ? `This record was merged into “${b.recordName}” afterwards. Undo that merge first.`
        : `Undo the later merge of “${b.recordName}” first: it relies on what this merge brought in (${joinWords(b.reasons)}).`,
    )
    .join(" ");
}

/** Locks entity rows for the rest of the transaction, in id order so concurrent merges cannot deadlock. */
async function lockEntities(db: Executor, businessId: string, ids: readonly string[]): Promise<Entity[]> {
  return db
    .select()
    .from(entities)
    .where(and(eq(entities.businessId, businessId), inArray(entities.id, [...ids])))
    .orderBy(asc(entities.id))
    .for("update");
}

/** Every merge-log row an entity took part in (kept or merged), newest first. */
async function mergeLogsOf(db: Executor, businessId: string, entityId: string): Promise<MergeLogEntry[]> {
  return db
    .select()
    .from(mergeLog)
    .where(and(eq(mergeLog.businessId, businessId), or(eq(mergeLog.keptId, entityId), eq(mergeLog.mergedId, entityId))))
    .orderBy(desc(mergeLog.createdAt), desc(mergeLog.id));
}

/**
 * The later, still-open merges that rely on `log`, so undoing it now would not be exact: the kept record was merged
 * into another one since; or a later merge into the same record carried an identifier, filled field or name that this
 * merge had already brought in (so the later merge did not add it), shares an interaction with it, or left a
 * relationship or mention on its own record because a row this merge moved already held that slot.
 * `history` is `mergeLogsOf(keptId)` (newest first, in the database's own order, so "later" is exact to the
 * microsecond); `current` is the kept record now.
 */
async function unmergeBlockers(db: Executor, businessId: string, log: MergeLogEntry, current: Entity, history: readonly MergeLogEntry[]): Promise<UnmergeBlocker[]> {
  const snap = log.reversibleSnapshot as unknown as MergeSnapshot;
  const open = history.filter((m) => m.id !== log.id && !m.revertedAt);
  const blockers: UnmergeBlocker[] = open
    .filter((m) => m.mergedId === log.keptId)
    .map((m) => ({ mergeLogId: m.id, kind: "absorbed", recordName: fieldsOf((m.reversibleSnapshot as unknown as MergeSnapshot).kept).displayName, reasons: [] }));
  const position = history.findIndex((m) => m.id === log.id);
  const later = history.slice(0, Math.max(0, position)).filter((m) => !m.revertedAt && m.keptId === log.keptId);
  if (!later.length) return blockers;

  const plan = revertPlan(snap, fieldsOf(current));
  const reasons = new Map<string, string[]>(later.map((m) => [m.id, []]));
  const byMergedId = new Map(later.map((m) => [m.mergedId, m.id]));
  for (const m of later) {
    const s = m.reversibleSnapshot as unknown as MergeSnapshot;
    const other = fieldsOf(s.merged);
    const r = reasons.get(m.id)!;
    for (const k of plan.identifierKeys) if (!isEmpty(other.identifiers[k])) r.push(`the ${identifierWord(k)}`);
    for (const f of plan.fields) if (other[f] !== null) r.push(`the ${FIELD_WORDS[f]}`);
    for (const a of plan.aliases) if (namesOf(other).includes(a)) r.push(`the name “${a}”`);
    if (s.moved.interactions.some((id) => snap.moved.interactions.includes(id))) r.push("an interaction both records were part of");
  }

  const laterIds = [...byMergedId.keys()];
  if (snap.moved.relationships.length) {
    const z = alias(relationships, "z");
    const rows = await db
      .select({ from: z.fromEntity, to: z.toEntity })
      .from(relationships)
      .innerJoin(
        z,
        and(
          eq(z.businessId, relationships.businessId),
          eq(z.type, relationships.type),
          or(
            and(eq(relationships.fromEntity, log.keptId), eq(z.toEntity, relationships.toEntity), inArray(z.fromEntity, laterIds)),
            and(eq(relationships.toEntity, log.keptId), eq(z.fromEntity, relationships.fromEntity), inArray(z.toEntity, laterIds)),
          ),
        ),
      )
      .where(and(eq(relationships.businessId, businessId), inArray(relationships.id, snap.moved.relationships)));
    for (const row of rows) reasons.get(byMergedId.get(row.from) ?? byMergedId.get(row.to)!)?.push("a relationship both records had");
  }
  if (snap.moved.mentions.length) {
    const z = alias(mentions, "z");
    const rows = await db
      .select({ entityId: z.entityId })
      .from(mentions)
      .innerJoin(z, and(eq(z.businessId, mentions.businessId), eq(z.containerKind, mentions.containerKind), eq(z.containerId, mentions.containerId), inArray(z.entityId, laterIds)))
      .where(and(eq(mentions.businessId, businessId), inArray(mentions.id, snap.moved.mentions), eq(mentions.entityId, log.keptId)));
    for (const row of rows) reasons.get(byMergedId.get(row.entityId)!)?.push("a mention both records had");
  }

  for (const m of later) {
    const r = uniq(reasons.get(m.id)!);
    if (r.length) blockers.push({ mergeLogId: m.id, kind: "later_merge", recordName: fieldsOf((m.reversibleSnapshot as unknown as MergeSnapshot).merged).displayName, reasons: r });
  }
  return blockers;
}

const scoped = (businessId: string, entityId: string) => and(eq(entities.businessId, businessId), eq(entities.id, entityId));
const live = and(isNull(entities.archivedAt), isNull(entities.mergedIntoId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const uniq = (xs: string[]) => [...new Set(xs)];
const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/** An active role matching every given filter (role and stage case-insensitively, as the founder types them). */
function roleFilter(businessId: string, f: { role?: string; stage?: string; ownerId?: string; departmentId?: string }): SQL | undefined {
  if (!f.role && !f.stage && !f.ownerId && !f.departmentId) return undefined;
  const conds: SQL[] = [sql`r.business_id = ${businessId}::uuid`, sql`r.entity_id = ${entities.id}`, sql`r.ended_at is null`];
  if (f.role) conds.push(sql`lower(r.role) = lower(${f.role})`);
  if (f.stage) conds.push(sql`lower(r.stage) = lower(${f.stage})`);
  if (f.ownerId) conds.push(sql`r.owner_ref ->> 'id' = ${f.ownerId}`);
  if (f.departmentId) conds.push(sql`r.owner_ref ->> 'kind' = 'department' and r.owner_ref ->> 'id' = ${f.departmentId}`);
  return sql`exists (select 1 from entity_roles r where ${sql.join(conds, sql` and `)})`;
}

/** The filters `list`, `listWithRoles` and `count` share. */
function listConditions(businessId: string, f: z.output<typeof EntityListFilter>): SQL | undefined {
  const kinds = toArray(f.kind);
  return and(
    eq(entities.businessId, businessId),
    f.includeArchived ? undefined : isNull(entities.archivedAt),
    f.includeMerged ? undefined : isNull(entities.mergedIntoId),
    kinds?.length ? inArray(entities.kind, kinds) : undefined,
    f.visibility ? eq(entities.visibility, f.visibility) : undefined,
    roleFilter(businessId, f),
  );
}

export const entitiesRepo = {
  async list(db: Executor, businessId: string, filter: EntityListFilter = {}): Promise<Page<Entity>> {
    const f = parseInput(EntityListFilter, filter, "entity filter");
    const ks = timeKeyset<Entity>(entities.createdAt, entities.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(entities)
      .where(and(listConditions(businessId, f), ks.after(f.cursor)))
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** How many entities `list` pages through for these filters: the CRM's true total (cursor and limit are ignored). */
  async count(db: Executor, businessId: string, filter: EntityListFilter = {}): Promise<number> {
    const f = parseInput(EntityListFilter, filter, "entity filter");
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(entities).where(listConditions(businessId, f));
    return Number(row?.n ?? 0);
  },

  /** `list` with each entity's active roles (role, stage, owner): what the CRM list, its views and its filters read. */
  async listWithRoles(db: Executor, businessId: string, filter: EntityListFilter = {}): Promise<Page<EntityWithRoles>> {
    const page = await entitiesRepo.list(db, businessId, filter);
    const roles = await entitiesRepo.activeRoles(db, businessId, page.items.map((e) => e.id));
    return { ...page, items: page.items.map((e) => ({ ...e, roles: roles.get(e.id) ?? [] })) };
  },

  /** Active roles of many entities in one query, newest first per entity. */
  async activeRoles(db: Executor, businessId: string, entityIds: readonly string[]): Promise<Map<string, ActiveRole[]>> {
    const out = new Map<string, ActiveRole[]>();
    if (entityIds.length === 0) return out;
    const rows = await db
      .select({ entityId: entityRoles.entityId, id: entityRoles.id, role: entityRoles.role, stage: entityRoles.stage, ownerRef: entityRoles.ownerRef, startedAt: entityRoles.startedAt, endedAt: entityRoles.endedAt })
      .from(entityRoles)
      .where(and(eq(entityRoles.businessId, businessId), inArray(entityRoles.entityId, uniq([...entityIds])), isNull(entityRoles.endedAt)))
      .orderBy(desc(entityRoles.startedAt), asc(entityRoles.id));
    for (const { entityId, ...role } of rows) out.set(entityId, [...(out.get(entityId) ?? []), role]);
    return out;
  },

  async get(db: Executor, businessId: string, entityId: string): Promise<Entity> {
    return one(await db.select().from(entities).where(scoped(businessId, entityId)).limit(1), "entity", entityId);
  },

  async byIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    return db.select().from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, [...ids])));
  },

  /** Follows merged_into links to the surviving record (a merged id still resolves for old links). */
  async resolve(db: Executor, businessId: string, entityId: string): Promise<Entity> {
    let current = await entitiesRepo.get(db, businessId, entityId);
    for (let hops = 0; current.mergedIntoId && hops < 16; hops++) current = await entitiesRepo.get(db, businessId, current.mergedIntoId);
    return current;
  },

  /** The manifest the entity-linker builds from: every visible (not archived, not merged) entity's id, kind, name and aliases. */
  async manifest(db: Executor, businessId: string, options: { ids?: readonly string[]; limit?: number } = {}): Promise<Pick<Entity, "id" | "kind" | "displayName" | "aliases">[]> {
    if (options.ids && options.ids.length === 0) return [];
    return db
      .select({ id: entities.id, kind: entities.kind, displayName: entities.displayName, aliases: entities.aliases })
      .from(entities)
      .where(and(eq(entities.businessId, businessId), live, options.ids ? inArray(entities.id, [...options.ids]) : undefined))
      .orderBy(asc(entities.displayName))
      .limit(options.limit ?? 2000);
  },

  async create(db: Executor, businessId: string, input: CreateEntityInput): Promise<Entity> {
    const v = parseInput(CreateEntityInput, input, "entity");
    return one(
      await db
        .insert(entities)
        .values({
          ...(v.id ? { id: v.id } : {}),
          businessId,
          kind: v.kind,
          displayName: v.displayName,
          aliases: uniq(v.aliases.filter((a) => a !== v.displayName)),
          avatarUrl: v.avatarUrl ?? null,
          identifiers: v.identifiers as Entity["identifiers"],
          lawfulBasis: v.lawfulBasis ?? null,
          source: v.source ?? null,
          embedding: v.embedding ?? null,
          visibility: v.visibility,
          agentId: v.agentId ?? null,
        })
        .returning(),
      "entity",
    );
  },

  async update(db: Executor, businessId: string, entityId: string, input: UpdateEntityInput): Promise<Entity> {
    const v = parseInput(UpdateEntityInput, input, "entity update");
    const patch = defined({ ...v, identifiers: v.identifiers as Entity["identifiers"] | undefined, aliases: v.aliases ? uniq(v.aliases) : undefined });
    return one(await db.update(entities).set(patch).where(scoped(businessId, entityId)).returning(), "entity", entityId);
  },

  /** Enrichment fills empty fields only (BUILD §11.12): existing identifiers, avatar and aliases are kept. */
  async enrich(db: Executor, businessId: string, entityId: string, input: { identifiers?: Record<string, unknown>; aliases?: string[]; avatarUrl?: string | null; source?: string }): Promise<Entity> {
    const v = parseInput(z.object({ identifiers: Identifiers.optional(), aliases: z.array(z.string().min(1)).optional(), avatarUrl: z.string().nullable().optional(), source: z.string().optional() }), input, "enrichment");
    return db.transaction(async (tx) => {
      const current = await entitiesRepo.get(tx, businessId, entityId);
      const identifiers = { ...(v.identifiers ?? {}), ...Object.fromEntries(Object.entries(current.identifiers).filter(([, val]) => val !== null && val !== undefined && val !== "")) };
      return one(
        await tx
          .update(entities)
          .set({
            identifiers: identifiers as Entity["identifiers"],
            aliases: uniq([...current.aliases, ...(v.aliases ?? [])].filter((a) => a !== current.displayName)),
            avatarUrl: current.avatarUrl ?? v.avatarUrl ?? null,
            source: current.source ?? v.source ?? null,
          })
          .where(scoped(businessId, entityId))
          .returning(),
        "entity",
        entityId,
      );
    });
  },

  async setEmbedding(db: Executor, businessId: string, entityId: string, embedding: number[] | null): Promise<void> {
    const e = parseInput(z.array(z.number()).length(1024).nullable(), embedding, "embedding");
    await db.update(entities).set({ embedding: e }).where(scoped(businessId, entityId));
  },

  async archive(db: Executor, businessId: string, entityId: string): Promise<Entity> {
    return one(await db.update(entities).set({ archivedAt: new Date() }).where(scoped(businessId, entityId)).returning(), "entity", entityId);
  },

  /** Exact match on a strong identifier (email, domain, linkedin, reg_no, stripe_id), case-insensitive. */
  async findByIdentifier(db: Executor, businessId: string, key: StrongIdentifier, value: string): Promise<Entity | null> {
    const k = parseInput(z.enum(STRONG_IDENTIFIERS), key, "identifier");
    const rows = await db
      .select()
      .from(entities)
      .where(and(eq(entities.businessId, businessId), live, sql`lower(${entities.identifiers} ->> ${k}) = lower(${value})`))
      .orderBy(asc(entities.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  async countByKind(db: Executor, businessId: string): Promise<Record<EntityKind, number>> {
    const rows = await db.select({ kind: entities.kind, n: sql<number>`count(*)::int` }).from(entities).where(and(eq(entities.businessId, businessId), live)).groupBy(entities.kind);
    const out = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>;
    for (const r of rows) out[r.kind] = Number(r.n);
    return out;
  },

  // search ------------------------------------------------------------------------------------------------------------
  async search(db: Executor, businessId: string, input: SearchInput): Promise<SearchResult> {
    const v = parseInput(SearchInput, input, "search");
    const q = v.q;
    const tsq = sql`plainto_tsquery('simple', ${q})`;
    const nameSim = sql<number>`similarity(${entities.displayName}, ${q})`;
    const aliasSim = sql<number>`coalesce((select max(similarity(a, ${q})) from unnest(${entities.aliases}) as a), 0)`;
    const prefix = sql<boolean>`left(lower(${entities.displayName}), length(${q})) = lower(${q})`;
    const identifier = sql<boolean>`exists (select 1 from jsonb_each_text(${entities.identifiers}) i where lower(i.value) = lower(${q}))`;
    const textMatch = sql<boolean>`${entities.search} @@ ${tsq}`;
    const textScore = sql<number>`case when ${entities.search} @@ ${tsq} then 0.6 + least(0.3, ts_rank(${entities.search}, ${tsq})) else 0 end`;
    const vec = v.embedding ? sql<number>`case when ${entities.embedding} is null then 0 else 1 - (${entities.embedding} <=> ${vectorLiteral(v.embedding)}::vector) end` : sql<number>`0`;
    const score = sql<number>`greatest(
      case when ${identifier} then 1.0 else 0 end,
      case when ${prefix} then 0.95 else 0 end,
      ${nameSim},
      ${aliasSim},
      ${textScore},
      ${vec} * 0.9
    )`;
    const candidate = or(
      sql`${entities.displayName} % ${q}`,
      sql`exists (select 1 from unnest(${entities.aliases}) a where a % ${q})`,
      prefix,
      identifier,
      textMatch,
      v.embedding ? sql`${vec} > 0.5` : undefined,
    );
    const rows = await db
      .select({ entity: entities, score, nameSim, aliasSim, prefix, identifier, textMatch, vec })
      .from(entities)
      .where(and(eq(entities.businessId, businessId), live, v.kinds?.length ? inArray(entities.kind, v.kinds) : undefined, roleFilter(businessId, v), candidate))
      .orderBy(desc(score), asc(entities.displayName), asc(entities.id))
      .limit(v.limit + 1)
      .offset(v.offset);

    // One row past the page says another page follows (hits below `minScore` rank last, so they end the list).
    const more = rows.length > v.limit;
    const scored = rows
      .slice(0, v.limit)
      .map((r) => {
        const s = Number(r.score);
        const matchedOn: SearchMatch = r.identifier ? "identifier" : r.prefix ? "prefix" : Number(r.vec) * 0.9 >= s - 1e-9 && Number(r.vec) > 0 ? "meaning" : Number(r.nameSim) >= s - 1e-9 ? "name" : Number(r.aliasSim) >= s - 1e-9 ? "alias" : "text";
        return { entity: r.entity, score: Math.round(s * 1000) / 1000, matchedOn };
      })
      .filter((h) => h.score >= v.minScore);
    const nextOffset = more && scored.length === v.limit ? v.offset + v.limit : null;
    const roles = await entitiesRepo.activeRoles(db, businessId, scored.map((h) => h.entity.id));
    const hits: SearchHit[] = scored.map((h) => ({ ...h, roles: roles.get(h.entity.id) ?? [] }));
    const byKind = new Map<EntityKind, SearchHit[]>();
    for (const h of hits) byKind.set(h.entity.kind, [...(byKind.get(h.entity.kind) ?? []), h]);
    const groups = ENTITY_KINDS.filter((k) => byKind.has(k)).map((kind) => ({ kind, hits: byKind.get(kind)! }));
    return { hits, groups, total: hits.length, nextOffset };
  },

  // roles -------------------------------------------------------------------------------------------------------------
  async listRoles(db: Executor, businessId: string, entityId: string, options: { includeEnded?: boolean } = {}): Promise<EntityRole[]> {
    return db
      .select()
      .from(entityRoles)
      .where(and(eq(entityRoles.businessId, businessId), eq(entityRoles.entityId, entityId), options.includeEnded ? undefined : isNull(entityRoles.endedAt)))
      .orderBy(desc(entityRoles.startedAt));
  },

  async addRole(db: Executor, businessId: string, entityId: string, input: AddRoleInput): Promise<EntityRole> {
    const v = parseInput(AddRoleInput, input, "entity role");
    await entitiesRepo.get(db, businessId, entityId);
    return one(
      await db.insert(entityRoles).values({ businessId, entityId, role: v.role, stage: v.stage ?? null, ownerRef: v.ownerRef ?? null, startedAt: v.startedAt ?? new Date() }).returning(),
      "entity role",
    );
  },

  async updateRole(db: Executor, businessId: string, roleId: string, patch: { stage?: string | null; ownerRef?: { kind: "agent" | "user" | "department"; id: string } | null }): Promise<EntityRole> {
    const v = parseInput(AddRoleInput.pick({ stage: true, ownerRef: true }), patch, "entity role update");
    return one(await db.update(entityRoles).set(defined(v)).where(and(eq(entityRoles.businessId, businessId), eq(entityRoles.id, roleId))).returning(), "entity role", roleId);
  },

  async endRole(db: Executor, businessId: string, roleId: string, endedAt = new Date()): Promise<EntityRole> {
    return one(await db.update(entityRoles).set({ endedAt }).where(and(eq(entityRoles.businessId, businessId), eq(entityRoles.id, roleId))).returning(), "entity role", roleId);
  },

  /** Entities in a role (e.g. customers, leads at a stage), newest role first. */
  async listByRole(db: Executor, businessId: string, role: string, options: { stage?: string } & PageInput = {}): Promise<Page<Entity & { role: EntityRole }>> {
    const p = parseInput(PageInput, options, "page");
    type Row = Entity & { role: EntityRole };
    const ks = timeKeyset<Row>(entityRoles.startedAt, entityRoles.id, (r) => ({ at: r.role.startedAt, id: r.role.id }));
    const rows = await db
      .select({ entity: entities, role: entityRoles })
      .from(entityRoles)
      .innerJoin(entities, eq(entities.id, entityRoles.entityId))
      .where(
        and(
          eq(entityRoles.businessId, businessId),
          eq(entities.businessId, businessId),
          live,
          isNull(entityRoles.endedAt),
          eq(entityRoles.role, role),
          options.stage ? eq(entityRoles.stage, options.stage) : undefined,
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r.entity, role: r.role })),
      p,
      ks,
    );
  },

  // relationships -----------------------------------------------------------------------------------------------------
  async listRelationships(db: Executor, businessId: string, entityId: string): Promise<RelationshipWithOther[]> {
    const rows = await db
      .select({ rel: relationships, from: { id: entities.id, kind: entities.kind, displayName: entities.displayName } })
      .from(relationships)
      .innerJoin(entities, sql`${entities.id} = case when ${relationships.fromEntity} = ${entityId}::uuid then ${relationships.toEntity} else ${relationships.fromEntity} end`)
      .where(and(eq(relationships.businessId, businessId), or(eq(relationships.fromEntity, entityId), eq(relationships.toEntity, entityId))))
      .orderBy(desc(relationships.strength));
    return rows.map((r) => ({ ...r.rel, other: r.from }));
  },

  async upsertRelationship(db: Executor, businessId: string, input: UpsertRelationshipInput): Promise<Relationship> {
    const v = parseInput(UpsertRelationshipInput, input, "relationship");
    if (v.fromEntity === v.toEntity) throw new ValidationError("An entity cannot relate to itself", { fromEntity: v.fromEntity });
    const owned = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, [v.fromEntity, v.toEntity])));
    if (owned.length !== 2) throw new ValidationError("Both entities must belong to the business", { fromEntity: v.fromEntity, toEntity: v.toEntity });
    return one(
      await db
        .insert(relationships)
        .values({ businessId, fromEntity: v.fromEntity, toEntity: v.toEntity, type: v.type, strength: numericText(v.strength) ?? "0.5" })
        .onConflictDoUpdate({ target: [relationships.fromEntity, relationships.toEntity, relationships.type], set: { strength: numericText(v.strength) ?? "0.5" }, setWhere: eq(relationships.businessId, businessId) })
        .returning(),
      "relationship",
    );
  },

  async removeRelationship(db: Executor, businessId: string, relationshipId: string): Promise<void> {
    await db.delete(relationships).where(and(eq(relationships.businessId, businessId), eq(relationships.id, relationshipId)));
  },

  // interactions ------------------------------------------------------------------------------------------------------
  async listInteractions(db: Executor, businessId: string, filter: InteractionListFilter = {}): Promise<Page<Interaction>> {
    const f = parseInput(InteractionListFilter, filter, "interaction filter");
    const ks = timeKeyset<Interaction>(interactions.occurredAt, interactions.id, (r) => ({ at: r.occurredAt, id: r.id }));
    const kinds = toArray(f.kind);
    const rows = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.businessId, businessId),
          isNull(interactions.archivedAt),
          f.entityId ? sql`${interactions.entityIds} @> array[${f.entityId}::uuid]` : undefined,
          kinds?.length ? inArray(interactions.kind, kinds) : undefined,
          timeRange(interactions.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async createInteraction(db: Executor, businessId: string, input: CreateInteractionInput): Promise<Interaction> {
    const v = parseInput(CreateInteractionInput, input, "interaction");
    const owned = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, v.entityIds)));
    if (owned.length !== new Set(v.entityIds).size) throw new ValidationError("entityIds must be entities of this business", { entityIds: v.entityIds });
    return one(
      await db
        .insert(interactions)
        .values({ businessId, kind: v.kind, occurredAt: v.occurredAt ?? new Date(), entityIds: uniq(v.entityIds), agentId: v.agentId ?? null, contentRef: v.contentRef ?? null, summary: v.summary, direction: v.direction ?? null })
        .returning(),
      "interaction",
    );
  },

  /** A note on a profile (router crm.entity.notes). */
  async addNote(db: Executor, businessId: string, entityId: string, summary: string, options: { agentId?: string | null } = {}): Promise<Interaction> {
    return entitiesRepo.createInteraction(db, businessId, { kind: "note", entityIds: [entityId], summary, agentId: options.agentId ?? null, direction: "internal" });
  },

  async archiveInteraction(db: Executor, businessId: string, interactionId: string): Promise<Interaction> {
    return one(await db.update(interactions).set({ archivedAt: new Date() }).where(and(eq(interactions.businessId, businessId), eq(interactions.id, interactionId))).returning(), "interaction", interactionId);
  },

  // mentions ----------------------------------------------------------------------------------------------------------
  /** Records where an entity is mentioned (inbox item, spec block, post…); idempotent per container. */
  async recordMentions(db: Executor, businessId: string, containerKind: string, containerId: string, entityIds: readonly string[]): Promise<number> {
    const v = parseInput(z.object({ containerKind: z.string().min(1).max(40), containerId: Id, entityIds: z.array(Id) }), { containerKind, containerId, entityIds }, "mentions");
    if (v.entityIds.length === 0) return 0;
    const owned = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, v.entityIds)));
    const rows = await db
      .insert(mentions)
      .values(owned.map((e) => ({ businessId, entityId: e.id, containerKind: v.containerKind, containerId: v.containerId })))
      .onConflictDoNothing()
      .returning({ id: mentions.id });
    return rows.length;
  },

  async listMentions(db: Executor, businessId: string, entityId: string, limit = 100): Promise<Mention[]> {
    return db.select().from(mentions).where(and(eq(mentions.businessId, businessId), eq(mentions.entityId, entityId))).orderBy(desc(mentions.createdAt)).limit(limit);
  },

  async entitiesMentionedIn(db: Executor, businessId: string, containerKind: string, containerId: string): Promise<Entity[]> {
    const rows = await db
      .select({ entity: entities })
      .from(mentions)
      .innerJoin(entities, eq(entities.id, mentions.entityId))
      .where(and(eq(mentions.businessId, businessId), eq(mentions.containerKind, containerKind), eq(mentions.containerId, containerId)));
    return rows.map((r) => r.entity);
  },

  // provenance --------------------------------------------------------------------------------------------------------
  async recordProvenance(db: Executor, businessId: string, entityId: string, input: RecordProvenanceInput): Promise<FieldProvenance> {
    const v = parseInput(RecordProvenanceInput, input, "field provenance");
    return one(
      await db
        .insert(fieldProvenance)
        .values({ businessId, entityId, field: v.field, source: v.source, sourceRef: v.sourceRef ?? null, confidence: numericText(v.confidence) ?? null, observedAt: v.observedAt ?? new Date() })
        .returning(),
      "field provenance",
    );
  },

  async listProvenance(db: Executor, businessId: string, entityId: string, field?: string): Promise<FieldProvenance[]> {
    return db
      .select()
      .from(fieldProvenance)
      .where(and(eq(fieldProvenance.businessId, businessId), eq(fieldProvenance.entityId, entityId), field ? eq(fieldProvenance.field, field) : undefined))
      .orderBy(desc(fieldProvenance.observedAt));
  },

  // merge / unmerge (AC-11.12.3) --------------------------------------------------------------------------------------
  /**
   * Folds `mergedId` into `keptId`: the kept record gains the merged name as an alias, the merged aliases and any
   * identifiers it lacked; CRM child rows (roles, relationships, mentions, provenance, interactions) move over;
   * the merged row is archived with `merged_into_id` set. Everything needed to undo it is in the merge_log row.
   */
  async merge(db: Executor, businessId: string, keptId: string, mergedId: string, options: MergeOptions = {}): Promise<{ kept: Entity; merged: Entity; log: MergeLogEntry }> {
    const o = parseInput(MergeOptions, options, "merge options");
    if (keptId === mergedId) throw new ValidationError("Cannot merge an entity into itself", { keptId });
    return db.transaction(async (tx) => {
      const locked = await lockEntities(tx, businessId, [keptId, mergedId]);
      const kept = one(locked.filter((e) => e.id === keptId), "entity", keptId);
      const merged = one(locked.filter((e) => e.id === mergedId), "entity", mergedId);
      if (kept.mergedIntoId || merged.mergedIntoId) throw new ValidationError("One of the entities is already merged", { keptId, mergedId });
      const snapshotOf = (e: Entity) => Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, e[k] instanceof Date ? (e[k] as Date).toISOString() : e[k]]));

      // Interactions that already list the kept record get the merged one back on unmerge (the kept one stays).
      const sharedInteractionIds = (
        await tx
          .select({ id: interactions.id })
          .from(interactions)
          .where(and(eq(interactions.businessId, businessId), sql`${interactions.entityIds} @> array[${mergedId}::uuid, ${keptId}::uuid]`))
      ).map((r) => r.id);
      const roleIds = (await tx.update(entityRoles).set({ entityId: keptId }).where(and(eq(entityRoles.businessId, businessId), eq(entityRoles.entityId, mergedId))).returning({ id: entityRoles.id })).map((r) => r.id);
      const relFrom = await tx
        .update(relationships)
        .set({ fromEntity: keptId })
        .where(
          and(
            eq(relationships.businessId, businessId),
            eq(relationships.fromEntity, mergedId),
            sql`${relationships.toEntity} <> ${keptId}::uuid`,
            sql`not exists (select 1 from relationships x where x.from_entity = ${keptId}::uuid and x.to_entity = ${relationships.toEntity} and x.type = ${relationships.type})`,
          ),
        )
        .returning({ id: relationships.id });
      const relTo = await tx
        .update(relationships)
        .set({ toEntity: keptId })
        .where(
          and(
            eq(relationships.businessId, businessId),
            eq(relationships.toEntity, mergedId),
            sql`${relationships.fromEntity} <> ${keptId}::uuid`,
            sql`not exists (select 1 from relationships x where x.to_entity = ${keptId}::uuid and x.from_entity = ${relationships.fromEntity} and x.type = ${relationships.type})`,
          ),
        )
        .returning({ id: relationships.id });
      const mentionIds = (
        await tx
          .update(mentions)
          .set({ entityId: keptId })
          .where(
            and(
              eq(mentions.businessId, businessId),
              eq(mentions.entityId, mergedId),
              sql`not exists (select 1 from mentions x where x.entity_id = ${keptId}::uuid and x.container_kind = ${mentions.containerKind} and x.container_id = ${mentions.containerId})`,
            ),
          )
          .returning({ id: mentions.id })
      ).map((r) => r.id);
      const provenanceIds = (await tx.update(fieldProvenance).set({ entityId: keptId }).where(and(eq(fieldProvenance.businessId, businessId), eq(fieldProvenance.entityId, mergedId))).returning({ id: fieldProvenance.id })).map((r) => r.id);
      const interactionIds = (
        await tx
          .update(interactions)
          .set({ entityIds: sql`array(select distinct case when x = ${mergedId}::uuid then ${keptId}::uuid else x end from unnest(${interactions.entityIds}) x)` })
          .where(and(eq(interactions.businessId, businessId), sql`${interactions.entityIds} @> array[${mergedId}::uuid]`))
          .returning({ id: interactions.id })
      ).map((r) => r.id);

      const fields = mergedFields(fieldsOf(kept), fieldsOf(merged));
      const updatedKept = one(
        await tx
          .update(entities)
          .set({ ...fields, identifiers: fields.identifiers as Entity["identifiers"] })
          .where(scoped(businessId, keptId))
          .returning(),
        "entity",
        keptId,
      );
      const updatedMerged = one(await tx.update(entities).set({ mergedIntoId: keptId, archivedAt: new Date() }).where(scoped(businessId, mergedId)).returning(), "entity", mergedId);
      const snapshot: MergeSnapshot = {
        kept: snapshotOf(kept),
        merged: snapshotOf(merged),
        moved: {
          roles: roleIds,
          relationships: [...relFrom.map((r) => r.id), ...relTo.map((r) => r.id)],
          mentions: mentionIds,
          provenance: provenanceIds,
          interactions: interactionIds,
          sharedInteractions: sharedInteractionIds,
        },
      };
      const log = one(
        await tx.insert(mergeLog).values({ businessId, keptId, mergedId, byKind: o.byKind, byId: o.byId ?? null, reversibleSnapshot: snapshot as unknown as Record<string, unknown> }).returning(),
        "merge log",
      );
      return { kept: updatedKept, merged: updatedMerged, log };
    });
  },

  /**
   * Undoes one merge: the merged record is live again, the child rows the merge moved go back to it, and the kept
   * record loses only what the merge gave it (`revertPlan`), so later edits and other merges stay. Refuses with a
   * CONFLICT that names the later merge to undo first while one relies on this merge (`unmergeBlockers`).
   */
  async unmerge(db: Executor, businessId: string, mergeLogId: string): Promise<{ kept: Entity; merged: Entity; log: MergeLogEntry }> {
    return db.transaction(async (tx) => {
      const log = one(await tx.select().from(mergeLog).where(and(eq(mergeLog.businessId, businessId), eq(mergeLog.id, mergeLogId))).for("update").limit(1), "merge log", mergeLogId);
      if (log.revertedAt) throw new ValidationError("Merge already reverted", { mergeLogId });
      const snap = log.reversibleSnapshot as unknown as MergeSnapshot;
      const locked = await lockEntities(tx, businessId, [log.keptId, log.mergedId]);
      const current = one(locked.filter((e) => e.id === log.keptId), "entity", log.keptId);
      one(locked.filter((e) => e.id === log.mergedId), "entity", log.mergedId);
      const history = await mergeLogsOf(tx, businessId, log.keptId);
      const blockers = await unmergeBlockers(tx, businessId, log, current, history);
      if (blockers.length) throw new AppError("merge_relied_on", describeUnmergeBlockers(blockers), 409, { mergeLogId, blockers });

      const { patch } = revertPlan(snap, fieldsOf(current));
      const kept = one(await tx.update(entities).set(patch).where(scoped(businessId, log.keptId)).returning(), "entity", log.keptId);
      // The merge only archived the merged record and pointed it at the kept one; put exactly that back.
      const mergedBefore = snap.merged;
      const merged = one(
        await tx
          .update(entities)
          .set({ mergedIntoId: (mergedBefore.mergedIntoId as string | null | undefined) ?? null, archivedAt: mergedBefore.archivedAt ? new Date(mergedBefore.archivedAt as string) : null })
          .where(scoped(businessId, log.mergedId))
          .returning(),
        "entity",
        log.mergedId,
      );
      const m = snap.moved;
      if (m.roles.length) await tx.update(entityRoles).set({ entityId: log.mergedId }).where(and(eq(entityRoles.businessId, businessId), inArray(entityRoles.id, m.roles)));
      if (m.relationships.length) {
        await tx.update(relationships).set({ fromEntity: log.mergedId }).where(and(eq(relationships.businessId, businessId), inArray(relationships.id, m.relationships), eq(relationships.fromEntity, log.keptId)));
        await tx.update(relationships).set({ toEntity: log.mergedId }).where(and(eq(relationships.businessId, businessId), inArray(relationships.id, m.relationships), eq(relationships.toEntity, log.keptId)));
      }
      if (m.mentions.length) await tx.update(mentions).set({ entityId: log.mergedId }).where(and(eq(mentions.businessId, businessId), inArray(mentions.id, m.mentions)));
      if (m.provenance.length) await tx.update(fieldProvenance).set({ entityId: log.mergedId }).where(and(eq(fieldProvenance.businessId, businessId), inArray(fieldProvenance.id, m.provenance)));
      // The kept record stays on an interaction it was already part of, or that another open merge into it moved there
      // (merges logged before `sharedInteractions` existed rely on the second test alone); there the merged record is
      // added back. Elsewhere it is swapped back for the merged record.
      const keepKept = new Set([...(m.sharedInteractions ?? []), ...history.filter((h) => h.id !== log.id && !h.revertedAt && h.keptId === log.keptId).flatMap((h) => (h.reversibleSnapshot as unknown as MergeSnapshot).moved.interactions)]);
      const swap = m.interactions.filter((id) => !keepKept.has(id));
      const addBack = m.interactions.filter((id) => keepKept.has(id));
      if (swap.length) {
        await tx
          .update(interactions)
          .set({ entityIds: sql`array(select distinct case when x = ${log.keptId}::uuid then ${log.mergedId}::uuid else x end from unnest(${interactions.entityIds}) x)` })
          .where(and(eq(interactions.businessId, businessId), inArray(interactions.id, swap)));
      }
      if (addBack.length) {
        await tx
          .update(interactions)
          .set({ entityIds: sql`case when ${interactions.entityIds} @> array[${log.mergedId}::uuid] then ${interactions.entityIds} else array_append(${interactions.entityIds}, ${log.mergedId}::uuid) end` })
          .where(and(eq(interactions.businessId, businessId), inArray(interactions.id, addBack)));
      }
      const updatedLog = one(await tx.update(mergeLog).set({ revertedAt: new Date() }).where(eq(mergeLog.id, mergeLogId)).returning(), "merge log", mergeLogId);
      return { kept, merged, log: updatedLog };
    });
  },

  /**
   * Every merge an entity took part in, newest first. Each open merge into it says whether Unmerge is available now
   * (`undoBlocked` is the reason when a later merge relies on it), so the profile can explain instead of failing.
   */
  async mergeHistory(db: Executor, businessId: string, entityId: string): Promise<MergeHistoryEntry[]> {
    const history = await mergeLogsOf(db, businessId, entityId);
    const open = history.filter((m) => !m.revertedAt && m.keptId === entityId);
    const current = open.length ? await entitiesRepo.get(db, businessId, entityId) : null;
    return Promise.all(
      history.map(async (m) => {
        if (!current || m.revertedAt || m.keptId !== entityId) return { ...m, undoBlocked: null };
        const blockers = await unmergeBlockers(db, businessId, m, current, history);
        return { ...m, undoBlocked: blockers.length ? describeUnmergeBlockers(blockers) : null };
      }),
    );
  },

  /** Interactions referencing an entity re-pointed by a merge keep both ids distinct; this is the profile view's bundle. */
  async profile(db: Executor, businessId: string, entityId: string): Promise<EntityProfile> {
    const entity = await entitiesRepo.resolve(db, businessId, entityId);
    const [roles, rels, recent, mentionRows] = await Promise.all([
      entitiesRepo.listRoles(db, businessId, entity.id),
      entitiesRepo.listRelationships(db, businessId, entity.id),
      entitiesRepo.listInteractions(db, businessId, { entityId: entity.id, limit: 10 }),
      db.select({ n: sql<number>`count(*)::int` }).from(mentions).where(and(eq(mentions.businessId, businessId), eq(mentions.entityId, entity.id))),
    ]);
    return { entity, roles, relationships: rels, recentInteractions: recent.items, mentionCount: Number(mentionRows[0]?.n ?? 0) };
  },
};
