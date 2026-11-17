/** The free plan's spend for the month's cap (WP-13 T6, `free-plan-cap.ts`): platform-wide, so no business id. */
import { and, eq, gte, sql } from "drizzle-orm";
import { businesses, ideaDrafts, usageLedger } from "../schema";
import type { Executor } from "./_shared";

export const freePlanSpendRepo = {
  /** Every cost booked to the platform's credits since `since` by a business on the free plan, plus the idea box's cards, in millionths of a cent. */
  async spendMicro(db: Executor, since: Date): Promise<number> {
    const [ledger] = await db
      .select({ total: sql<string>`coalesce(sum(${usageLedger.costMicroMinor}), 0)` })
      .from(usageLedger)
      .innerJoin(businesses, eq(businesses.id, usageLedger.businessId))
      .where(and(eq(usageLedger.billedTo, "credits"), gte(usageLedger.occurredAt, since), eq(businesses.planTier, "free")));
    const [box] = await db.select({ total: sql<string>`coalesce(sum(${ideaDrafts.costMicro}), 0)` }).from(ideaDrafts).where(gte(ideaDrafts.createdAt, since));
    return Number(ledger?.total ?? 0) + Number(box?.total ?? 0);
  },
};
