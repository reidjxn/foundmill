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
/**
 * 0025 — the currency of a business amount (budgets, wage caps, bank money, revenue, legal costs): no fixed default; an
 * insert that names none takes `businesses.currency` (trigger `fm_business_currency_fill`). Drizzle sends `default`.
 */
export const businessCurrency = () => char("currency", { length: 3 }).notNull().$defaultFn(() => sql`default`);
/** 0025 — the currency of a model cost (sessions, training runs, an agent's day, an Inbox note): the pricing currency. */
export const pricingCurrency = () => char("currency", { length: 3 }).notNull().default("USD");

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
