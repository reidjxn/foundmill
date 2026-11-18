/**
 * The real-Postgres harness drops its test database by first ending the connections the cleanup role may end, then
 * `drop … with (force)`. A 42501 that still comes back (a connection of a role it may not end) is logged, not thrown;
 * any other error is thrown (it failed #285's CI after every test had passed, Nov 17, 2026).
 */
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { dropTestDatabase } from "../testing/postgres";

const stub = (dropError: unknown) => {
  const sent: string[] = [];
  const sql = {
    unsafe: async (text: string) => {
      sent.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (text.includes("drop database") && dropError) throw dropError;
      if (text.includes("select usename")) return [{ usename: "supabase_admin", application_name: "", state: "idle" }];
      return [];
    },
  } as unknown as postgres.Sql;
  return { sql, sent };
};

describe("dropTestDatabase", () => {
  it("ends the connections it may end before dropping", async () => {
    const { sql, sent } = stub(null);
    const warned: string[] = [];
    await dropTestDatabase(sql, "fm_rls_0a1b2c", (l) => warned.push(l));
    expect(sent).toEqual(["do $$ declare", "drop database if"]);
    expect(warned).toEqual([]);
  });

  it("logs a 42501 with the connections left open instead of failing the suite", async () => {
    const { sql } = stub(Object.assign(new Error("permission denied to terminate process"), { code: "42501" }));
    const warned: string[] = [];
    await dropTestDatabase(sql, "fm_rls_0a1b2c", (l) => warned.push(l));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("fm_rls_0a1b2c not dropped");
    expect(warned[0]).toContain("supabase_admin");
  });

  it("throws any other error, and refuses a name that is not a test database", async () => {
    await expect(dropTestDatabase(stub(Object.assign(new Error("boom"), { code: "XX000" })).sql, "fm_rls_0a1b2c", () => {})).rejects.toThrow("boom");
    await expect(dropTestDatabase(stub(null).sql, "postgres", () => {})).rejects.toThrow(/not a test database/);
  });
});
