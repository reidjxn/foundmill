/** 0072 — the business's goal (founder, 2026-11-07): proposed by the Chief of Staff, approved by the founder. */
import { GOAL_METRIC_KINDS, GOAL_PROPOSAL_REASONS, GOAL_STATUSES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { bigint, char, date, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents } from "./agents";
import { inboxItems } from "./inbox";

/**
 * One row per proposal (revision 1, 2, …): proposed → active (approved; the previous active goal becomes replaced) →
 * achieved, or replaced (the founder asked for a change, or a newer goal was approved). At most one proposed and one
 * active goal per business (partial unique indexes).
 */
export const goals = pgTable(
  "goals",
  {
    id: id(),
    businessId: businessId(),
    revision: integer("revision").notNull().default(1),
    /** "Get the first 10 paying customers by Dec 19" (packages/shared `goalSentence`), at most 140 characters. */
    sentence: text("sentence").notNull(),
    metricKind: text("metric_kind", { enum: GOAL_METRIC_KINDS }).notNull(),
    /** A count, or minor units for revenue_month; null for custom. */
    targetValue: bigint("target_value", { mode: "number" }),
    /** The business's currency for revenue_month. */
    currency: char("currency", { length: 3 }),
    /** Where the number stood when the goal was proposed, and again when it was approved. */
    startValue: bigint("start_value", { mode: "number" }),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    status: text("status", { enum: GOAL_STATUSES }).notNull().default("proposed"),
    reason: text("reason", { enum: GOAL_PROPOSAL_REASONS }).notNull().default("first"),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    replacesGoalId: uuid("replaces_goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    /** The founder's words when they asked for a change to this proposal (at most 2,000 characters). */
    changeRequest: text("change_request"),
    inboxItemId: uuid("inbox_item_id").references((): AnyPgColumn => inboxItems.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => authUsers.id, { onDelete: "set null" }),
    approvedAt: tstz("approved_at"),
    achievedAt: tstz("achieved_at"),
    achievedValue: bigint("achieved_value", { mode: "number" }),
    replacedAt: tstz("replaced_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("goals_business_id_revision_key").on(t.businessId, t.revision),
    uniqueIndex("goals_one_proposed_idx").on(t.businessId).where(sql`status = 'proposed'`),
    uniqueIndex("goals_one_active_idx").on(t.businessId).where(sql`status = 'active'`),
    index("goals_business_idx").on(t.businessId, t.revision),
    index("goals_item_idx").on(t.inboxItemId),
    index("goals_agent_idx").on(t.proposedByAgentId),
    index("goals_replaces_idx").on(t.replacesGoalId),
    index("goals_approved_by_idx").on(t.approvedBy),
  ],
);
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
