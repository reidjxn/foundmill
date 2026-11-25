/**
 * 0175 — visits to a project's public page, counted by Foundmill (founder, Nov 25, 2026; packages/shared
 * `page-visits.ts`). One count per business, UTC day, surface (0176: the page or the Site) and source; nothing names a
 * visitor. Members read; only the service connection (apps/api services/page-visits.ts) and `site_visit` (apps/sites)
 * write.
 */
import { PAGE_VISIT_SOURCES, PAGE_VISIT_SURFACES } from "@foundmill/shared/page-visits";
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
    /** 0176: `page` for `/p/<slug>`, `site` for the project's Foundmill Site. */
    surface: text("surface", { enum: PAGE_VISIT_SURFACES }).notNull().default("page"),
    source: text("source", { enum: PAGE_VISIT_SOURCES }).notNull(),
    visits: integer("visits").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("page_visit_days_business_id_day_surface_source_key").on(t.businessId, t.day, t.surface, t.source)],
);
export type PageVisitDayRow = typeof pageVisitDays.$inferSelect;
