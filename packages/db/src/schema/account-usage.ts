/**
 * 0138 — model calls a signed-in person makes before they have a project (WP-09 T2): one row per live call at its exact
 * cost, summed for the api's ceilings before commit and read by the cost report. The services' alone: RLS on, no policy,
 * no client grant; the service role reads and adds rows, never changes them.
 */
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { MODEL_KEYS } from "@foundmill/shared";
import { id, minor, timestamps, tstz, usdCurrency } from "./_common";

export const accountUsage = pgTable(
  "account_usage",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    route: text("route").notNull(),
    modelKey: text("model_key", { enum: MODEL_KEYS }),
    quantity: minor("quantity").notNull().default(0),
    /** The exact cost in millionths of a US cent, as usage_ledger.cost_micro_minor. */
    costMicroMinor: minor("cost_micro_minor").notNull().default(0),
    currency: usdCurrency(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    details: jsonb("details").notNull().default({}),
    ...timestamps(),
  },
  (t) => [index("account_usage_user_id_occurred_at_idx").on(t.userId, t.occurredAt)],
);
export type AccountUsageRow = typeof accountUsage.$inferSelect;
