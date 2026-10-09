/** 0020 — founder ↔ agent conversations (the agent's desk): threads per agent and subject, and their messages. */
import { AGENT_REACTIONS, CONVERSATION_AUTHOR_KINDS, CONVERSATION_SUBJECT_KINDS, type QuickReplyKind } from "@foundmill/shared";
import { foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyArray, emptyList, emptyObject, id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents } from "./agents";
import { plans } from "./inbox";

/** One quick reply as stored on an agent message (the `QuickReply` contract of packages/models). */
export interface StoredQuickReply {
  id: string;
  label: string;
  say: string;
  kind: QuickReplyKind;
  option_id: string | null;
  recommended: boolean;
}

export const agentThreads = pgTable(
  "agent_threads",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind", { enum: CONVERSATION_SUBJECT_KINDS }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    lastMessageAt: tstz("last_message_at"),
    messageCount: integer("message_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("agent_threads_id_business_id_key").on(t.id, t.businessId),
    uniqueIndex("agent_threads_subject_idx").on(t.businessId, t.agentId, t.subjectKind, t.subjectId),
    index("agent_threads_agent_id_idx").on(t.agentId),
    index("agent_threads_recent_idx").on(t.businessId, t.lastMessageAt),
  ],
);
export type AgentThread = typeof agentThreads.$inferSelect;
export type NewAgentThread = typeof agentThreads.$inferInsert;

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: id(),
    businessId: businessId(),
    threadId: uuid("thread_id").notNull(),
    authorKind: text("author_kind", { enum: CONVERSATION_AUTHOR_KINDS }).notNull(),
    authorUserId: uuid("author_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    bubbles: jsonb("bubbles").$type<string[]>().notNull(),
    reaction: text("reaction", { enum: AGENT_REACTIONS }).notNull().default("none"),
    quickReplies: jsonb("quick_replies").$type<StoredQuickReply[]>().notNull().default(emptyList),
    chosenQuickReplyId: text("chosen_quick_reply_id"),
    handOff: jsonb("hand_off").$type<{ instruction: string; gated?: boolean }>(),
    refersTo: text("refers_to").array().notNull().default(emptyArray),
    entityIds: uuid("entity_ids").array().notNull().default(emptyArray),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(emptyObject),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "agent_messages_thread_fkey", columns: [t.threadId, t.businessId], foreignColumns: [agentThreads.id, agentThreads.businessId] }).onDelete("cascade"),
    index("agent_messages_thread_idx").on(t.threadId, t.createdAt),
    index("agent_messages_business_id_idx").on(t.businessId, t.createdAt),
    index("agent_messages_author_user_id_idx").on(t.authorUserId),
    index("agent_messages_agent_id_idx").on(t.agentId),
    index("agent_messages_plan_id_idx").on(t.planId),
  ],
);
export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
