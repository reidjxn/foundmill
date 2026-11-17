/**
 * 0134 — write to your followers (WP-08 T3): the founders' updates and their per-follower delivery record. Members read
 * updates and write a draft's subject and body; everything else is the services' (see the migration). Deliveries are
 * service role only and hold no address.
 */
import { PROJECT_UPDATE_STATUSES } from "@foundmill/shared";
import { index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { businessId } from "./_refs";
import { entities } from "./crm";
import { id, timestamps, tstz } from "./_common";

export const projectUpdates = pgTable(
  "project_updates",
  {
    id: id(),
    businessId: businessId(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: PROJECT_UPDATE_STATUSES }).notNull().default("draft"),
    draftedByAgentId: uuid("drafted_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    sentCount: integer("sent_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    remainingCount: integer("remaining_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("project_updates_business_id_idx").on(t.businessId, t.createdAt), index("project_updates_drafted_by_agent_id_idx").on(t.draftedByAgentId)],
);
export type ProjectUpdate = typeof projectUpdates.$inferSelect;

export const projectUpdateDeliveries = pgTable(
  "project_update_deliveries",
  {
    id: id(),
    updateId: uuid("update_id").notNull().references(() => projectUpdates.id, { onDelete: "cascade" }),
    businessId: businessId(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    recipientHash: text("recipient_hash").notNull(),
    state: text("state", { enum: ["sending", "sent", "skipped"] }).notNull(),
    reason: text("reason"),
    messageRef: uuid("message_ref"),
    at: tstz("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [unique("project_update_deliveries_one").on(t.updateId, t.entityId), unique("project_update_deliveries_one_address").on(t.updateId, t.recipientHash), index("project_update_deliveries_business_id_idx").on(t.businessId), index("project_update_deliveries_entity_id_idx").on(t.entityId)],
);
export type ProjectUpdateDelivery = typeof projectUpdateDeliveries.$inferSelect;
