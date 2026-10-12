/** Column helpers shared by every schema file. The SQL migrations are the source of truth; these mirror them. */
import { sql } from "drizzle-orm";
import { bigint, char, customType, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const archivedAt = () => timestamp("archived_at", { withTimezone: true, mode: "date" });
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** created_at + updated_at (every table). */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
/** created_at + updated_at + archived_at (soft-deletable tables). */
export const timestampsWithArchive = () => ({ ...timestamps(), archivedAt: archivedAt() });

/** Money in minor units (bigint in SQL, number in TS; values stay below 2^53). */
export const minor = (name: string) => bigint(name, { mode: "number" });
export const currency = () => char("currency", { length: 3 }).notNull().default("EUR");
/** Platform costs and credits (usage_ledger, credit_balances, agent_sessions, training_runs, agent_metrics; 0024): metered in US dollars, the model price list's currency. */
export const usdCurrency = () => char("currency", { length: 3 }).notNull().default("USD");

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** `default '{}'::uuid[]` etc. Drizzle needs an explicit SQL default for empty arrays. */
export const emptyArray = sql`'{}'`;
export const emptyObject = sql`'{}'::jsonb`;
export const emptyList = sql`'[]'::jsonb`;
