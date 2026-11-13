/**
 * The test harness on a real Postgres (docs/DECISIONS.md "RLS cross-tenant tests run on PGlite"): `createTestDb()`
 * comes here when `RLS_TEST_DATABASE_URL` is set, and returns the same `TestHarness` as on PGlite.
 *
 * PGlite runs everything as a superuser in one process, so it cannot show what a role may and may not do the way
 * Supabase does (a non-superuser owner, its default privileges, `service_role` with BYPASSRLS, `authenticated` and
 * `anon` without it). Here each harness gets a fresh database on the server the URL names:
 *
 * - `create database fm_rls_<random>` through the URL's connection (its role needs CREATEDB; the new database is
 *   owned by that role, as Supabase's `postgres` owns its database), dropped again on `close()`;
 * - Supabase's roles and `auth` schema: when the server already has them (the database's template carries an `auth`
 *   schema with `auth.users`, as a cluster set up like Supabase does) they are used as they are; otherwise
 *   `PGLITE_BOOTSTRAP_SQL` creates them (the URL's role then needs CREATEROLE, and BYPASSRLS for `service_role`);
 * - the migrations, file by file in journal order as on PGlite, with `rewriteForMissingVector` when the server has
 *   no pgvector;
 * - `db` is Drizzle over postgres.js connected as the URL's role (the owner: like Supabase's `postgres`, it bypasses
 *   RLS as owner of the tables, superuser or not), and the runners go through `withRls` on postgres.js, the very path
 *   apps/api takes in production (`set_config('role', …)` and `request.jwt.claims` in one transaction).
 *
 * Two shapes are bridged so the suites need no second spelling: `execute()` results also answer `.rows` (PGlite's
 * shape; postgres.js returns the rows themselves), and `pg` answers `query(text, params)` and `exec(text)` as PGlite
 * does. Nothing else of PGlite is there (`pg.execProtocolRaw`, `createWireDb`): `driver` says which one a suite has.
 */
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { withRls, type Db, type RlsRole } from "../client";
import { readMigrations } from "../migrations";
import { PGLITE_BOOTSTRAP_SQL, rewriteForMissingVector } from "../pglite";
import * as schema from "../schema";
import type { CreateTestDbOptions, Runner, TestDb, TestHarness } from "./pglite";

/** The variable that sends the harness to a real Postgres. */
export const RLS_TEST_DATABASE_URL = "RLS_TEST_DATABASE_URL";

/** Set to 1 to let the harness use a Postgres that is not on this machine (never a production cluster). */
export const RLS_TEST_ALLOW_REMOTE = "RLS_TEST_ALLOW_REMOTE";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The URL from the environment, or undefined (then the harness boots PGlite). */
export function realPostgresUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env[RLS_TEST_DATABASE_URL]?.trim();
  if (!url) return undefined;
  if (!isLoopback(url) && env[RLS_TEST_ALLOW_REMOTE] !== "1") {
    throw new Error(`${RLS_TEST_DATABASE_URL} points at a host that is not this machine; the harness creates and drops databases there. Set ${RLS_TEST_ALLOW_REMOTE}=1 to allow it.`);
  }
  return url;
}

/** True when the URL's host is this machine (a socket directory counts). */
export function isLoopback(url: string): boolean {
  const parsed = new URL(url);
  const host = parsed.hostname || parsed.searchParams.get("host") || "localhost";
  return LOOPBACK_HOSTS.has(host) || host.startsWith("/") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** `url` with its database name replaced. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const NIL = "00000000-0000-0000-0000-000000000000";

/** The array postgres.js returns, also answering `.rows` (itself) as PGlite's results do. */
function withRowsProperty<T>(res: T): T {
  if (Array.isArray(res) && !Object.prototype.hasOwnProperty.call(res, "rows")) {
    Object.defineProperty(res, "rows", { value: res, enumerable: false, configurable: true });
  }
  return res;
}

interface Executes {
  execute(query: unknown): PromiseLike<unknown>;
  transaction(fn: (tx: never) => Promise<unknown>, config?: unknown): Promise<unknown>;
}

/** Makes `execute` on `target`, and on every transaction and savepoint it opens, answer `.rows` too. In place, so `withRls` keeps its handle. */
function bridgeRowsShape<T extends object>(target: T): T {
  const t = target as unknown as Executes;
  const execute = t.execute.bind(t);
  const transaction = t.transaction.bind(t);
  t.execute = (query) => Promise.resolve(execute(query)).then(withRowsProperty);
  t.transaction = (fn, config) => transaction(((tx: object) => fn(bridgeRowsShape(tx) as never)) as never, config);
  return target;
}

/** `pg.query` / `pg.exec` as PGlite answers them, over a postgres.js client with its default type parsing (as PGlite parses). */
function pgliteLike(client: Sql): PGlite {
  const shape = (res: postgres.RowList<postgres.Row[]>) => ({
    rows: [...res],
    affectedRows: res.count ?? 0,
    fields: (res.columns ?? []).map((c) => ({ name: c.name, dataTypeID: c.type })),
  });
  return {
    query: async (text: string, params: unknown[] = []) => shape(await client.unsafe(text, params as postgres.ParameterOrJSON<never>[])),
    // No parameters: postgres.js sends the simple protocol, so several statements run as one, as PGlite's exec does.
    exec: async (text: string) => {
      const res = (await client.unsafe(text)) as unknown;
      const parts = Array.isArray(res) && res.length > 0 && Array.isArray(res[0]) ? (res as postgres.RowList<postgres.Row[]>[]) : [res as postgres.RowList<postgres.Row[]>];
      return parts.map(shape);
    },
    get closed() {
      return false;
    },
  } as unknown as PGlite;
}

/** Connection errors read as the Postgres message, as the PGlite runners rethrow them (`unwrapDbError`). */
type Unwrap = (err: unknown) => Error;

export async function createRealPostgresTestDb(url: string, options: CreateTestDbOptions, unwrapDbError: Unwrap): Promise<TestHarness> {
  const database = `fm_rls_${crypto.randomBytes(6).toString("hex")}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${database}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const target = withDatabase(url, database);
  // Drizzle's own client (it makes dates and times pass through as text, as drizzle's PGlite driver does), and one for
  // `pg` with postgres.js's default parsing (dates as Date, as PGlite's `query` returns them).
  const client = postgres(target, { max: 10, onnotice: () => {} });
  const raw = postgres(target, { max: 4, onnotice: () => {} });
  const dropDatabase = async () => {
    await Promise.allSettled([client.end({ timeout: 5 }), raw.end({ timeout: 5 })]);
    const cleanup = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await cleanup.unsafe(`drop database if exists ${database} with (force)`);
    } finally {
      await cleanup.end({ timeout: 5 });
    }
  };

  try {
    const [{ has_auth: hasAuth, has_vector: vectorAvailable }] = (await raw.unsafe(
      `select to_regclass('auth.users') is not null as has_auth, exists (select 1 from pg_available_extensions where name = 'vector') as has_vector`,
    )) as unknown as [{ has_auth: boolean; has_vector: boolean }];
    if (!hasAuth) await raw.unsafe(PGLITE_BOOTSTRAP_SQL);
    const vector = vectorAvailable && !options.disableVector;

    const migrations = options.migrations ?? readMigrations();
    const applied: string[] = [];
    for (const m of migrations) {
      try {
        await raw.unsafe(vector ? m.sql : rewriteForMissingVector(m.sql));
      } catch (err) {
        throw new Error(`Migration ${m.tag} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(m.tag);
    }

    const db = bridgeRowsShape(drizzle({ client, schema }));
    const makeRunner = (ctx: { userId: string; role: RlsRole }): Runner => ({
      run: (fn) => withRls(db as unknown as Db, ctx, fn).catch((err: unknown) => Promise.reject(unwrapDbError(err))),
      execute: async <T extends Record<string, unknown>>(query: Parameters<Runner["execute"]>[0]) =>
        withRls(db as unknown as Db, ctx, async (tx) => [...((await tx.execute(query)) as unknown as T[])]).catch((err: unknown) =>
          Promise.reject(unwrapDbError(err)),
        ),
    });

    let closed = false;
    return {
      db: db as unknown as TestDb,
      pg: pgliteLike(raw),
      driver: "postgres",
      database,
      hasVector: vector,
      appliedMigrations: applied,
      asUser: (userId, role = "authenticated") => makeRunner({ userId, role }),
      service: () => makeRunner({ userId: NIL, role: "service_role" }),
      anon: () => makeRunner({ userId: NIL, role: "anon" }),
      createUser: async (email) => {
        const addr = email ?? `user-${crypto.randomUUID().slice(0, 8)}@test.local`;
        const rows = (await db.execute(sql`insert into auth.users (email) values (${addr}) returning id`)) as unknown as { id: string }[];
        const row = rows[0];
        if (!row) throw new Error("createUser: insert returned no row");
        return row.id;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await dropDatabase();
      },
    };
  } catch (err) {
    await dropDatabase().catch(() => undefined);
    throw err;
  }
}
