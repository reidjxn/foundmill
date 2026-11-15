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

describe("what a shared post led to is the services' to write (0106)", () => {
  for (const table of ["post_links", "post_attributions"]) {
    for (const role of CLIENT_ROLES) {
      it(`${role} holds no INSERT, UPDATE or DELETE on ${table}`, async () => {
        const held: string[] = [];
        for (const priv of ["insert", "update", "delete", "truncate", "trigger", "references"]) if (await tablePriv(role, table, priv)) held.push(priv);
        expect(held).toEqual([]);
      });
    }
    it(`service_role writes ${table}`, async () => {
      for (const priv of ["select", "insert", "update", "delete"]) expect(await tablePriv("service_role", table, priv), priv).toBe(true);
    });
  }

  it("no client role calls the trigger function that keeps each row to its business", async () => {
    for (const role of CLIENT_ROLES) expect(await fnPriv(role, "fm_post_link_same_business()"), role).toBe(false);
  });

  it("a signed-in owner writes no post link into a follow (contact_consents has no client write)", async () => {
    const rowsChanged = await h.asUser(A.ownerId).run((tx) => tx.update(s.contactConsents).set({ postLinkId: null }).where(eq(s.contactConsents.businessId, A.businessId)).returning());
    expect(rowsChanged).toEqual([]);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.postLinks).values({ businessId: A.businessId, assetId: A.postAssetIds[0]!, network: "x", code: "abcdefgh22" }))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.insert(s.postAttributions).values({ businessId: A.businessId, linkId: A.postLinks[0]!.id, assetId: A.postLinks[0]!.assetId, network: A.postLinks[0]!.network as "x" | null, outcomeKind: "follow", outcomeEventId: crypto.randomUUID(), originId: crypto.randomUUID(), outcomeAt: now }))).rejects.toThrow(/permission denied/);
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

describe("structural: what the client roles may call and create", () => {
  // Every security-definer function in `public` that is not a trigger function and that a client role can EXECUTE.
  // A new one must be added here on purpose (and reviewed); a service-only one revokes from public, anon and
  // authenticated (docs/DECISIONS.md, 0087).
  const MAY_CALL: Record<(typeof CLIENT_ROLES)[number], readonly string[]> = {
    // The RLS helpers: each answers about the caller (auth.uid()) or a public flag, never another person's data.
    anon: ["business_has_members(uuid)", "has_role(uuid,text[])", "is_community_member(uuid)", "is_community_moderator(uuid)", "is_member(uuid)", "is_public(uuid)", "is_thread_participant(uuid)"],
    authenticated: [
      "business_has_members(uuid)", "has_role(uuid,text[])", "is_community_member(uuid)", "is_community_moderator(uuid)", "is_member(uuid)", "is_public(uuid)", "is_thread_participant(uuid)",
      "audit_log_verify(uuid)",
      "connection_is_blocked(uuid,uuid)",
      "fm_set_share_one_to_one_calls(boolean)",
      "is_community_invitee(uuid)",
      // 0094 (granted by 0095): whether the caller is a member of the business other than as a collaborator; the
      // policies that close the admin-written, Money and Legal tables to a collaborator call it as authenticated.
      "is_member_not_collaborator(uuid)",
      // 0096: takes a share lock on the caller's own membership row (auth.uid() only) for team.humans.role.
      "lock_my_membership(uuid)",
    ],
  };

  // The people helpers are for a signed-in caller and the service only: with no auth.uid() anon has no use for them.
  for (const fn of ["is_member_not_collaborator(uuid)", "lock_my_membership(uuid)"]) {
    it(`anon cannot EXECUTE ${fn}; authenticated and service_role can`, async () => {
      expect([await fnPriv("anon", fn), await fnPriv("authenticated", fn), await fnPriv("service_role", fn)]).toEqual([false, true, true]);
    });
  }

  // 0098: the event types a collaborator may read, called by the events and outbox policies as authenticated. Not
  // security definer (it reads no table), so it is not in MAY_CALL; anon never needs it and holds no EXECUTE.
  it("fm_collaborator_event_types() is not security definer, and anon cannot EXECUTE it; authenticated and service_role can", async () => {
    const [fn] = await rows<{ prosecdef: boolean }>(sql`select prosecdef from pg_proc where proname = 'fm_collaborator_event_types' and pronamespace = 'public'::regnamespace`);
    expect(fn).toEqual({ prosecdef: false });
    const sig = "fm_collaborator_event_types()";
    expect([await fnPriv("anon", sig), await fnPriv("authenticated", sig), await fnPriv("service_role", sig)]).toEqual([false, true, true]);
    await expect(h.anon().execute(sql`select fm_collaborator_event_types()`)).rejects.toThrow(/permission denied for function fm_collaborator_event_types/);
  });

  it("anon's call to a people helper is refused", async () => {
    await expect(h.anon().execute(sql`select is_member_not_collaborator(${A.businessId}::uuid)`)).rejects.toThrow(/permission denied for function is_member_not_collaborator/);
    await expect(h.anon().execute(sql`select lock_my_membership(${A.businessId}::uuid)`)).rejects.toThrow(/permission denied for function lock_my_membership/);
  });

  for (const role of CLIENT_ROLES) {
    it(`${role} can EXECUTE only the listed security-definer functions`, async () => {
      const callable = await rows<{ fn: string }>(sql`
        select p.oid::regprocedure::text as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
           and has_function_privilege(${role}::name, p.oid, 'execute')
         order by 1`);
      // Sorted here, not by `order by`: a real Postgres orders text by the database's collation, PGlite bytewise.
      expect(callable.map((r) => r.fn).sort()).toEqual([...MAY_CALL[role]].sort());
    });
    it(`${role} cannot CREATE in schema public`, async () => {
      expect(await one(sql`select has_schema_privilege(${role}::name, 'public', 'create') as ok`)).toBe(false);
    });
  }
});
