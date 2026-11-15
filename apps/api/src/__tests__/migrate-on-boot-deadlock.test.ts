/**
 * migrateOnBoot when Postgres picks the migration as a deadlock victim (docs/DEPLOY.md §3 "Migrations at boot").
 *
 * During a redeploy the previous deployment keeps serving (railway.toml `overlapSeconds`, then `drainingSeconds`), so a
 * migration can deadlock with its queries. That is as transient as a lock wait: the api exits 1 and Railway restarts the
 * boot, instead of logging "migrations failed; serving anyway" and running the new code on the old schema.
 * packages/db's migrate-lock.test.ts reproduces the deadlock on a real Postgres; here migrateDb reports it.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@foundmill/db";
import { loadEnv } from "@foundmill/shared";
import { createApiDeps, type ApiDeps } from "../context";

const migrateDb = vi.fn();
vi.mock("@foundmill/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@foundmill/db")>()), migrateDb: (...args: unknown[]) => migrateDb(...args) }));

const { MigrationLockTimeoutError } = await import("@foundmill/db");
const { migrateOnBoot } = await import("../index");

function boot() {
  const lines: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => void lines.push({ level, obj: (obj ?? {}) as Record<string, unknown>, msg });
  const log = { info: at("info"), warn: at("warn"), error: at("error"), debug: () => undefined, child: () => log } as unknown as ApiDeps["log"];
  const env = loadEnv({ APP_ENV: "test", DATABASE_URL: "postgres://nobody@127.0.0.1:1/none", MIGRATION_LOCK_TIMEOUT_MS: "60000", TEMPORAL_ADDRESS: "127.0.0.1:1" });
  const deps = createApiDeps({ env, db: {} as Db, redis: null, log, recordings: null });
  return { deps, lines };
}

describe("migrateOnBoot and a deadlock", () => {
  it("exits 1 so the platform retries the boot, and says it was a deadlock", async () => {
    migrateDb.mockRejectedValueOnce(new MigrationLockTimeoutError(60_000, "deadlock", [], { cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }) }));
    const { deps, lines } = boot();
    const exit = vi.fn();
    expect(await migrateOnBoot(deps, { exit })).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    const line = lines.find((l) => l.level === "error");
    expect(line?.obj.phase).toBe("deadlock");
    expect(line?.msg).toMatch(/^migration aborted by a deadlock with another connection; exiting with code 1/);
    expect(lines.some((l) => /migrations failed; serving/.test(l.msg ?? ""))).toBe(false);
  });

  it("still serves on any other migration failure (a broken migration would only loop)", async () => {
    migrateDb.mockRejectedValueOnce(Object.assign(new Error("division by zero"), { code: "22012" }));
    const { deps, lines } = boot();
    const exit = vi.fn();
    expect(await migrateOnBoot(deps, { exit })).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === "error" && /migrations failed; serving/.test(l.msg ?? ""))).toBe(true);
  });
});
