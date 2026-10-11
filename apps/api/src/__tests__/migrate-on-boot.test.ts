/**
 * migrateOnBoot against real Postgres (docs/DEPLOY.md §3 "Migrations at boot").
 *
 * Production reaches Supabase through its transaction pooler (port 6543): every statement outside a transaction may
 * run on a different server connection, so a session-level `pg_advisory_lock` taken by one statement and released by
 * another can stay held on a pooled connection forever, and the next boot waits on it before "api listening".
 *
 * These cases need a Postgres and, for the pooler case, a PgBouncer in `pool_mode = transaction` in front of it:
 *   FM_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:55432/postgres   (direct; used to create databases and inspect pg_locks)
 *   FM_TEST_POOLER_URL=postgres://postgres@127.0.0.1:56543/postgres     (PgBouncer, transaction mode, optional)
 * Without them only the no-database case runs.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, closeDb, type Db, type ServiceDb } from "@foundmill/db";
import { loadEnv } from "@foundmill/shared";
import { createApiDeps, type ApiDeps } from "../context";
import { migrateOnBoot } from "../index";

const DIRECT = process.env.FM_TEST_POSTGRES_URL;
const POOLER = process.env.FM_TEST_POOLER_URL;

interface LogLine {
  level: "info" | "warn" | "error";
  obj: Record<string, unknown>;
  msg?: string;
}

function captureLog() {
  const lines: LogLine[] = [];
  const at = (level: LogLine["level"]) => (obj: unknown, msg?: string) => void lines.push({ level, obj: (obj ?? {}) as Record<string, unknown>, msg });
  const log = { info: at("info"), warn: at("warn"), error: at("error"), debug: () => undefined, child: () => log } as unknown as ApiDeps["log"];
  return { log, lines };
}

type Sql = ServiceDb["$client"];
/** A bare postgres.js client (apps/api reaches postgres.js only through packages/db). */
const postgres = (url: string, options: { max: number; prepare?: boolean }): Sql => (createDb(url, { max: options.max, prepare: options.prepare }) as ServiceDb).$client;

const withDb = (url: string, name: string): string => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

function bootDeps(url: string, db: Db, lockTimeoutMs: number) {
  const { log, lines } = captureLog();
  const env = loadEnv({ APP_ENV: "test", DATABASE_URL: url, MIGRATION_LOCK_TIMEOUT_MS: String(lockTimeoutMs), TEMPORAL_ADDRESS: "127.0.0.1:1" });
  const deps = createApiDeps({ env, db, redis: null, log, recordings: null });
  return { deps, lines };
}

/** Advisory locks in this database in the migration namespace: the current (7461, 1) and the old bigint key 7461. */
async function migrationLocks(admin: Sql, database: string) {
  return admin<{ pid: number; classid: number; objid: number; objsubid: number }[]>`
    select l.pid, l.classid::int, l.objid::int, l.objsubid::int
    from pg_locks l join pg_database d on d.oid = l.database
    where l.locktype = 'advisory' and l.granted and d.datname = ${database}
      and ((l.classid = 7461 and l.objid = 1 and l.objsubid = 2) or (l.classid = 0 and l.objid = 7461 and l.objsubid = 1))`;
}

describe("migrateOnBoot without a reachable database", () => {
  it("logs the failure and keeps serving: an unreachable database is not a reason to exit", async () => {
    const url = "postgres://nobody@127.0.0.1:1/none";
    const db = createDb(url, { max: 1 }) as unknown as Db;
    const { deps, lines } = bootDeps(url, db, 500);
    const exit = vi.fn();
    expect(await migrateOnBoot(deps, { exit })).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === "error" && /migrations failed; serving anyway/.test(l.msg ?? ""))).toBe(true);
    await closeDb(db);
  });
});

describe.skipIf(!DIRECT)("migrateOnBoot on Postgres", () => {
  let admin: Sql;
  const created: string[] = [];

  beforeAll(async () => {
    admin = postgres(DIRECT!, { max: 2 });
  });

  afterAll(async () => {
    for (const name of created) await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => undefined);
    await admin.end({ timeout: 5 });
  });

  async function freshDatabase(): Promise<string> {
    const name = `fm_boot_${randomBytes(4).toString("hex")}`;
    await admin.unsafe(`create database ${name}`);
    created.push(name);
    return name;
  }

  it("a boot behind a held migration lock logs why and exits 1 within the lock timeout instead of hanging", async () => {
    const name = await freshDatabase();
    const holder = postgres(withDb(DIRECT!, name), { max: 1 });
    // Hold both keys: the current transaction-scoped one and the session-level key the old boot used.
    await holder`select pg_advisory_lock(7461, 1), pg_advisory_lock(7461)`;
    const holderPid = (await holder<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]!.pid;

    const url = withDb(POOLER ?? DIRECT!, name);
    const db = createDb(url, { max: 4, prepare: false }) as unknown as Db;
    const { deps, lines } = bootDeps(url, db, 700);
    const exit = vi.fn();
    const started = Date.now();
    const migrated = await migrateOnBoot(deps, { exit });
    const waited = Date.now() - started;

    expect(migrated).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(waited).toBeGreaterThanOrEqual(600);
    expect(waited).toBeLessThan(5_000);
    const line = lines.find((l) => l.level === "error" && /migration lock/.test(l.msg ?? ""));
    expect(line?.msg).toMatch(/exiting with code 1/);
    expect(line?.obj).toMatchObject({ lockTimeoutMs: 700 });
    expect((line?.obj.holders as { pid: number }[] | undefined)?.map((h) => h.pid)).toContain(holderPid);

    await holder.end({ timeout: 1 });
    await closeDb(db);
  }, 15_000);

  it.skipIf(!POOLER)("through a transaction pooler under concurrent traffic, no migration lock outlives the boot", async () => {
    const name = await freshDatabase();
    const url = withDb(POOLER!, name);
    // Other clients keep the pooler's server connections churning, as the five other services and the old deployment do.
    const others = Array.from({ length: 4 }, () => postgres(url, { max: 1, prepare: false }));
    let busy = true;
    const churn = others.map(async (sql) => {
      while (busy) await sql.begin(async (tx) => tx`select pg_sleep(0.02)`).catch(() => undefined);
    });

    for (let boot = 0; boot < 3; boot += 1) {
      const db = createDb(url, { max: 10, prepare: false }) as unknown as Db;
      const { deps } = bootDeps(url, db, 2_000);
      const exit = vi.fn();
      await migrateOnBoot(deps, { exit }); // the real migrations need pgvector, which a bare Postgres may lack; the lock is what matters
      expect(exit).not.toHaveBeenCalled();
      await closeDb(db);
    }
    busy = false;
    await Promise.all(churn);
    await Promise.all(others.map((sql) => sql.end({ timeout: 1 })));

    expect(await migrationLocks(admin, name)).toEqual([]);
  }, 60_000);
});
