/**
 * PGlite test harness (docs/DECISIONS.md "No Docker on the build machine").
 *
 * createTestDb() boots an in-memory Postgres 17 (WASM) through bootPglite (src/pglite.ts: pg_trgm, pgvector when
 * `@electric-sql/pglite-pgvector` is installed, the Supabase roles and the stub `auth` schema), applies every
 * migration in journal order and returns role-switching runners so RLS can be exercised exactly as apps/api
 * does it through withRls().
 */
import type { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { withRls, type Db, type DbTx, type RlsRole } from "../client";
import { readMigrations, type MigrationFile } from "../migrations";
import { bootPglite, rewriteForMissingVector } from "../pglite";
import * as schema from "../schema";

export { PGLITE_BOOTSTRAP_SQL as BOOTSTRAP_SQL, rewriteForMissingVector } from "../pglite";

export type TestDb = PgliteDatabase<typeof schema>;

export interface Runner {
  /** Runs fn inside one transaction with the role + claims applied. */
  run<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  /** Convenience: one raw query under the role. */
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: SQL): Promise<T[]>;
}

export interface TestHarness {
  /** Superuser (postgres) connection — bypasses RLS. Use for fixtures and assertions about ground truth. */
  db: TestDb;
  pg: PGlite;
  /** Runner acting as a signed-in user (role authenticated by default). */
  asUser(userId: string, role?: RlsRole): Runner;
  /** Runner acting as the service role (bypassrls). */
  service(): Runner;
  /** Runner acting as anon (no user). */
  anon(): Runner;
  /** Inserts a stub auth.users row and returns its id. */
  createUser(email?: string): Promise<string>;
  /** True when the real pgvector extension was loaded; false when vector(1024) was rewritten to real[]. */
  hasVector: boolean;
  appliedMigrations: string[];
  close(): Promise<void>;
}

/**
 * drizzle wraps driver errors in DrizzleQueryError ("Failed query: …") and keeps the Postgres error in `cause`.
 * Tests assert on Postgres' own text ("new row violates row-level security policy", "permission denied"),
 * so the runners rethrow an Error whose message is the Postgres message, with the original kept as `cause`.
 */
export function unwrapDbError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== err.message) {
    const out = new Error(cause.message, { cause: err });
    out.name = cause.name || err.name;
    Object.assign(out, { code: (cause as { code?: string }).code, query: (err as { query?: string }).query });
    return out;
  }
  return err;
}

export interface CreateTestDbOptions {
  /** Override the migration files (defaults to packages/db/migrations in journal order). */
  migrations?: MigrationFile[];
  /** Force the no-pgvector path even when the extension is installed. */
  disableVector?: boolean;
}

export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestHarness> {
  // Same roles / auth stub / extensions as createDb("pglite:…") (src/pglite.ts); in-memory, migrations applied
  // file by file here (not through migrateDb) so a suite can pass its own list and the no-pgvector rewrite applies.
  const booted = await bootPglite({ disableVector: options.disableVector });
  const { pg, hasVector: vector } = booted;
  const db = drizzle({ client: pg, schema });

  const migrations = options.migrations ?? readMigrations();
  const applied: string[] = [];
  for (const m of migrations) {
    const text = vector ? m.sql : rewriteForMissingVector(m.sql);
    try {
      await pg.exec(text);
    } catch (err) {
      throw new Error(`Migration ${m.tag} failed: ${(err as Error).message}`, { cause: err });
    }
    applied.push(m.tag);
  }

  const makeRunner = (ctx: { userId: string; role: RlsRole }): Runner => ({
    run: (fn) => withRls(db as unknown as Db, ctx, fn).catch((err: unknown) => Promise.reject(unwrapDbError(err))),
    execute: async <T extends Record<string, unknown>>(query: SQL) =>
      withRls(db as unknown as Db, ctx, async (tx) => {
        const res = await tx.execute(query);
        return (res as unknown as { rows: T[] }).rows;
      }).catch((err: unknown) => Promise.reject(unwrapDbError(err))),
  });

  const NIL = "00000000-0000-0000-0000-000000000000";

  return {
    db,
    pg,
    hasVector: vector,
    appliedMigrations: applied,
    asUser: (userId, role = "authenticated") => makeRunner({ userId, role }),
    service: () => makeRunner({ userId: NIL, role: "service_role" }),
    anon: () => makeRunner({ userId: NIL, role: "anon" }),
    createUser: async (email) => {
      const addr = email ?? `user-${crypto.randomUUID().slice(0, 8)}@test.local`;
      const res = await db.execute(sql`insert into auth.users (email) values (${addr}) returning id`);
      const row = (res as unknown as { rows: { id: string }[] }).rows[0];
      if (!row) throw new Error("createUser: insert returned no row");
      return row.id;
    },
    close: () => booted.close(),
  };
}
