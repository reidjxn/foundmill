/**
 * page_visit_days (0175): the daily visit counts of a project's public page. `count` is the beacon's one write, on the
 * service connection; `recent` reads the window for the founder's screen (under RLS) and the team (service).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { PageVisitDay, PageVisitSource } from "@foundmill/shared/page-visits";
import { pageVisitDays } from "../schema";
import type { Executor } from "./_shared";

export const pageVisitsRepo = {
  /** Adds one visit to the business's count for `day` ("YYYY-MM-DD", UTC) and `source`: one upsert. */
  async count(db: Executor, businessId: string, day: string, source: PageVisitSource): Promise<void> {
    await db
      .insert(pageVisitDays)
      .values({ businessId, day, source, visits: 1 })
      .onConflictDoUpdate({ target: [pageVisitDays.businessId, pageVisitDays.day, pageVisitDays.source], set: { visits: sql`${pageVisitDays.visits} + 1`, updatedAt: new Date() } });
  },

  /** Every row of the business from `sinceDay` on ("YYYY-MM-DD"). */
  async recent(db: Executor, businessId: string, sinceDay: string): Promise<PageVisitDay[]> {
    return db
      .select({ day: pageVisitDays.day, source: pageVisitDays.source, visits: pageVisitDays.visits })
      .from(pageVisitDays)
      .where(and(eq(pageVisitDays.businessId, businessId), gte(pageVisitDays.day, sinceDay)));
  },
};
