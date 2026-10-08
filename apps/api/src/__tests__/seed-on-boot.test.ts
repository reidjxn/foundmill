/**
 * SEED_ON_BOOT (services/seed-on-boot.ts): builds the demo businesses once on an empty database, makes the
 * SEED_OWNER_EMAILS addresses owners, and on later boots only adds missing owner memberships; never deletes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { LEDGERLY_SLUG, NORTHWIND_SLUG, stubAuthProvisioner } from "@foundmill/db/seed";
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
  }, 240_000);

  it("on a later boot adds only the missing owner memberships and deletes nothing", async () => {
    const northwind = await repos.businesses.getBySlug(db, NORTHWIND_SLUG);
    const again = await run(env({ SEED_OWNER_EMAILS: "founder@example.com, second@example.com" }));
    expect(again).toEqual({ status: "owners_ensured", owners: ["founder@example.com", "second@example.com"], added: 2 });
    expect((await repos.businesses.getBySlug(db, NORTHWIND_SLUG))?.id).toBe(northwind?.id);
    expect(await run(env({ SEED_OWNER_EMAILS: "founder@example.com, second@example.com" }))).toMatchObject({ status: "owners_ensured", added: 0 });
  }, 60_000);
});
