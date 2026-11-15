/**
 * PGlite as a database driver (docs/DECISIONS.md "PGlite as the local database driver").
 *
 * One place for everything PGlite-specific so the test harness (src/testing/pglite.ts), the seed target
 * (src/seed/pglite-target.ts) and `createDb("pglite:…")` (src/client.ts) boot the very same database:
 *
 * - URL forms: `pglite:<dir>` (file-backed; a relative dir resolves against the workspace root so every
 *   package and app opens the same directory) and `pglite::memory:` (in-memory).
 * - PGLITE_BOOTSTRAP_SQL: the Supabase roles (anon / authenticated / service_role), a stub `auth` schema with
 *   `auth.uid()` / `auth.role()` reading `request.jwt.claims` (what withRls sets per transaction), pg_trgm and
 *   pgvector are loaded as extensions. After it, packages/db/migrations apply verbatim.
 * - `LazyPgliteClient`: the client Drizzle talks to. `createDb` must stay synchronous (every service calls it
 *   at module scope), while PGlite boots asynchronously; the lazy client queues the first query behind
 *   "WASM ready + bootstrap applied" and is transparent afterwards. It also answers `end()` so code written
 *   for postgres.js (`db.$client.end({ timeout })`) keeps working on either driver.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Extension, type PGliteOptions, type QueryOptions, type Results, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export const PGLITE_URL_PREFIX = "pglite:";
/** Where `SEED_TARGET=pglite` and the docs put the local database (relative to the workspace root). */
export const DEFAULT_PGLITE_DIR = "./.pglite/dev";
const MEMORY_SPECS = new Set(["", ":memory:", "memory:", "memory://"]);

export interface PgliteTarget {
  /** Absolute data directory, or undefined for an in-memory database. */
  dataDir?: string;
}

export function isPgliteUrl(url: string): boolean {
  return url.startsWith(PGLITE_URL_PREFIX);
}

/**
 * Nearest ancestor of `from` holding pnpm-workspace.yaml (the monorepo root); `from` itself when none.
 * `pnpm --filter <pkg> <script>` runs scripts with cwd = the package, so a relative dir must not depend on it.
 */
export function findWorkspaceRoot(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

/** Absolute path for a PGlite data directory; relative paths resolve against the workspace root. */
export function resolvePgliteDir(dir: string, from: string = process.cwd()): string {
  return path.isAbsolute(dir) ? dir : path.resolve(findWorkspaceRoot(from), dir);
}

/** Parses `pglite:<dir>` / `pglite::memory:`; null when `url` is not a PGlite URL. */
export function parsePgliteUrl(url: string, from: string = process.cwd()): PgliteTarget | null {
  if (!isPgliteUrl(url)) return null;
  let spec = url.slice(PGLITE_URL_PREFIX.length).trim();
  if (spec.startsWith("//")) spec = spec.slice(2); // tolerate pglite://./dir and pglite:///abs/dir
  if (MEMORY_SPECS.has(spec)) return {};
  if (spec.startsWith("file://")) spec = spec.slice("file://".length);
  return { dataDir: resolvePgliteDir(spec, from) };
}

/** `pglite:<absolute dir>` for a directory, `pglite::memory:` for none: the inverse of parsePgliteUrl. */
export function pgliteUrl(dataDir?: string): `pglite:${string}` {
  return dataDir ? `${PGLITE_URL_PREFIX}${resolvePgliteDir(dataDir)}` : `${PGLITE_URL_PREFIX}:memory:`;
}

/**
 * What Supabase provides and PGlite does not: the three API roles and the `auth` schema the RLS policies
 * call into. Idempotent, so it runs on every open of a file-backed directory.
 */
export const PGLITE_BOOTSTRAP_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- Mirrors Supabase's auth.uid(): the sub claim of request.jwt.claims (set per transaction by withRls).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;
`;

/** pgvector for PGlite (`@electric-sql/pglite-pgvector`); null when the package is not installed. */
export async function loadVectorExtension(): Promise<Extension | null> {
  const specifier = "@electric-sql/pglite-pgvector";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as { vector?: Extension };
    return mod.vector ?? null;
  } catch {
    return null;
  }
}

/** Without pgvector the only incompatible SQL is the extension itself and the vector(1024) column type. */
export function rewriteForMissingVector(sqlText: string): string {
  return sqlText
    .replace(/create extension if not exists vector;/gi, "select 1; -- vector extension unavailable on this PGlite build")
    .replace(/\bvector\(\d+\)/g, "real[]");
}

export interface BootPgliteOptions extends PgliteTarget {
  /** Force the no-pgvector path even when the extension is installed (test harness only). */
  disableVector?: boolean;
  /** A dump of a database to start from (testing/snapshot.ts); it already holds the bootstrap, so that is skipped. */
  loadDataDir?: Blob;
}

export interface BootedPglite {
  pg: PGlite;
  /** True when the real pgvector extension was loaded. */
  hasVector: boolean;
  /** Closes the instance and releases the directory lock. */
  close(): Promise<void>;
}

export const PGLITE_LOCK_FILE = "foundmill.lock";

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * PGlite is one Postgres per process with no shared-memory coordination: two processes on one directory do not
 * see each other's writes and corrupt it on sync (measured: both applied every migration). Postgres' own
 * postmaster.pid does not stop a second WASM instance, so we keep an advisory lock file (pid + time) and refuse
 * a second opener while the owning pid is alive. A stale lock (dead pid, e.g. after a crash) is taken over.
 */
export function acquirePgliteDirLock(dataDir: string): () => void {
  const lockPath = path.join(dataDir, PGLITE_LOCK_FILE);
  const payload = JSON.stringify({ pid: process.pid, openedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: "wx" });
      return () => {
        try {
          if (fs.readFileSync(lockPath, "utf8") === payload) fs.unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let holder: { pid?: number } = {};
      try {
        holder = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number };
      } catch {
        /* unreadable: treat as stale */
      }
      if (holder.pid && pidAlive(holder.pid)) {
        throw new Error(
          `PGlite directory ${dataDir} is already open in process ${holder.pid}${holder.pid === process.pid ? " (this process)" : ""}. ` +
            "PGlite allows one process per data directory: close the other instance, or give this one its own pglite:<dir>.",
          { cause: err },
        );
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`PGlite directory ${dataDir}: could not acquire ${PGLITE_LOCK_FILE}`);
}

/** Creates the PGlite instance (pg_trgm + pgvector) and applies PGLITE_BOOTSTRAP_SQL. Migrations are the caller's job. */
export async function bootPglite(options: BootPgliteOptions = {}): Promise<BootedPglite> {
  const vector = options.disableVector ? null : await loadVectorExtension();
  const extensions: Record<string, Extension> = { pg_trgm };
  if (vector) extensions.vector = vector;
  const pgOptions: PGliteOptions = { extensions, relaxedDurability: true, ...(options.loadDataDir ? { loadDataDir: options.loadDataDir } : {}) };
  let releaseLock = () => {};
  if (options.dataDir) {
    fs.mkdirSync(options.dataDir, { recursive: true });
    releaseLock = acquirePgliteDirLock(options.dataDir);
    pgOptions.dataDir = options.dataDir;
  }
  let pg: PGlite;
  try {
    pg = await PGlite.create(pgOptions);
    if (!options.loadDataDir) await pg.exec(PGLITE_BOOTSTRAP_SQL);
  } catch (err) {
    releaseLock();
    throw err;
  }
  let closed = false;
  return {
    pg,
    hasVector: Boolean(vector),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        if (!pg.closed) await pg.close();
      } finally {
        releaseLock();
      }
    },
  };
}

/**
 * The subset of PGlite that drizzle-orm/pglite uses (query / transaction) plus close, each awaiting the boot.
 * Everything drizzle needs is here; `instance()` hands out the real PGlite for tooling (the seed target, tests).
 */
export class LazyPgliteClient {
  readonly dataDir?: string;
  readonly waitReady: Promise<void>;
  private booted: BootedPglite | null = null;
  private closedFlag = false;

  constructor(private readonly target: PgliteTarget) {
    this.dataDir = target.dataDir;
    this.waitReady = bootPglite(target).then((b) => {
      this.booted = b;
    });
    // A boot failure surfaces on the first query (and on instance()); never as an unhandled rejection.
    this.waitReady.catch(() => undefined);
  }

  /** The underlying PGlite once booted and bootstrapped (rejects with the boot error otherwise). */
  async instance(): Promise<PGlite> {
    await this.waitReady;
    if (!this.booted) throw new Error("PGlite did not boot");
    return this.booted.pg;
  }

  /** True when the real pgvector extension was loaded (resolves after boot). */
  async hasVector(): Promise<boolean> {
    await this.waitReady;
    return Boolean(this.booted?.hasVector);
  }

  get ready(): boolean {
    return this.booted !== null;
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  async query<T>(query: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>> {
    const pg = await this.instance();
    return pg.query<T>(query, params, options);
  }

  async exec(query: string, options?: QueryOptions): Promise<Results[]> {
    const pg = await this.instance();
    return pg.exec(query, options);
  }

  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const pg = await this.instance();
    return pg.transaction(callback);
  }

  async close(): Promise<void> {
    if (this.closedFlag) return;
    this.closedFlag = true;
    const booted = await this.waitReady.then(() => this.booted, () => null);
    if (booted) await booted.close();
  }

  /** postgres.js spelling of close(), so `db.$client.end({ timeout })` works on either driver. */
  async end(_options?: { timeout?: number }): Promise<void> {
    await this.close();
  }
}

/** A Drizzle database over PGlite with our schema; `$client` is the lazy client above. */
export type PgliteDb = PgliteDatabase<typeof schema> & { $client: LazyPgliteClient };

export interface CreatePgliteDbOptions {
  logger?: boolean;
}

/** Synchronous: the returned db queues its first query behind the boot (see LazyPgliteClient). */
export function createPgliteDb(target: PgliteTarget, options: CreatePgliteDbOptions = {}): PgliteDb {
  const client = new LazyPgliteClient(target);
  // drizzle's pglite driver only calls query()/transaction() on the client; the lazy client answers both.
  const db = drizzle({ client: client as unknown as PGlite, schema, logger: options.logger ?? false });
  return db as unknown as PgliteDb;
}

/** Narrowing helper for code that must behave differently per driver (closeDb, migrateDb). */
export function isPgliteDb(db: unknown): db is PgliteDb {
  return Boolean(db) && (db as { $client?: unknown }).$client instanceof LazyPgliteClient;
}
