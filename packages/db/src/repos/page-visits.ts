/**
 * page_visit_days (0175, 0176): the daily visit counts of a project's public page and its Site. `count` is the page
 * beacon's one write, on the service connection (a Site counts through `repos.sites.countVisit`); `recent` reads one
 * surface's window for the founder's screens (under RLS) and the team (service).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { PageVisitDay, PageVisitSource, PageVisitSurface } from "@foundmill/shared/page-visits";
import { pageVisitDays } from "../schema";
import type { Executor } from "./_shared";

export const pageVisitsRepo = {
  /** Adds one visit to the business's count for `day` ("YYYY-MM-DD", UTC) and `source`: one upsert. */
  async count(db: Executor, businessId: string, day: string, source: PageVisitSource): Promise<void> {
    await db
      .insert(pageVisitDays)
      .values({ businessId, day, source, visits: 1 })
      .onConflictDoUpdate({ target: [pageVisitDays.businessId, pageVisitDays.day, pageVisitDays.surface, pageVisitDays.source], set: { visits: sql`${pageVisitDays.visits} + 1`, updatedAt: new Date() } });
  },

  /** Every row of the business for `surface` from `sinceDay` on ("YYYY-MM-DD"). */
  async recent(db: Executor, businessId: string, sinceDay: string, surface: PageVisitSurface = "page"): Promise<PageVisitDay[]> {
    return db
      .select({ day: pageVisitDays.day, source: pageVisitDays.source, visits: pageVisitDays.visits })
      .from(pageVisitDays)
      .where(and(eq(pageVisitDays.businessId, businessId), eq(pageVisitDays.surface, surface), gte(pageVisitDays.day, sinceDay)));
  },
};
