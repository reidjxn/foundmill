/**
 * Seed script (BUILD §17.2; docs/ARCHITECTURE.md §4 Seeds). Builds Northwind Skincare and Ledgerly.
 *
 *   pnpm db:seed                                   against DATABASE_URL (service role); owners from SEED_OWNER_EMAILS are
 *                                                  created through the Supabase admin API when SUPABASE_URL +
 *                                                  SUPABASE_SERVICE_ROLE_KEY are set
 *   DATABASE_URL=pglite:./.pglite/dev pnpm db:seed into a local PGlite directory (migrated first); the same URL then
 *                                                  points every service at the seeded data
 *   SEED_TARGET=pglite pnpm db:seed                same, default dir ./.pglite/dev (workspace-root relative),
 *                                                  SEED_PGLITE_DIR to override; also the fallback when DATABASE_URL is unset
 *   SEED_TODAY=2026-10-07                          pin "today" (default: now); SEED_DAYS=730; SEED_VOLUME_SCALE=1
 *   SEED_OWNER_PROFILE=0                           leave the demo owner without a founder profile (removes one an earlier
 *                                                  seed created) so the AC-11.1.1 onboarding redirect can be exercised
 *
 * Library use: `import { seedDemo } from "@foundmill/db/seed"` (tests, e2e, apps/api SEED_ON_BOOT).
 */
import { loadEnv } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { DEFAULT_PGLITE_DIR, parsePgliteUrl } from "./pglite";
import { openLocalPglite } from "./seed/pglite-target";
import { parseOwnerEmails, seedDemo, supabaseAuthProvisioner, type AuthProvisioner } from "./seed/index";

export * from "./seed/index";
export { openLocalPglite, type LocalPglite } from "./seed/pglite-target";

/** Which target the env selects: a PGlite directory (string) or the Postgres DATABASE_URL (null). */
export function resolvePgliteSeedDir(env: { SEED_TARGET?: string; SEED_PGLITE_DIR?: string; DATABASE_URL?: string }): string | null {
  const fromUrl = env.DATABASE_URL ? parsePgliteUrl(env.DATABASE_URL) : null;
  if (fromUrl) {
    if (!fromUrl.dataDir) throw new Error("db:seed needs a file-backed PGlite URL (pglite:<dir>); an in-memory database is gone when the process ends");
    return fromUrl.dataDir;
  }
  const target = env.SEED_TARGET ?? (env.DATABASE_URL ? "database" : "pglite");
  return target === "pglite" ? (env.SEED_PGLITE_DIR ?? DEFAULT_PGLITE_DIR) : null;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const today = process.env.SEED_TODAY ? new Date(`${process.env.SEED_TODAY}T12:00:00.000Z`) : new Date();
  const days = process.env.SEED_DAYS ? Number(process.env.SEED_DAYS) : undefined;
  const volumeScale = process.env.SEED_VOLUME_SCALE ? Number(process.env.SEED_VOLUME_SCALE) : undefined;
  const ownerProfile = !/^(0|false|no|off)$/i.test((process.env.SEED_OWNER_PROFILE ?? "").trim());
  const ownerEmails = parseOwnerEmails(env.SEED_OWNER_EMAILS);
  const log = (m: string) => console.warn(`[seed] ${m}`);

  const pgliteDir = resolvePgliteSeedDir({ SEED_TARGET: process.env.SEED_TARGET, SEED_PGLITE_DIR: process.env.SEED_PGLITE_DIR, DATABASE_URL: env.DATABASE_URL });
  if (pgliteDir) {
    const local = await openLocalPglite(pgliteDir);
    log(`PGlite at ${local.dataDir} (${local.appliedMigrations.length} migration(s) applied now, pgvector ${local.hasVector ? "on" : "off"}); services: DATABASE_URL=pglite:${local.dataDir}`);
    try {
      // A real project for the browser suites: this local path only, never a hosted database.
      const e2eProject = /^(1|true|yes|on)$/i.test((process.env.SEED_E2E_PROJECT ?? "").trim());
      const result = await seedDemo(local.db, { today, days, volumeScale, ownerEmails, ownerProfile, e2eProject, log });
      log(`done in ${Math.round(result.durationMs / 1000)}s: ${result.businesses.northwind.slug} (${result.businesses.northwind.id}), ${result.businesses.ledgerly.slug} (${result.businesses.ledgerly.id}); owner ${result.owner.email} = ${result.owner.userId}`);
    } finally {
      await local.close();
    }
    return;
  }

  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set (or use SEED_TARGET=pglite)");
  const db = createDb(env.DATABASE_URL, { max: 2 });
  let auth: AuthProvisioner | undefined;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    auth = await supabaseAuthProvisioner(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    log("owners through the Supabase admin API");
  } else {
    log("no SUPABASE_SERVICE_ROLE_KEY: owners are stub rows in auth.users (local Postgres only)");
  }
  try {
    const result = await seedDemo(db, { today, days, volumeScale, ownerEmails, ownerProfile, auth, log });
    log(`done in ${Math.round(result.durationMs / 1000)}s: ${result.businesses.northwind.slug} (${result.businesses.northwind.id}), ${result.businesses.ledgerly.slug} (${result.businesses.ledgerly.id}); owners ${result.owners.map((o) => o.email).join(", ")}`);
  } finally {
    await closeDb(db);
  }
}

const isMain = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
