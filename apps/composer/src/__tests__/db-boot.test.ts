import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@foundmill/db";
import { PGLITE_UNAVAILABLE_HINT, prepareDb, type DbBootLogger } from "../db-boot";

interface Line {
  level: "info" | "error";
  obj: unknown;
  msg: string | undefined;
}

const capture = (): DbBootLogger & { lines: Line[] } => {
  const lines: Line[] = [];
  return { lines, info: (obj, msg) => lines.push({ level: "info", obj, msg }), error: (obj, msg) => lines.push({ level: "error", obj, msg }) };
};

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) await c();
});

describe("prepareDb", () => {
  it("boots an in-memory PGlite, applies every migration once and is idempotent", async () => {
    const db = createDb("pglite::memory:");
    cleanups.push(() => closeDb(db));
    const log = capture();
    const first = await prepareDb(db, log, { service: "test" });
    expect(first).toMatchObject({ ok: true, driver: "pglite", dir: null, reason: null });
    expect(first.applied).toBeGreaterThan(0);
    expect(log.lines).toEqual([{ level: "info", obj: expect.objectContaining({ driver: "pglite", applied: first.applied }), msg: "test: database ready" }]);

    const second = await prepareDb(db, log, { service: "test" });
    expect(second).toMatchObject({ ok: true, applied: 0 });
  }, 120_000);

  it("reports a directory held by another opener instead of throwing (one process per PGlite directory)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "foundmill-db-boot-"));
    const owner = createDb(`pglite:${dir}`);
    cleanups.push(async () => {
      await closeDb(owner);
      rmSync(dir, { recursive: true, force: true });
    });
    await owner.$client.waitReady;

    const second = createDb(`pglite:${dir}`);
    const log = capture();
    const readiness = await prepareDb(second, log, { service: "test" });
    expect(readiness.ok).toBe(false);
    expect(readiness.driver).toBe("pglite");
    expect(readiness.dir).toBe(dir);
    expect(readiness.reason).toMatch(/already open in process/);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]!.level).toBe("error");
    expect(log.lines[0]!.msg).toContain("serving without it");
    expect(log.lines[0]!.msg).toContain(PGLITE_UNAVAILABLE_HINT);
    await closeDb(second).catch(() => undefined);
  }, 120_000);

  it("probes Postgres with a bounded timeout and never throws", async () => {
    const db = createDb("postgres://invalid:invalid@127.0.0.1:1/invalid", { max: 1 });
    cleanups.push(() => closeDb(db));
    const log = capture();
    const readiness = await prepareDb(db, log, { service: "test", probeTimeoutMs: 2_000 });
    expect(readiness).toMatchObject({ ok: false, driver: "postgres", applied: 0 });
    expect(typeof readiness.reason).toBe("string");
    expect(log.lines[0]).toMatchObject({ level: "error", msg: expect.stringContaining("database unreachable") });
  }, 30_000);
});
