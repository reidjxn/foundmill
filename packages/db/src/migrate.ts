/**
 * Applies packages/db/migrations to DATABASE_URL (or the URL given as the first argument) with migrateDb,
 * so `postgres://…` and `pglite:<dir>` behave the same.
 * Usage: pnpm --filter @foundmill/db migrate [url]   (or `pnpm db:migrate` from the root)
 */
import { closeDb, createDb, createServiceDb } from "./client";
import { migrateDb } from "./migrator";

export { appliedMigrationCount, DEFAULT_MIGRATION_LOCK_TIMEOUT_MS, isMigrationLockTimeout, migrateDb, MIGRATION_LOCK, MigrationLockTimeoutError, schemaReady, type MigrateOptions, type MigrateResult, type MigrationLockHolder } from "./migrator";
/** @deprecated Use migrateDb. */
export { migrateDb as runMigrations } from "./migrator";

async function main() {
  const url = process.argv[2];
  const db = url ? createDb(url, { max: 1 }) : createServiceDb({ max: 1 });
  try {
    const result = await migrateDb(db);
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
