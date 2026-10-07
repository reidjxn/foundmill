/**
 * createDb("pglite:…") as the local database driver (docs/DECISIONS.md "PGlite as the local database driver"):
 * URL forms, lazy boot, migrateDb on PGlite, withRls tenancy, file-backed persistence shared between the seed
 * target and the services' URL form, the apps/api boot migrator path, and closeDb.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate as postgresJsMigrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, withRls, type Db, type PgliteDb, type ServiceDb } from "../client";
import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, readMigrations } from "../migrations";
import { appliedMigrationCount, migrateDb } from "../migrator";
import { DEFAULT_PGLITE_DIR, PGLITE_LOCK_FILE, findWorkspaceRoot, isPgliteDb, isPgliteUrl, parsePgliteUrl, pgliteUrl, resolvePgliteDir } from "../pglite";
import { repos } from "../repos";
import * as s from "../schema";
import { demoBusinessesPresent, NORTHWIND_BUSINESS_ID, seedDemo } from "../seed/index";
import { openLocalPglite } from "../seed/pglite-target";
import { resolvePgliteSeedDir } from "../seed";
import { unwrapDbError } from "../testing/pglite";

const MIGRATION_TAGS = readMigrations().map((m) => m.tag);
const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
/** drizzle wraps the Postgres error ("Failed query: …"); assert on Postgres' own message. */
const denied = <T>(p: Promise<T>) => p.catch((err: unknown) => Promise.reject(unwrapDbError(err)));

const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundmill-pglite-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function createUser(db: Db, email: string): Promise<string> {
  const [row] = await rows<{ id: string }>(db, sql`insert into auth.users (email) values (${email}) returning id`);
  return row!.id;
}

async function createBusiness(db: Db, slug: string, ownerId: string): Promise<string> {
  const [b] = await db.insert(s.businesses).values({ name: slug, slug, createdBy: ownerId, archetype: "b2b_saas" }).returning({ id: s.businesses.id });
  await db.insert(s.memberships).values({ businessId: b!.id, userId: ownerId, role: "owner" });
  return b!.id;
}

describe("pglite URLs", () => {
  const root = findWorkspaceRoot();

  it("recognises pglite: URLs and nothing else", () => {
    expect(isPgliteUrl("pglite::memory:")).toBe(true);
    expect(isPgliteUrl("pglite:./.pglite/dev")).toBe(true);
    expect(isPgliteUrl("postgres://u:p@h:5432/db")).toBe(false);
    expect(parsePgliteUrl("postgres://u:p@h:5432/db")).toBeNull();
  });

  it("maps the memory spellings to no data directory", () => {
    for (const url of ["pglite::memory:", "pglite:memory://", "pglite:"]) expect(parsePgliteUrl(url), url).toEqual({});
  });

  it("resolves a relative directory against the workspace root, whatever the cwd", () => {
    expect(fs.existsSync(path.join(root, "pnpm-workspace.yaml"))).toBe(true);
    const fromPackage = parsePgliteUrl("pglite:./.pglite/dev", path.join(root, "packages", "db"));
    const fromApp = parsePgliteUrl("pglite:./.pglite/dev", path.join(root, "apps", "api"));
    expect(fromPackage).toEqual({ dataDir: path.join(root, ".pglite", "dev") });
    expect(fromApp).toEqual(fromPackage);
    expect(parsePgliteUrl("pglite:///abs/dir")).toEqual({ dataDir: "/abs/dir" });
    expect(parsePgliteUrl("pglite:/abs/dir")).toEqual({ dataDir: "/abs/dir" });
    expect(resolvePgliteDir(DEFAULT_PGLITE_DIR, path.join(root, "apps", "web"))).toBe(path.join(root, ".pglite", "dev"));
  });

  it("pgliteUrl is the inverse of parsePgliteUrl", () => {
    expect(parsePgliteUrl(pgliteUrl())).toEqual({});
    expect(parsePgliteUrl(pgliteUrl("/abs/dir"))).toEqual({ dataDir: "/abs/dir" });
    expect(parsePgliteUrl(pgliteUrl("./.pglite/dev"))).toEqual({ dataDir: path.join(root, ".pglite", "dev") });
  });

  it("the seed picks the same directory from DATABASE_URL, SEED_TARGET or the default", () => {
    const dev = path.join(root, ".pglite", "dev");
    expect(resolvePgliteSeedDir({ DATABASE_URL: "pglite:./.pglite/dev" })).toBe(dev);
    expect(resolvePgliteSeedDir({ SEED_TARGET: "pglite" })).toBe(DEFAULT_PGLITE_DIR);
    expect(resolvePgliteSeedDir({})).toBe(DEFAULT_PGLITE_DIR);
    expect(resolvePgliteSeedDir({ SEED_TARGET: "pglite", SEED_PGLITE_DIR: "/elsewhere" })).toBe("/elsewhere");
    expect(resolvePgliteSeedDir({ DATABASE_URL: "postgres://u:p@h:5432/db" })).toBeNull();
    expect(resolvePgliteSeedDir({ DATABASE_URL: "postgres://u:p@h:5432/db", SEED_TARGET: "pglite" })).toBe(DEFAULT_PGLITE_DIR);
    expect(() => resolvePgliteSeedDir({ DATABASE_URL: "pglite::memory:" })).toThrow(/file-backed/);
  });
});

describe("createDb over an in-memory PGlite", () => {
  let db: PgliteDb;
  beforeAll(() => {
    db = createDb("pglite::memory:");
  });
  afterAll(() => closeDb(db));

  it("returns synchronously, boots lazily and has the Supabase roles and auth stub before any migration", async () => {
    expect(isPgliteDb(db)).toBe(true);
    expect(db.$client.ready).toBe(false);
    const roles = await rows<{ rolname: string }>(db, sql`select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`);
    expect(roles.map((r) => r.rolname)).toEqual(["anon", "authenticated", "service_role"]);
    expect(db.$client.ready).toBe(true);
    const [uid] = await rows<{ uid: string | null }>(db, sql`select auth.uid() as uid`);
    expect(uid!.uid).toBeNull();
    expect(await appliedMigrationCount(db)).toBe(0);
  });

  it("migrateDb applies every migration in journal order into drizzle's bookkeeping table, then nothing twice", async () => {
    const first = await migrateDb(db);
    expect(first.applied).toEqual(MIGRATION_TAGS);
    expect(first.total).toBe(MIGRATION_TAGS.length);
    const second = await migrateDb(db);
    expect(second).toEqual({ applied: [], total: MIGRATION_TAGS.length });
    const [ext] = await rows<{ n: number }>(db, sql`select count(*)::int as n from pg_extension where extname in ('pg_trgm','vector')`);
    expect(ext!.n).toBe(2);
    const tables = await rows<{ n: number }>(db, sql`select count(*)::int as n from pg_tables where schemaname = 'public'`);
    expect(tables[0]!.n).toBeGreaterThan(60);
  });

  it("withRls sets the role and claims per transaction and the connection returns to superuser afterwards", async () => {
    const userId = await createUser(db, "rls-role@test.local");
    type Seen = { role: string; uid: string; jwt_role: string; email: string };
    const inside = await withRls(db, { userId, claims: { email: "rls-role@test.local" } }, async (tx) => {
      const res = await tx.execute(
        sql`select current_user as role, auth.uid()::text as uid, auth.role() as jwt_role, current_setting('request.jwt.claims', true)::jsonb ->> 'email' as email`,
      );
      return (res as unknown as { rows: Seen[] }).rows[0]!;
    });
    expect(inside).toEqual({ role: "authenticated", uid: userId, jwt_role: "authenticated", email: "rls-role@test.local" });
    const [after] = await rows<{ role: string }>(db, sql`select current_user as role`);
    expect(after!.role).toBe("postgres");
  });

  it("withRls denies cross-tenant reads and writes", async () => {
    const ownerA = await createUser(db, "a-owner@test.local");
    const ownerB = await createUser(db, "b-owner@test.local");
    const stranger = await createUser(db, "stranger@test.local");
    const bizA = await createBusiness(db, "tenant-a", ownerA);
    const bizB = await createBusiness(db, "tenant-b", ownerB);

    const visible = (userId: string) => withRls(db, { userId }, (tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect((await visible(ownerA)).map((r) => r.id)).toEqual([bizA]);
    expect((await visible(ownerB)).map((r) => r.id)).toEqual([bizB]);
    expect(await visible(stranger)).toEqual([]);
    // anon has no grant on business tables at all (the migrations grant to authenticated and service_role only).
    await expect(denied(withRls(db, { userId: stranger, role: "anon" }, (tx) => tx.select({ id: s.businesses.id }).from(s.businesses)))).rejects.toThrow(/permission denied/);

    // A's owner cannot read B's memberships nor plant a department in B.
    expect(await withRls(db, { userId: ownerA }, (tx) => tx.select().from(s.memberships).where(eq(s.memberships.businessId, bizB)))).toEqual([]);
    await expect(denied(withRls(db, { userId: ownerA }, (tx) => tx.insert(s.departments).values({ businessId: bizB, name: "Intruder", slug: "intruder" })))).rejects.toThrow(
      /row-level security/,
    );
    await withRls(db, { userId: ownerA }, (tx) => tx.insert(s.departments).values({ businessId: bizA, name: "Home", slug: "home" }));
    expect(await withRls(db, { userId: ownerB }, (tx) => tx.select().from(s.departments).where(eq(s.departments.businessId, bizA)))).toEqual([]);
    // service_role bypasses RLS (what the workers use).
    const all = await withRls(db, { userId: ownerA, role: "service_role" }, (tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(all.map((r) => r.id).sort()).toEqual([bizA, bizB].sort());
    // Repositories run unchanged over the PGlite db.
    expect((await repos.businesses.get(db, bizA))?.slug).toBe("tenant-a");
  });

  it("the apps/api boot path (advisory lock + drizzle's postgres-js migrator) works on the PGlite db", async () => {
    // apps/api casts its Db to the postgres-js migrator's parameter type the same way.
    const api = db as unknown as ServiceDb;
    await api.execute(sql`select pg_advisory_lock(7461)`);
    try {
      await postgresJsMigrate(api, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
    } finally {
      await api.execute(sql`select pg_advisory_unlock(7461)`);
    }
    expect(await appliedMigrationCount(db)).toBe(MIGRATION_TAGS.length);
  });
});

describe("file-backed PGlite shared between the seed target and createDb", () => {
  const open: PgliteDb[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) await closeDb(db);
  });

  it("openLocalPglite migrates a fresh directory once; createDb(pglite:<dir>) then reads the same data", async () => {
    const dir = tmpDir();
    const local = await openLocalPglite(dir);
    expect(local.dataDir).toBe(dir);
    expect(local.appliedMigrations).toEqual(MIGRATION_TAGS);
    expect(local.hasVector).toBe(true);
    const owner = await createUser(local.db, "persist@test.local");
    const bizId = await createBusiness(local.db, "persisted", owner);
    await local.close();

    const db = createDb(pgliteUrl(dir));
    open.push(db);
    expect(db.$client.dataDir).toBe(dir);
    expect(await migrateDb(db)).toEqual({ applied: [], total: MIGRATION_TAGS.length });
    expect((await repos.businesses.get(db, bizId))?.slug).toBe("persisted");
    const mine = await withRls(db, { userId: owner }, (tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(mine.map((r) => r.id)).toEqual([bizId]);

    // Re-opening through the seed target applies nothing more and sees the row too.
    await closeDb(open.pop()!);
    const again = await openLocalPglite(dir);
    expect(again.appliedMigrations).toEqual([]);
    expect(await again.db.select({ id: s.businesses.id }).from(s.businesses).where(eq(s.businesses.id, bizId))).toHaveLength(1);
    await again.close();
  });

  it("refuses a second opener while the directory is held, and takes over a stale lock", async () => {
    const dir = tmpDir();
    const holder = createDb(pgliteUrl(dir));
    open.push(holder);
    await rows(holder, sql`select 1`);
    expect(fs.existsSync(path.join(dir, PGLITE_LOCK_FILE))).toBe(true);

    const second = createDb(pgliteUrl(dir));
    await expect(denied(rows(second, sql`select 1`))).rejects.toThrow(/already open in process/);
    await closeDb(second);
    expect(fs.existsSync(path.join(dir, PGLITE_LOCK_FILE)), "a refused opener never removes the holder's lock").toBe(true);

    await closeDb(open.pop()!);
    expect(fs.existsSync(path.join(dir, PGLITE_LOCK_FILE))).toBe(false);

    // A lock left behind by a process that no longer exists does not block anyone.
    fs.writeFileSync(path.join(dir, PGLITE_LOCK_FILE), JSON.stringify({ pid: 2 ** 22 - 1, openedAt: "2026-01-01T00:00:00.000Z" }));
    const after = createDb(pgliteUrl(dir));
    open.push(after);
    expect(await rows<{ one: number }>(after, sql`select 1 as one`)).toEqual([{ one: 1 }]);
  });

  it("the demo seed written through the URL form is readable by a second open of the directory", async () => {
    const dir = tmpDir();
    const seedDb = createDb(pgliteUrl(dir));
    await migrateDb(seedDb);
    const result = await seedDemo(seedDb, { today: new Date("2026-10-07T12:00:00.000Z"), days: 30, volumeScale: 0.02 });
    expect(result.businesses.northwind.id).toBe(NORTHWIND_BUSINESS_ID);
    await closeDb(seedDb);

    const db = createDb(pgliteUrl(dir));
    open.push(db);
    expect(await demoBusinessesPresent(db)).toBe(true);
    const northwind = await repos.businesses.get(db, NORTHWIND_BUSINESS_ID);
    expect(northwind?.slug).toBe(result.businesses.northwind.slug);
    const visible = await withRls(db, { userId: result.owner.userId }, (tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(visible.map((r) => r.id).sort()).toEqual([result.businesses.northwind.id, result.businesses.ledgerly.id].sort());
    expect((await repos.journeys.dailyRange(db, NORTHWIND_BUSINESS_ID, {})).length).toBeGreaterThan(0);
    expect((await repos.inbox.list(db, NORTHWIND_BUSINESS_ID, {})).items.length).toBeGreaterThan(0);
  }, 300_000);
});

describe("closeDb", () => {
  it("closes a PGlite db, tolerates a second close, and the postgres.js spelling end() works too", async () => {
    const db = createDb("pglite::memory:");
    await rows(db, sql`select 1`);
    await closeDb(db);
    expect(db.$client.closed).toBe(true);
    await closeDb(db);
    await expect(rows(db, sql`select 1`)).rejects.toThrow();

    const other = createDb("pglite::memory:");
    await rows(other, sql`select 1`);
    await other.$client.end({ timeout: 5 });
    expect(other.$client.closed).toBe(true);
  });

  it("closes a db whose boot is still in flight, and a failed boot surfaces on the first query", async () => {
    const pending = createDb("pglite::memory:");
    await closeDb(pending);
    expect(pending.$client.closed).toBe(true);

    const file = path.join(tmpDir(), "not-a-dir");
    fs.writeFileSync(file, "x");
    const broken = createDb(pgliteUrl(path.join(file, "db")));
    await expect(rows(broken, sql`select 1`)).rejects.toThrow();
    await closeDb(broken);
  });

  it("still ends a postgres.js pool without connecting", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 1 });
    expect(isPgliteDb(db)).toBe(false);
    await closeDb(db);
  });
});
