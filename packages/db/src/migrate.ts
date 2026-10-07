/**
 * Applies packages/db/migrations to DATABASE_URL with drizzle's migrator (reads meta/_journal.json).
 * Usage: pnpm --filter @foundmill/db migrate   (or `pnpm db:migrate` from the root)
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, createDb, createServiceDb, type ServiceDb } from "./client";
import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, readMigrations } from "./migrations";

export interface MigrateResult {
  /** Migrations applied by this run. */
  applied: string[];
  /** Total rows in drizzle.__drizzle_migrations after the run. */
  total: number;
}

async function appliedCount(db: ServiceDb): Promise<number> {
  // Migration bookkeeping (drizzle.__drizzle_migrations), not business data: not a repository concern.
  // eslint-disable-next-line fm/no-raw-db -- reads drizzle's migrations table
  const res = await db.execute(
    sql`select count(*)::int as n from information_schema.tables where table_schema = ${MIGRATIONS_SCHEMA} and table_name = ${MIGRATIONS_TABLE}`,
  );
  const exists = Number((res as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0) > 0;
  if (!exists) return 0;
  // eslint-disable-next-line fm/no-raw-db -- reads drizzle's migrations table
  const count = await db.execute(sql`select count(*)::int as n from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`);
  return Number((count as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

export async function runMigrations(db: ServiceDb): Promise<MigrateResult> {
  const before = await appliedCount(db);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
  const total = await appliedCount(db);
  const all = readMigrations().map((m) => m.tag);
  return { applied: all.slice(before, total), total };
}

async function main() {
  const url = process.argv[2];
  const db = url ? createDb(url, { max: 1 }) : createServiceDb({ max: 1 });
  try {
    const result = await runMigrations(db);
    console.warn(`Applied ${result.applied.length} migration(s)${result.applied.length ? `: ${result.applied.join(", ")}` : ""}. ${result.total} total.`);
  } finally {
    await closeDb(db);
  }
}

const isMain = process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
