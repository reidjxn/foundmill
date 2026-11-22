/**
 * 0154 — the tool scout's memory: one row per project per kind of tool (what is needed and why, the pick with its
 * alternatives and sources, and the founder's answer). Members read; only the services write.
 */
import { TOOL_CATEGORIES, TOOL_NEED_STAGES, type ToolRoute } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { tasks } from "./agents";
import { inboxItems } from "./inbox";

/** `planned` is known at take charge and raised at its stage; the rest are `TOOL_NEED_STATUSES`. */
export const TOOL_NEED_ROW_STATUSES = ["planned", "open", "recommended", "accepted", "not_now"] as const;

/** The recommendation as the founder read it. */
export interface ToolPick {
  name: string;
  /** The catalog entry, when the pick is one Foundmill has checked. */
  catalogKey?: string;
  route: ToolRoute;
  why: string;
  whyNow: string;
  /** In words, always with "Estimate" unless it is free. */
  cost: string;
  founderSteps: string;
}

export const toolNeeds = pgTable(
  "tool_needs",
  {
    id: id(),
    businessId: businessId(),
    category: text("category", { enum: TOOL_CATEGORIES }).notNull(),
    stage: text("stage", { enum: TOOL_NEED_STAGES }),
    status: text("status", { enum: TOOL_NEED_ROW_STATUSES }).notNull().default("open"),
    reason: text("reason").notNull(),
    raisedByAgentId: uuid("raised_by_agent_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, { onDelete: "set null" }),
    pick: jsonb("pick").$type<ToolPick>(),
    alternatives: jsonb("alternatives").$type<{ name: string; line: string }[]>().notNull().default(sql`'[]'::jsonb`),
    sources: jsonb("sources").$type<{ url: string; title: string }[]>().notNull().default(sql`'[]'::jsonb`),
    decidedAt: tstz("decided_at"),
    askAgainAt: tstz("ask_again_at"),
    ...timestamps(),
  },
  (t) => [unique("tool_needs_business_category_key").on(t.businessId, t.category), index("tool_needs_task_id_idx").on(t.taskId), index("tool_needs_inbox_item_id_idx").on(t.inboxItemId)],
);
export type ToolNeed = typeof toolNeeds.$inferSelect;
