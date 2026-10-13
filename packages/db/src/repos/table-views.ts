/**
 * saved_table_views (0041) — account-scoped (userId first): the views one person saved on one data table, and the view
 * they last had open, for a business (`businessId`) or for the account-wide LIVE pages (`businessId` null). Router
 * founder.tableViews.get/save, run as that person under RLS, so a row is only ever their own and only for a business
 * they belong to. Built-in views live in code; the row holds the person's list as they last left it.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { savedTableViews, type StoredTableView } from "../schema";
import { Id, maybeOne, one, parseInput, rowsOf, type Executor } from "./_shared";

/** "team.agents", "crm.list", "live.leaderboards": lower-case, dotted, at most 80 characters (the table's own check). */
export const TableKey = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,79}$/, "Unknown table");

const ViewId = z.string().min(1).max(80);

const FilterScalar = z.union([z.string().max(500), z.number(), z.boolean()]);

/** One filter chip (Dugout FilterChipValue): a field, an operator and a scalar, a `[from, to]` pair or a list. */
export const StoredFilter = z.object({
  id: z.string().min(1).max(80),
  field: z.string().min(1).max(80),
  op: z.string().min(1).max(40),
  value: z.union([FilterScalar, z.array(z.union([z.string().max(500), z.number()])).max(200).readonly()]).optional(),
});

export const StoredView = z.object({
  id: ViewId,
  name: z.string().trim().min(1).max(80),
  columns: z.array(z.string().min(1).max(80)).max(100),
  sort: z.array(z.object({ id: z.string().min(1).max(80), desc: z.boolean() })).max(20),
  filters: z.array(StoredFilter).max(50),
  density: z.enum(["compact", "comfortable"]).optional(),
  builtIn: z.boolean().optional(),
});

export const TableViewsScope = z.object({ tableKey: TableKey, businessId: Id.nullish() });
export type TableViewsScope = z.input<typeof TableViewsScope>;

export const SaveTableViewsInput = TableViewsScope.extend({
  views: z.array(StoredView).max(50),
  activeViewId: ViewId.nullable(),
});
export type SaveTableViewsInput = z.input<typeof SaveTableViewsInput>;

export interface TableViewsState {
  views: StoredTableView[];
  activeViewId: string | null;
}

const NIL = "00000000-0000-0000-0000-000000000000";

export const tableViewsRepo = {
  /** The person's saved state for the table, or null when they never changed anything there. */
  async get(db: Executor, userId: string, scope: TableViewsScope): Promise<TableViewsState | null> {
    const v = parseInput(TableViewsScope, scope, "table views");
    const row = maybeOne(
      await db
        .select({ views: savedTableViews.views, activeViewId: savedTableViews.activeViewId })
        .from(savedTableViews)
        .where(sql`${savedTableViews.userId} = ${userId} and coalesce(${savedTableViews.businessId}, ${NIL}::uuid) = ${v.businessId ?? NIL}::uuid and ${savedTableViews.tableKey} = ${v.tableKey}`)
        .limit(1),
    );
    return row ? { views: row.views, activeViewId: row.activeViewId } : null;
  },

  /** Stores the person's views and open view for the table (one row per person × business × table); returns them. */
  async save(db: Executor, userId: string, input: SaveTableViewsInput): Promise<TableViewsState> {
    const v = parseInput(SaveTableViewsInput, input, "table views");
    const views = JSON.stringify(v.views);
    const rows = rowsOf<{ views: StoredTableView[]; active_view_id: string | null }>(await db.execute(sql`
      insert into saved_table_views (user_id, business_id, table_key, views, active_view_id)
      values (${userId}, ${v.businessId ?? null}, ${v.tableKey}, ${views}::jsonb, ${v.activeViewId})
      on conflict (user_id, coalesce(business_id, ${sql.raw(`'${NIL}'::uuid`)}), table_key)
      do update set views = excluded.views, active_view_id = excluded.active_view_id
      returning views, active_view_id`));
    const row = one(rows, "table views", v.tableKey);
    return { views: row.views, activeViewId: row.active_view_id };
  },
};
