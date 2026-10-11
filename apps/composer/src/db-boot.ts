/**
 * Database readiness at boot (docs/DECISIONS.md "PGlite as the local database driver"; docs/ARCHITECTURE.md §4).
 *
 * `createDb(url)` is synchronous and PGlite boots lazily, so a locked directory (PGlite allows one process per data
 * directory), a missing pgvector or an unapplied migration would otherwise surface as the first request's error.
 * `prepareDb` settles that once at boot and never throws: the service keeps serving, `/health` reports `db: false`,
 * and one log line says what to do.
 *
 * - PGlite (`pglite:<dir>` / `pglite::memory:`): wait for the boot, then apply pending migrations with `migrateDb`
 *   (idempotent: a directory seeded by `pnpm db:seed` has nothing left to apply). This process owns the directory, so
 *   no advisory lock is needed.
 * - Postgres: a bounded connectivity probe through drizzle's migrations bookkeeping (`appliedMigrationCount`), no
 *   migration: apps/api runs the migrator for Postgres in one transaction under `pg_advisory_xact_lock(7461, 1)`
 *   (packages/db migrator.ts; ARCHITECTURE §13).
 *
 * The same file lives in every service under apps/ until packages/db exports it (docs/WAVE3 open issue).
 */
import { appliedMigrationCount, isPgliteDb, migrateDb, type Db } from "@foundmill/db";

export interface DbBootLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface DbReadiness {
  ok: boolean;
  driver: "pglite" | "postgres";
  /** Data directory (PGlite) or null. */
  dir: string | null;
  /** Migrations applied by this boot (PGlite only; Postgres is migrated by apps/api). */
  applied: number;
  /** Why the database is unavailable; null when ok. */
  reason: string | null;
}

export interface PrepareDbOptions {
  /** Appears in the log lines. */
  service: string;
  /** Apply pending migrations on PGlite (default true). */
  migrate?: boolean;
  /** Postgres probe timeout (default 5 000 ms). */
  probeTimeoutMs?: number;
}

export const PGLITE_UNAVAILABLE_HINT =
  "PGlite allows one process per data directory: point this service at its own pglite:<dir> (seed it with SEED_PGLITE_DIR=<dir> pnpm db:seed) or at a Postgres DATABASE_URL.";

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

/** Settles database readiness once; logs one line either way and never throws. */
export async function prepareDb(db: Db, log: DbBootLogger, options: PrepareDbOptions): Promise<DbReadiness> {
  const { service } = options;
  if (isPgliteDb(db)) {
    const dir = db.$client.dataDir ?? null;
    try {
      await db.$client.waitReady;
      const applied = options.migrate === false ? 0 : (await migrateDb(db)).applied.length;
      log.info({ driver: "pglite", dir: dir ?? ":memory:", applied }, `${service}: database ready`);
      return { ok: true, driver: "pglite", dir, applied, reason: null };
    } catch (err) {
      const reason = (err as Error).message;
      log.error({ driver: "pglite", dir: dir ?? ":memory:", err: reason }, `${service}: database unavailable; serving without it (/health reports db:false). ${PGLITE_UNAVAILABLE_HINT}`);
      return { ok: false, driver: "pglite", dir, applied: 0, reason };
    }
  }
  try {
    const total = await withTimeout(appliedMigrationCount(db), options.probeTimeoutMs ?? 5_000, "database probe");
    log.info({ driver: "postgres", migrations: total }, `${service}: database ready`);
    return { ok: true, driver: "postgres", dir: null, applied: 0, reason: null };
  } catch (err) {
    const reason = (err as Error).message;
    log.error({ driver: "postgres", err: reason }, `${service}: database unreachable; serving without it (/health reports db:false). Check DATABASE_URL.`);
    return { ok: false, driver: "postgres", dir: null, applied: 0, reason };
  }
}
