/**
 * Helpers shared by every repository (docs/ARCHITECTURE.md §4).
 *
 * - Every repo function takes `(db, businessId, …)` and adds `business_id = $businessId` to its SQL; the
 *   helpers here keep that boilerplate (pagination, date ranges, "exactly one row") uniform.
 * - Pagination is keyset: `timeKeyset(column, idColumn)` orders by (column truncated to the millisecond,
 *   id) so a cursor built from a JavaScript `Date` never skips rows that share a millisecond, and the
 *   cursor is an opaque base64url token the UI passes back unchanged. `offset` is also accepted for
 *   tables and grids that show page numbers.
 */
import { NotFoundError, ValidationError } from "@foundmill/shared";
import { and, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbTx } from "../client";

/** A database or a transaction (a transaction is a database; repos never care which). */
export type Executor = Db | DbTx;

/** Ids are UUID-shaped (8-4-4-4-12 hex). Seeds use deterministic ids whose version nibble is not 4, so `guid`. */
export const Id = z.guid();
export const IsoDateInput = z.coerce.date();
export const JsonObject = z.record(z.string(), z.unknown());
export const JsonArray = z.array(z.unknown());
export const Currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "currency is a three-letter code");
export const MinorAmount = z.number().int().safe();

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export const PageInput = z.object({
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor: z.string().nullish(),
  /** Offset paging for grids that show page numbers. Ignored when a cursor is given. */
  offset: z.number().int().min(0).optional(),
});
export type PageInput = z.input<typeof PageInput>;
export type ParsedPage = z.output<typeof PageInput>;

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` to fetch the next page; null when this was the last page. */
  nextCursor: string | null;
}

export const DateRange = z.object({ from: IsoDateInput.optional(), to: IsoDateInput.optional() });
export type DateRange = z.input<typeof DateRange>;

/** `col >= from and col < to` (half-open) for timestamptz columns; both ends optional. */
export function timeRange(column: AnyColumn, range: { from?: Date; to?: Date } | undefined): SQL | undefined {
  if (!range) return undefined;
  const parts: SQL[] = [];
  if (range.from) parts.push(sql`${column} >= ${range.from.toISOString()}`);
  if (range.to) parts.push(sql`${column} < ${range.to.toISOString()}`);
  return parts.length ? and(...parts) : undefined;
}

export const DayRange = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });
export type DayRange = z.input<typeof DayRange>;

/** `col >= from and col <= to` (inclusive) for `date` columns given as YYYY-MM-DD. */
export function dayRange(column: AnyColumn, range: { from?: string; to?: string } | undefined): SQL | undefined {
  if (!range) return undefined;
  const parts: SQL[] = [];
  if (range.from) parts.push(sql`${column} >= ${range.from}::date`);
  if (range.to) parts.push(sql`${column} <= ${range.to}::date`);
  return parts.length ? and(...parts) : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------------------------------------------------

const CursorShape = z.object({ k: z.string(), id: z.string() });

export function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify({ k: key, id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { k: string; id: string } {
  try {
    return CursorShape.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ValidationError("Malformed pagination cursor", { cursor });
  }
}

export interface Keyset<Row> {
  orderBy: SQL[];
  /** Condition selecting rows strictly after the cursor in `orderBy` order; undefined without a cursor. */
  after(cursor: string | null | undefined): SQL | undefined;
  cursorOf(row: Row): string;
}

/**
 * Keyset over a timestamptz column. Rows are ordered by the column truncated to milliseconds (the precision
 * a JavaScript Date carries) and then by id, so the cursor made from a returned row reproduces the exact
 * position in the order.
 */
export function timeKeyset<Row>(column: AnyColumn, idColumn: AnyColumn, pick: (row: Row) => { at: Date; id: string }, direction: "asc" | "desc" = "desc"): Keyset<Row> {
  const key = sql`date_trunc('milliseconds', ${column})`;
  const op = direction === "desc" ? sql`<` : sql`>`;
  const dir = direction === "desc" ? sql`desc` : sql`asc`;
  return {
    orderBy: [sql`${key} ${dir}`, sql`${idColumn} ${dir}`],
    after(cursor) {
      if (!cursor) return undefined;
      const c = decodeCursor(cursor);
      return sql`(${key}, ${idColumn}) ${op} (${c.k}::timestamptz, ${c.id}::uuid)`;
    },
    cursorOf(row) {
      const { at, id } = pick(row);
      return encodeCursor(at.toISOString(), id);
    },
  };
}

/** Keyset over an integer sequence column (audit_log.seq). */
export function seqKeyset<Row>(column: AnyColumn, pick: (row: Row) => number, direction: "asc" | "desc" = "desc"): Keyset<Row> {
  const op = direction === "desc" ? sql`<` : sql`>`;
  const dir = direction === "desc" ? sql`desc` : sql`asc`;
  return {
    orderBy: [sql`${column} ${dir}`],
    after(cursor) {
      if (!cursor) return undefined;
      const c = decodeCursor(cursor);
      if (!/^-?\d+$/.test(c.k)) throw new ValidationError("Malformed pagination cursor", { cursor });
      return sql`${column} ${op} ${c.k}::bigint`;
    },
    cursorOf(row) {
      return encodeCursor(String(pick(row)), "seq");
    },
  };
}

/**
 * Turn `limit + 1` fetched rows into a page: trims the sentinel row and builds the next cursor from the
 * last returned row. With offset paging the caller passes `offset`, and the cursor still works for
 * "load more" from the same list.
 */
export function toPage<Row>(rows: Row[], page: ParsedPage, keyset: Keyset<Row>): Page<Row> {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? keyset.cursorOf(last) : null };
}

/** Offset to apply: only when no cursor was given. */
export function pageOffset(page: ParsedPage): number {
  return page.cursor ? 0 : (page.offset ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

/** The first row or a NotFoundError (404). */
export function one<T>(rows: T[], what: string, id?: string): T {
  const row = rows[0];
  if (row === undefined) throw new NotFoundError(what, id);
  return row;
}

/** The first row or null. */
export function maybeOne<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

/** Normalise `db.execute()` results: postgres.js returns an array, PGlite / node-postgres `{ rows }`. */
export function rowsOf<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/** The Postgres SQLSTATE of a database error, looking through Drizzle's wrapper (`DrizzleQueryError.cause`). */
export function sqlState(err: unknown): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === "object"; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Parses with a Zod schema and rethrows as the platform's ValidationError (400) with the issues attached. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, what: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(`Invalid ${what}`, result.error.issues);
  }
  return result.data;
}

/** `numeric` columns are strings on the wire; repos accept numbers. */
export const numericText = (n: number | string | null | undefined): string | null | undefined =>
  n === null || n === undefined ? n : typeof n === "number" ? String(n) : n;

export const toNumber = (s: string | number | null | undefined): number | null =>
  s === null || s === undefined ? null : typeof s === "number" ? s : Number(s);

type StripDefault<T> = T extends z.ZodDefault<infer U> ? StripDefault<U> : T extends z.ZodPrefault<infer U> ? StripDefault<U> : T;
type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: z.ZodOptional<StripDefault<S[K]>> };

/**
 * The update schema for a create schema: every field optional *and without its default*. Zod 4's `.partial()`
 * keeps `.default()`/`.prefault()` and fills missing keys, so an update built from it would silently reset
 * every defaulted column (arrays to `[]`, strings to `""`) on each patch. This unwraps the defaults first.
 */
export function patchSchema<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType;
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}

/** Builds a `set` object with only the keys that were supplied (undefined = leave unchanged). */
export function defined<T extends Record<string, unknown>>(patch: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** True when the current Postgres role bypasses RLS (service_role or a superuser) — some reads pick a different relation. */
export async function bypassesRls(db: Executor): Promise<boolean> {
  const rows = rowsOf<{ bypass: boolean }>(
    await db.execute(sql`select (current_user = 'service_role' or exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))) as bypass`),
  );
  return Boolean(rows[0]?.bypass);
}
