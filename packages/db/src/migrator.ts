/**
 * migrateDb(db): applies packages/db/migrations (journal order, drizzle's own bookkeeping in
 * drizzle.__drizzle_migrations) on either driver. postgres.js and PGlite share one bookkeeping table, so a
 * directory seeded with `pnpm db:seed` and later opened by apps/api's boot migrator sees nothing left to apply.
 * Idempotent: a second call applies nothing.
 */
import { sql } from "drizzle-orm";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { Db, ServiceDb } from "./client";
import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, readMigrations } from "./migrations";
import { isPgliteDb } from "./pglite";

export interface MigrateResult {
  /** Migration tags applied by this run, in order. */
  applied: string[];
  /** Total rows in drizzle.__drizzle_migrations after the run. */
  total: number;
}

const MIGRATE_CONFIG = { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE } as const;

// PGlite answers `{ rows }`; postgres.js answers the rows themselves (an array).
const firstN = (res: unknown): number => {
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) as { n?: number | string }[] | undefined;
  return Number(rows?.[0]?.n ?? 0);
};

/** Rows in drizzle's migrations table; 0 when the table does not exist yet. */
export async function appliedMigrationCount(db: Db): Promise<number> {
  // Migration bookkeeping (drizzle.__drizzle_migrations), not business data: not a repository concern.
  // eslint-disable-next-line fm/no-raw-db -- reads drizzle's migrations table
  const exists = await db.execute(
    sql`select count(*)::int as n from information_schema.tables where table_schema = ${MIGRATIONS_SCHEMA} and table_name = ${MIGRATIONS_TABLE}`,
  );
  if (firstN(exists) === 0) return 0;
  // eslint-disable-next-line fm/no-raw-db -- reads drizzle's migrations table
  const count = await db.execute(sql`select count(*)::int as n from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`);
  return firstN(count);
}

export async function migrateDb(db: Db): Promise<MigrateResult> {
  const before = await appliedMigrationCount(db);
  // Both migrators run `db.dialect.migrate(...)`; the split only keeps each one's declared database type honest.
  if (isPgliteDb(db)) await migratePglite(db, MIGRATE_CONFIG);
  else await migratePostgres(db as ServiceDb, MIGRATE_CONFIG);
  const total = await appliedMigrationCount(db);
  const all = readMigrations().map((m) => m.tag);
  return { applied: all.slice(before, total), total };
}
