/**
 * `seedDemo(db, opts)` — builds Northwind Skincare and Ledgerly (BUILD §17.2) deterministically from a seeded PRNG.
 * Idempotent: the two demo businesses are deleted by slug (every business-scoped table cascades) and rebuilt;
 * owners, platform skill definitions and the community are upserted. Usage:
 *
 *   const result = await seedDemo(db, { today: new Date("2026-10-07T12:00:00Z"), volumeScale: 0.3 });
 *
 * `pnpm --filter @foundmill/db seed` runs it against DATABASE_URL (or a local PGlite directory, see src/seed.ts).
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { repos } from "../repos";
import { rowsOf } from "../repos/_shared";
import { businesses, communities, founderProfiles, leaderboardEntries } from "../schema";
import { parseOwnerEmails, stubAuthProvisioner, type AuthProvisioner } from "./auth";
import { DEFAULT_SEED_DAYS, DEMO_BUSINESS_SLUGS, DEMO_OWNER_DISPLAY_NAME, DEMO_OWNER_EMAIL, DEMO_OWNER_USER_ID, DEMO_SEED, LEDGERLY_SLUG, NORTHWIND_SLUG, SEED_COMMUNITY_SLUGS } from "./constants";
import { createSeedCtx, type SeedOwner } from "./context";
import { seedLedgerly } from "./ledgerly";
import { seedNorthwind } from "./northwind";
import { ensurePlatformSkillDefinitions } from "./platform";
import type { SeedDemoOptions, SeedDemoResult } from "./types";

export * from "./constants";
export * from "./types";
export { parseOwnerEmails, stubAuthProvisioner, supabaseAuthProvisioner, type AuthProvisioner } from "./auth";
export { FOUNDER_PRESET_LAYOUT } from "./content";

/** True when both demo businesses exist (what `SEED_ON_BOOT` checks before seeding). */
export async function demoBusinessesPresent(db: Db): Promise<boolean> {
  const rows = await db.select({ slug: businesses.slug }).from(businesses).where(inArray(businesses.slug, [...DEMO_BUSINESS_SLUGS]));
  return rows.length === DEMO_BUSINESS_SLUGS.length;
}

/**
 * Makes Northwind the newer demo business. `/` opens a founder's newest business when no last-business cookie is set
 * (apps/web/app/page.tsx), and Ledgerly is built after Northwind, so without this a first sign-in lands on Ledgerly.
 * Idempotent; returns whether a row changed.
 */
export async function putNorthwindFirst(db: Db): Promise<boolean> {
  const result = await db.execute(
    sql`update businesses n set created_at = l.created_at + interval '1 second' from businesses l where n.slug = ${NORTHWIND_SLUG} and l.slug = ${LEDGERLY_SLUG} and n.created_at <= l.created_at returning n.id`,
  );
  return rowsOf(result).length > 0;
}

/**
 * Deletes the demo businesses (cascades through every business-scoped table) and the demo community.
 * The audit log is append-only by trigger (BUILD §7.2), so the cascade would be refused; a rebuild of the demo
 * businesses discards their audit chains deliberately (docs/DECISIONS.md "Seed re-runs replace the demo
 * businesses"), which needs the table owner (PGlite superuser, the service connection on Supabase).
 */
export async function deleteDemoBusinesses(db: Db): Promise<number> {
  const rows = await db.select({ id: businesses.id, slug: businesses.slug }).from(businesses).where(inArray(businesses.slug, [...DEMO_BUSINESS_SLUGS]));
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await db.transaction(async (tx) => {
      try {
        await tx.execute(sql`alter table audit_log disable trigger audit_log_immutable`);
      } catch (err) {
        throw new Error(`seed: cannot rebuild the demo businesses because the connection may not disable the audit_log trigger (run the seed as the database owner): ${(err as Error).message}`, { cause: err });
      }
      await tx.delete(leaderboardEntries).where(inArray(leaderboardEntries.businessId, ids));
      await tx.delete(businesses).where(inArray(businesses.id, ids));
      await tx.execute(sql`alter table audit_log enable trigger audit_log_immutable`);
    });
  }
  await db.delete(communities).where(inArray(communities.slug, [...SEED_COMMUNITY_SLUGS]));
  return rows.length;
}

export async function seedDemo(db: Db, opts: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  const startedAt = Date.now();
  const log = opts.log ?? (() => {});
  const auth: AuthProvisioner = opts.auth ?? stubAuthProvisioner(db);
  const today = opts.today ?? new Date();
  const days = opts.days ?? DEFAULT_SEED_DAYS;
  if (!Number.isInteger(days) || days < 30) throw new RangeError("seedDemo: days must be an integer >= 30");

  // Owners: the demo founder plus SEED_OWNER_EMAILS.
  const ownerUserId = await auth.ensureUser(DEMO_OWNER_EMAIL, { preferredId: DEMO_OWNER_USER_ID, displayName: DEMO_OWNER_DISPLAY_NAME });
  const owner: SeedOwner = { userId: ownerUserId, email: DEMO_OWNER_EMAIL };
  const owners: SeedOwner[] = [owner];
  for (const email of parseOwnerEmails((opts.ownerEmails ?? []).join(","))) {
    if (email === DEMO_OWNER_EMAIL) continue;
    owners.push({ userId: await auth.ensureUser(email, { displayName: email.split("@")[0] }), email });
  }
  log(`owners: ${owners.map((o) => `${o.email} (${o.userId})`).join(", ")} via ${auth.kind} auth`);

  const removed = await deleteDemoBusinesses(db);
  if (removed) log(`removed ${removed} existing demo business(es)`);
  const platformSkillDefinitionsAdded = await ensurePlatformSkillDefinitions(db);
  if (platformSkillDefinitionsAdded) log(`added ${platformSkillDefinitionsAdded} platform skill definitions`);

  const ctx = createSeedCtx({ db, seed: opts.seed ?? DEMO_SEED, today, days, volumeScale: opts.volumeScale ?? 1, owner, owners, log });

  const ownerProfile = opts.ownerProfile ?? true;
  if (!ownerProfile) {
    // SEED_OWNER_PROFILE=0: the demo owner starts without a profile so `/` and `/b/*` redirect to /onboarding.
    const deleted = await db.delete(founderProfiles).where(eq(founderProfiles.userId, owner.userId)).returning({ userId: founderProfiles.userId });
    log(`demo owner profile skipped${deleted.length ? " (existing profile removed)" : ""}: the onboarding gate applies to ${owner.email}`);
  }
  for (const o of owners) {
    if (!ownerProfile && o.userId === owner.userId) continue;
    if (!(await repos.founders.get(db, o.userId))) {
      await repos.founders.upsert(db, o.userId, {
        displayName: o.userId === owner.userId ? DEMO_OWNER_DISPLAY_NAME : o.email.split("@")[0]!,
        experience: "operator",
        skills: { engineering: 9, sales: 13, design: 11, finance: 10, domain: 16 },
        timeCommitment: "full_time",
        budgetMinor: 6_000_000,
        currency: "GBP",
        citizenship: "GB",
        residence: "GB",
        targetMarkets: ["GB", "IE", "US"],
        constraints: ["No consumer cold email in the EU", "Founder approves anything in their name"],
        riskAppetite: "moderate",
      });
    }
  }

  const northwind = await seedNorthwind(ctx);
  log(`northwind done: ${JSON.stringify(northwind.counts)}`);
  const ledgerly = await seedLedgerly(ctx);
  log(`ledgerly done: ${JSON.stringify(ledgerly.counts)}`);
  await putNorthwindFirst(db);

  if (opts.refreshDaily ?? true) {
    await repos.journeys.refreshDaily(db);
    log("journey_daily refreshed");
  }

  return { owner, owners, businesses: { northwind, ledgerly }, platformSkillDefinitionsAdded, durationMs: Date.now() - startedAt };
}
