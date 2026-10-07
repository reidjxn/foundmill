/**
 * A file-backed PGlite database for local use (`SEED_TARGET=pglite`, `DATABASE_URL=pglite:<dir>`, or no
 * DATABASE_URL at all). Default dir `./.pglite/dev` relative to the workspace root, override with SEED_PGLITE_DIR.
 *
 * Thin wrapper over the production path: `createDb("pglite:<dir>")` boots the roles, the stub `auth` schema and the
 * extensions (src/pglite.ts), and `migrateDb` applies what drizzle's bookkeeping table has not seen yet. A directory
 * seeded here is therefore exactly what the services open with `DATABASE_URL=pglite:<same dir>`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { createDb, type PgliteDb } from "../client";
import { migrateDb } from "../migrator";
import { DEFAULT_PGLITE_DIR, pgliteUrl, resolvePgliteDir } from "../pglite";

export interface LocalPglite {
  db: PgliteDb;
  pg: PGlite;
  /** Absolute data directory. */
  dataDir: string;
  /** Migration tags applied by this open (empty on a directory that is already up to date). */
  appliedMigrations: string[];
  hasVector: boolean;
  close(): Promise<void>;
}

export async function openLocalPglite(dataDir: string = DEFAULT_PGLITE_DIR): Promise<LocalPglite> {
  const dir = resolvePgliteDir(dataDir);
  const db = createDb(pgliteUrl(dir));
  try {
    const { applied } = await migrateDb(db);
    return {
      db,
      pg: await db.$client.instance(),
      dataDir: dir,
      appliedMigrations: applied,
      hasVector: await db.$client.hasVector(),
      close: () => db.$client.close(),
    };
  } catch (err) {
    await db.$client.close().catch(() => undefined);
    throw err;
  }
}
