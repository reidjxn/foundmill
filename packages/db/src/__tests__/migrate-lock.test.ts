/**
 * migrateDb on Postgres: one transaction under `pg_advisory_xact_lock(7461, 1)` with a bounded wait
 * (docs/DEPLOY.md §3 "Migrations at boot").
 *
 * Needs a Postgres (and, for the pooler cases, a PgBouncer in `pool_mode = transaction` in front of it, the way
 * Supabase's port 6543 behaves):
 *   FM_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:55432/postgres
 *   FM_TEST_POOLER_URL=postgres://postgres@127.0.0.1:56543/postgres
 * Every case creates its own database and its own migrations folder (two small migrations), so no extension is needed.
 * The "never answers" case runs everywhere: it needs no database at all.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, type ServiceDb } from "../client";
import { isMigrationLockTimeout, migrateDb, MIGRATION_LOCK, MigrationLockTimeoutError } from "../migrator";

const DIRECT = process.env.FM_TEST_POSTGRES_URL;
const POOLER = process.env.FM_TEST_POOLER_URL;
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A drizzle-kit style folder: meta/_journal.json + NNNN_tag.sql, `when` increasing. */
function migrationsFolder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-migrations-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const entries = Object.entries(files).map(([tag, body], idx) => {
    fs.writeFileSync(path.join(dir, `${tag}.sql`), body);
    return { idx, version: "7", when: 1_700_000_000_000 + idx * 1000, tag, breakpoints: true };
  });
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries }));
  return dir;
}

const TWO_MIGRATIONS = {
  "0001_first": "create table first_table (id int primary key);\n--> statement-breakpoint\nselect pg_sleep(0.3);",
  "0002_second": "create table second_table (id int primary key);",
};

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

describe("migrateDb when the database never answers", () => {
  let server: Server;
  const sockets = new Set<Socket>();
  beforeAll(async () => {
    server = createServer((socket) => void sockets.add(socket)); // accepts, never speaks Postgres
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  });
  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("stops waiting shortly after the lock timeout instead of hanging, and says so", async () => {
    const { port } = server.address() as { port: number };
    const db = createDb(`postgres://nobody@127.0.0.1:${port}/none`, { max: 1 }) as ServiceDb;
    const started = Date.now();
    const err = await migrateDb(db, { migrationsFolder: migrationsFolder(TWO_MIGRATIONS), lockTimeoutMs: 200, lockWaitGraceMs: 300 }).catch((e: unknown) => e);
    const waited = Date.now() - started;
    expect(err).toBeInstanceOf(MigrationLockTimeoutError);
    expect(isMigrationLockTimeout(err)).toBe(true);
    expect((err as MigrationLockTimeoutError).phase).toBe("no-answer");
    expect(waited).toBeGreaterThanOrEqual(450);
    expect(waited).toBeLessThan(2_000);
    await db.$client.end({ timeout: 0 });
  });
});

describe.skipIf(!DIRECT)("migrateDb on Postgres", () => {
  let admin: Sql;
  const created: string[] = [];

  beforeAll(() => {
    admin = postgres(DIRECT!, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    for (const name of created) await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => undefined);
    await admin.end({ timeout: 5 });
  });

  async function freshDatabase(): Promise<string> {
    const name = `fm_lock_${randomBytes(4).toString("hex")}`;
    await admin.unsafe(`create database ${name}`);
    created.push(name);
    return name;
  }

  /** Granted advisory locks in `database`: the migration lock (7461, 1) and the old session key 7461. */
  const migrationLocks = (database: string) =>
    admin<{ pid: number }[]>`
      select l.pid from pg_locks l join pg_database d on d.oid = l.database
      where l.locktype = 'advisory' and l.granted and d.datname = ${database}
        and ((l.classid = ${MIGRATION_LOCK.namespace} and l.objid = ${MIGRATION_LOCK.key} and l.objsubid = 2) or (l.classid = 0 and l.objid = 7461 and l.objsubid = 1))`;

  const bookkeeping = async (database: string) => {
    const sql = postgres(withDb(DIRECT!, database), { max: 1, onnotice: () => undefined });
    try {
      const [present] = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
      if (!present?.exists) return { rows: 0, tables: [] as string[] };
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
      const tables = await sql<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'public' order by 1`;
      return { rows: count?.n ?? 0, tables: tables.map((r) => r.t) };
    } finally {
      await sql.end({ timeout: 1 });
    }
  };

  it("applies everything in one transaction and leaves no advisory lock behind; a second run applies nothing", async () => {
    const name = await freshDatabase();
    const folder = migrationsFolder(TWO_MIGRATIONS);
    const db = createDb(withDb(DIRECT!, name), { max: 4 }) as ServiceDb;
    expect(await migrateDb(db, { migrationsFolder: folder })).toEqual({ applied: ["0001_first", "0002_second"], total: 2 });
    expect(await migrateDb(db, { migrationsFolder: folder })).toEqual({ applied: [], total: 2 });
    expect(await migrationLocks(name)).toEqual([]);
    expect(await bookkeeping(name)).toEqual({ rows: 2, tables: ["first_table", "second_table"] });
    await closeDb(db);
  });

  it("a held lock times out after lockTimeoutMs, names the holder, and applies nothing", async () => {
    const name = await freshDatabase();
    const holder = postgres(withDb(DIRECT!, name), { max: 1, onnotice: () => undefined });
    await holder`select pg_advisory_lock(${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.key})`;
    const pid = (await holder<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]!.pid;
    const db = createDb(withDb(DIRECT!, name), { max: 4 }) as ServiceDb;

    const started = Date.now();
    const err = (await migrateDb(db, { migrationsFolder: migrationsFolder(TWO_MIGRATIONS), lockTimeoutMs: 400 }).catch((e: unknown) => e)) as MigrationLockTimeoutError;
    const waited = Date.now() - started;

    expect(err).toBeInstanceOf(MigrationLockTimeoutError);
    expect(err.phase).toBe("migration-lock");
    expect(err.holders.map((h) => h.pid)).toEqual([pid]);
    expect(waited).toBeGreaterThanOrEqual(350);
    expect(waited).toBeLessThan(3_000);
    expect(await bookkeeping(name)).toEqual({ rows: 0, tables: [] });
    // Once the holder lets go, the next boot migrates normally.
    await holder.end({ timeout: 1 });
    expect((await migrateDb(db, { migrationsFolder: migrationsFolder(TWO_MIGRATIONS), lockTimeoutMs: 2_000 })).total).toBe(2);
    await closeDb(db);
  });

  it("a migration that waits on a table lock gives up after lockTimeoutMs too, rolls back, and frees the lock", async () => {
    const name = await freshDatabase();
    const folder1 = migrationsFolder({ "0001_first": "create table first_table (id int primary key);" });
    const db = createDb(withDb(DIRECT!, name), { max: 4 }) as ServiceDb;
    await migrateDb(db, { migrationsFolder: folder1 });
    const reader = postgres(withDb(DIRECT!, name), { max: 1, onnotice: () => undefined });
    // A long transaction from the old deployment holds a lock that ALTER TABLE has to wait for.
    const longRead = reader.begin(async (tx) => {
      await tx`select * from first_table`;
      await tx`select pg_sleep(2)`;
    });
    await new Promise((r) => setTimeout(r, 100));
    const folder2 = migrationsFolder({ "0001_first": "create table first_table (id int primary key);", "0002_alter": "alter table first_table add column name text;" });
    const err = (await migrateDb(db, { migrationsFolder: folder2, lockTimeoutMs: 300 }).catch((e: unknown) => e)) as MigrationLockTimeoutError;
    expect(err).toBeInstanceOf(MigrationLockTimeoutError);
    expect(err.phase).toBe("table-lock");
    expect((await bookkeeping(name)).rows).toBe(1);
    expect(await migrationLocks(name)).toEqual([]);
    await longRead;
    await reader.end({ timeout: 1 });
    expect(await migrateDb(db, { migrationsFolder: folder2 })).toEqual({ applied: ["0002_alter"], total: 2 });
    await closeDb(db);
  });

  it("a failing migration rolls the whole run back (bookkeeping included) and releases the lock", async () => {
    const name = await freshDatabase();
    const folder = migrationsFolder({ "0001_first": "create table first_table (id int primary key);", "0002_broken": "select 1/0;" });
    const db = createDb(withDb(DIRECT!, name), { max: 4 }) as ServiceDb;
    const err = await migrateDb(db, { migrationsFolder: folder }).catch((e: unknown) => e);
    expect(isMigrationLockTimeout(err)).toBe(false);
    expect(String((err as Error).cause ?? err)).toMatch(/division by zero/);
    expect(await bookkeeping(name)).toEqual({ rows: 0, tables: [] });
    expect(await migrationLocks(name)).toEqual([]);
    await closeDb(db);
  });

  for (const via of ["direct", "pooler"] as const) {
    const base = via === "direct" ? DIRECT : POOLER;
    it.skipIf(!base)(`two boots at once (${via}) serialize: one applies, the other waits and applies nothing`, async () => {
      const name = await freshDatabase();
      const folder = migrationsFolder(TWO_MIGRATIONS);
      const a = createDb(withDb(base!, name), { max: 4, prepare: false }) as ServiceDb;
      const b = createDb(withDb(base!, name), { max: 4, prepare: false }) as ServiceDb;
      const [ra, rb] = await Promise.all([migrateDb(a, { migrationsFolder: folder, lockTimeoutMs: 10_000 }), migrateDb(b, { migrationsFolder: folder, lockTimeoutMs: 10_000 })]);
      expect([ra.applied.length, rb.applied.length].sort()).toEqual([0, 2]);
      expect([ra.total, rb.total]).toEqual([2, 2]);
      expect(await bookkeeping(name)).toEqual({ rows: 2, tables: ["first_table", "second_table"] });
      expect(await migrationLocks(name)).toEqual([]);
      await Promise.all([closeDb(a), closeDb(b)]);
    });

    it.skipIf(!base)(`a process killed mid-migration (${via}) leaves no lock and nothing half-applied`, async () => {
      const name = await freshDatabase();
      const url = withDb(base!, name);
      const slow = migrationsFolder({ "0001_first": "create table first_table (id int primary key);\n--> statement-breakpoint\nselect pg_sleep(30);" });
      const child = spawn(process.execPath, ["--import", "tsx", "src/__tests__/fixtures/migrate-child.ts", url, slow], { cwd: PACKAGE_DIR, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString()));
      child.stderr.on("data", (d: Buffer) => (output += d.toString()));
      // Wait until the child holds the migration lock (it is then inside pg_sleep).
      const deadline = Date.now() + 20_000;
      while ((await migrationLocks(name)).length === 0) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`child never took the lock: ${output}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      child.kill("SIGKILL");
      await new Promise((r) => child.once("exit", r));

      const freed = Date.now();
      while ((await migrationLocks(name)).length > 0) {
        if (Date.now() - freed > 5_000) throw new Error("the lock outlived the killed process");
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(Date.now() - freed).toBeLessThan(5_000);
      expect(await bookkeeping(name)).toEqual({ rows: 0, tables: [] });
      // The next boot is not blocked.
      const db = createDb(url, { max: 2, prepare: false }) as ServiceDb;
      expect((await migrateDb(db, { migrationsFolder: migrationsFolder(TWO_MIGRATIONS), lockTimeoutMs: 2_000 })).total).toBe(2);
      await closeDb(db);
    }, 60_000);
  }

  it.skipIf(!POOLER)("through the pooler, while other clients churn its server connections, the lock never outlives a run", async () => {
    const name = await freshDatabase();
    const url = withDb(POOLER!, name);
    const others = Array.from({ length: 4 }, () => postgres(url, { max: 1, prepare: false, onnotice: () => undefined }));
    let busy = true;
    const churn = others.map(async (sql) => {
      while (busy) await sql.begin(async (tx) => tx`select pg_sleep(0.02)`).catch(() => undefined);
    });
    const folder = migrationsFolder(TWO_MIGRATIONS);
    for (let run = 0; run < 3; run += 1) {
      const db = createDb(url, { max: 10, prepare: false }) as ServiceDb;
      await migrateDb(db, { migrationsFolder: folder, lockTimeoutMs: 5_000 });
      expect(await migrationLocks(name)).toEqual([]);
      await closeDb(db);
    }
    busy = false;
    await Promise.all(churn);
    await Promise.all(others.map((sql) => sql.end({ timeout: 1 })));
    expect(await bookkeeping(name)).toEqual({ rows: 2, tables: ["first_table", "second_table"] });
  }, 60_000);
});
