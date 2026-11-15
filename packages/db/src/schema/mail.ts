/** 0078 — a project's Foundmill sending address: one row per business, its local part kept once chosen. */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
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

/**
 * Every local part a deleted project held (trigger `fm_project_mail_retire`), never given out again so a new project
 * never receives an old one's replies. A platform table: no business_id, service role only (no app-role grant or policy).
 */
export const retiredMailLocalParts = pgTable(
  "retired_mail_local_parts",
  {
    id: id(),
    localPart: text("local_part").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("retired_mail_local_parts_local_part_key").on(t.localPart)],
);

/**
 * 0101 — the founders' postal address for the project's marketing email (US CAN-SPAM), one line. Private: the founders
 * (owner or admin) read and write it; collaborators do not; the gateway reads it on the service connection for the footer.
 */
export const projectPostalAddresses = pgTable(
  "project_postal_addresses",
  {
    id: id(),
    businessId: businessId(),
    address: text("address").notNull(),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("project_postal_addresses_business_id_key").on(t.businessId), index("project_postal_addresses_updated_by_idx").on(t.updatedBy)],
);
export type ProjectPostalAddress = typeof projectPostalAddresses.$inferSelect;
