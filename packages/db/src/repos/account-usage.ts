/**
 * account_usage (0138, WP-09 T2): live model calls a signed-in person makes before they have a project, at their exact
 * cost. The api's usage sink records each; the api's credits gate sums them for the ceilings before commit.
 */
import type { ModelKey } from "@foundmill/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import { accountUsage } from "../schema";
import type { Executor } from "./_shared";

export interface RecordAccountUsageInput {
  userId: string;
  kind: string;
  route: string;
  modelKey: ModelKey | null;
  quantity: number;
  /** Millionths of a US cent: the meter's exact cost. */
  costMicroMinor: number;
  occurredAt: Date;
  details: Record<string, unknown>;
}

export const accountUsageRepo = {
  async record(db: Executor, input: RecordAccountUsageInput): Promise<void> {
    await db.insert(accountUsage).values({
      userId: input.userId,
      kind: input.kind,
      route: input.route,
      modelKey: input.modelKey,
      quantity: Math.max(0, Math.round(input.quantity)),
      costMicroMinor: Math.max(0, Math.round(input.costMicroMinor)),
      occurredAt: input.occurredAt,
      details: input.details,
    });
  },

  /** What a person's calls before a project have cost since `since`, in millionths of a US cent. */
  async spentMicro(db: Executor, userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${accountUsage.costMicroMinor}), 0)` })
      .from(accountUsage)
      .where(and(eq(accountUsage.userId, userId), gte(accountUsage.occurredAt, since)));
    return Number(row?.total ?? 0);
  },
};
