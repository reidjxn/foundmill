/**
 * The sample businesses roll forward with the calendar (first-time founder report, Phase 3 group K item 3; DECISIONS
 * 2026-11-10 "The sample businesses roll forward"). The demo seed dates its activity up to the instant it ran (its
 * "today"), so a deployment seeded weeks ago showed Northwind with 0 customers this week and no revenue this month
 * while Milestones and Finance still showed the seeded history. `rollDemoForward` moves the timestamps and dates of a
 * demo business's own sample rows (the business found by its fixed id, never by slug) forward by the whole days between
 * that "today" and now, in one transaction per business: the sample keeps its shape (weekdays, times of day, gaps
 * between events) and looks current.
 *
 * - **Only the demo businesses.** The ids are `DEMO_BUSINESS_IDS`; a founder's own business is never read or written.
 * - **Only the sample's own rows, for good.** The seed records the ids of every row it wrote, per table, in
 *   `demo_sample_rows` (migration 0074; `recordSampleRows`, just before its `seed.demo` entry). A roll moves those rows
 *   and nothing else, however many rolls run: a row a person or a service writes later (an owner's approval, a nightly
 *   agent rollup, a viewer's seat, a real charge) keeps its real times. A sample row someone changes after a roll leaves
 *   the list at the next roll (its updated_at, which the trigger stamps with now(), is newer than the last roll), so a
 *   seeded approval a founder resolves keeps the resolution time the audit log records. A seed older than the list is
 *   given one at its first roll, from the rows created up to its own audit entry (exact while nothing has rolled yet).
 * - **Never the tables that record real people, real money or other businesses' view.** `ROLL_EXCLUDED_TABLES`: the
 *   append-only audit chain, the outbox, memberships and read marks, billing (usage, credit balances, checkouts),
 *   secrets (credentials, webhooks), consent (the suppression list), the network's posts and community members (demo
 *   posts sit in public communities real founders use), people's saved views and layouts, and the sample list itself.
 * - **Whole days, never into the future.** The shift is `floor((now − anchor) / 1 day)` days, so the shifted anchor is
 *   at most now; `created_at` and `updated_at` are also capped at now. Dates meant to be ahead (a goal's due date, a
 *   vacation's end, a roadmap's target) stay ahead by the same distance.
 * - **Never wedged by a unique date.** A column in a unique index (a day per agent, a day per channel and campaign) is
 *   moved in two steps, far ahead and back, so the sample never collides with itself mid-statement; a sample row whose
 *   new key another row already holds (last night's rollup wrote that agent's day) is dropped, so the writer's row
 *   wins. A table whose unique index uses an expression over a moved date is left as it is (named in the result), and
 *   any other unique or exclusion violation rolls back that table alone, never the roll.
 * - **updated_at keeps its meaning.** Migration 0074 lets the updated_at trigger keep the shifted value for the rows of
 *   the business named in `fm.demo_roll_forward` (set by this transaction), never for an app role.
 * - **Recorded.** Each roll appends `seed.demo.rolled` to the business's audit chain with the old and new anchor and
 *   its time (`settledAt`); the next roll reads the latest of that entry and the seed's own `seed.demo` (whose details
 *   carry the seed's "today" since Nov 10, 2026; an older seed's entry is read by its own time). An advisory lock per
 *   business, shared with the seed's rebuild (`deleteDemoBusinesses`), and that re-read inside the transaction make two
 *   api instances rolling at once shift the data once.
 *
 * Known limits: text keys (`ledger_snapshots.period`, chapter title keys) and timestamps inside JSON (inbox payloads,
 * milestone refs) keep their seeded values; seeded prose names no absolute dates for that reason. A table without an
 * updated_at column cannot tell that someone changed one of its sample rows, so such a row keeps moving.
 */
import { goalDateWords } from "@foundmill/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { repos } from "../repos";
import { rowsOf, type Executor } from "../repos/_shared";
import { auditLog } from "../schema";
import { DEMO_BUSINESS_IDS, DEMO_SEED_AUDIT_ACTION, LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID } from "./constants";
import { DAY_MS } from "./context";

/** The audit action each roll appends (the seed's own entry is `seed.demo`). */
export const DEMO_ROLL_AUDIT_ACTION = "seed.demo.rolled";

/**
 * Business-scoped tables a roll never touches: real people's and real money's, other businesses' view, internal
 * plumbing. The audit chain is append-only (its times are when things really happened) and the outbox belongs to the
 * relay; memberships, read marks, saved views and dashboard layouts are people's; posts and community
 * members are the network's (demo posts sit in public communities real founders use, among real replies); usage,
 * credit balances and checkouts are billing, keyed by real periods; credentials and webhooks are secrets; the
 * suppression list is consent; `demo_sample_rows` is this roll's own list.
 */
export const ROLL_EXCLUDED_TABLES: readonly string[] = [
  "audit_log",
  "outbox",
  "memberships",
  "inbox_item_reads",
  "saved_table_views",
  "dashboard_layouts",
  "posts",
  "community_members",
  "usage_ledger",
  "credit_balances",
  "billing_checkouts",
  "credentials",
  "webhooks",
  "suppression_list",
  "demo_sample_rows",
  // A public page is a person's own writing and a sample business never has one live (0077).
  "project_pages",
];

/** Columns that record when a row was written: never shifted past now. */
const CAPPED_COLUMNS = new Set(["created_at", "updated_at"]);
/** How far a unique date is parked during the two-step move (about a century). */
const PARK_DAYS = 36_500;

/**
 * The lock a roll of one demo business and the seed's rebuild of it share (`deleteDemoBusinesses`): a roll never runs
 * while the business is being deleted, and one that waited finds no anchor afterwards.
 */
export async function lockDemoBusiness(tx: Executor, businessId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fm.demo_roll_forward'), hashtext(${businessId}::text))`);
}

/**
 * Makes Northwind the newer demo business. `/` opens a founder's newest business when no last-business cookie is set
 * (apps/web/app/page.tsx), and Ledgerly is built after Northwind (and a roll caps both created_at at now, which can tie
 * them), so without this a first sign-in lands on Ledgerly. Idempotent; returns whether a row changed.
 */
export async function putNorthwindFirst(db: Executor): Promise<boolean> {
  const result = await db.execute(
    sql`update businesses n set created_at = l.created_at + interval '1 second' from businesses l where n.id = ${NORTHWIND_BUSINESS_ID}::uuid and l.id = ${LEDGERLY_BUSINESS_ID}::uuid and n.created_at <= l.created_at returning n.id`,
  );
  return rowsOf(result).length > 0;
}

export interface DemoAnchor {
  /** The sample's "now": the seed's today, or the last roll's shifted anchor. */
  anchor: Date;
  /** A seed without a sample list: rows created at or before this instant are the sample's (its first roll records them). */
  cutoff: Date;
  /** When the last roll ran (null for the seed's own entry): a sample row changed after it is no longer the sample's. */
  settledAt: Date | null;
}

interface AnchorEntry {
  action: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

const dateOr = (value: unknown, fallback: Date): Date => {
  if (typeof value !== "string") return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : fallback;
};

/** The anchor an audit entry records: a roll's `anchor`/`settledAt`, the seed's `anchor` (its today) with its own time as the cutoff. */
export function anchorOf(entry: AnchorEntry): DemoAnchor {
  const details = entry.details ?? {};
  if (entry.action === DEMO_ROLL_AUDIT_ACTION) {
    const anchor = dateOr(details.anchor, entry.createdAt);
    // A roll written before the sample list (Nov 10, 2026) carried a `cutoff`; every later one carries `settledAt`.
    const settledAt = dateOr(details.settledAt, dateOr(details.cutoff, anchor));
    return { anchor, cutoff: dateOr(details.cutoff, settledAt), settledAt };
  }
  return { anchor: dateOr(details.anchor, entry.createdAt), cutoff: entry.createdAt, settledAt: null };
}

/** Whole days to shift so the sample's "now" is within a day of `now` and never after it; 0 when it is current. */
export function rollDays(anchor: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / DAY_MS));
}

/** The latest seed or roll entry of a demo business, read as its anchor; null when the seed never finished. */
export async function demoAnchor(db: Executor, businessId: string): Promise<DemoAnchor | null> {
  const [row] = await db
    .select({ action: auditLog.action, details: auditLog.details, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.businessId, businessId), inArray(auditLog.action, [DEMO_SEED_AUDIT_ACTION, DEMO_ROLL_AUDIT_ACTION])))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  return row ? anchorOf({ action: row.action, details: (row.details ?? null) as Record<string, unknown> | null, createdAt: row.createdAt }) : null;
}

interface DatedColumn {
  table: string;
  column: string;
  type: "timestamptz" | "timestamp" | "date";
}

/** A unique index whose key holds a moved date: its plain key columns and, for a partial index, its predicate. */
interface UniqueKey {
  name: string;
  columns: string[];
  predicate: string | null;
}

interface RollTable {
  table: string;
  columns: DatedColumn[];
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  /** Unique indexes over moved dates, checked for collisions in the two-step move. */
  unique: UniqueKey[];
  /** Why this table is left as it is (a unique index with an expression over a moved date), or null. */
  unsupported: string | null;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Does a SQL expression (as pg_get_expr prints it) name this column? */
const mentions = (expression: string, column: string): boolean => new RegExp(`(^|[^a-z0-9_"])"?${column.replace(/[^a-z0-9_]/gi, "")}"?($|[^a-z0-9_"])`, "i").test(expression);

/**
 * Every business-scoped table (and `businesses` itself) with timestamp or date columns, minus the excluded ones and any
 * without a uuid `id` (a sample row is known by its id): the dated columns (generated ones left out) and the unique
 * indexes over them. An index whose key is an expression over a moved date cannot be checked for collisions, so its
 * table is marked unsupported and left alone.
 */
async function rollTables(db: Executor): Promise<RollTable[]> {
  const cols = rowsOf<{ table_name: string; column_name: string; data_type: string }>(
    await db.execute(sql`
      select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public'
        and c.data_type in ('timestamp with time zone', 'timestamp without time zone', 'date')
        and c.is_generated = 'NEVER'
        and (c.table_name = 'businesses' or exists (
          select 1 from information_schema.columns b where b.table_schema = 'public' and b.table_name = c.table_name and b.column_name = 'business_id'))
        and exists (
          select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')
      order by c.table_name, c.ordinal_position`),
  );
  const indexes = rowsOf<{ table_name: string; index_name: string; columns: string[] | string; exprs: string | null; pred: string | null }>(
    await db.execute(sql`
      select cl.relname as table_name, ic.relname as index_name,
        array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = cl.oid and a.attnum = k.attnum where k.attnum > 0 order by k.n) as columns,
        case when i.indexprs is null then null else pg_get_expr(i.indexprs, i.indrelid) end as exprs,
        case when i.indpred is null then null else pg_get_expr(i.indpred, i.indrelid) end as pred
      from pg_index i
      join pg_class cl on cl.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and i.indisunique`),
  );
  const byTable = new Map<string, RollTable>();
  for (const c of cols) {
    if (ROLL_EXCLUDED_TABLES.includes(c.table_name)) continue;
    const entry = byTable.get(c.table_name) ?? { table: c.table_name, columns: [], hasCreatedAt: false, hasUpdatedAt: false, unique: [], unsupported: null };
    entry.columns.push({ table: c.table_name, column: c.column_name, type: c.data_type === "date" ? "date" : c.data_type === "timestamp with time zone" ? "timestamptz" : "timestamp" });
    if (c.column_name === "created_at") entry.hasCreatedAt = true;
    if (c.column_name === "updated_at") entry.hasUpdatedAt = true;
    byTable.set(c.table_name, entry);
  }
  for (const ix of indexes) {
    const entry = byTable.get(ix.table_name);
    if (!entry) continue;
    const dated = entry.columns.map((c) => c.column);
    // node-postgres and PGlite return text[] as an array; a driver that returns the literal gets it parsed here.
    const keyColumns = Array.isArray(ix.columns) ? ix.columns : String(ix.columns).replace(/^\{|\}$/g, "").split(",").filter(Boolean);
    const keyDated = keyColumns.some((c) => dated.includes(c));
    const exprDated = ix.exprs !== null && dated.some((c) => mentions(ix.exprs!, c));
    if (exprDated || (ix.exprs !== null && keyDated)) {
      entry.unsupported ??= `unique index ${ix.index_name} has an expression in a key with a moved date`;
      continue;
    }
    if (keyDated) entry.unique.push({ name: ix.index_name, columns: keyColumns, predicate: ix.pred });
  }
  return [...byTable.values()];
}

/** The ids the seed recorded for a table: a subquery over `demo_sample_rows`. */
const sampleIds = (businessId: string, table: string): string => `(select unnest(row_ids) from demo_sample_rows where business_id = ${literal(businessId)}::uuid and table_name = ${literal(table)})`;

/** The rows of `table` (as `alias`) that belong to the sample: the businesses row itself, or a recorded id of this business. */
const ownedBy = (businessId: string, table: string, alias: string): string =>
  table === "businesses" ? `${alias}.id = ${literal(businessId)}::uuid` : `${alias}.business_id = ${literal(businessId)}::uuid and ${alias}.id in ${sampleIds(businessId, table)}`;

/**
 * Records the ids of every row the seed wrote for a demo business, per table (`demo_sample_rows`): the rows a roll
 * moves. Called by the seed just before its `seed.demo` entry; `createdAtOrBefore` is the first roll's backfill for a
 * seed older than the list (the rows created up to the seed's own entry). Returns the number of ids recorded.
 */
export async function recordSampleRows(db: Executor, businessId: string, options: { createdAtOrBefore?: Date } = {}): Promise<number> {
  let recorded = 0;
  for (const t of await rollTables(db)) {
    if (t.table === "businesses") continue;
    const before = options.createdAtOrBefore && t.hasCreatedAt ? ` and created_at <= ${literal(options.createdAtOrBefore.toISOString())}::timestamptz` : "";
    const rows = rowsOf<{ n: number }>(
      await db.execute(
        sql.raw(`
          insert into demo_sample_rows (business_id, table_name, row_ids)
          select ${literal(businessId)}::uuid, ${literal(t.table)}, array_agg(id order by id)
          from ${ident(t.table)} where business_id = ${literal(businessId)}::uuid${before}
          having count(*) > 0
          on conflict (business_id, table_name) do update set row_ids = excluded.row_ids
          returning cardinality(row_ids) as n`),
      ),
    );
    recorded += Number(rows[0]?.n ?? 0);
  }
  return recorded;
}

/** When the seed recorded its sample list (null: a seed older than the list). */
async function sampleRecordedAt(db: Executor, businessId: string): Promise<Date | null> {
  const [row] = rowsOf<{ at: string | Date | null }>(await db.execute(sql`select max(created_at) as at from demo_sample_rows where business_id = ${businessId}::uuid`));
  return row?.at ? new Date(row.at) : null;
}

/**
 * Takes the sample rows someone changed since `settledAt` off the list (their updated_at, stamped by the trigger, is
 * newer than the last roll): from now on they are that person's or that service's, and keep their times.
 */
async function releaseChangedRows(tx: Executor, t: RollTable, businessId: string, settledAt: Date): Promise<number> {
  if (!t.hasUpdatedAt || t.table === "businesses") return 0;
  const updatedAt = t.columns.find((c) => c.column === "updated_at")!;
  const since = updatedAt.type === "timestamptz" ? `${literal(settledAt.toISOString())}::timestamptz` : `(${literal(settledAt.toISOString())}::timestamptz at time zone 'UTC')`;
  const rows = rowsOf<{ n: number }>(
    await tx.execute(
      sql.raw(`
        with changed as (select t.id from ${ident(t.table)} t where ${ownedBy(businessId, t.table, "t")} and t.updated_at > ${since})
        update demo_sample_rows d set row_ids = array(select u from unnest(d.row_ids) u where u not in (select id from changed))
        where d.business_id = ${literal(businessId)}::uuid and d.table_name = ${literal(t.table)} and exists (select 1 from changed)
        returning (select count(*) from changed)::int as n`),
    ),
  );
  return Number(rows[0]?.n ?? 0);
}

/** `column + n days` in the column's own type (as `alias.column` when an alias is given). */
const plusDays = (c: DatedColumn, days: number, alias?: string): string => {
  const col = alias ? `${alias}.${ident(c.column)}` : ident(c.column);
  return c.type === "date" ? `${col} + ${days}` : `${col} + make_interval(days => ${days})`;
};

interface ShiftContext {
  businessId: string;
  days: number;
  nowIso: string;
}

interface ShiftOutcome {
  /** Sample rows dropped because the row they would move onto is someone else's (a unique key another row holds). */
  dropped: number;
}

/**
 * Shifts the sample rows of one table: unique dates in two steps (far ahead, collisions dropped, back), `created_at` /
 * `updated_at` capped at now. Only the sample's rows move, in every step.
 */
async function shiftTable(tx: Executor, t: RollTable, ctx: ShiftContext): Promise<ShiftOutcome> {
  const parkedNames = new Set(t.unique.flatMap((u) => u.columns));
  const parked = t.columns.filter((c) => parkedNames.has(c.column));
  const nowOf = (c: DatedColumn) => (c.type === "timestamptz" ? `${literal(ctx.nowIso)}::timestamptz` : c.type === "timestamp" ? `(${literal(ctx.nowIso)}::timestamptz at time zone 'UTC')` : `(${literal(ctx.nowIso)}::timestamptz at time zone 'UTC')::date`);
  const capped = (c: DatedColumn, expr: string) => (CAPPED_COLUMNS.has(c.column) ? `least(${expr}, ${nowOf(c)})` : expr);
  const sets = t.columns.map((c) => {
    if (parked.includes(c)) return `${ident(c.column)} = ${plusDays(c, ctx.days + PARK_DAYS)}`;
    return `${ident(c.column)} = ${capped(c, plusDays(c, ctx.days))}`;
  });
  await tx.execute(sql.raw(`update ${ident(t.table)} s set ${sets.join(", ")} where ${ownedBy(ctx.businessId, t.table, "s")}`));
  if (!parked.length) return { dropped: 0 };

  // Where a parked value lands once it comes back.
  const back = (c: DatedColumn, alias?: string) => capped(c, plusDays(c, -PARK_DAYS, alias));
  let dropped = 0;
  for (const key of t.unique) {
    // A sample row whose new key another row already holds (one written after the seed: last night's rollup of that
    // agent's day) is dropped; the writer's row wins. Every sample row is parked a century ahead now, so the rows at
    // the landing values are never the sample's own moving rows. Null keys are compared as equal: a duplicate day
    // with no campaign is still a duplicate, even where the index lets it through.
    const same = key.columns
      .map((col) => {
        const c = parked.find((p) => p.column === col);
        return `o.${ident(col)} is not distinct from ${c ? back(c, "p") : `p.${ident(col)}`}`;
      })
      .join(" and ");
    const partial = key.predicate ? ` and o.id in (select id from ${ident(t.table)} where ${key.predicate}) and p.id in (select id from ${ident(t.table)} where ${key.predicate})` : "";
    const rows = rowsOf<{ id: string }>(
      await tx.execute(sql.raw(`delete from ${ident(t.table)} p where ${ownedBy(ctx.businessId, t.table, "p")} and exists (select 1 from ${ident(t.table)} o where o.id <> p.id and ${same})${partial} returning p.id`)),
    );
    dropped += rows.length;
  }
  // Back from the park: the same rows, and only those (a newer row with a far-future date is never moved).
  await tx.execute(sql.raw(`update ${ident(t.table)} s set ${parked.map((c) => `${ident(c.column)} = ${back(c)}`).join(", ")} where ${ownedBy(ctx.businessId, t.table, "s")}`));
  return { dropped };
}

/** Postgres refused the shift because of a key: a unique or an exclusion constraint. */
const isKeyViolation = (err: unknown): boolean => {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (code === "23505" || code === "23P01") return true;
  }
  return false;
};

/** "… by Nov 18" or "… by Nov 18, 2027": the date a goal's sentence ends on (packages/shared `goalSentence`). */
const GOAL_DATE_TAIL = / by [A-Z][a-z]{2} \d{1,2}(?:, \d{4})?$/;

/**
 * A sample goal's sentence names its due date in words ("Reach 1,500 paying customers by Nov 18"): after the move it
 * names the moved date, counted from the moved approval as the seed wrote it. A goal the founder wrote is left alone.
 */
async function redateGoalSentences(tx: Executor, businessId: string): Promise<void> {
  const goals = rowsOf<{ id: string; sentence: string; due_on: string; approved_at: string | Date | null; created_at: string | Date }>(
    await tx.execute(sql.raw(`select g.id, g.sentence, g.due_on::text as due_on, g.approved_at, g.created_at from goals g where ${ownedBy(businessId, "goals", "g")}`)),
  );
  for (const g of goals) {
    if (!GOAL_DATE_TAIL.test(g.sentence)) continue;
    const from = new Date(g.approved_at ?? g.created_at).toISOString().slice(0, 10);
    const sentence = g.sentence.replace(GOAL_DATE_TAIL, ` by ${goalDateWords(g.due_on, from)}`);
    if (sentence !== g.sentence) await tx.execute(sql`update goals set sentence = ${sentence} where id = ${g.id}::uuid and business_id = ${businessId}::uuid`);
  }
}

export interface DemoRollResult {
  businessId: string;
  days: number;
  from: string;
  to: string;
  /** Sample rows someone changed since the last roll, taken off the list (they keep their times from now on). */
  released: number;
  /** Sample rows dropped because the key they would move onto is held by a row written after the seed. */
  dropped: number;
  /** Tables left as they were this roll, with the reason. */
  skipped: { table: string; reason: string }[];
  /** The seed had no sample list (older than 0074): this roll recorded one from the rows created up to the seed. */
  backfilled: boolean;
}

export interface RollDemoForwardOptions {
  now?: Date;
  /** Defaults to every demo business; ids outside `DEMO_BUSINESS_IDS` are ignored (a founder's business never rolls). */
  businessIds?: readonly string[];
  log?: (message: string) => void;
  /**
   * Refresh the journey's daily rows when anything moved (default true). A failed refresh is logged and never undoes
   * the roll; a caller that retries it itself passes false.
   */
  refreshDaily?: boolean;
}

/** Rolls one demo business in one transaction; null when it is current or its seed never finished. */
async function rollOne(db: Db, businessId: string, now: Date, log: (message: string) => void): Promise<DemoRollResult | null> {
  return db.transaction(async (tx) => {
    await lockDemoBusiness(tx, businessId);
    // Read under the lock: a roll that just finished elsewhere moved the anchor, and this one then has nothing to do.
    const anchor = await demoAnchor(tx, businessId);
    if (!anchor) return null;
    const days = rollDays(anchor.anchor, now);
    if (days < 1) return null;
    // The updated_at trigger keeps the shifted value for this business's rows only (0074).
    await tx.execute(sql`select set_config('fm.demo_roll_forward', ${businessId}, true)`);
    const tables = await rollTables(tx);
    const recordedAt = await sampleRecordedAt(tx, businessId);
    const backfilled = recordedAt === null;
    if (backfilled) await recordSampleRows(tx, businessId, { createdAtOrBefore: anchor.cutoff });
    // Changed since the last roll, or (first roll) since the seed recorded its list (or, for an older seed, since its entry).
    const settledAt = anchor.settledAt ?? recordedAt ?? anchor.cutoff;
    let released = 0;
    for (const t of tables) released += await releaseChangedRows(tx, t, businessId, settledAt);
    const ctx: ShiftContext = { businessId, days, nowIso: now.toISOString() };
    let dropped = 0;
    const skipped: { table: string; reason: string }[] = [];
    for (const t of tables) {
      if (t.unsupported) {
        skipped.push({ table: t.table, reason: t.unsupported });
        continue;
      }
      try {
        // A savepoint per table: a key the checks above did not foresee rolls back this table alone.
        dropped += (await tx.transaction((sp) => shiftTable(sp, t, ctx))).dropped;
      } catch (err) {
        if (!isKeyViolation(err)) throw err;
        skipped.push({ table: t.table, reason: `key violation: ${(err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message}` });
      }
    }
    await redateGoalSentences(tx, businessId);
    const to = new Date(anchor.anchor.getTime() + days * DAY_MS);
    await tx.execute(sql`select set_config('fm.demo_roll_forward', '', true)`);
    for (const s of skipped) log(`rolling ${businessId}: ${s.table} left as it was (${s.reason})`);
    await repos.audit.append(tx, businessId, {
      actorKind: "system",
      actorId: null,
      action: DEMO_ROLL_AUDIT_ACTION,
      target: { kind: "business", id: businessId },
      details: { days, from: anchor.anchor.toISOString(), anchor: to.toISOString(), settledAt: now.toISOString(), released, dropped, skipped: skipped.map((s) => s.table), backfilled },
    });
    return { businessId, days, from: anchor.anchor.toISOString(), to: to.toISOString(), released, dropped, skipped, backfilled };
  });
}

/**
 * Rolls each demo business forward to `now` (see the header). Returns the businesses that moved, with the days and
 * the anchors; an empty list when every sample is current or no seed finished. After a move it keeps Northwind the
 * newer of the two and (unless `refreshDaily` is false) refreshes the journey's daily rows; a failed refresh is logged.
 */
export async function rollDemoForward(db: Db, options: RollDemoForwardOptions = {}): Promise<DemoRollResult[]> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const ids = (options.businessIds ?? DEMO_BUSINESS_IDS).filter((id) => (DEMO_BUSINESS_IDS as readonly string[]).includes(id));
  const moved: DemoRollResult[] = [];
  for (const businessId of ids) {
    const result = await rollOne(db, businessId, now, log);
    if (result) {
      moved.push(result);
      log(`rolled ${businessId} forward ${result.days} day${result.days === 1 ? "" : "s"} (${result.from} → ${result.to})`);
    }
  }
  if (!moved.length) return moved;
  // A capped created_at can tie the two businesses; a first sign-in opens the newest one, which must stay Northwind.
  await putNorthwindFirst(db);
  if (options.refreshDaily ?? true) {
    try {
      await repos.journeys.refreshDaily(db);
    } catch (err) {
      log(`the sample rolled, but refreshing the journey's daily rows failed: ${(err as Error).message}`);
    }
  }
  return moved;
}
