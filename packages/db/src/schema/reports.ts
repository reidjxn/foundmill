/**
 * 0112 — reports of a person, a profile or a message (docs/NETWORK.md F21). Person-level, not business-scoped: RLS on,
 * no policy, service role only. Written by the api's `report.create` and resolved through `operator.reports.*`.
 */
import { REPORT_REASONS, REPORT_RESOLUTIONS, REPORT_TARGET_KINDS } from "@foundmill/shared/reports";
import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { messages } from "./social";

export const reports = pgTable(
  "reports",
  {
    id: id(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: REPORT_TARGET_KINDS }).notNull(),
    targetUserId: uuid("target_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    targetMessageId: uuid("target_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    /** The reporter's words: untrusted, shown as plain text, never sent to a model. */
    note: text("note"),
    resolvedAt: tstz("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => authUsers.id, { onDelete: "set null" }),
    resolution: text("resolution", { enum: REPORT_RESOLUTIONS }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("reports_open_once_key")
      .on(t.reporterUserId, t.targetKind, sql`coalesce(${t.targetMessageId}, ${t.targetUserId})`)
      .where(sql`${t.resolvedAt} is null`),
    index("reports_open_idx")
      .on(t.createdAt)
      .where(sql`${t.resolvedAt} is null`),
    index("reports_target_user_id_idx").on(t.targetUserId),
    index("reports_target_message_id_idx").on(t.targetMessageId),
    index("reports_resolved_by_idx").on(t.resolvedBy),
  ],
);
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
