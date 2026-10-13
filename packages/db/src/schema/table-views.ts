/** 0041 — saved table views: the views each person saves on a data table, per business (null: the account-wide LIVE pages). */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { businesses } from "./accounts";
import { id, timestamps } from "./_common";

/** One saved view as the DataTable stores it (packages/dugout SavedView); validated by repos.tableViews. */
export interface StoredTableView {
  id: string;
  name: string;
  columns: string[];
  sort: { id: string; desc: boolean }[];
  filters: { id: string; field: string; op: string; value?: string | number | boolean | readonly (string | number)[] }[];
  density?: "compact" | "comfortable";
  builtIn?: boolean;
}

export const savedTableViews = pgTable(
  "saved_table_views",
  {
    id: id(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    tableKey: text("table_key").notNull(),
    views: jsonb("views").$type<StoredTableView[]>().notNull().default(sql`'[]'::jsonb`),
    activeViewId: text("active_view_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("saved_table_views_key_idx").on(t.userId, sql`coalesce(${t.businessId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.tableKey), index("saved_table_views_business_id_idx").on(t.businessId)],
);
export type SavedTableViews = typeof savedTableViews.$inferSelect;
export type NewSavedTableViews = typeof savedTableViews.$inferInsert;
