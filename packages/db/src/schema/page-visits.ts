/**
 * 0175 — visits to a project's public page, counted by Foundmill (founder, Nov 25, 2026; packages/shared
 * `page-visits.ts`). One count per business, UTC day and source; nothing names a visitor. Members read; only the
 * service connection writes (apps/api services/page-visits.ts).
 */
import { PAGE_VISIT_SOURCES } from "@foundmill/shared/page-visits";
import { date, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const pageVisitDays = pgTable(
  "page_visit_days",
  {
    id: id(),
    businessId: businessId(),
    /** The day in UTC. */
    day: date("day", { mode: "string" }).notNull(),
    source: text("source", { enum: PAGE_VISIT_SOURCES }).notNull(),
    visits: integer("visits").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("page_visit_days_business_id_day_source_key").on(t.businessId, t.day, t.source)],
);
export type PageVisitDayRow = typeof pageVisitDays.$inferSelect;
