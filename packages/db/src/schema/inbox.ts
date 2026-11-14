/** 0005 — inbox items, decisions, plans, plan actions, composer buffer. */
import { INBOX_ITEM_TYPES, INBOX_STATES, PLAN_ACTION_TYPES, PLAN_ORIGINS, PLAN_STATUSES, POLICY_OUTCOMES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyArray, emptyList, emptyObject, id, minor, pricingCurrency, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents, playbooks } from "./agents";

export const DECIDED_BY_KINDS = ["user", "chief_of_staff"] as const;
export const PLAN_ACTION_STATUSES = ["pending", "awaiting_approval", "running", "done", "failed", "skipped", "denied"] as const;

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    businessId: businessId(),
    type: text("type", { enum: INBOX_ITEM_TYPES }).notNull(),
    fromAgentId: uuid("from_agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    fromUserId: uuid("from_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    statusStrip: jsonb("status_strip").$type<unknown[]>().notNull().default(emptyList),
    exhibit: jsonb("exhibit").$type<{ kind: string } & Record<string, unknown>>().notNull().default(sql`'{"kind":"none"}'::jsonb`),
    decision: jsonb("decision").$type<Record<string, unknown>>(),
    blocksContinue: boolean("blocks_continue").notNull().default(false),
    sourceEventIds: uuid("source_event_ids").array().notNull().default(emptyArray),
    entityIds: uuid("entity_ids").array().notNull().default(emptyArray),
    state: text("state", { enum: INBOX_STATES }).notNull().default("unread"),
    costMinor: minor("cost_minor").notNull().default(0),
    currency: pricingCurrency(),
    /**
     * 0103 — a note for one person only (a founder's own showcase ask). Null: a note for everyone who reads the Inbox, as
     * every note before it. A restrictive policy keeps it out of every other client's reads and writes.
     */
    forUserId: uuid("for_user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    ...timestampsWithArchive(),
  },
  (t) => [
    unique("inbox_items_id_business_id_key").on(t.id, t.businessId),
    index("inbox_items_business_id_idx").on(t.businessId, t.createdAt),
    index("inbox_items_state_idx").on(t.businessId, t.state).where(sql`${t.state} <> 'archived'`),
    index("inbox_items_type_idx").on(t.businessId, t.type),
    index("inbox_items_from_agent_id_idx").on(t.fromAgentId),
    index("inbox_items_from_user_id_idx").on(t.fromUserId),
    index("inbox_items_for_user_id_idx").on(t.forUserId).where(sql`${t.forUserId} is not null`),
  ],
);
export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;

/**
 * 0048 — who has opened which note. `inbox_items.state` is `unread` until the note is answered or archived; whether a
 * given person has read it is a receipt here (one per person and note), so one person opening a note no longer marks it
 * read for everyone, and viewers and advisors keep their own. User-owned within a business, like dashboard_layouts.
 */
export const inboxItemReads = pgTable(
  "inbox_item_reads",
  {
    id: id(),
    businessId: businessId(),
    inboxItemId: uuid("inbox_item_id").notNull(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    readAt: tstz("read_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "inbox_item_reads_item_fkey", columns: [t.inboxItemId, t.businessId], foreignColumns: [inboxItems.id, inboxItems.businessId] }).onDelete("cascade"),
    unique("inbox_item_reads_item_user_key").on(t.inboxItemId, t.userId),
    index("inbox_item_reads_business_id_idx").on(t.businessId),
    index("inbox_item_reads_user_id_idx").on(t.userId, t.businessId),
  ],
);
export type InboxItemRead = typeof inboxItemReads.$inferSelect;
export type NewInboxItemRead = typeof inboxItemReads.$inferInsert;

export const plans = pgTable(
  "plans",
  {
    id: id(),
    businessId: businessId(),
    origin: text("origin", { enum: PLAN_ORIGINS }).notNull(),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("pending_confirmation"),
    summaryMd: text("summary_md").notNull().default(""),
    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, { onDelete: "set null" }),
    playbookId: uuid("playbook_id").references((): AnyPgColumn => playbooks.id, { onDelete: "set null" }),
    workflowId: text("workflow_id"),
    confirmedAt: tstz("confirmed_at"),
    completedAt: tstz("completed_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("plans_business_id_idx").on(t.businessId, t.createdAt),
    index("plans_status_idx").on(t.businessId, t.status),
    index("plans_inbox_item_id_idx").on(t.inboxItemId),
    index("plans_playbook_id_idx").on(t.playbookId),
  ],
);
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    businessId: businessId(),
    inboxItemId: uuid("inbox_item_id").notNull().references(() => inboxItems.id, { onDelete: "cascade" }),
    chosenOption: text("chosen_option"),
    freeText: text("free_text"),
    decidedByKind: text("decided_by_kind", { enum: DECIDED_BY_KINDS }).notNull().default("user"),
    decidedBy: uuid("decided_by"),
    decidedAt: tstz("decided_at").notNull().defaultNow(),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("decisions_business_id_idx").on(t.businessId, t.decidedAt),
    index("decisions_inbox_item_id_idx").on(t.inboxItemId),
    index("decisions_plan_id_idx").on(t.planId),
  ],
);
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

export const planActions = pgTable(
  "plan_actions",
  {
    id: id(),
    businessId: businessId(),
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    type: text("type", { enum: PLAN_ACTION_TYPES }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default(emptyObject),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    policyOutcome: text("policy_outcome", { enum: POLICY_OUTCOMES }),
    status: text("status", { enum: PLAN_ACTION_STATUSES }).notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    startedAt: tstz("started_at"),
    endedAt: tstz("ended_at"),
    ...timestamps(),
  },
  (t) => [
    index("plan_actions_business_id_idx").on(t.businessId),
    index("plan_actions_plan_id_idx").on(t.planId, t.position),
    index("plan_actions_agent_id_idx").on(t.agentId),
    index("plan_actions_status_idx").on(t.businessId, t.status),
  ],
);
export type PlanAction = typeof planActions.$inferSelect;
export type NewPlanAction = typeof planActions.$inferInsert;

export const composerBuffer = pgTable(
  "composer_buffer",
  {
    id: id(),
    businessId: businessId(),
    candidate: jsonb("candidate").$type<Record<string, unknown>>().notNull(),
    sourceHash: text("source_hash").notNull(),
    priority: integer("priority").notNull().default(0),
    valid: boolean("valid").notNull().default(true),
    consumedAt: tstz("consumed_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("composer_buffer_business_id_source_hash_key").on(t.businessId, t.sourceHash),
    index("composer_buffer_business_id_idx").on(t.businessId, t.priority).where(sql`${t.valid} and ${t.consumedAt} is null`),
  ],
);
export type ComposerBufferRow = typeof composerBuffer.$inferSelect;
export type NewComposerBufferRow = typeof composerBuffer.$inferInsert;
