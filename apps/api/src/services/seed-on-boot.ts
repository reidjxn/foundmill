/**
 * SEED_ON_BOOT (docs/DEPLOY.md §3): the api builds the demo businesses, Northwind Skincare and Ledgerly, the first time
 * it boots against an empty database, and makes every SEED_OWNER_EMAILS address an owner of both. It runs in the
 * background after the server listens, so health answers while the seed works.
 *
 * - Neither demo business exists → `seedDemo` (owners through the Supabase admin API when the service role key is set;
 *   on PGlite and local databases the stub `auth.users` rows).
 * - Both exist → only make sure each SEED_OWNER_EMAILS owner has an owner membership on both, so adding an address
 *   later needs no reseed. Nothing is deleted.
 * - Exactly one exists → a seed is still running in another process, or one stopped half-way. Nothing happens: a
 *   rebuild deletes the demo businesses, which stays a deliberate `pnpm db:seed`.
 */
import { repos, type Db } from "@foundmill/db";
import { DEMO_BUSINESS_SLUGS, parseOwnerEmails, seedDemo, stubAuthProvisioner, supabaseAuthProvisioner, type AuthProvisioner } from "@foundmill/db/seed";
import type { Env } from "@foundmill/shared";

export type SeedOnBootOutcome =
  | { status: "off" }
  | { status: "skipped"; reason: string }
  | { status: "seeded"; businesses: string[]; owners: string[]; durationMs: number }
  | { status: "owners_ensured"; owners: string[]; added: number }
  | { status: "partial"; present: string[] }
  | { status: "failed"; error: string };

interface SeedLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface SeedOnBootDeps {
  db: Db;
  env: Pick<Env, "SEED_ON_BOOT" | "SEED_OWNER_EMAILS" | "SEED_VOLUME_SCALE" | "DATABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">;
  log: SeedLogger;
}

export interface SeedOnBootOptions {
  /** Override the owner provisioner (tests). Default: Supabase admin API when configured, stub rows on PGlite. */
  auth?: AuthProvisioner;
  today?: Date;
  days?: number;
}

export const seedOnBootEnabled = (value: string | undefined): boolean => /^(1|true|yes|on)$/i.test((value ?? "").trim());

function provisioner(deps: SeedOnBootDeps): Promise<AuthProvisioner> | AuthProvisioner | null {
  const { env } = deps;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseAuthProvisioner(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  // Without the service role key, owners can only be stub rows, which exist on PGlite and local databases alone.
  if (env.DATABASE_URL && /^pglite:/i.test(env.DATABASE_URL)) return stubAuthProvisioner(deps.db);
  return null;
}

export async function seedOnBoot(deps: SeedOnBootDeps, options: SeedOnBootOptions = {}): Promise<SeedOnBootOutcome> {
  const { env, log, db } = deps;
  if (!seedOnBootEnabled(env.SEED_ON_BOOT)) return { status: "off" };
  if (!env.DATABASE_URL) return { status: "skipped", reason: "DATABASE_URL is not set" };
  try {
    const auth = options.auth ?? (await provisioner(deps));
    if (!auth) {
      log.error({}, "SEED_ON_BOOT: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to create the owners on Supabase; seed skipped");
      return { status: "skipped", reason: "no owner provisioner" };
    }
    const ownerEmails = parseOwnerEmails(env.SEED_OWNER_EMAILS);
    const existing = (await Promise.all(DEMO_BUSINESS_SLUGS.map((slug) => repos.businesses.getBySlug(db, slug)))).filter((b) => b !== null);

    if (existing.length === DEMO_BUSINESS_SLUGS.length) {
      let added = 0;
      for (const email of ownerEmails) {
        const userId = await auth.ensureUser(email, { displayName: email.split("@")[0] });
        for (const business of existing) {
          if (await repos.memberships.get(db, business.id, userId)) continue;
          await repos.memberships.add(db, business.id, { userId, role: "owner" });
          added++;
        }
      }
      log.info({ owners: ownerEmails, added }, "SEED_ON_BOOT: demo businesses present; owner memberships ensured");
      return { status: "owners_ensured", owners: ownerEmails, added };
    }

    if (existing.length > 0) {
      const present = existing.map((b) => b.slug);
      log.warn({ present }, "SEED_ON_BOOT: only some demo businesses exist (a seed is running elsewhere or stopped half-way); nothing done. Rebuild them with `pnpm db:seed`.");
      return { status: "partial", present };
    }

    const volumeScale = env.SEED_VOLUME_SCALE ?? 1;
    log.info({ owners: ownerEmails, volumeScale, auth: auth.kind }, "SEED_ON_BOOT: building Northwind Skincare and Ledgerly");
    const result = await seedDemo(db, {
      ownerEmails,
      auth,
      volumeScale,
      ...(options.today ? { today: options.today } : {}),
      ...(options.days ? { days: options.days } : {}),
      log: (m) => log.info({}, `[seed] ${m}`),
    });
    const businesses = [result.businesses.northwind.slug, result.businesses.ledgerly.slug];
    const owners = result.owners.map((o) => o.email);
    log.info({ businesses, owners, durationMs: result.durationMs }, "SEED_ON_BOOT: done");
    return { status: "seeded", businesses, owners, durationMs: result.durationMs };
  } catch (err) {
    const error = (err as Error).message;
    log.error({ err: error }, "SEED_ON_BOOT: seed failed; the api keeps serving");
    return { status: "failed", error };
  }
}
