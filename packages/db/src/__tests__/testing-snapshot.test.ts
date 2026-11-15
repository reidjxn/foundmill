/**
 * The migrated PGlite snapshot (WP-01 T3): createTestDb loads one dump of a fully migrated database instead of replaying
 * every migration in every test file. These cases hold the snapshot to the replay it replaces.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { snapshotKey } from "../testing/snapshot";

type Row = Record<string, unknown>;
const rows = async (h: TestHarness, q: ReturnType<typeof sql>) => (await h.db.execute(q)) as unknown as { rows: Row[] };

const SHAPE = [
  sql`select table_schema, table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema in ('public', 'auth') order by 1, 2, 3`,
  sql`select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies order by 1, 2, 3`,
  sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`,
];

describe.skipIf(Boolean(process.env.RLS_TEST_DATABASE_URL))("createTestDb from the migrated snapshot", () => {
  let fromSnapshot: TestHarness;
  let fromReplay: TestHarness;

  beforeAll(async () => {
    fromSnapshot = await createTestDb();
    // Passing the migrations keeps today's path: every file applied in turn.
    fromReplay = await createTestDb({ migrations: readMigrations() });
  }, 300_000);

  afterAll(async () => {
    await fromSnapshot?.close();
    await fromReplay?.close();
  });

  it("has the same columns, policies and row-level security as a fresh replay", async () => {
    for (const q of SHAPE) expect((await rows(fromSnapshot, q)).rows).toEqual((await rows(fromReplay, q)).rows);
  });

  it("reports every migration of the journal as applied", () => {
    const tags = readMigrations().map((m) => m.tag);
    expect(fromSnapshot.appliedMigrations).toEqual(tags);
    expect(fromReplay.appliedMigrations).toEqual(tags);
  });

  it("gives every harness its own database: a row written in one is absent from the next", async () => {
    const id = await fromSnapshot.createUser("snapshot-isolation@test.local");
    expect(id).toBeTruthy();
    const next = await createTestDb();
    try {
      const found = await rows(next, sql`select count(*)::int as n from auth.users where email = 'snapshot-isolation@test.local'`);
      expect(found.rows[0]?.n).toBe(0);
    } finally {
      await next.close();
    }
  });
});

describe("snapshotKey", () => {
  it("changes when one migration's SQL changes, and when pgvector is or is not loaded", () => {
    const migrations = readMigrations();
    const key = snapshotKey(migrations, true);
    expect(snapshotKey(migrations, true)).toBe(key);
    const edited = migrations.map((m, i) => (i === migrations.length - 1 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    expect(snapshotKey(edited, true)).not.toBe(key);
    expect(snapshotKey(migrations, false)).not.toBe(key);
  });
});
