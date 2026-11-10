/**
 * The sample businesses roll forward with the calendar (first-time founder report, Phase 3 group K item 3; DECISIONS
 * 2026-11-10 "The sample businesses roll forward"). The demo seed dates its activity up to the instant it ran (its
 * "today"), so a deployment seeded weeks ago showed Northwind with 0 customers this week and no revenue this month
 * while Milestones and Finance still showed the seeded history. `rollDemoForward` moves every timestamp and date of a
 * demo business (found by its fixed id, never by slug) forward by the whole days between that "today" and now, in one
 * transaction per business: the sample keeps its shape (weekdays, times of day, gaps between events) and looks current.
 *
 * - **Only the demo businesses.** The ids are `DEMO_BUSINESS_IDS`; a founder's own business is never read or written.
 * - **Whole days, never into the future.** The shift is `floor((now − anchor) / 1 day)` days, so the shifted anchor is
 *   at most now; `created_at` and `updated_at` are also capped at now (a row the seed wrote at its own wall-clock time,
 *   after a pinned SEED_TODAY, never reads as created tomorrow). Dates meant to be ahead (a goal's due date, a vacation's
 *   end, a roadmap's target) stay ahead by the same distance.
 * - **Rows people added stay where they are.** In a table with `created_at`, only rows created at or before the last
 *   anchor's cutoff move (the seed's own rows); a row written later (an example viewer's seat, a demo owner's press of
 *   Continue) keeps its real times until a later roll catches up with it. Tables that record real people or real
 *   bookkeeping are never touched (`ROLL_EXCLUDED_TABLES`: the append-only audit chain, the outbox, memberships, read
 *   marks, leaderboard rows and billing periods).
 * - **Unique dates.** A column in a unique index (a day per channel, a day per agent) is moved in two steps, far ahead
 *   and back, so a row never lands on a day another row still holds mid-statement.
 * - **updated_at keeps its meaning.** Migration 0074 lets the updated_at trigger keep the shifted value while
 *   `fm.demo_roll_forward` is on in this transaction (a churned role is "churned since its last change").
 * - **Recorded.** Each roll appends `seed.demo.rolled` to the business's audit chain with the old and new anchor; the
 *   next roll reads the latest of that entry and the seed's own `seed.demo` (whose details carry the seed's "today" since
 *   Nov 10, 2026; an older seed's entry is read by its own time). An advisory lock and that re-read inside the
 *   transaction make two api instances rolling at once shift the data once.
 *
 * Known limits: text keys (`ledger_snapshots.period`, chapter title keys) and timestamps inside JSON (inbox payloads,
 * milestone refs) keep their seeded values; seeded prose names no absolute dates for that reason.
 */
import { goalDateWords } from "@foundmill/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { repos } from "../repos";
import { rowsOf, type Executor } from "../repos/_shared";
import { auditLog } from "../schema";
import { DEMO_BUSINESS_IDS, DEMO_SEED_AUDIT_ACTION } from "./constants";
import { DAY_MS } from "./context";

/** The audit action each roll appends (the seed's own entry is `seed.demo`). */
export const DEMO_ROLL_AUDIT_ACTION = "seed.demo.rolled";

/**
 * Business-scoped tables a roll never touches: the audit chain is append-only (and its times are when things really
 * happened), the outbox belongs to the relay, memberships and read marks are real people's, leaderboard rows and
 * credit balances are keyed by real periods.
 */
export const ROLL_EXCLUDED_TABLES: readonly string[] = ["audit_log", "outbox", "memberships", "inbox_item_reads", "leaderboard_entries", "credit_balances"];

/** Columns that record when a row was written: never shifted past now. */
const CAPPED_COLUMNS = new Set(["created_at", "updated_at"]);
/** How far a unique date is parked during the two-step move (about a century). */
const PARK_DAYS = 36_500;

export interface DemoAnchor {
  /** The sample's "now": the seed's today, or the last roll's shifted anchor. */
  anchor: Date;
  /** Rows created at or before this instant belong to the sample and move with it. */
  cutoff: Date;
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

/** The anchor an audit entry records: a roll's `anchor`/`cutoff`, the seed's `anchor` (its today) with its own time as the cutoff. */
export function anchorOf(entry: AnchorEntry): DemoAnchor {
  const details = entry.details ?? {};
  if (entry.action === DEMO_ROLL_AUDIT_ACTION) {
    const anchor = dateOr(details.anchor, entry.createdAt);
    return { anchor, cutoff: dateOr(details.cutoff, anchor) };
  }
  return { anchor: dateOr(details.anchor, entry.createdAt), cutoff: entry.createdAt };
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

/** Every timestamp and date column of the business-scoped tables (and of `businesses` itself), generated columns left out. */
async function datedColumns(db: Executor): Promise<{ columns: DatedColumn[]; unique: Set<string>; withCreatedAt: Set<string> }> {
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
      order by c.table_name, c.ordinal_position`),
  );
  const uniqueRows = rowsOf<{ table_name: string; column_name: string }>(
    await db.execute(sql`
      select distinct cl.relname as table_name, a.attname as column_name
      from pg_index i
      join pg_class cl on cl.oid = i.indrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = cl.oid and a.attnum = any(i.indkey)
      where n.nspname = 'public' and i.indisunique`),
  );
  const columns = cols
    .filter((c) => !ROLL_EXCLUDED_TABLES.includes(c.table_name))
    .map((c): DatedColumn => ({ table: c.table_name, column: c.column_name, type: c.data_type === "date" ? "date" : c.data_type === "timestamp with time zone" ? "timestamptz" : "timestamp" }));
  return {
    columns,
    unique: new Set(uniqueRows.map((u) => `${u.table_name}.${u.column_name}`)),
    withCreatedAt: new Set(cols.filter((c) => c.column_name === "created_at").map((c) => c.table_name)),
  };
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** `column + n days` in the column's own type. */
const plusDays = (c: DatedColumn, days: number): string => (c.type === "date" ? `${ident(c.column)} + ${days}` : `${ident(c.column)} + make_interval(days => ${days})`);

/** Shifts one business's rows in one table: unique dates in two steps, `created_at`/`updated_at` capped at now. */
async function shiftTable(tx: Executor, table: string, cols: DatedColumn[], ctx: { businessId: string; days: number; nowIso: string; cutoffIso: string; unique: Set<string>; hasCreatedAt: boolean }): Promise<void> {
  const key = table === "businesses" ? "id" : "business_id";
  const parked = cols.filter((c) => ctx.unique.has(`${table}.${c.column}`));
  const now = (c: DatedColumn) => (c.type === "timestamptz" ? `'${ctx.nowIso}'::timestamptz` : c.type === "timestamp" ? `('${ctx.nowIso}'::timestamptz at time zone 'UTC')` : `('${ctx.nowIso}'::timestamptz at time zone 'UTC')::date`);
  const sets = cols.map((c) => {
    if (parked.includes(c)) return `${ident(c.column)} = ${plusDays(c, ctx.days + PARK_DAYS)}`;
    if (CAPPED_COLUMNS.has(c.column)) return `${ident(c.column)} = least(${plusDays(c, ctx.days)}, ${now(c)})`;
    return `${ident(c.column)} = ${plusDays(c, ctx.days)}`;
  });
  // The businesses row is the sample's by definition (the seed reorders it after its own entry: putNorthwindFirst).
  const own = ctx.hasCreatedAt && table !== "businesses" ? ` and (created_at is null or created_at <= '${ctx.cutoffIso}'::timestamptz)` : "";
  await tx.execute(sql.raw(`update ${ident(table)} set ${sets.join(", ")} where ${key} = '${ctx.businessId}'::uuid${own}`));
  if (!parked.length) return;
  const back = parked.map((c) => `${ident(c.column)} = ${plusDays(c, -PARK_DAYS)}`);
  const far = parked.map((c) => `${ident(c.column)}::timestamp`).join(", ");
  await tx.execute(sql.raw(`update ${ident(table)} set ${back.join(", ")} where ${key} = '${ctx.businessId}'::uuid and greatest(${far}) > ('${ctx.nowIso}'::timestamptz at time zone 'UTC') + make_interval(days => ${PARK_DAYS / 2})`));
}

/** "… by Nov 18" or "… by Nov 18, 2027": the date a goal's sentence ends on (packages/shared `goalSentence`). */
const GOAL_DATE_TAIL = / by [A-Z][a-z]{2} \d{1,2}(?:, \d{4})?$/;

/**
 * A goal's sentence names its due date in words ("Reach 1,500 paying customers by Nov 18"): after the move it names
 * the moved date, counted from the moved approval as the seed wrote it.
 */
async function redateGoalSentences(tx: Executor, businessId: string): Promise<void> {
  const goals = rowsOf<{ id: string; sentence: string; due_on: string; approved_at: string | Date | null; created_at: string | Date }>(
    await tx.execute(sql`select id, sentence, due_on::text as due_on, approved_at, created_at from goals where business_id = ${businessId}::uuid`),
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
}

export interface RollDemoForwardOptions {
  now?: Date;
  /** Defaults to every demo business; ids outside `DEMO_BUSINESS_IDS` are ignored (a founder's business never rolls). */
  businessIds?: readonly string[];
  log?: (message: string) => void;
}

/**
 * Rolls each demo business forward to `now` (see the header). Returns the businesses that moved, with the days and
 * the anchors; an empty list when every sample is current or no seed finished. Refreshes the journey's daily rows
 * when anything moved.
 */
export async function rollDemoForward(db: Db, options: RollDemoForwardOptions = {}): Promise<DemoRollResult[]> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const ids = (options.businessIds ?? DEMO_BUSINESS_IDS).filter((id) => (DEMO_BUSINESS_IDS as readonly string[]).includes(id));
  const moved: DemoRollResult[] = [];
  for (const businessId of ids) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('fm.demo_roll_forward', 'on', true)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fm.demo_roll_forward'), hashtext(${businessId}::text))`);
      // Read under the lock: a roll that just finished elsewhere moved the anchor, and this one then has nothing to do.
      const anchor = await demoAnchor(tx, businessId);
      if (!anchor) return null;
      const days = rollDays(anchor.anchor, now);
      if (days < 1) return null;
      const { columns, unique, withCreatedAt } = await datedColumns(tx);
      const byTable = new Map<string, DatedColumn[]>();
      for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
      const ctx = { businessId, days, nowIso: now.toISOString(), cutoffIso: anchor.cutoff.toISOString(), unique };
      for (const [table, cols] of byTable) await shiftTable(tx, table, cols, { ...ctx, hasCreatedAt: withCreatedAt.has(table) });
      await redateGoalSentences(tx, businessId);
      const to = new Date(anchor.anchor.getTime() + days * DAY_MS);
      // Every row that moved was created at or before the old cutoff, so it now reads at most this (and never after now).
      const cutoff = new Date(Math.min(anchor.cutoff.getTime() + days * DAY_MS, now.getTime()));
      await tx.execute(sql`select set_config('fm.demo_roll_forward', '', true)`);
      await repos.audit.append(tx, businessId, {
        actorKind: "system",
        actorId: null,
        action: DEMO_ROLL_AUDIT_ACTION,
        target: { kind: "business", id: businessId },
        details: { days, from: anchor.anchor.toISOString(), anchor: to.toISOString(), cutoff: cutoff.toISOString() },
      });
      return { businessId, days, from: anchor.anchor.toISOString(), to: to.toISOString() };
    });
    if (result) {
      moved.push(result);
      log(`rolled ${businessId} forward ${result.days} day${result.days === 1 ? "" : "s"} (${result.from} → ${result.to})`);
    }
  }
  if (moved.length) await repos.journeys.refreshDaily(db);
  return moved;
}
