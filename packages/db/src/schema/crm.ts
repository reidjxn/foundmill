/** 0008 — CRM: entities, roles, relationships, interactions, mentions, provenance, merge log. */
import { ENTITY_KINDS, INTERACTION_KINDS, VISIBILITY } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgTable, text, uniqueIndex, uuid, vector, type AnyPgColumn } from "drizzle-orm/pg-core";
import { emptyArray, emptyObject, id, timestamps, timestampsWithArchive, tstz, tsvector } from "./_common";
import { businessId } from "./_refs";
import { agents } from "./agents";

export const INTERACTION_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const ACTOR_BY_KINDS = ["user", "agent", "system"] as const;

export const entities = pgTable(
  "entities",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: ENTITY_KINDS }).notNull(),
    displayName: text("display_name").notNull(),
    aliases: text("aliases").array().notNull().default(emptyArray),
    avatarUrl: text("avatar_url"),
    identifiers: jsonb("identifiers").$type<Partial<Record<"email" | "domain" | "linkedin" | "reg_no" | "stripe_id", string>> & Record<string, unknown>>().notNull().default(emptyObject),
    lawfulBasis: text("lawful_basis"),
    source: text("source"),
    embedding: vector("embedding", { dimensions: 1024 }),
    /** Maintained by the entities_search trigger; never write it. */
    search: tsvector("search"),
    visibility: text("visibility", { enum: VISIBILITY }).notNull().default("private"),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    /** A deletion (erasure) request: suppressed from outreach at once, purged by the scheduled job after `deletionDueAt` (0028). */
    deletionRequestedAt: tstz("deletion_requested_at"),
    deletionDueAt: tstz("deletion_due_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("entities_business_id_idx").on(t.businessId),
    index("entities_kind_idx").on(t.businessId, t.kind).where(sql`${t.archivedAt} is null`),
    index("entities_search_idx").using("gin", t.search),
    index("entities_agent_id_idx").on(t.agentId),
    index("entities_merged_into_id_idx").on(t.mergedIntoId),
    index("entities_deletion_due_idx").on(t.deletionDueAt).where(sql`${t.deletionDueAt} is not null`),
  ],
);
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;

export const entityRoles = pgTable(
  "entity_roles",
  {
    id: id(),
    businessId: businessId(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    stage: text("stage"),
    ownerRef: jsonb("owner_ref").$type<{ kind: "agent" | "user" | "department"; id: string }>(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
    ...timestamps(),
  },
  (t) => [
    index("entity_roles_business_id_idx").on(t.businessId),
    index("entity_roles_entity_id_idx").on(t.entityId),
    index("entity_roles_role_stage_idx").on(t.businessId, t.role, t.stage).where(sql`${t.endedAt} is null`),
  ],
);
export type EntityRole = typeof entityRoles.$inferSelect;
export type NewEntityRole = typeof entityRoles.$inferInsert;

export const relationships = pgTable(
  "relationships",
  {
    id: id(),
    businessId: businessId(),
    fromEntity: uuid("from_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    toEntity: uuid("to_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    strength: numeric("strength", { precision: 4, scale: 3 }).notNull().default("0.5"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("relationships_from_entity_to_entity_type_key").on(t.fromEntity, t.toEntity, t.type),
    index("relationships_business_id_idx").on(t.businessId),
    index("relationships_to_entity_idx").on(t.toEntity),
  ],
);
export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;

export const interactions = pgTable(
  "interactions",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: INTERACTION_KINDS }).notNull(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    entityIds: uuid("entity_ids").array().notNull().default(emptyArray),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    /** A reference to where a body lives elsewhere (no encrypted store exists yet; WP-08 corrections, item 7). */
    contentRef: text("content_ref"),
    summary: text("summary").notNull().default(""),
    /**
     * 0124: an email's own words as plain text (≤ 20,000 characters): a reply a stranger wrote, or the founder's answer.
     * Shown as plain text only, never to an agent (`repos.replies`; founder D3, Nov 16, 2026).
     */
    bodyUntrusted: text("body_untrusted"),
    direction: text("direction", { enum: INTERACTION_DIRECTIONS }),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("interactions_business_id_idx").on(t.businessId, t.occurredAt),
    index("interactions_entity_ids_idx").using("gin", t.entityIds),
    index("interactions_agent_id_idx").on(t.agentId),
  ],
);
export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;

export const mentions = pgTable(
  "mentions",
  {
    id: id(),
    businessId: businessId(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    containerKind: text("container_kind").notNull(),
    containerId: uuid("container_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("mentions_entity_id_container_kind_container_id_key").on(t.entityId, t.containerKind, t.containerId),
    index("mentions_business_id_idx").on(t.businessId),
    index("mentions_container_idx").on(t.containerKind, t.containerId),
  ],
);
export type Mention = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;

export const fieldProvenance = pgTable(
  "field_provenance",
  {
    id: id(),
    businessId: businessId(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    observedAt: tstz("observed_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("field_provenance_business_id_idx").on(t.businessId), index("field_provenance_entity_id_idx").on(t.entityId, t.field)],
);
export type FieldProvenance = typeof fieldProvenance.$inferSelect;
export type NewFieldProvenance = typeof fieldProvenance.$inferInsert;

export const mergeLog = pgTable(
  "merge_log",
  {
    id: id(),
    businessId: businessId(),
    keptId: uuid("kept_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    mergedId: uuid("merged_id").notNull(),
    byKind: text("by_kind", { enum: ACTOR_BY_KINDS }).notNull().default("user"),
    byId: uuid("by_id"),
    reversibleSnapshot: jsonb("reversible_snapshot").$type<Record<string, unknown>>().notNull().default(emptyObject),
    revertedAt: tstz("reverted_at"),
    ...timestamps(),
  },
  (t) => [
    index("merge_log_business_id_idx").on(t.businessId, t.createdAt),
    index("merge_log_kept_id_idx").on(t.keptId),
    index("merge_log_merged_id_idx").on(t.mergedId),
  ],
);
export type MergeLogEntry = typeof mergeLog.$inferSelect;
export type NewMergeLogEntry = typeof mergeLog.$inferInsert;
