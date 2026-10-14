/** createDb/createServiceDb construction and env handling (no network: nothing is connected until a query runs). */
import { resetEnvCache } from "@foundmill/shared";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, createDb, createServiceDb, MIGRATIONS_DIR, postgresConnection } from "../index";

afterEach(() => {
  delete process.env.DATABASE_URL;
  resetEnvCache();
});

describe("createDb", () => {
  it("builds a Drizzle database over postgres.js without connecting, and closes cleanly", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 1 });
    expect(db.$client).toBeDefined();
    expect(typeof db.transaction).toBe("function");
    await closeDb(db);
  });
  it("rejects an empty connection string", () => {
    expect(() => createDb("")).toThrow(/connection string/);
  });
  it("createServiceDb reads DATABASE_URL through loadEnv and fails loudly when unset", async () => {
    resetEnvCache();
    expect(() => createServiceDb()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = "postgres://user:pass@127.0.0.1:1/founder_manager";
    resetEnvCache();
    const db = createServiceDb({ max: 1 });
    await closeDb(db);
  });
  it("turns prepared statements off for every transaction pooler, and never sends client-only parameters to the server", async () => {
    // Supabase's shared pooler and its dedicated pooler (port 6543) run PgBouncer in transaction mode.
    expect(postgresConnection("postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require")).toEqual({ url: "postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require", transactionPooler: true });
    expect(postgresConnection("postgresql://u:p@db.abcd.supabase.co:6543/postgres").transactionPooler).toBe(true);
    expect(postgresConnection("postgresql://u:p@db.abcd.supabase.co:5432/postgres").transactionPooler).toBe(false);
    // A Prisma-style URL: `pgbouncer=true` marks the pooler but would reach Postgres as an unknown startup parameter.
    const prisma = postgresConnection("postgresql://u:p@db.abcd.supabase.co:5432/postgres?pgbouncer=true&connection_limit=1&sslmode=require");
    expect(prisma).toEqual({ url: "postgresql://u:p@db.abcd.supabase.co:5432/postgres?sslmode=require", transactionPooler: true });
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager?pgbouncer=true&sslmode=disable", { max: 1 });
    const options = (db.$client as unknown as { options: { prepare: boolean; connection: Record<string, unknown> } }).options;
    expect(options.prepare).toBe(false);
    expect(options.connection).not.toHaveProperty("pgbouncer");
    await closeDb(db);
  });
  it("exposes MIGRATIONS_DIR pointing at packages/db/migrations", () => {
    expect(MIGRATIONS_DIR.replace(/\\/g, "/")).toMatch(/packages\/db\/migrations$/);
  });
});
