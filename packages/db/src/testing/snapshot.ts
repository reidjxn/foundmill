/**
 * A migrated PGlite database, dumped once and loaded by every test harness (WP-01 T3; audit a10 EH-04). About 300 test
 * files used to replay every migration (11 to 13 s each); they now load this dump. The dump is keyed by everything that
 * shapes it (the bootstrap SQL, each migration's tag and SQL, the PGlite version and whether pgvector is loaded), so a
 * changed migration builds a new one. Tests and CI only: no service reads it.
 *
 *   FM_PGLITE_SNAPSHOT_DIR  where the dumps live (default: <os tmpdir>/foundmill-pglite)
 *   FM_PGLITE_SNAPSHOT=0    replay the migrations as before
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readMigrations, type MigrationFile } from "../migrations";
import { bootPglite, loadVectorExtension, PGLITE_BOOTSTRAP_SQL, rewriteForMissingVector } from "../pglite";

export interface MigratedSnapshot {
  bytes: Uint8Array<ArrayBuffer>;
  tags: string[];
  hasVector: boolean;
}

function pgliteVersion(): string {
  const require = createRequire(import.meta.url);
  let dir = path.dirname(require.resolve("@electric-sql/pglite"));
  for (;;) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@electric-sql/pglite") return pkg.version ?? "unknown";
    }
    const parent = path.dirname(dir);
    if (parent === dir) return "unknown";
    dir = parent;
  }
}

export function snapshotKey(migrations: MigrationFile[], hasVector: boolean): string {
  const hash = crypto.createHash("sha256");
  hash.update(PGLITE_BOOTSTRAP_SQL);
  for (const m of migrations) hash.update(`\0${m.tag}\0${m.sql}`);
  hash.update(`\0pglite ${pgliteVersion()}\0vector ${hasVector}`);
  return hash.digest("hex").slice(0, 32);
}

export function snapshotDir(): string {
  return process.env.FM_PGLITE_SNAPSHOT_DIR || path.join(os.tmpdir(), "foundmill-pglite");
}

async function build(migrations: MigrationFile[], file: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hasVector: boolean }> {
  const booted = await bootPglite();
  try {
    for (const m of migrations) {
      try {
        await booted.pg.exec(booted.hasVector ? m.sql : rewriteForMissingVector(m.sql));
      } catch (err) {
        throw new Error(`Migration ${m.tag} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    const bytes = new Uint8Array(await (await booted.pg.dumpDataDir("none")).arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Two workers that build at once write the same bytes under different names; the rename is atomic.
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
    return { bytes, hasVector: booted.hasVector };
  } finally {
    await booted.close();
  }
}

let cached: Promise<MigratedSnapshot> | null = null;

/** The dump for today's migrations: read from the snapshot directory, or built and written there on a miss. */
export function loadOrBuildSnapshot(): Promise<MigratedSnapshot> {
  cached ??= (async () => {
    const migrations = readMigrations();
    const hasVector = (await loadVectorExtension()) !== null;
    const file = path.join(snapshotDir(), `${snapshotKey(migrations, hasVector)}.tar`);
    const tags = migrations.map((m) => m.tag);
    if (fs.existsSync(file)) return { bytes: new Uint8Array(fs.readFileSync(file)), tags, hasVector };
    const built = await build(migrations, file);
    return { bytes: built.bytes, tags, hasVector: built.hasVector };
  })().catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}
