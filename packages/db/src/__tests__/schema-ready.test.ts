/**
 * schemaReady: whether every migration in the folder is applied (WP-11 T2). The api's /health answers 503 while it is
 * not, so a deployment whose migration failed never takes traffic and the previous one keeps serving.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeDb, createDb } from "../client";
import { migrateDb, schemaReady } from "../migrator";

/** A drizzle-kit style folder: meta/_journal.json + NNNN_tag.sql, `when` increasing (as migrate-lock.test.ts builds). */
function migrationsFolder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-schema-ready-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const entries = Object.entries(files).map(([tag, body], idx) => {
    fs.writeFileSync(path.join(dir, `${tag}.sql`), body);
    return { idx, version: "7", when: 1_700_000_000_000 + idx * 1000, tag, breakpoints: true };
  });
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries }));
  return dir;
}

describe("schemaReady", () => {
  it("is behind after a migration fails, and ready once the folder applies", async () => {
    const db = createDb("pglite::memory:");
    try {
      const broken = migrationsFolder({ "0001_first": "create table first_table (id int primary key);", "0002_broken": "select 1/0;" });
      await expect(migrateDb(db, { migrationsFolder: broken })).rejects.toBeTruthy();
      const behind = await schemaReady(db, broken);
      expect(behind.expected).toBe(2);
      expect(behind.applied).toBeLessThan(2);
      expect(behind.ready).toBe(false);

      const fixed = migrationsFolder({ "0001_first": "create table first_table (id int primary key);", "0002_fixed": "alter table first_table add column name text;" });
      await migrateDb(db, { migrationsFolder: fixed });
      expect(await schemaReady(db, fixed)).toEqual({ applied: 2, expected: 2, ready: true });
    } finally {
      await closeDb(db);
    }
  });
});
