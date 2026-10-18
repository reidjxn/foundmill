/** 0003 — product: spec blocks, versions, change proposals, roadmap, sources; 0062 — product sign-offs. */
import { HUNK_DECISIONS, PROPOSAL_STATUSES, ROADMAP_HORIZONS, SEVERITIES, SIGNOFF_KINDS, SIGNOFF_STATUSES, SOURCE_KINDS } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, vector, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyArray, emptyObject, id, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents } from "./agents";
import { inboxItems } from "./inbox";

export const AUTHOR_KINDS = ["user", "agent", "system"] as const;

export const specBlocks = pgTable(
  "spec_blocks",
  {
    id: id(),
    businessId: businessId(),
    section: text("section").notNull(),
    position: integer("position").notNull().default(0),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default(sql`'{"type":"doc","content":[]}'::jsonb`),
    sources: uuid("sources").array().notNull().default(emptyArray),
    authoredByKind: text("authored_by_kind", { enum: AUTHOR_KINDS }).notNull().default("user"),
    authoredBy: uuid("authored_by"),
    pinned: boolean("pinned").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...timestampsWithArchive(),
  },
  (t) => [index("spec_blocks_business_id_idx").on(t.businessId), index("spec_blocks_section_idx").on(t.businessId, t.section, t.position)],
);
export type SpecBlock = typeof specBlocks.$inferSelect;
export type NewSpecBlock = typeof specBlocks.$inferInsert;

export const specVersions = pgTable(
  "spec_versions",
  {
    id: id(),
    businessId: businessId(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default(emptyObject),
    changelogMd: text("changelog_md").notNull().default(""),
    publishedBy: uuid("published_by").references(() => authUsers.id, { onDelete: "set null" }),
    publishedAt: tstz("published_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("spec_versions_business_id_version_key").on(t.businessId, t.version),
    index("spec_versions_business_id_idx").on(t.businessId),
    index("spec_versions_published_by_idx").on(t.publishedBy),
  ],
);
export type SpecVersion = typeof specVersions.$inferSelect;
export type NewSpecVersion = typeof specVersions.$inferInsert;

export const changeProposals = pgTable(
  "change_proposals",
  {
    id: id(),
    businessId: businessId(),
    title: text("title").notNull().default(""),
    status: text("status", { enum: PROPOSAL_STATUSES }).notNull().default("open"),
    rationaleMd: text("rationale_md").notNull().default(""),
    evidence: uuid("evidence").array().notNull().default(emptyArray),
    impact: jsonb("impact").$type<Record<string, unknown>>().notNull().default(emptyObject),
    severity: text("severity", { enum: SEVERITIES }).notNull().default("normal"),
    proposedByAgentId: uuid("proposed_by_agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    inboxItemId: uuid("inbox_item_id").references((): AnyPgColumn => inboxItems.id, { onDelete: "set null" }),
    resolvedAt: tstz("resolved_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("change_proposals_business_id_idx").on(t.businessId),
    index("change_proposals_status_idx").on(t.businessId, t.status),
    index("change_proposals_inbox_item_id_idx").on(t.inboxItemId),
  ],
);
export type ChangeProposal = typeof changeProposals.$inferSelect;
export type NewChangeProposal = typeof changeProposals.$inferInsert;

export const roadmapItems = pgTable(
  "roadmap_items",
  {
    id: id(),
    businessId: businessId(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    horizon: text("horizon", { enum: ROADMAP_HORIZONS }).notNull().default("next"),
    targetStart: date("target_start", { mode: "string" }),
    targetEnd: date("target_end", { mode: "string" }),
    confidence: integer("confidence").notNull().default(3),
    ownerRef: jsonb("owner_ref").$type<{ kind: "agent" | "user" | "department"; id: string }>(),
    specBlockIds: uuid("spec_block_ids").array().notNull().default(emptyArray),
    status: text("status").notNull().default("planned"),
    position: integer("position").notNull().default(0),
    ...timestampsWithArchive(),
  },
  (t) => [index("roadmap_items_business_id_idx").on(t.businessId), index("roadmap_items_horizon_idx").on(t.businessId, t.horizon, t.position)],
);
export type RoadmapItem = typeof roadmapItems.$inferSelect;
export type NewRoadmapItem = typeof roadmapItems.$inferInsert;

export const roadmapDependencies = pgTable(
  "roadmap_dependencies",
  {
    id: id(),
    businessId: businessId(),
    fromItem: uuid("from_item").notNull().references(() => roadmapItems.id, { onDelete: "cascade" }),
    toItem: uuid("to_item").notNull().references(() => roadmapItems.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("roadmap_dependencies_from_item_to_item_key").on(t.fromItem, t.toItem),
    index("roadmap_dependencies_business_id_idx").on(t.businessId),
    index("roadmap_dependencies_to_item_idx").on(t.toItem),
  ],
);
export type RoadmapDependency = typeof roadmapDependencies.$inferSelect;
export type NewRoadmapDependency = typeof roadmapDependencies.$inferInsert;

export const proposalHunks = pgTable(
  "proposal_hunks",
  {
    id: id(),
    businessId: businessId(),
    proposalId: uuid("proposal_id").notNull().references(() => changeProposals.id, { onDelete: "cascade" }),
    specBlockId: uuid("spec_block_id").references(() => specBlocks.id, { onDelete: "cascade" }),
    roadmapItemId: uuid("roadmap_item_id").references(() => roadmapItems.id, { onDelete: "cascade" }),
    base: jsonb("base").$type<Record<string, unknown>>(),
    ours: jsonb("ours").$type<Record<string, unknown>>(),
    theirs: jsonb("theirs").$type<Record<string, unknown>>(),
    decision: text("decision", { enum: HUNK_DECISIONS }).notNull().default("pending"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("proposal_hunks_business_id_idx").on(t.businessId),
    index("proposal_hunks_proposal_id_idx").on(t.proposalId),
    index("proposal_hunks_spec_block_id_idx").on(t.specBlockId),
    index("proposal_hunks_roadmap_item_id_idx").on(t.roadmapItemId),
  ],
);
export type ProposalHunk = typeof proposalHunks.$inferSelect;
export type NewProposalHunk = typeof proposalHunks.$inferInsert;

export const sources = pgTable(
  "sources",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    uri: text("uri"),
    title: text("title").notNull().default(""),
    contentRef: text("content_ref"),
    embedding: vector("embedding", { dimensions: 1024 }),
    relevance: jsonb("relevance").$type<Record<string, unknown>>().notNull().default(emptyObject),
    fetchedAt: tstz("fetched_at"),
    ...timestampsWithArchive(),
  },
  (t) => [index("sources_business_id_idx").on(t.businessId), index("sources_kind_idx").on(t.businessId, t.kind)],
);
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * 0062 — the founder's sign-offs of the product (founder, 2026-10-18): one row per round of the specification, the
 * roadmap, or the step that starts distribution, tied to the Inbox decision note that asks for it. Pending → approved,
 * changes_requested (the founder's notes become a revision task) or declined ("Not yet" on Ready to start selling).
 */
export const productSignoffs = pgTable(
  "product_signoffs",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: SIGNOFF_KINDS }).notNull(),
    round: integer("round").notNull().default(1),
    status: text("status", { enum: SIGNOFF_STATUSES }).notNull().default("pending"),
    inboxItemId: uuid("inbox_item_id").references((): AnyPgColumn => inboxItems.id, { onDelete: "set null" }),
    /** The specification version an approval of the spec published. */
    specVersionId: uuid("spec_version_id").references((): AnyPgColumn => specVersions.id, { onDelete: "set null" }),
    /** roadmap: `{ items: [{ id, title, horizon, position }] }`; ready_to_sell: `{ roadmapItemId, title }`. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    /** The founder's words with the decision (what to change, or notes with an approval), at most 2,000 characters. */
    notes: text("notes"),
    decidedBy: uuid("decided_by").references(() => authUsers.id, { onDelete: "set null" }),
    decidedByKind: text("decided_by_kind", { enum: ["user", "system"] }),
    decidedAt: tstz("decided_at"),
    requestedAt: tstz("requested_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("product_signoffs_business_id_kind_round_key").on(t.businessId, t.kind, t.round),
    index("product_signoffs_business_idx").on(t.businessId, t.kind, t.round),
    index("product_signoffs_item_idx").on(t.inboxItemId),
    index("product_signoffs_spec_version_idx").on(t.specVersionId),
    index("product_signoffs_decided_by_idx").on(t.decidedBy),
  ],
);
export type ProductSignoff = typeof productSignoffs.$inferSelect;
export type NewProductSignoff = typeof productSignoffs.$inferInsert;

