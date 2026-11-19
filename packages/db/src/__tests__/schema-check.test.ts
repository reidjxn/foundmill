import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSchema, journalEntries, publicTables, type Run } from "../schema-check";
import { createTestDb, type TestHarness } from "../testing/pglite";

describe("schema-check (WP-11 T8)", () => {
  let h: TestHarness;
  let run: Run;
  beforeAll(async () => {
    h = await createTestDb({ pglite: true });
    run = async (text) => (await h.pg.query<Record<string, unknown>>(text)).rows;
  });
  afterAll(() => h.close());

  it("finds nothing on a database migrated from this checkout", async () => {
    const report = await checkSchema(run, await publicTables(run));
    expect(report.migrations.journal).toBe(journalEntries());
    expect(report.tables).toContain("businesses");
    expect(report.missingTables).toEqual([]);
    expect(report.backups).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it("names a missing table, a backup schema and what the backup still holds", async () => {
    const reference = [...(await publicTables(run)), "a_table_production_lacks"];
    await h.pg.exec(`
      create schema bak_test;
      create table bak_test.businesses (id uuid);
      insert into bak_test.businesses values ('00000000-0000-4000-8000-0000000000b1');
      create table bak_test.credentials (id int);
      insert into bak_test.credentials values (1), (2);
      create schema "bak_Odd";`);
    const report = await checkSchema(run, reference);
    expect(report.missingTables).toEqual(["a_table_production_lacks"]);
    expect(report.backups).toHaveLength(1);
    expect(report.backups[0]).toMatchObject({ name: "bak_test", tables: 2, goneBusinesses: 1, credentials: 2, foreignKeysFromOutside: [], viewsOutside: [] });
    expect(report.problems.join("\n")).toMatch(/missing tables: a_table_production_lacks[\s\S]*"bak_Odd" has an unexpected name[\s\S]*backup schema bak_test/);
  });

  it("works inside a read-only transaction", async () => {
    await h.pg.exec("begin transaction read only");
    try {
      await expect(checkSchema(run, null)).resolves.toMatchObject({ missingTables: null });
      await expect(h.pg.exec("create table public.should_fail (id int)")).rejects.toThrow(/read-only/);
    } finally {
      await h.pg.exec("rollback");
    }
  });
});
