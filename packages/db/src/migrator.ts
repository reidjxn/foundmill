/**
 * migrateDb(db): applies packages/db/migrations (journal order, drizzle's own bookkeeping in
 * drizzle.__drizzle_migrations) on either driver. postgres.js and PGlite share one bookkeeping table, so a
 * directory seeded with `pnpm db:seed` and later opened by apps/api's boot migrator sees nothing left to apply.
 * Idempotent: a second call applies nothing.
 *
 * Postgres: the whole run is ONE transaction that first takes the transaction-scoped advisory lock
 * `pg_advisory_xact_lock(7461, 1)`, then reads the bookkeeping and applies what is pending (drizzle's own algorithm,
 * `dialect.migrate`, run inside that transaction). Production reaches Supabase through its transaction pooler, where
 * statements outside a transaction can land on different server connections: a session-level lock taken by one
 * statement and released by another stayed held on a pooled connection and hung the next boot (docs/DEPLOY.md §3).
 * A transaction is pinned to one server connection, and its lock ends with it: on commit, on rollback, and when the
 * process dies (the server aborts the transaction when the connection drops; `idle_in_transaction_session_timeout`
 * covers a pooler that keeps it open). Waiting is bounded: `lock_timeout` stops the wait for the advisory lock (and
 * for any table lock a migration needs) after `lockTimeoutMs`, and a client-side watchdog gives up shortly after in
 * case the server or pooler never answers. Either way `MigrationLockTimeoutError` is thrown and nothing is applied.
 *
 * PGlite: one process per data directory and a single connection, so drizzle's migrator runs as before, unlocked.
 */
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import type { PgDialect, PgSession } from "drizzle-orm/pg-core";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { Db, ServiceDb } from "./client";
import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, readMigrations } from "./migrations";
import { isPgliteDb } from "./pglite";

export interface MigrateResult {
  /** Migration tags applied by this run, in order. */
  applied: string[];
  /** Total rows in drizzle.__drizzle_migrations after the run. */
  total: number;
}

/**
 * The advisory lock every migrating process takes, in the two-int form: namespace 7461 (Foundmill migrations), key 1
 * (the transaction-scoped scheme). The old boot used the session-level bigint key 7461, which can still be held by a
 * pooled connection on a database the old code migrated; a different key means such a leftover never blocks a boot.
 */
export const MIGRATION_LOCK = { namespace: 7461, key: 1 } as const;
/** Longest wait for the migration lock (and any table lock a migration needs) before giving up. */
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 60_000;
/** How long after `lockTimeoutMs` the client stops waiting for an answer at all (a pooler that queues, a dead link). */
export const DEFAULT_LOCK_WAIT_GRACE_MS = 5_000;
/** A migration transaction idle this long on the server is aborted (and its lock freed) even if the pooler keeps it open. */
const IDLE_IN_TRANSACTION_MS = 60_000;
/** How often the server checks, during a running migration statement, that the client is still connected (PG 14+). */
const CLIENT_CHECK_MS = 1_000;

export interface MigrateOptions {
  /** Longest wait for the migration lock and for table locks, in ms (default 60 000). Postgres only. */
  lockTimeoutMs?: number;
  /** Extra time the client waits beyond `lockTimeoutMs` for the server to answer before giving up (default 5 000). */
  lockWaitGraceMs?: number;
  /** Another migrations folder in drizzle-kit journal format (tests). */
  migrationsFolder?: string;
}

/** A session holding the migration lock when a wait timed out (from pg_locks + pg_stat_activity; best effort). */
export interface MigrationLockHolder {
  pid: number;
  state: string | null;
  applicationName: string | null;
  backendStart: string | null;
  xactStart: string | null;
  query: string | null;
}

/**
 * The migration lock (or a table lock a migration needed) was not granted within `timeoutMs`, or Postgres aborted the
 * migration to break a deadlock with another connection; nothing was applied. All of these clear up once the other
 * connection is done (the previous deployment keeps serving for a while during a redeploy), so callers at boot exit
 * non-zero and the platform restarts them, instead of hanging the deploy or serving on the old schema.
 */
export class MigrationLockTimeoutError extends Error {
  override readonly name = "MigrationLockTimeoutError";
  readonly code = "MIGRATION_LOCK_TIMEOUT";
  constructor(
    readonly timeoutMs: number,
    /** `migration-lock`: another session holds the migration lock. `table-lock`: a migration waited on a table lock. `deadlock`: Postgres chose the migration as a deadlock victim. `no-answer`: the server or pooler did not answer in time. */
    readonly phase: "migration-lock" | "table-lock" | "deadlock" | "no-answer",
    readonly holders: MigrationLockHolder[] = [],
    options?: { cause?: unknown },
  ) {
    super(
      phase === "table-lock"
        ? `a migration waited more than ${timeoutMs} ms for a table lock held by another connection; nothing was applied`
        : phase === "deadlock"
          ? "a migration was aborted to break a deadlock with another connection; nothing was applied"
          : phase === "no-answer"
          ? `the database did not answer within ${timeoutMs} ms while taking the migration lock; nothing was applied`
          : `the migration lock was not granted within ${timeoutMs} ms; nothing was applied`,
      options,
    );
  }
}

export const isMigrationLockTimeout = (err: unknown): err is MigrationLockTimeoutError =>
  err instanceof MigrationLockTimeoutError || (err as { code?: unknown } | null)?.code === "MIGRATION_LOCK_TIMEOUT";

const MIGRATE_CONFIG = { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE } as const;

// PGlite answers `{ rows }`; postgres.js answers the rows themselves (an array).
const rowsOf = <T>(res: unknown): T[] => ((Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? []) as T[];
const firstN = (res: unknown): number => Number(rowsOf<{ n?: number | string }>(res)[0]?.n ?? 0);

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

/**
 * Whether every migration in `dir` is applied (WP-11 T2): the api's /health is not ready while one is missing, so a
 * deployment whose migration failed at boot never takes traffic.
 */
export async function schemaReady(db: Db, dir: string = MIGRATIONS_DIR): Promise<{ applied: number; expected: number; ready: boolean }> {
  const expected = readMigrations(dir).length;
  const applied = await appliedMigrationCount(db);
  return { applied, expected, ready: applied >= expected };
}

export async function migrateDb(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const config: MigrationConfig = { ...MIGRATE_CONFIG, ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}) };
  const tags = () => readMigrations(config.migrationsFolder).map((m) => m.tag);
  if (isPgliteDb(db)) {
    const before = await appliedMigrationCount(db);
    await migratePglite(db, config);
    const total = await appliedMigrationCount(db);
    return { applied: tags().slice(before, total), total };
  }
  const { before, total } = await migratePostgresLocked(db as ServiceDb, config, options);
  return { applied: tags().slice(before, total), total };
}

const sqlState = (err: unknown): string | undefined => {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth += 1) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
};
const LOCK_NOT_AVAILABLE = "55P03";
const DEADLOCK_DETECTED = "40P01";

async function migratePostgresLocked(db: ServiceDb, config: MigrationConfig, options: MigrateOptions): Promise<{ before: number; total: number }> {
  const lockTimeoutMs = Math.max(1, Math.round(options.lockTimeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS));
  const graceMs = Math.max(0, options.lockWaitGraceMs ?? DEFAULT_LOCK_WAIT_GRACE_MS);
  const migrations = readMigrationFiles(config);
  // drizzle's postgres-js migrator calls `db.dialect.migrate(migrations, db.session, config)`; we call the same with a
  // session bound to our transaction, so the bookkeeping is byte-for-byte what drizzle (and the PGlite path) write.
  const dialect = (db as unknown as { dialect: PgDialect }).dialect;

  let locked = false;
  let abandoned = false;
  let onLocked!: () => void;
  const lockGranted = new Promise<void>((resolve) => (onLocked = resolve));

  const run = db.transaction(async (tx) => {
    // eslint-disable-next-line fm/no-raw-db -- migration infrastructure: transaction-local lock and idle limits
    await tx.execute(sql`select set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true), set_config('idle_in_transaction_session_timeout', ${`${Math.max(IDLE_IN_TRANSACTION_MS, lockTimeoutMs)}ms`}, true)`);
    // A client that dies mid-statement is otherwise noticed only when the statement ends (a long index build keeps the
    // lock until then); Postgres 14+ can check the socket while a statement runs.
    // eslint-disable-next-line fm/no-raw-db -- migration infrastructure: notice a dead client during a long statement
    await tx.execute(sql`select set_config('client_connection_check_interval', ${`${CLIENT_CHECK_MS}ms`}, true) where current_setting('server_version_num')::int >= 140000`);
    // eslint-disable-next-line fm/no-raw-db -- migration infrastructure: the transaction-scoped migration lock
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(MIGRATION_LOCK.namespace))}, ${sql.raw(String(MIGRATION_LOCK.key))})`);
    if (abandoned) throw new Error("migration abandoned: the client stopped waiting for the lock");
    locked = true;
    onLocked();
    const before = await appliedMigrationCount(tx as unknown as Db);
    const session = Object.create(tx._.session, { transaction: { value: <T>(fn: (inner: typeof tx) => Promise<T>) => fn(tx) } }) as PgSession;
    await dialect.migrate(migrations, session, config);
    const total = await appliedMigrationCount(tx as unknown as Db);
    return { before, total };
  });

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const noAnswer = new Promise<"no-answer">((resolve) => {
    watchdog = setTimeout(() => resolve("no-answer"), lockTimeoutMs + graceMs);
  });
  try {
    const first = await Promise.race([lockGranted.then(() => "locked" as const), run.then(() => "done" as const), noAnswer]);
    if (first === "no-answer") {
      abandoned = true;
      run.catch(() => undefined); // settles (or not) after the caller has moved on; the transaction rolls back without the lock
      throw new MigrationLockTimeoutError(lockTimeoutMs, "no-answer");
    }
  } catch (err) {
    if (isMigrationLockTimeout(err)) throw err;
    throw await translate(err, db, lockTimeoutMs, locked);
  } finally {
    clearTimeout(watchdog);
  }
  try {
    return await run;
  } catch (err) {
    throw await translate(err, db, lockTimeoutMs, locked);
  }
}

async function translate(err: unknown, db: ServiceDb, lockTimeoutMs: number, locked: boolean): Promise<unknown> {
  const state = sqlState(err);
  // A deadlock with the previous deployment's queries is as transient as a lock wait: retry on restart, never serve on the old schema.
  if (state === DEADLOCK_DETECTED) return new MigrationLockTimeoutError(lockTimeoutMs, "deadlock", [], { cause: err });
  if (state !== LOCK_NOT_AVAILABLE) return err;
  if (locked) return new MigrationLockTimeoutError(lockTimeoutMs, "table-lock", [], { cause: err });
  return new MigrationLockTimeoutError(lockTimeoutMs, "migration-lock", await lockHolders(db), { cause: err });
}

/** Who holds the migration lock right now (best effort, bounded: an empty list when it cannot be read in 2 s). */
async function lockHolders(db: ServiceDb): Promise<MigrationLockHolder[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // eslint-disable-next-line fm/no-raw-db -- diagnostics for a lock wait that timed out (pg_locks, pg_stat_activity)
    const query = db.execute(sql`
      select l.pid, a.state, a.application_name, a.backend_start::text, a.xact_start::text, left(a.query, 200) as query
      from pg_locks l left join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.database = (select oid from pg_database where datname = current_database())
        and l.classid = ${sql.raw(String(MIGRATION_LOCK.namespace))} and l.objid = ${sql.raw(String(MIGRATION_LOCK.key))} and l.objsubid = 2`);
    const rows = await Promise.race([query, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), 2_000)))]);
    return rowsOf<{ pid: number; state: string | null; application_name: string | null; backend_start: string | null; xact_start: string | null; query: string | null }>(rows).map((r) => ({
      pid: Number(r.pid),
      state: r.state,
      applicationName: r.application_name,
      backendStart: r.backend_start,
      xactStart: r.xact_start,
      query: r.query,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
