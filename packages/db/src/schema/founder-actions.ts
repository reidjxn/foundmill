/**
 * 0169 — founder-executed actions: a request an agent prepared, the exact payload with its hash, what the note showed,
 * and what became of the founder's press. Members read; only the services write.
 */
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { inboxItems } from "./inbox";

export const FOUNDER_ACTION_STATUSES = ["prepared", "executing", "executed", "failed", "unknown", "voided"] as const;
export type FounderActionStatus = (typeof FOUNDER_ACTION_STATUSES)[number];

/** What the note showed: its subject, its lines, and the checked facts the gateway reads again before it runs anything. */
export interface FounderActionSummary {
  title: string;
  lines: string[];
  facts: Record<string, string | null>;
}

export const founderActions = pgTable(
  "founder_actions",
  {
    id: id(),
    businessId: businessId(),
    connectorKey: text("connector_key").notNull(),
    tool: text("tool").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    summary: jsonb("summary").$type<FounderActionSummary>().notNull(),
    preparedByAgentId: uuid("prepared_by_agent_id"),
    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, { onDelete: "set null" }),
    status: text("status", { enum: FOUNDER_ACTION_STATUSES }).notNull().default("prepared"),
    tokenHash: text("token_hash"),
    tokenExpiresAt: tstz("token_expires_at"),
    pressedBy: uuid("pressed_by"),
    pressedAt: tstz("pressed_at"),
    executedAt: tstz("executed_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("founder_actions_open_key").on(t.businessId, t.connectorKey, t.tool, t.payloadHash).where(sql`${t.status} = 'prepared'`), index("founder_actions_inbox_item_id_idx").on(t.inboxItemId)],
);
export type FounderAction = typeof founderActions.$inferSelect;
