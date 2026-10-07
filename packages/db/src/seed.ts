/**
 * Seed script (BUILD §17.2; docs/ARCHITECTURE.md §4 Seeds). Builds Northwind Skincare and Ledgerly.
 *
 *   pnpm db:seed                         against DATABASE_URL (service role); owners from SEED_OWNER_EMAILS are created
 *                                        through the Supabase admin API when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *   SEED_TARGET=pglite pnpm db:seed      into a local PGlite directory (default ./.pglite/dev, SEED_PGLITE_DIR to override);
 *                                        also the fallback when DATABASE_URL is unset
 *   SEED_TODAY=2026-10-07                pin "today" (default: now); SEED_DAYS=730; SEED_VOLUME_SCALE=1
 *
 * Library use: `import { seedDemo } from "@foundmill/db/seed"` (tests, e2e, apps/api SEED_ON_BOOT).
 */
import { loadEnv } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { openLocalPglite } from "./seed/pglite-target";
import { parseOwnerEmails, seedDemo, supabaseAuthProvisioner, type AuthProvisioner } from "./seed/index";

export * from "./seed/index";
export { openLocalPglite, type LocalPglite } from "./seed/pglite-target";

async function main(): Promise<void> {
  const env = loadEnv();
  const target = process.env.SEED_TARGET ?? (env.DATABASE_URL ? "database" : "pglite");
  const today = process.env.SEED_TODAY ? new Date(`${process.env.SEED_TODAY}T12:00:00.000Z`) : new Date();
  const days = process.env.SEED_DAYS ? Number(process.env.SEED_DAYS) : undefined;
  const volumeScale = process.env.SEED_VOLUME_SCALE ? Number(process.env.SEED_VOLUME_SCALE) : undefined;
  const ownerEmails = parseOwnerEmails(env.SEED_OWNER_EMAILS);
  const log = (m: string) => console.warn(`[seed] ${m}`);

  if (target === "pglite") {
    const dir = process.env.SEED_PGLITE_DIR ?? "./.pglite/dev";
    const local = await openLocalPglite(dir);
    log(`PGlite at ${dir} (${local.appliedMigrations.length} migration(s) applied now, pgvector ${local.hasVector ? "on" : "off"})`);
    try {
      const result = await seedDemo(local.db, { today, days, volumeScale, ownerEmails, log });
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
    const result = await seedDemo(db, { today, days, volumeScale, ownerEmails, auth, log });
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
