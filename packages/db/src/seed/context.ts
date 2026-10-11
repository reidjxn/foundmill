/**
 * Shared state and helpers for the seed modules: the seeded PRNG, the calendar window, bulk inserts and
 * small formatting helpers. Nothing here knows about a particular demo business.
 */
import { createSeededRng, type SeededRng } from "@foundmill/journey";
import type { PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../client";

export interface SeedOwner {
  userId: string;
  email: string;
}

export interface SeedCtx {
  db: Db;
  rng: SeededRng;
  /** Root seed string; forked per business and per concern. */
  seed: string;
  /** "Today" as a UTC instant (the last day of the generated window). */
  today: Date;
  todayKey: string;
  /** First day of the window (UTC midnight). */
  startDate: Date;
  startKey: string;
  days: number;
  volumeScale: number;
  owner: SeedOwner;
  owners: SeedOwner[];
  log: (message: string) => void;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** YYYY-MM-DD in UTC. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
/** YYYY-MM in UTC. */
export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);
export const utcMidnight = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const addHours = (d: Date, n: number): Date => new Date(d.getTime() + n * HOUR_MS);
export const atHour = (day: Date, hour: number, minute = 0): Date => new Date(utcMidnight(day).getTime() + hour * HOUR_MS + minute * 60_000);

/** Every YYYY-MM between two instants, inclusive, oldest first. */
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** First instant of a YYYY-MM month (UTC). */
export const monthStart = (key: string): Date => new Date(`${key}-01T00:00:00.000Z`);
/** Day `n` of a YYYY-MM month at `hour` UTC. */
export const monthDay = (key: string, n: number, hour = 10): Date => new Date(monthStart(key).getTime() + (n - 1) * DAY_MS + hour * HOUR_MS);

export const quarterKey = (d: Date): string => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

export function createSeedCtx(input: {
  db: Db;
  seed: string;
  today: Date;
  days: number;
  volumeScale: number;
  owner: SeedOwner;
  owners: SeedOwner[];
  log?: (message: string) => void;
}): SeedCtx {
  const today = input.today;
  const startDate = addDays(utcMidnight(today), -(input.days - 1));
  return {
    db: input.db,
    rng: createSeededRng(input.seed),
    seed: input.seed,
    today,
    todayKey: dayKey(today),
    startDate,
    startKey: dayKey(startDate),
    days: input.days,
    volumeScale: input.volumeScale,
    owner: input.owner,
    owners: input.owners,
    log: input.log ?? (() => {}),
  };
}

/** Inserts rows in batches (PGlite and Postgres both cap bound parameters at 65 535 per statement). */
export async function bulkInsert<T extends PgTable>(db: Db, table: T, rows: PgInsertValue<T>[], batch = 400): Promise<number> {
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    if (slice.length === 0) continue;
    await db.insert(table).values(slice);
  }
  return rows.length;
}

/** ProseMirror doc with one paragraph per line (what spec_blocks.content stores). */
export function proseDoc(...paragraphs: string[]): Record<string, unknown> {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

/** Money for prose: "£1,234.56" / "€12.00". Amounts in the seed are synthetic; callers add the label. */
export function money(amountMinor: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
  const major = Math.round(amountMinor) / 100;
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `[[ent:<id>|Name]]` mention markup (BUILD §11.3). */
export const mention = (id: string, name: string): string => `[[ent:${id}|${name.replace(/[\]|]/g, "")}]]`;

export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
