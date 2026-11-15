/**
 * 0110 — task reports (WP-05 T3): the result of a task an agent finished, saved with the platform's `save_report` (or
 * from `complete_task`'s summary when the session saved none). Members other than collaborators read; only the services
 * write.
 * `simulated` is set by the gateway: a report built on a mock connector's reads is never a real result.
 */
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { businessId } from "./_refs";
import { tasks } from "./agents";

/** One source a report cites. */
export interface TaskReportSource {
  url: string;
  title: string;
}

export const taskReports = pgTable(
  "task_reports",
  {
    id: id(),
    businessId: businessId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** The session that saved it; null outside one. */
    sessionId: uuid("session_id"),
    agentId: uuid("agent_id").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    sources: jsonb("sources").$type<TaskReportSource[]>().notNull().default(sql`'[]'::jsonb`),
    simulated: boolean("simulated").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("task_reports_task_idx").on(t.businessId, t.taskId, t.createdAt.desc()), index("task_reports_task_id_idx").on(t.taskId)],
);
export type TaskReport = typeof taskReports.$inferSelect;
export type NewTaskReport = typeof taskReports.$inferInsert;
