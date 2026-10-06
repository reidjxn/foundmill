/** createDb/createServiceDb construction and env handling (no network: nothing is connected until a query runs). */
import { resetEnvCache } from "@founder-manager/shared";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, createDb, createServiceDb, MIGRATIONS_DIR } from "../index";

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
  it("exposes MIGRATIONS_DIR pointing at packages/db/migrations", () => {
    expect(MIGRATIONS_DIR.replace(/\\/g, "/")).toMatch(/packages\/db\/migrations$/);
  });
});
