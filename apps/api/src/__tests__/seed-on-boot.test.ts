/**
 * SEED_ON_BOOT (services/seed-on-boot.ts): builds the demo businesses once on an empty database, makes the
 * SEED_OWNER_EMAILS addresses owners, and on later boots only adds missing owner memberships; never deletes. A first
 * sign-in opens the founder's newest business, so Northwind is kept the newer of the two.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { auditLog, businesses, events, repos, type Db } from "@foundmill/db";
import { DEMO_BUSINESS_IDS, DEMO_SEED_AUDIT_ACTION, demoSeedState, LEDGERLY_BUSINESS_ID, LEDGERLY_SLUG, NORTHWIND_BUSINESS_ID, NORTHWIND_SLUG, stubAuthProvisioner } from "@foundmill/db/seed";
import { rowToEventInput, safeParseEvent } from "@foundmill/events";
import { seedOnBoot, seedOnBootEnabled } from "../services/seed-on-boot";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const TODAY = new Date("2026-10-07T12:00:00.000Z");

describe("seedOnBoot", () => {
  let t: TestHarness;
  let db: Db;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db as unknown as Db;
  }, 120_000);
  afterAll(async () => {
    await t?.pg.close();
  });

  const env = (overrides: Record<string, string | number | undefined> = {}) => ({ DATABASE_URL: "pglite:memory", SEED_ON_BOOT: "1", SEED_OWNER_EMAILS: "founder@example.com", SEED_VOLUME_SCALE: 0.05, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...overrides }) as Parameters<typeof seedOnBoot>[0]["env"];
  const run = (e = env()) => seedOnBoot({ db, env: e, log: silent }, { auth: stubAuthProvisioner(db), today: TODAY, days: 60 });

  it("is off unless SEED_ON_BOOT is 1/true/yes/on, and needs a database", async () => {
    expect(seedOnBootEnabled("1")).toBe(true);
    expect(seedOnBootEnabled("true")).toBe(true);
    expect(seedOnBootEnabled("0")).toBe(false);
    expect(seedOnBootEnabled(undefined)).toBe(false);
    expect(await run(env({ SEED_ON_BOOT: undefined }))).toEqual({ status: "off" });
    expect((await run(env({ DATABASE_URL: undefined }))).status).toBe("skipped");
  });

  it("refuses to create owners on Supabase without the service role key", async () => {
    const outcome = await seedOnBoot({ db, env: env({ DATABASE_URL: "postgres://x@db.example.com:6543/postgres" }), log: silent }, { today: TODAY, days: 60 });
    expect(outcome).toEqual({ status: "skipped", reason: "no owner provisioner" });
  });

  it("builds Northwind and Ledgerly on an empty database with the SEED_OWNER_EMAILS owner", async () => {
    const outcome = await run();
    expect(outcome.status).toBe("seeded");
    if (outcome.status !== "seeded") return;
    expect(outcome.businesses).toEqual([NORTHWIND_SLUG, LEDGERLY_SLUG]);
    expect(outcome.owners).toContain("founder@example.com");
    const userId = await stubAuthProvisioner(db).ensureUser("founder@example.com");
    const owned = await repos.memberships.listForUser(db, userId);
    expect(owned.filter((m) => m.role === "owner")).toHaveLength(2);
    expect((await repos.businesses.listForUser(db, userId))[0]?.slug, "newest first: what `/` opens").toBe(NORTHWIND_SLUG);
  }, 240_000);

  it("every event the demo seed writes passes its catalogue schema, so the relay publishes it instead of dead-lettering it (#432)", async () => {
    const rows = await db.select().from(events).where(inArray(events.businessId, [...DEMO_BUSINESS_IDS]));
    expect(rows.length).toBeGreaterThan(4);
    const invalid = rows.flatMap((row) => {
      const parsed = safeParseEvent(rowToEventInput(row as unknown as Record<string, unknown>));
      return parsed.ok ? [] : [`${row.type}: ${parsed.error.message.slice(0, 300)}`];
    });
    expect(invalid).toEqual([]);
    for (const type of ["agent.health_changed", "holiday.started", "credential.expiring", "training.completed"]) expect(rows.some((r) => r.type === type), type).toBe(true);
  });

  it("on a later boot adds only the missing owner memberships and deletes nothing", async () => {
    const northwind = await repos.businesses.getBySlug(db, NORTHWIND_SLUG);
    const again = await run(env({ SEED_OWNER_EMAILS: "founder@example.com, second@example.com" }));
    expect(again).toEqual({ status: "owners_ensured", owners: ["founder@example.com", "second@example.com"], added: 2 });
    expect((await repos.businesses.getBySlug(db, NORTHWIND_SLUG))?.id).toBe(northwind?.id);
    expect(await run(env({ SEED_OWNER_EMAILS: "founder@example.com, second@example.com" }))).toMatchObject({ status: "owners_ensured", added: 0 });
  }, 60_000);

  it("on a later boot makes Northwind the newer business when an earlier seed left Ledgerly newer", async () => {
    await db.update(businesses).set({ createdAt: sql`now() + interval '1 hour'` }).where(eq(businesses.slug, LEDGERLY_SLUG));
    const userId = await stubAuthProvisioner(db).ensureUser("founder@example.com");
    expect((await repos.businesses.listForUser(db, userId))[0]?.slug).toBe(LEDGERLY_SLUG);
    expect((await run()).status).toBe("owners_ensured");
    expect((await repos.businesses.listForUser(db, userId)).map((b) => b.slug)).toEqual([NORTHWIND_SLUG, LEDGERLY_SLUG]);
  }, 60_000);

  // Audit api-services-21: the demo businesses are found by their fixed ids, never by (founder-editable) slug.
  it("never adds owners to, or rewrites, a stranger's business that holds a demo slug", async () => {
    const stub = stubAuthProvisioner(db);
    const stranger = await stub.ensureUser("stranger@example.com");
    // The demo owner renamed both demo businesses; strangers took the freed demo slugs.
    await db.update(businesses).set({ slug: "northwind-renamed" }).where(eq(businesses.id, NORTHWIND_BUSINESS_ID));
    await db.update(businesses).set({ slug: "ledgerly-renamed" }).where(eq(businesses.id, LEDGERLY_BUSINESS_ID));
    const taken = await repos.businesses.create(db, { name: "Stranger Northwind", slug: NORTHWIND_SLUG });
    const takenLedgerly = await repos.businesses.create(db, { name: "Stranger Ledgerly", slug: LEDGERLY_SLUG });
    await repos.memberships.add(db, taken.id, { userId: stranger, role: "owner" });
    await repos.memberships.add(db, takenLedgerly.id, { userId: stranger, role: "owner" });
    const createdBefore = (await repos.businesses.get(db, taken.id)).createdAt.getTime();

    const outcome = await run(env({ SEED_OWNER_EMAILS: "founder@example.com, newcomer@example.com" }));
    expect(outcome.status).toBe("owners_ensured");

    const founder = await stub.ensureUser("founder@example.com");
    const newcomer = await stub.ensureUser("newcomer@example.com");
    for (const id of [taken.id, takenLedgerly.id]) {
      expect(await repos.memberships.get(db, id, founder), "an owner address is not added to a stranger's business").toBeNull();
      expect(await repos.memberships.get(db, id, newcomer)).toBeNull();
    }
    expect(await repos.memberships.get(db, NORTHWIND_BUSINESS_ID, newcomer)).toMatchObject({ role: "owner" });
    expect((await repos.businesses.get(db, taken.id)).createdAt.getTime(), "the stranger's created_at is untouched").toBe(createdBefore);
    // Leave the demo as it was found for the tests that follow.
    await db.delete(businesses).where(inArray(businesses.id, [taken.id, takenLedgerly.id]));
    await db.update(businesses).set({ slug: NORTHWIND_SLUG }).where(eq(businesses.id, NORTHWIND_BUSINESS_ID));
    await db.update(businesses).set({ slug: LEDGERLY_SLUG }).where(eq(businesses.id, LEDGERLY_BUSINESS_ID));
  });

  it("finds the demo by its fixed ids: a renamed demo business is still the demo (#232)", async () => {
    await db.update(businesses).set({ slug: "ledgerly-renamed" }).where(eq(businesses.id, LEDGERLY_BUSINESS_ID));
    try {
      expect((await run()).status).toBe("owners_ensured");
    } finally {
      await db.update(businesses).set({ slug: LEDGERLY_SLUG }).where(eq(businesses.id, LEDGERLY_BUSINESS_ID));
    }
  }, 60_000);

  it("reports a Ledgerly whose build stopped half-way as partial instead of treating it as a finished demo (#437)", async () => {
    // Its last write, the `seed.demo` audit entry, is what a stopped build never wrote.
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('fm.purge_business', ${LEDGERLY_BUSINESS_ID}, true)`);
      await tx.delete(auditLog).where(and(eq(auditLog.businessId, LEDGERLY_BUSINESS_ID), eq(auditLog.action, DEMO_SEED_AUDIT_ACTION)));
    });
    const warnings: string[] = [];
    const outcome = await seedOnBoot({ db, env: env(), log: { ...silent, warn: (_o: object, msg?: string) => void warnings.push(msg ?? "") } }, { auth: stubAuthProvisioner(db), today: TODAY, days: 60 });
    expect(outcome).toEqual({ status: "partial", present: [NORTHWIND_SLUG, LEDGERLY_SLUG], reason: "a demo business was not built completely" });
    expect(warnings[0]).toMatch(/not built completely.*pnpm db:seed/);
    expect(await demoSeedState(db)).toEqual({ present: [NORTHWIND_SLUG, LEDGERLY_SLUG], complete: false });
  }, 60_000);

});
