/**
 * Database clients (docs/ARCHITECTURE.md §4).
 *
 * - createDb(url)       Drizzle over postgres.js for a `postgres://` connection string, or over PGlite for
 *                        `pglite:<dir>` / `pglite::memory:` (docs/DECISIONS.md "PGlite as the local database driver").
 * - createServiceDb()   Reads DATABASE_URL via loadEnv(); the service-role connection used by workers.
 * - withRls(db, ctx, fn) Runs fn(tx) in a transaction as `authenticated` (or another app role) with
 *                        request.jwt.claims set, so Postgres RLS enforces tenancy for user-originated queries.
 * - warmPool(db, n) / keepPoolWarm(db, …)  Open (and keep open) pooled connections ahead of the requests that need them.
 * - closeDb(db)         Ends the underlying pool (postgres.js) or closes the PGlite instance.
 * - migrateDb(db)       See ./migrator: applies packages/db/migrations on either driver.
 */
import { loadEnv } from "@foundmill/shared";
import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { createPgliteDb, isPgliteDb, parsePgliteUrl, type PgliteDb } from "./pglite";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Any Drizzle Postgres database over our schema: the one type apps use for both drivers. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle over our schema; what withRls hands to its callback. */
export type DbTx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** The concrete postgres.js database returned by createDb for a postgres:// URL. */
export type ServiceDb = PostgresJsDatabase<Schema> & { $client: Sql };
/** What createDb/createServiceDb return: postgres.js or PGlite, decided by the URL. Both are assignable to Db. */
export type AnyDb = ServiceDb | PgliteDb;
export type { PgliteDb } from "./pglite";

export const RLS_ROLES = ["authenticated", "anon", "service_role"] as const;
export type RlsRole = (typeof RLS_ROLES)[number];

export interface RlsContext {
  /** auth.users.id of the acting user (becomes the `sub` claim). */
  userId: string;
  /** Postgres role to assume. Defaults to "authenticated". */
  role?: RlsRole;
  /** Extra JWT claims merged into request.jwt.claims (e.g. email). Never overrides sub/role. */
  claims?: Record<string, unknown>;
}

export interface CreateDbOptions {
  /** Max pooled connections. Default 10 (postgres.js default). */
  max?: number;
  /** Seconds before an idle connection is closed. Default: never (a warm pool is the point, see `keepPoolWarm`). */
  idleTimeout?: number;
  /**
   * Seconds a connection lives before it is replaced, busy or not; null: for good. Default: for good on a direct
   * connection, 6 hours plus up to one hour of jitter per connection (`DEFAULT_MAX_LIFETIME_S`) through a transaction
   * pooler, whose own sessions come and go. postgres.js's default (30-60 minutes) made the first page load after each
   * renewal open a new TLS connection on every request (about +250 ms each in production, audit api-db F1), and its
   * renewal path loses the connection for good when the lifetime ends while the connection is in use
   * (porsager/postgres#1255; the 2026-10-19 outage, docs/DECISIONS.md), so a direct connection is never renewed: a
   * dropped one is noticed by TCP keep-alive and replaced on the next query.
   */
  maxLifetime?: number | null;
  /** Seconds a new connection may take before it fails (default 5; postgres.js waits 30): a stalled connect fails fast. */
  connectTimeout?: number;
  /** Supabase transaction pooler needs prepared statements off. Default: auto-detected from the URL. */
  prepare?: boolean;
  /**
   * Server-side ceiling on one statement, in milliseconds (`statement_timeout`); null: none. Default 5 minutes on a
   * direct connection (a migration's backfill fits; a runaway query does not hold a pooled connection for good), none
   * through a transaction pooler (startup parameters are not reliably passed on).
   */
  statementTimeoutMs?: number | null;
  /**
   * Server-side ceiling on a transaction left open without a statement, in milliseconds
   * (`idle_in_transaction_session_timeout`); null: none. Default 2 minutes on a direct connection, none through a pooler.
   */
  idleInTransactionTimeoutMs?: number | null;
  logger?: boolean;
}

/** The lifetime through a transaction pooler: 6 hours plus up to one hour, drawn per connection so they are not renewed together. */
export const DEFAULT_MAX_LIFETIME_S = (): number => 6 * 3600 + Math.round(Math.random() * 3600);
export const DEFAULT_CONNECT_TIMEOUT_S = 5;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 2 * 60_000;
/** How long a warm-up `select 1` may go unanswered before it counts as a sign of a wedged pool. */
export const WARM_PROBE_TIMEOUT_MS = 10_000;

/**
 * Query parameters other clients (Prisma) put in a connection string. postgres.js sends every query parameter it does not
 * know to the server as a startup parameter, and Postgres refuses the connection ("unrecognized configuration parameter
 * \"pgbouncer\""), so they are dropped before connecting.
 */
const CLIENT_ONLY_PARAMS = ["pgbouncer", "connection_limit", "pool_timeout", "socket_timeout", "statement_cache_size"];

/**
 * The connection string postgres.js gets, and whether it reaches a transaction pooler (PgBouncer in transaction mode:
 * Supabase's shared pooler, its dedicated pooler on port 6543, or any URL marked `pgbouncer=true`), where prepared
 * statements must be off. A string that is not a URL is passed as it is.
 */
export function postgresConnection(url: string): { url: string; transactionPooler: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, transactionPooler: /pooler\.supabase\.com:6543/.test(url) };
  }
  const transactionPooler = parsed.port === "6543" || /\.pooler\.supabase\.com$/i.test(parsed.hostname) || parsed.searchParams.get("pgbouncer") === "true";
  const dropped = CLIENT_ONLY_PARAMS.filter((p) => parsed.searchParams.has(p));
  for (const p of dropped) parsed.searchParams.delete(p);
  return { url: dropped.length > 0 ? parsed.toString() : url, transactionPooler };
}

/**
 * `pglite:<dir>` / `pglite::memory:` → Drizzle over PGlite (roles, stub auth schema, pg_trgm + pgvector booted
 * lazily before the first query; run migrateDb(db) to apply the migrations). Anything else → postgres.js.
 * Pool options (max, idleTimeout, prepare) only apply to postgres.js; PGlite is one in-process connection.
 */
export function createDb(url: `pglite:${string}`, options?: CreateDbOptions): PgliteDb;
export function createDb(url: string, options?: CreateDbOptions): AnyDb;
export function createDb(url: string, options: CreateDbOptions = {}): AnyDb {
  if (!url) throw new Error("createDb: a connection string is required");
  const pglite = parsePgliteUrl(url);
  if (pglite) return createPgliteDb(pglite, { logger: options.logger });
  const connection = postgresConnection(url);
  const direct = !connection.transactionPooler;
  // postgres.js also takes a function here (its own default is one), drawn once per pooled connection; null is never.
  const maxLifetime = (options.maxLifetime === undefined ? (direct ? null : DEFAULT_MAX_LIFETIME_S) : options.maxLifetime) as number | null;
  const statementTimeout = options.statementTimeoutMs === undefined ? (direct ? DEFAULT_STATEMENT_TIMEOUT_MS : null) : options.statementTimeoutMs;
  const idleInTransaction = options.idleInTransactionTimeoutMs === undefined ? (direct ? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS : null) : options.idleInTransactionTimeoutMs;
  // Startup parameters: the server applies them to every session of the pool.
  const startup: Record<string, string> = {};
  if (statementTimeout !== null) startup.statement_timeout = String(statementTimeout);
  if (idleInTransaction !== null) startup.idle_in_transaction_session_timeout = String(idleInTransaction);
  const client = postgres(connection.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout,
    max_lifetime: maxLifetime,
    connect_timeout: options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_S,
    prepare: options.prepare ?? direct,
    ...(Object.keys(startup).length ? { connection: startup } : {}),
    // Array types are still fetched on each new connection (postgres.js `fetch_types`): raw `execute` results rely on
    // them to parse array columns, and a warm pool rarely opens one.
    onnotice: () => {},
  });
  return withDateParams(client, drizzle({ client, schema, logger: options.logger ?? false }));
}

/** The date and time types Drizzle's postgres-js driver makes pass through unchanged (drizzle-orm 0.45 `postgres-js/driver`). */
const DATE_TIME_TYPES = ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"] as const;

/**
 * Lets a `Date` go into a raw `sql` template on postgres.js, as it already does on PGlite (Nov 14, 2026). Drizzle's
 * postgres-js driver replaces postgres.js's serializers for the date and time types with a pass-through, because the
 * values it maps from a column are already text. A `Date` in a raw template (`sql\`${t.expiresAt} > ${now}\``) has no
 * column mapping: postgres.js infers timestamptz (1184) for it and the pass-through hands the `Date` itself to the wire
 * writer, which throws (`The "string" argument must be of type string … Received an instance of Date`). The PGlite tests
 * never saw it. This keeps text as text and writes a `Date` as its ISO string. Call it after `drizzle({ client })`,
 * which is what installs the pass-through.
 */
export function withDateParams<D>(client: Sql, db: D): D {
  const serializers = client.options.serializers as Record<string, (v: unknown) => unknown>;
  for (const type of DATE_TIME_TYPES) {
    const inner = serializers[type];
    serializers[type] = (v: unknown) => (v instanceof Date ? v.toISOString() : inner ? inner(v) : v);
  }
  return db;
}

/** `fn()` raced against `ms`; the loser is left alone (a pooled query cannot be taken back). */
export function withinMs<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    timer.unref?.();
    fn().then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

/**
 * Opens, or keeps open, up to `connections` pooled connections of a postgres.js database: that many `select 1` at once
 * (postgres.js gives each to an idle connection, else opens a closed one). A no-op on PGlite (one in-process connection)
 * and on a database without a pool. Resolves to how many answered; never throws. A probe that has not answered within
 * `timeoutMs` (default `WARM_PROBE_TIMEOUT_MS`) counts as failed and is reported through `onError`: a healthy pool
 * answers `select 1` in milliseconds, so an unanswered one means a pooled connection that will never answer
 * (the 2026-10-19 outage, docs/DECISIONS.md), which the pool watchdog (`createPoolWatchdog`) acts on.
 */
export async function warmPool(db: Db, connections: number, onError?: (err: unknown) => void, timeoutMs: number = WARM_PROBE_TIMEOUT_MS): Promise<number> {
  if (isPgliteDb(db)) return 0;
  const client = (db as Partial<ServiceDb>).$client;
  if (!client || typeof client.unsafe !== "function" || connections <= 0) return 0;
  // Not a data query: it only opens connections (ARCHITECTURE §4).
  const answers = await Promise.allSettled(Array.from({ length: Math.floor(connections) }, () => withinMs(timeoutMs, () => client.unsafe("select 1"))));
  const unanswered = answers.filter((a) => a.status === "rejected" && /no answer within/.test(String((a as PromiseRejectedResult).reason?.message ?? ""))).length;
  const failed = answers.find((a): a is PromiseRejectedResult => a.status === "rejected");
  if (unanswered > 0) onError?.(new Error(`${unanswered} of ${answers.length} warm-up queries did not answer within ${timeoutMs} ms: a pooled connection may be wedged`));
  else if (failed) onError?.(failed.reason);
  return answers.filter((a) => a.status === "fulfilled").length;
}

export interface PoolWarmer {
  /** Resolves when the first warm-up (started at once) has answered. */
  readonly ready: Promise<number>;
  stop(): void;
}

/**
 * Warms the pool now and again every `intervalMs` (default 60 s) on an unref'd timer, so the first request after a
 * deploy or a quiet spell finds open connections instead of paying a TLS and SCRAM handshake per connection, and a
 * connection the pooler or a NAT dropped is replaced before a request needs it. A round still waiting when the next is
 * due is left to finish first (its probes are bounded, so a wedged pool is reported, not buried under more probes).
 * `stop()` in the service's shutdown.
 */
export function keepPoolWarm(db: Db, options: { connections: number; intervalMs?: number; onError?: (err: unknown) => void; probeTimeoutMs?: number }): PoolWarmer {
  let pending: Promise<number> | null = null;
  const warm = () => {
    if (pending) return pending;
    pending = warmPool(db, options.connections, options.onError, options.probeTimeoutMs).finally(() => (pending = null));
    return pending;
  };
  const ready = warm();
  const timer = setInterval(() => void warm(), options.intervalMs ?? 60_000);
  timer.unref?.();
  return { ready, stop: () => clearInterval(timer) };
}

/** Service-role connection from DATABASE_URL. Only repositories may run raw queries on it (eslint fm/no-raw-db). */
export function createServiceDb(options: CreateDbOptions = {}): AnyDb {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return createDb(env.DATABASE_URL, options);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The statement that makes RLS apply to a transaction: `set_config('role', …, true)` is `set local role` (the same
 * privilege check, transaction-local) and `request.jwt.claims` is what auth.uid() reads. Both values are bound
 * parameters ($1 and $2), never interpolated. It also turns JIT compilation off for the transaction, in the same round
 * trip: a policy calls a function on every row it checks, which makes aggregates over a business's history look costly
 * enough to compile, and compiling took longer than the query (audit api-db F5).
 */
const RLS_SETUP_SQL = "select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('jit', 'off', true)";

/** The role each `withRls` transaction runs as, by its transaction handle (`rlsRoleOf`). */
const rlsRoles = new WeakMap<object, RlsRole>();

/**
 * The role `db` runs as when it is a transaction `withRls` opened (its callback's `tx`), else undefined: then only the
 * server can say (`bypassesRls` in repos/_shared asks it).
 */
export function rlsRoleOf(db: object): RlsRole | undefined {
  return rlsRoles.get(db);
}

/** The postgres.js handle a Drizzle transaction runs on (its postgres-js session), or null on another driver (PGlite). */
function postgresJsClient(tx: DbTx): Pick<Sql, "unsafe"> | null {
  const client = (tx as unknown as { session?: { client?: unknown } }).session?.client;
  return typeof client === "function" && typeof (client as Partial<Sql>).unsafe === "function" ? (client as Sql) : null;
}

/**
 * Runs `fn(tx)` after `set local role <role>` and `set local request.jwt.claims = {sub, role, ...}`.
 * Both settings are transaction-local, so the connection returns to the service role when the
 * transaction ends (commit or rollback). The role name is whitelisted; claims go through set_config
 * as a bound parameter, never string-interpolated.
 *
 * Round trips (src/__tests__/round-trips.test.ts): BEGIN, then the setup together with fn's first statements, then
 * any later statements of fn, then COMMIT. On postgres.js the setup is handed to the transaction's connection before
 * fn starts and the connection sends in order, so it always runs before anything fn sends; if it fails, the
 * transaction is aborted and none of fn's statements run. On PGlite (in process, no network) it is awaited first.
 */
export async function withRls<T>(db: Db, ctx: RlsContext, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  const role: RlsRole = ctx.role ?? "authenticated";
  if (!RLS_ROLES.includes(role)) throw new Error(`withRls: unknown role ${String(role)}`);
  if (role !== "anon" && !UUID_RE.test(ctx.userId)) throw new Error("withRls: userId must be a UUID");
  const claims = JSON.stringify({ ...(ctx.claims ?? {}), sub: role === "anon" ? undefined : ctx.userId, role });
  return db.transaction(async (tx) => {
    rlsRoles.set(tx, role);
    // Infrastructure, not a data query: this statement is what makes RLS apply to everything fn(tx) runs.
    const client = postgresJsClient(tx);
    if (!client) {
      // eslint-disable-next-line fm/no-raw-db -- role switch and JWT claims for this transaction (ARCHITECTURE §4)
      await tx.execute(sql`select set_config('role', ${role}, true), set_config('request.jwt.claims', ${claims}, true), set_config('jit', 'off', true)`);
      return fn(tx);
    }
    // `execute()` queues the statement on the connection now (a postgres.js query is otherwise sent only once
    // awaited), ahead of everything fn sends. Not awaiting it before fn saves a round trip: the setup travels with
    // fn's first statements. Both settle before the transaction commits or rolls back, so fn has always finished
    // with the connection by then.
    const ready = client.unsafe(RLS_SETUP_SQL, [role, claims]).execute();
    const [applied, result] = await Promise.allSettled([ready, Promise.resolve().then(() => fn(tx))]);
    if (applied.status === "rejected") throw applied.reason;
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

/** Ends the postgres.js pool or closes the PGlite instance; a no-op for a db without a client (tests' fakes). */
export async function closeDb(db: Db): Promise<void> {
  if (isPgliteDb(db)) {
    await db.$client.close();
    return;
  }
  const client = (db as Partial<ServiceDb>).$client;
  if (client && typeof client.end === "function") await client.end({ timeout: 5 });
}
