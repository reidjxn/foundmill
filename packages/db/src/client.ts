/**
 * Database clients (docs/ARCHITECTURE.md §4).
 *
 * - createDb(url)       Drizzle over postgres.js for an explicit connection string.
 * - createServiceDb()   Reads DATABASE_URL via loadEnv(); the service-role connection used by workers.
 * - withRls(db, ctx, fn) Runs fn(tx) in a transaction as `authenticated` (or another app role) with
 *                        request.jwt.claims set, so Postgres RLS enforces tenancy for user-originated queries.
 * - closeDb(db)         Ends the underlying pool.
 */
import { loadEnv } from "@foundmill/shared";
import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Any Drizzle Postgres database over our schema (postgres.js in services, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle over our schema; what withRls hands to its callback. */
export type DbTx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** The concrete postgres.js database returned by createDb/createServiceDb. */
export type ServiceDb = PostgresJsDatabase<Schema> & { $client: Sql };

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
  /** Seconds before an idle connection is closed. */
  idleTimeout?: number;
  /** Supabase transaction pooler needs prepared statements off. Default: auto-detected from the URL. */
  prepare?: boolean;
  logger?: boolean;
}

const isTransactionPooler = (url: string) => /pooler\.supabase\.com:6543/.test(url) || /pgbouncer=true/.test(url);

export function createDb(url: string, options: CreateDbOptions = {}): ServiceDb {
  if (!url) throw new Error("createDb: a connection string is required");
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout,
    prepare: options.prepare ?? !isTransactionPooler(url),
    onnotice: () => {},
  });
  return drizzle({ client, schema, logger: options.logger ?? false });
}

/** Service-role connection from DATABASE_URL. Only repositories may run raw queries on it (eslint fm/no-raw-db). */
export function createServiceDb(options: CreateDbOptions = {}): ServiceDb {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return createDb(env.DATABASE_URL, options);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn(tx)` after `set local role <role>` and `set local request.jwt.claims = {sub, role, ...}`.
 * Both settings are transaction-local, so the connection returns to the service role when the
 * transaction ends (commit or rollback). The role name is whitelisted; claims go through set_config
 * as a bound parameter, never string-interpolated.
 */
export async function withRls<T>(db: Db, ctx: RlsContext, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  const role: RlsRole = ctx.role ?? "authenticated";
  if (!RLS_ROLES.includes(role)) throw new Error(`withRls: unknown role ${String(role)}`);
  if (role !== "anon" && !UUID_RE.test(ctx.userId)) throw new Error("withRls: userId must be a UUID");
  const claims = JSON.stringify({ ...(ctx.claims ?? {}), sub: role === "anon" ? undefined : ctx.userId, role });
  return db.transaction(async (tx) => {
    // Infrastructure, not a data query: these two statements are what makes RLS apply to everything fn(tx) runs.
    // eslint-disable-next-line fm/no-raw-db -- role switch for this transaction (ARCHITECTURE §4)
    await tx.execute(sql.raw(`set local role ${role}`));
    // eslint-disable-next-line fm/no-raw-db -- JWT claims for auth.uid(); bound parameter, never interpolated
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}

export async function closeDb(db: ServiceDb): Promise<void> {
  await db.$client.end({ timeout: 5 });
}
