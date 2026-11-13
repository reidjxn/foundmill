/**
 * The test harness on a real Postgres (src/testing/postgres.ts). The unit cases always run; the rest run only when
 * RLS_TEST_DATABASE_URL names a server (CI on PGlite skips them), e.g.
 *   RLS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5441/postgres pnpm --filter @foundmill/db test:rls
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { realPostgresUrl, withDatabase } from "../testing/postgres";

describe("RLS_TEST_DATABASE_URL", () => {
  it("is read from the environment, blank meaning unset", () => {
    expect(realPostgresUrl({ RLS_TEST_DATABASE_URL: "postgres://u@127.0.0.1:5432/db" })).toBe("postgres://u@127.0.0.1:5432/db");
    expect(realPostgresUrl({ RLS_TEST_DATABASE_URL: "postgres://u@localhost/db" })).toBe("postgres://u@localhost/db");
    expect(() => realPostgresUrl({ RLS_TEST_DATABASE_URL: "postgres://u@db.example.supabase.co:5432/postgres" })).toThrow(/not this machine/);
    expect(realPostgresUrl({ RLS_TEST_DATABASE_URL: "postgres://u@h:5432/db", RLS_TEST_ALLOW_REMOTE: "1" })).toBe("postgres://u@h:5432/db");
    expect(realPostgresUrl({ RLS_TEST_DATABASE_URL: "  " })).toBeUndefined();
    expect(realPostgresUrl({})).toBeUndefined();
  });

  it("names the fresh database in place of the URL's own, keeping everything else", () => {
    expect(withDatabase("postgres://postgres:pw@127.0.0.1:5441/postgres?sslmode=disable", "fm_rls_ab12")).toBe(
      "postgres://postgres:pw@127.0.0.1:5441/fm_rls_ab12?sslmode=disable",
    );
  });

  it("is passed over when a suite asks for PGlite", async () => {
    const h = await createTestDb({ pglite: true, migrations: readMigrations().slice(0, 1) });
    try {
      expect(h.driver).toBe("pglite");
      expect(h.database).toBeUndefined();
    } finally {
      await h.close();
    }
  });
});

const url = realPostgresUrl();

describe.skipIf(!url)("createTestDb on a real Postgres", () => {
  let h: TestHarness;
  let userId: string;
  const admin = () => postgres(url!, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    h = await createTestDb();
    userId = await h.createUser("real-pg@test.local");
  });
  afterAll(async () => {
    await h?.close();
  });

  it("runs on a fresh database of that server with every migration applied", async () => {
    expect(h.driver).toBe("postgres");
    expect(h.database).toMatch(/^fm_rls_[0-9a-f]{12}$/);
    expect(h.appliedMigrations).toEqual(readMigrations().map((m) => m.tag));
    const [row] = (await h.db.execute(sql`select current_database() as db, current_user as role`)).rows as { db: string; role: string }[];
    expect(row).toEqual({ db: h.database, role: new URL(url!).username || row!.role });
  });

  it("switches role and claims as withRls does for apps/api", async () => {
    const q = sql`select current_user as role, auth.uid()::text as uid, auth.role() as claim_role`;
    expect(await h.asUser(userId).execute(q)).toEqual([{ role: "authenticated", uid: userId, claim_role: "authenticated" }]);
    expect(await h.service().execute(q)).toEqual([{ role: "service_role", uid: "00000000-0000-0000-0000-000000000000", claim_role: "service_role" }]);
    expect(await h.anon().execute(q)).toEqual([{ role: "anon", uid: null, claim_role: "anon" }]);
    // The role ends with the transaction: the owner connection is itself again.
    expect((await h.db.execute(sql`select current_user as role`)).rows).toEqual([{ role: new URL(url!).username || expect.any(String) }]);
  });

  it("answers PGlite's result shapes: execute().rows, pg.query and pg.exec", async () => {
    const res = await h.db.execute(sql`select 1::int as n`);
    expect(res.rows).toEqual([{ n: 1 }]);
    const inTx = await h.asUser(userId).run(async (tx) => ((await tx.execute(sql`select 2::int as n`)) as unknown as { rows: unknown[] }).rows);
    expect(inTx).toEqual([{ n: 2 }]);
    const q = await h.pg.query<{ n: number; at: Date }>(`select $1::int as n, now() as at`, [3]);
    expect(q.rows[0]?.n).toBe(3);
    expect(q.rows[0]?.at).toBeInstanceOf(Date);
    const updated = await h.pg.query(`update auth.users set email = email where id = $1`, [userId]);
    expect(updated.affectedRows).toBe(1);
    const parts = await h.pg.exec(`select 1 as a; select 2 as b`);
    expect(parts.map((p) => p.rows)).toEqual([[{ a: 1 }], [{ b: 2 }]]);
  });

  it("rethrows the Postgres message from a refused statement", async () => {
    await expect(h.anon().execute(sql`select * from businesses`)).rejects.toThrow(/permission denied for table businesses/);
  });

  it("drops its database on close", async () => {
    const other = await createTestDb({ migrations: readMigrations().slice(0, 1) });
    const name = other.database!;
    const a = admin();
    try {
      expect(await a`select 1 from pg_database where datname = ${name}`).toHaveLength(1);
      await other.close();
      expect(await a`select 1 from pg_database where datname = ${name}`).toHaveLength(0);
    } finally {
      await a.end({ timeout: 5 });
    }
  });
});
