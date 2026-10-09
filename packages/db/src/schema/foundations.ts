/** 0016 — business foundations: the vision, first specification and first roadmap drafted on the first open. */
import { FOUNDATIONS_DOORS, FOUNDATIONS_RUNNERS, FOUNDATIONS_STATUSES } from "@foundmill/shared";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { emptyObject, id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { ideas } from "./accounts";

export const businessFoundations = pgTable(
  "business_foundations",
  {
    id: id(),
    businessId: businessId(),
    status: text("status", { enum: FOUNDATIONS_STATUSES }).notNull().default("pending"),
    door: text("door", { enum: FOUNDATIONS_DOORS }).notNull(),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    importJobId: text("import_job_id"),
    importReport: jsonb("import_report").$type<Record<string, unknown>>(),
    attempt: integer("attempt").notNull().default(0),
    runner: text("runner", { enum: FOUNDATIONS_RUNNERS }),
    workflowId: text("workflow_id"),
    vision: jsonb("vision").$type<Record<string, unknown>>(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(emptyObject),
    error: text("error"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("business_foundations_business_idx").on(t.businessId), index("business_foundations_idea_id_idx").on(t.ideaId)],
);
export type BusinessFoundationsRow = typeof businessFoundations.$inferSelect;
export type NewBusinessFoundationsRow = typeof businessFoundations.$inferInsert;
