/** 0074 — the demo businesses' own sample rows: the ids the seed wrote, per table (the only rows the roll-forward moves). */
import { pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { emptyArray, id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const demoSampleRows = pgTable(
  "demo_sample_rows",
  {
    id: id(),
    businessId: businessId(),
    tableName: text("table_name").notNull(),
    rowIds: uuid("row_ids").array().notNull().default(emptyArray),
    ...timestamps(),
  },
  (t) => [unique("demo_sample_rows_business_id_table_name_key").on(t.businessId, t.tableName)],
);
export type DemoSampleRows = typeof demoSampleRows.$inferSelect;
export type NewDemoSampleRows = typeof demoSampleRows.$inferInsert;
