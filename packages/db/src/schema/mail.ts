/** 0078 — a project's Foundmill sending address: one row per business, its local part kept once chosen. */
import { integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const PROJECT_MAIL_STATUSES = ["active", "paused"] as const;
export type ProjectMailStatus = (typeof PROJECT_MAIL_STATUSES)[number];

/**
 * Members read; only the services write (the gateway on the first send, the api when Settings first shows it) and only
 * an operator pauses a project or raises its cap. `local_part` never changes (trigger `fm_project_mail_guard`).
 */
export const projectMail = pgTable(
  "project_mail",
  {
    id: id(),
    businessId: businessId(),
    localPart: text("local_part").notNull(),
    status: text("status", { enum: PROJECT_MAIL_STATUSES }).notNull().default("active"),
    /** Messages per UTC day for this project; null = PLATFORM_MAIL_DAILY_CAP. */
    dailyCap: integer("daily_cap"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("project_mail_business_id_key").on(t.businessId), uniqueIndex("project_mail_local_part_key").on(t.localPart)],
);
export type ProjectMail = typeof projectMail.$inferSelect;
