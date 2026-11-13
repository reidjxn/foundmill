/**
 * 0087 — client grants. On Supabase every object `postgres` creates in `public` is granted straight to anon,
 * authenticated and service_role, so a `revoke ... from public` alone left two service-only security-definer functions
 * callable by the client roles, a DELETE on three tables that were meant to have none, TRUNCATE, TRIGGER and REFERENCES
 * on every table, and every privilege on the two service-read public views.
 * On PGlite these hold before 0087 too (no default privileges there); run with RLS_TEST_DATABASE_URL against a cluster
 * with Supabase's default privileges (docs/DEPLOY.md §4) to see the migration do the work.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presenceRepo } from "../../repos/presence";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

const CLIENT_ROLES = ["anon", "authenticated"] as const;
const SERVICE_ONLY_FUNCTIONS = ["fm_purge_business(uuid)", "refresh_journey_daily()"] as const;
const NO_CLIENT_DELETE = ["account_preferences", "founder_presence", "founder_visit_days"] as const;

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const one = async (q: ReturnType<typeof sql>): Promise<boolean> => ((await rows<{ ok: boolean }>(q))[0] as { ok: boolean }).ok;
const fnPriv = (role: string, fn: string) => one(sql`select has_function_privilege(${role}::name, ${fn}::text, 'execute') as ok`);
const tablePriv = (role: string, table: string, priv: string) => one(sql`select has_table_privilege(${role}::name, ${`public.${table}`}::text, ${priv}::text) as ok`);
const businessExists = async (id: string) => (await h.service().run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses).where(eq(s.businesses.id, id)))).length === 1;

const now = new Date("2026-11-13T15:00:00Z");

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "grants-a");
  B = await createBusinessFixture(h, "grants-b");
});
afterAll(() => h?.close());

describe("service-only functions (0007, 0028)", () => {
  for (const fn of SERVICE_ONLY_FUNCTIONS) {
    for (const role of CLIENT_ROLES) it(`${role} cannot EXECUTE ${fn}`, async () => expect(await fnPriv(role, fn)).toBe(false));
    it(`service_role can EXECUTE ${fn}`, async () => expect(await fnPriv("service_role", fn)).toBe(true));
  }

  it("a signed-in owner cannot purge their own business, nor anyone else's; anon cannot either", async () => {
    await expect(h.asUser(A.ownerId).execute(sql`select fm_purge_business(${A.businessId}::uuid)`)).rejects.toThrow(/permission denied for function fm_purge_business/);
    await expect(h.asUser(A.ownerId).execute(sql`select fm_purge_business(${B.businessId}::uuid)`)).rejects.toThrow(/permission denied for function fm_purge_business/);
    await expect(h.anon().execute(sql`select fm_purge_business(${B.businessId}::uuid)`)).rejects.toThrow(/permission denied for function fm_purge_business/);
    expect([await businessExists(A.businessId), await businessExists(B.businessId)]).toEqual([true, true]);
  });

  it("only the service role refreshes the journey rollup", async () => {
    await expect(h.asUser(A.ownerId).execute(sql`select refresh_journey_daily()`)).rejects.toThrow(/permission denied for function refresh_journey_daily/);
    await expect(h.anon().execute(sql`select refresh_journey_daily()`)).rejects.toThrow(/permission denied for function refresh_journey_daily/);
    await expect(h.service().execute(sql`select refresh_journey_daily()`)).resolves.toHaveLength(1);
  });
});

describe("no client DELETE on account_preferences (0022), founder_presence and founder_visit_days (0083)", () => {
  for (const table of NO_CLIENT_DELETE) for (const role of CLIENT_ROLES) it(`${role} holds no DELETE on ${table}`, async () => expect(await tablePriv(role, table, "delete")).toBe(false));
  it("service_role keeps its DELETE on founder_presence and founder_visit_days", async () => {
    expect([await tablePriv("service_role", "founder_presence", "delete"), await tablePriv("service_role", "founder_visit_days", "delete")]).toEqual([true, true]);
  });

  it("a person cannot delete their own rows, which stay", async () => {
    await h.asUser(A.ownerId).run((tx) => tx.insert(s.accountPreferences).values({ userId: A.ownerId, dateFormat: "iso" }));
    await h.asUser(A.ownerId).run((tx) => presenceRepo.ping(tx, A.businessId, A.ownerId, { now }));
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.founderPresence).where(eq(s.founderPresence.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.founderVisitDays).where(eq(s.founderVisitDays.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
    const kept = await h.service().run(async (tx) => [
      (await tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, A.ownerId))).length,
      (await tx.select().from(s.founderPresence).where(eq(s.founderPresence.userId, A.ownerId))).length,
      (await tx.select().from(s.founderVisitDays).where(eq(s.founderVisitDays.userId, A.ownerId))).length,
    ]);
    expect(kept).toEqual([1, 1, 1]);
  });

  it("nor someone else's", async () => {
    await expect(h.asUser(B.ownerId).run((tx) => tx.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.memberId).run((tx) => tx.delete(s.founderPresence).where(eq(s.founderPresence.businessId, A.businessId)))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.delete(s.founderVisitDays))).rejects.toThrow(/permission denied/);
  });
});

describe("no client TRUNCATE, TRIGGER or REFERENCES", () => {
  for (const priv of ["truncate", "trigger", "references"]) {
    it(`anon and authenticated hold ${priv.toUpperCase()} on no table, view or materialized view in public`, async () => {
      const held = await rows<{ role: string; rel: string }>(sql`
        select r.role, c.relname as rel
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) as r(role)
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_table_privilege(r.role::name, c.oid, ${priv}::text)
        order by 1, 2`);
      expect(held).toEqual([]);
    });
  }

  it("a table the migration role creates later does not bring them back", async () => {
    await h.db.execute(sql`create table fm_grants_probe (id int primary key)`);
    try {
      const held: string[] = [];
      for (const role of CLIENT_ROLES) for (const priv of ["truncate", "trigger", "references"]) if (await tablePriv(role, "fm_grants_probe", priv)) held.push(`${role} ${priv}`);
      expect(held).toEqual([]);
    } finally {
      await h.db.execute(sql`drop table fm_grants_probe`);
    }
  });

  it("a signed-in person's TRUNCATE is refused and removes nothing", async () => {
    await expect(h.asUser(A.ownerId).execute(sql`truncate account_preferences`)).rejects.toThrow(/permission denied/);
    expect(await h.service().run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, A.ownerId)))).toHaveLength(1);
  });

  it("a signed-in person cannot attach a trigger to a table every tenant writes", async () => {
    await expect(h.asUser(A.ownerId).execute(sql`create trigger fm_grants_probe before insert on businesses for each row execute function fm_set_updated_at()`)).rejects.toThrow(/permission denied|must be owner/);
    expect(await rows(sql`select tgname from pg_trigger where tgname = 'fm_grants_probe'`)).toEqual([]);
  });
});

describe("the public views are read-only for the service role too (0080, 0081)", () => {
  for (const view of ["public_person_profiles", "public_project_pages"]) {
    it(`service_role holds SELECT and nothing else on ${view}`, async () => {
      const held: string[] = [];
      for (const priv of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) if (await tablePriv("service_role", view, priv)) held.push(priv);
      expect(held).toEqual(["select"]);
    });
  }
});
