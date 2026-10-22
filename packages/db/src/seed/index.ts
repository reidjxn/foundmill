/**
 * `seedDemo(db, opts)` — builds Northwind Skincare and Ledgerly (BUILD §17.2) deterministically from a seeded PRNG.
 * Idempotent: the two demo businesses are deleted by their fixed ids (every business-scoped table cascades) and
 * rebuilt; owners, platform skill definitions and the communities are upserted (real founders' members and posts stay).
 * Usage:
 *
 *   const result = await seedDemo(db, { today: new Date("2026-10-07T12:00:00Z"), volumeScale: 0.3 });
 *
 * `pnpm --filter @foundmill/db seed` runs it against DATABASE_URL (or a local PGlite directory, see src/seed.ts).
 */
import { freeDisplayName } from "@foundmill/config";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { repos } from "../repos";
import { rowsOf } from "../repos/_shared";
import { auditLog, businesses, founderProfiles, leaderboardEntries } from "../schema";
import { parseOwnerEmails, stubAuthProvisioner, type AuthProvisioner } from "./auth";
import { detachDemoPosts } from "./community";
import { DEFAULT_SEED_DAYS, DEMO_BUSINESS_IDS, DEMO_BUSINESS_SLUGS, DEMO_OWNER_DISPLAY_NAME, DEMO_OWNER_EMAIL, DEMO_OWNER_USER_ID, DEMO_SEED, DEMO_SEED_AUDIT_ACTION, LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID } from "./constants";
import { createSeedCtx, type SeedOwner } from "./context";
import { seedLedgerly } from "./ledgerly";
import { seedNorthwind } from "./northwind";
import { ensurePlatformSkillDefinitions } from "./platform";
import type { SeedDemoOptions, SeedDemoResult } from "./types";

export * from "./constants";
export * from "./types";
export { parseOwnerEmails, stubAuthProvisioner, supabaseAuthProvisioner, type AuthProvisioner } from "./auth";
export { FOUNDER_PRESET_LAYOUT } from "./content";

/** The demo businesses that exist, found by their fixed ids (never by slug, which founders can edit). */
export async function findDemoBusinesses(db: Db): Promise<{ id: string; slug: string }[]> {
  return db.select({ id: businesses.id, slug: businesses.slug }).from(businesses).where(inArray(businesses.id, [...DEMO_BUSINESS_IDS]));
}

/** True when both demo businesses exist (by their fixed ids). */
export async function demoBusinessesPresent(db: Db): Promise<boolean> {
  const rows = await db.select({ id: businesses.id }).from(businesses).where(inArray(businesses.id, [...DEMO_BUSINESS_IDS]));
  return rows.length === DEMO_BUSINESS_IDS.length;
}

export interface DemoSeedState {
  /** The demo businesses that exist, by fixed id (their current slugs). */
  present: string[];
  /** Both exist and both builds wrote their last entry (`seed.demo` on the audit log); Ledgerly is built second. */
  complete: boolean;
}

/**
 * Whether an earlier seed finished. A business row is written first and about seventy writes follow it, so the rows
 * alone cannot tell a finished demo from one whose seed stopped half-way; each build's last write, its `seed.demo`
 * audit entry, can (a rebuild deletes it with the business).
 */
export async function demoSeedState(db: Db): Promise<DemoSeedState> {
  const rows = await db.select({ id: businesses.id, slug: businesses.slug }).from(businesses).where(inArray(businesses.id, [...DEMO_BUSINESS_IDS]));
  const finished = await db
    .selectDistinct({ businessId: auditLog.businessId })
    .from(auditLog)
    .where(and(inArray(auditLog.businessId, [...DEMO_BUSINESS_IDS]), eq(auditLog.action, DEMO_SEED_AUDIT_ACTION)));
  const done = new Set(finished.map((r) => r.businessId));
  return { present: DEMO_BUSINESS_IDS.flatMap((id) => rows.filter((r) => r.id === id).map((r) => r.slug)), complete: rows.length === DEMO_BUSINESS_IDS.length && DEMO_BUSINESS_IDS.every((id) => done.has(id)) };
}

/**
 * Makes Northwind the newer demo business. `/` opens a founder's newest business when no last-business cookie is set
 * (apps/web/app/page.tsx), and Ledgerly is built after Northwind, so without this a first sign-in lands on Ledgerly.
 * Idempotent; returns whether a row changed.
 */
export async function putNorthwindFirst(db: Db): Promise<boolean> {
  const result = await db.execute(
    sql`update businesses n set created_at = l.created_at + interval '1 second' from businesses l where n.id = ${NORTHWIND_BUSINESS_ID}::uuid and l.id = ${LEDGERLY_BUSINESS_ID}::uuid and n.created_at <= l.created_at returning n.id`,
  );
  return rowsOf(result).length > 0;
}

/**
 * Deletes the demo businesses, found by their fixed ids (every business-scoped table cascades, their audit chains
 * included). A rebuild of the demo discards the demo's audit chains deliberately (docs/DECISIONS.md "Seed re-runs
 * replace the demo businesses"): the audit trigger lets this transaction delete the chain of the one business it names
 * in `fm.purge_business` (0053), so no `alter table` lock stops every audited write while the cascade runs.
 *
 * The seed communities are public and real founders use them: they stay, with their members and posts. The demo
 * businesses' posts are detached first so they and the replies under them survive; the rebuild re-attaches them.
 * A real business that took a demo slug is never touched (`seedDemo` refuses to build over it).
 */
export async function deleteDemoBusinesses(db: Db): Promise<number> {
  const rows = await db.select({ id: businesses.id }).from(businesses).where(inArray(businesses.id, [...DEMO_BUSINESS_IDS]));
  if (!rows.length) return 0;
  await db.transaction(async (tx) => {
    await detachDemoPosts(tx, rows.map((r) => r.id));
    for (const { id } of rows) {
      await tx.execute(sql`select set_config('fm.purge_business', ${id}, true)`);
      await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.businessId, id));
      await tx.delete(businesses).where(eq(businesses.id, id));
    }
    await tx.execute(sql`select set_config('fm.purge_business', '', true)`);
  });
  return rows.length;
}

/** Refuses to build over a real business that holds a demo slug (renamed into it while the demo was absent). */
async function assertDemoSlugsFree(db: Db): Promise<void> {
  const taken = await db
    .select({ id: businesses.id, slug: businesses.slug })
    .from(businesses)
    .where(and(inArray(businesses.slug, [...DEMO_BUSINESS_SLUGS]), notInArray(businesses.id, [...DEMO_BUSINESS_IDS])));
  if (taken.length) {
    throw new Error(`seed: the demo slug${taken.length > 1 ? "s" : ""} ${taken.map((t) => `"${t.slug}"`).join(" and ")} belong${taken.length > 1 ? "" : "s"} to a real business (${taken.map((t) => t.id).join(", ")}); the demo is not built over it. Rename that business first.`);
  }
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

  await assertDemoSlugsFree(db);
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
    if (!ownerProfile && o.userId === owner.userId) {
      // Without a profile the owner still confirms 18+ for the network: joins, connections and posts ask for it.
      await repos.social.confirmAdult(db, o.userId);
      continue;
    }
    if (!(await repos.founders.get(db, o.userId))) {
      await repos.founders.upsert(db, o.userId, {
        displayName: o.userId === owner.userId ? DEMO_OWNER_DISPLAY_NAME : freeDisplayName(o.email.split("@")[0]),
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
    // The demo founders are adults: the network asks once before a first connection, message or post (0027).
    await repos.social.confirmAdult(db, o.userId);
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

  // A freshly seeded database has no planner statistics, and Postgres plans the first queries as if every table held a
  // row: a role filter on the CRM list ran for minutes. Gathering them once costs a second.
  await db.execute(sql`analyze`);
  log("planner statistics gathered");

  return { owner, owners, businesses: { northwind, ledgerly }, platformSkillDefinitionsAdded, durationMs: Date.now() - startedAt };
}
