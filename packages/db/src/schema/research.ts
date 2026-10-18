/** 0063 — product research: the Product Researcher's plan to test the specification with the ICP, and its artifacts. */
import { RESEARCH_ARTIFACT_KINDS, RESEARCH_ARTIFACT_STATUSES, RESEARCH_STATUSES } from "@foundmill/shared";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { emptyArray, emptyObject, id, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents, tasks } from "./agents";

export const productResearch = pgTable(
  "product_research",
  {
    id: id(),
    businessId: businessId(),
    status: text("status", { enum: RESEARCH_STATUSES }).notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    icp: text("icp").notNull().default(""),
    specVersion: integer("spec_version"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    error: text("error"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(emptyObject),
    ...timestamps(),
  },
  (t) => [uniqueIndex("product_research_business_idx").on(t.businessId), index("product_research_agent_id_idx").on(t.agentId)],
);
export type ProductResearchRow = typeof productResearch.$inferSelect;
export type NewProductResearchRow = typeof productResearch.$inferInsert;

export const researchArtifacts = pgTable(
  "research_artifacts",
  {
    id: id(),
    businessId: businessId(),
    researchId: uuid("research_id").references((): AnyPgColumn => productResearch.id, { onDelete: "set null" }),
    kind: text("kind", { enum: RESEARCH_ARTIFACT_KINDS }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    status: text("status", { enum: RESEARCH_ARTIFACT_STATUSES }).notNull().default("draft"),
    position: integer("position").notNull().default(0),
    specBlockIds: uuid("spec_block_ids").array().notNull().default(emptyArray),
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
    createdByAgentId: uuid("created_by_agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("research_artifacts_business_idx").on(t.businessId, t.kind),
    index("research_artifacts_research_id_idx").on(t.researchId),
    index("research_artifacts_task_id_idx").on(t.taskId),
    index("research_artifacts_created_by_agent_id_idx").on(t.createdByAgentId),
  ],
);
export type ResearchArtifact = typeof researchArtifacts.$inferSelect;
export type NewResearchArtifact = typeof researchArtifacts.$inferInsert;
