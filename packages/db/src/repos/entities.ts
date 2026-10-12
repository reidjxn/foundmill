/**
 * entities, entity_roles, relationships, interactions, mentions, field_provenance, merge_log — the CRM
 * (BUILD §7.2 "CRM", §11.12; routers crm.search / entity.get / update / merge / unmerge / notes / roles).
 *
 * `search` is the hybrid typeahead: pg_trgm similarity on display_name and aliases (GIN-indexed), the
 * trigger-maintained `search` tsvector (name A, aliases B, email/domain C) and, when the caller supplies a
 * query embedding, pgvector cosine similarity. One score per row (the best signal wins, exact identifier
 * and prefix matches rank first) and the result is grouped by kind for the picker.
 *
 * `merge`/`unmerge` are reversible (AC-11.12.3): the merge_log row keeps an exact snapshot of both entity
 * rows and the ids of every CRM child row it re-pointed, so `unmerge` restores both records field for
 * field. Journey rows (visitors, touches, conversions) are never re-pointed — they are service-written and
 * resolve through `merged_into_id` (`resolve`).
 */
import { ENTITY_KINDS, INTERACTION_KINDS, ValidationError, VISIBILITY, type EntityKind } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
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
  role: z.string().max(80).optional(),
  stage: z.string().max(80).optional(),
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
});
export type SearchInput = z.input<typeof SearchInput>;

export type SearchMatch = "identifier" | "prefix" | "name" | "alias" | "text" | "meaning";
export interface SearchHit {
  entity: Entity;
  score: number;
  matchedOn: SearchMatch;
}
export interface SearchResult {
  hits: SearchHit[];
  groups: { kind: EntityKind; hits: SearchHit[] }[];
  total: number;
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
  kept: Record<string, unknown>;
  merged: Record<string, unknown>;
  moved: { roles: string[]; relationships: string[]; mentions: string[]; provenance: string[]; interactions: string[] };
}

const SNAPSHOT_FIELDS = ["displayName", "aliases", "avatarUrl", "identifiers", "lawfulBasis", "source", "visibility", "agentId", "mergedIntoId", "archivedAt"] as const;

const scoped = (businessId: string, entityId: string) => and(eq(entities.businessId, businessId), eq(entities.id, entityId));
const live = and(isNull(entities.archivedAt), isNull(entities.mergedIntoId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const uniq = (xs: string[]) => [...new Set(xs)];
const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;

function roleFilter(businessId: string, f: { role?: string; stage?: string; ownerId?: string; departmentId?: string }): SQL | undefined {
  if (!f.role && !f.stage && !f.ownerId && !f.departmentId) return undefined;
  const conds: SQL[] = [sql`r.business_id = ${businessId}::uuid`, sql`r.entity_id = ${entities.id}`, sql`r.ended_at is null`];
  if (f.role) conds.push(sql`r.role = ${f.role}`);
  if (f.stage) conds.push(sql`r.stage = ${f.stage}`);
  if (f.ownerId) conds.push(sql`r.owner_ref ->> 'id' = ${f.ownerId}`);
  if (f.departmentId) conds.push(sql`r.owner_ref ->> 'kind' = 'department' and r.owner_ref ->> 'id' = ${f.departmentId}`);
  return sql`exists (select 1 from entity_roles r where ${sql.join(conds, sql` and `)})`;
}

export const entitiesRepo = {
  async list(db: Executor, businessId: string, filter: EntityListFilter = {}): Promise<Page<Entity>> {
    const f = parseInput(EntityListFilter, filter, "entity filter");
    const ks = timeKeyset<Entity>(entities.createdAt, entities.id, (r) => ({ at: r.createdAt, id: r.id }));
    const kinds = toArray(f.kind);
    const rows = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.businessId, businessId),
          f.includeArchived ? undefined : isNull(entities.archivedAt),
          f.includeMerged ? undefined : isNull(entities.mergedIntoId),
          kinds?.length ? inArray(entities.kind, kinds) : undefined,
          f.visibility ? eq(entities.visibility, f.visibility) : undefined,
          roleFilter(businessId, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
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
      .limit(v.limit);

    const hits: SearchHit[] = rows
      .map((r) => {
        const s = Number(r.score);
        const matchedOn: SearchMatch = r.identifier ? "identifier" : r.prefix ? "prefix" : Number(r.vec) * 0.9 >= s - 1e-9 && Number(r.vec) > 0 ? "meaning" : Number(r.nameSim) >= s - 1e-9 ? "name" : Number(r.aliasSim) >= s - 1e-9 ? "alias" : "text";
        return { entity: r.entity, score: Math.round(s * 1000) / 1000, matchedOn };
      })
      .filter((h) => h.score >= v.minScore);
    const byKind = new Map<EntityKind, SearchHit[]>();
    for (const h of hits) byKind.set(h.entity.kind, [...(byKind.get(h.entity.kind) ?? []), h]);
    const groups = ENTITY_KINDS.filter((k) => byKind.has(k)).map((kind) => ({ kind, hits: byKind.get(kind)! }));
    return { hits, groups, total: hits.length };
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
      const kept = await entitiesRepo.get(tx, businessId, keptId);
      const merged = await entitiesRepo.get(tx, businessId, mergedId);
      if (kept.mergedIntoId || merged.mergedIntoId) throw new ValidationError("One of the entities is already merged", { keptId, mergedId });
      const snapshotOf = (e: Entity) => Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, e[k] instanceof Date ? (e[k] as Date).toISOString() : e[k]]));

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

      const keptIdentifiers = Object.fromEntries(Object.entries(kept.identifiers).filter(([, v]) => v !== null && v !== undefined && v !== ""));
      const updatedKept = one(
        await tx
          .update(entities)
          .set({
            aliases: uniq([...kept.aliases, merged.displayName, ...merged.aliases].filter((a) => a !== kept.displayName)),
            identifiers: { ...merged.identifiers, ...keptIdentifiers } as Entity["identifiers"],
            avatarUrl: kept.avatarUrl ?? merged.avatarUrl,
            lawfulBasis: kept.lawfulBasis ?? merged.lawfulBasis,
            source: kept.source ?? merged.source,
          })
          .where(scoped(businessId, keptId))
          .returning(),
        "entity",
        keptId,
      );
      const updatedMerged = one(await tx.update(entities).set({ mergedIntoId: keptId, archivedAt: new Date() }).where(scoped(businessId, mergedId)).returning(), "entity", mergedId);
      const snapshot: MergeSnapshot = {
        kept: snapshotOf(kept),
        merged: snapshotOf(merged),
        moved: { roles: roleIds, relationships: [...relFrom.map((r) => r.id), ...relTo.map((r) => r.id)], mentions: mentionIds, provenance: provenanceIds, interactions: interactionIds },
      };
      const log = one(
        await tx.insert(mergeLog).values({ businessId, keptId, mergedId, byKind: o.byKind, byId: o.byId ?? null, reversibleSnapshot: snapshot as unknown as Record<string, unknown> }).returning(),
        "merge log",
      );
      return { kept: updatedKept, merged: updatedMerged, log };
    });
  },

  /** Restores both records exactly as they were before the merge and moves the child rows back. */
  async unmerge(db: Executor, businessId: string, mergeLogId: string): Promise<{ kept: Entity; merged: Entity; log: MergeLogEntry }> {
    return db.transaction(async (tx) => {
      const log = one(await tx.select().from(mergeLog).where(and(eq(mergeLog.businessId, businessId), eq(mergeLog.id, mergeLogId))).limit(1), "merge log", mergeLogId);
      if (log.revertedAt) throw new ValidationError("Merge already reverted", { mergeLogId });
      const snap = log.reversibleSnapshot as unknown as MergeSnapshot;
      const restore = (s: Record<string, unknown>) => ({
        displayName: s.displayName as string,
        aliases: s.aliases as string[],
        avatarUrl: (s.avatarUrl as string | null) ?? null,
        identifiers: s.identifiers as Entity["identifiers"],
        lawfulBasis: (s.lawfulBasis as string | null) ?? null,
        source: (s.source as string | null) ?? null,
        visibility: s.visibility as Entity["visibility"],
        agentId: (s.agentId as string | null) ?? null,
        mergedIntoId: (s.mergedIntoId as string | null) ?? null,
        archivedAt: s.archivedAt ? new Date(s.archivedAt as string) : null,
      });
      const kept = one(await tx.update(entities).set(restore(snap.kept)).where(scoped(businessId, log.keptId)).returning(), "entity", log.keptId);
      const merged = one(await tx.update(entities).set(restore(snap.merged)).where(scoped(businessId, log.mergedId)).returning(), "entity", log.mergedId);
      const m = snap.moved;
      if (m.roles.length) await tx.update(entityRoles).set({ entityId: log.mergedId }).where(and(eq(entityRoles.businessId, businessId), inArray(entityRoles.id, m.roles)));
      if (m.relationships.length) {
        await tx.update(relationships).set({ fromEntity: log.mergedId }).where(and(eq(relationships.businessId, businessId), inArray(relationships.id, m.relationships), eq(relationships.fromEntity, log.keptId)));
        await tx.update(relationships).set({ toEntity: log.mergedId }).where(and(eq(relationships.businessId, businessId), inArray(relationships.id, m.relationships), eq(relationships.toEntity, log.keptId)));
      }
      if (m.mentions.length) await tx.update(mentions).set({ entityId: log.mergedId }).where(and(eq(mentions.businessId, businessId), inArray(mentions.id, m.mentions)));
      if (m.provenance.length) await tx.update(fieldProvenance).set({ entityId: log.mergedId }).where(and(eq(fieldProvenance.businessId, businessId), inArray(fieldProvenance.id, m.provenance)));
      if (m.interactions.length) {
        await tx
          .update(interactions)
          .set({ entityIds: sql`array(select distinct case when x = ${log.keptId}::uuid then ${log.mergedId}::uuid else x end from unnest(${interactions.entityIds}) x)` })
          .where(and(eq(interactions.businessId, businessId), inArray(interactions.id, m.interactions)));
      }
      const updatedLog = one(await tx.update(mergeLog).set({ revertedAt: new Date() }).where(eq(mergeLog.id, mergeLogId)).returning(), "merge log", mergeLogId);
      return { kept, merged, log: updatedLog };
    });
  },

  async mergeHistory(db: Executor, businessId: string, entityId: string): Promise<MergeLogEntry[]> {
    return db
      .select()
      .from(mergeLog)
      .where(and(eq(mergeLog.businessId, businessId), or(eq(mergeLog.keptId, entityId), eq(mergeLog.mergedId, entityId))))
      .orderBy(desc(mergeLog.createdAt));
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
