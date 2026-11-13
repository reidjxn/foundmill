/**
 * 0094 over a database that already has people (review of the grant rule, PR #113's follow-ups):
 *
 *   - `memberships.section_permissions` names only `SECTIONS` (@foundmill/shared), each "read", "write" or "none": the
 *     CHECK's list is the same as the walls' list, every known section and level is stored, anything else is refused,
 *     for the service connection too; the repo's `SectionPermissions` refuses an unknown key in plain words first;
 *   - rows stored before it keep their known keys and lose the unknown ones; a level that is not read, write or none
 *     stops the migration instead, with nothing applied;
 *   - `lock_my_membership(bid)` holds the caller's own row `for share` under RLS, where a locking read of one's own row
 *     finds nothing; anon cannot call it; `getForUpdate` locks only a row the caller may change.
 *
 * The migration's number may change when branches merge: `TAG` below is the one place this file names it.
 */
import { SECTIONS, ValidationError } from "@foundmill/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { repos } from "../repos";
import * as s from "../schema";
import { createTestDb, unwrapDbError, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0094_membership_grant_guards";
const CHECK = "memberships_section_permissions_known";

let h: TestHarness;
let A: BusinessFixture;
let refusedFirst = "";
let unknownKeys = "";
let unknownOnly = "";
let walled = "";

const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const row = (userId: string) => and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, userId));
const permissionsOf = async (userId: string) => (await h.db.select({ p: s.memberships.sectionPermissions }).from(s.memberships).where(row(userId)))[0]?.p;
/** What Postgres said, or "written": the error's messages and its causes', through drizzle's wrapper. */
const message = (p: Promise<unknown>) =>
  p.then(
    () => "written",
    (err: unknown) => {
      const messages: string[] = [];
      for (let e: unknown = unwrapDbError(err); e && typeof e === "object" && messages.length < 4; e = (e as { cause?: unknown }).cause) messages.push(String((e as { message?: unknown }).message ?? ""));
      return messages.join(" | ");
    },
  );
const setRaw = (userId: string, json: string) => message(h.db.execute(sql`update memberships set section_permissions = ${json}::jsonb where business_id = ${A.businessId}::uuid and user_id = ${userId}::uuid`));

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  A = await createBusinessFixture(h, "m-section-keys");
  const migration = all.find((m) => m.tag === TAG)!.sql;
  [unknownKeys, unknownOnly, walled] = await Promise.all([h.createUser("m94-unknown@test.local"), h.createUser("m94-unknown-only@test.local"), h.createUser("m94-walled@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: A.businessId, userId: unknownKeys, role: "member", sectionPermissions: { finance: "none", money: "write", plan: "read" } },
    { businessId: A.businessId, userId: unknownOnly, role: "viewer", sectionPermissions: { marketing: "write" } },
    { businessId: A.businessId, userId: walled, role: "admin", sectionPermissions: { finance: "none", legal: "read" } },
  ]);
  // A level the walls do not know stops the migration, and nothing of it is applied.
  await setRaw(A.viewerId, `{"product":"admin"}`);
  refusedFirst = await message(h.pg.exec(migration));
  await setRaw(A.viewerId, `{}`);
  await h.pg.exec(migration);
}, 120_000);
afterAll(() => h?.close());

describe(`${TAG}: what a membership's section permissions may name`, () => {
  it("a level other than read, write or none stopped the migration before it changed anything", async () => {
    expect(refusedFirst).toMatch(/0094: 1 memberships hold section permissions that are not an object of read, write or none/);
  });

  it("rows from before keep their known keys and lose the unknown ones; other rows are untouched", async () => {
    expect(await permissionsOf(unknownKeys)).toEqual({ finance: "none" });
    expect(await permissionsOf(unknownOnly)).toEqual({});
    expect(await permissionsOf(walled)).toEqual({ finance: "none", legal: "read" });
    expect(await permissionsOf(A.ownerId)).toEqual({});
  });

  it("the CHECK's list is the walls' list", async () => {
    const [def] = await rows<{ def: string }>(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${CHECK} and conrelid = 'memberships'::regclass`);
    const arrays = [...(def?.def ?? "").matchAll(/ARRAY\[([^\]]*)\]/g)].map((m) => [...(m[1] ?? "").matchAll(/'([a-z_]+)'::text/g)].map((k) => k[1]));
    expect(arrays).toHaveLength(1);
    expect([...arrays[0]!].sort()).toEqual([...SECTIONS].sort());
  });

  it("stores every known section at every level, and refuses anything else, for the service connection too", async () => {
    for (const section of SECTIONS) for (const level of ["read", "write", "none"]) expect(await setRaw(walled, JSON.stringify({ [section]: level })), `${section}=${level}`).toBe("written");
    expect(await setRaw(walled, JSON.stringify(Object.fromEntries(SECTIONS.map((x) => [x, "none"]))))).toBe("written");
    for (const json of [`{"money":"write"}`, `{"finance":"none","plan":"read"}`, `{"finance":"admin"}`, `{"finance":1}`, `{"finance":null}`, `[]`, `"finance"`, `null`]) {
      expect(await setRaw(walled, json), json).toMatch(new RegExp(CHECK));
    }
    expect(await message(h.service().execute(sql`update memberships set section_permissions = '{"money":"write"}'::jsonb where business_id = ${A.businessId}::uuid and user_id = ${walled}::uuid`))).toMatch(new RegExp(CHECK));
    expect(await message(h.asUser(A.ownerId).execute(sql`update memberships set section_permissions = '{"money":"write"}'::jsonb where business_id = ${A.businessId}::uuid and user_id = ${walled}::uuid`))).toMatch(new RegExp(CHECK));
  });

  it("the repo refuses an unknown key in plain words before the database sees it", async () => {
    const refused = await repos.memberships.setSectionPermissions(h.db, A.businessId, walled, { money: "write" } as never).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((refused as ValidationError).details)).toContain("No such section: money");
    await expect(repos.memberships.add(h.db, A.businessId, { userId: await h.createUser("m94-add@test.local"), role: "member", sectionPermissions: { plan: "read" } as never })).rejects.toBeInstanceOf(ValidationError);
    expect((await repos.memberships.setSectionPermissions(h.db, A.businessId, walled, { finance: "none" })).sectionPermissions).toEqual({ finance: "none" });
  });
});

describe(`${TAG}: locking one's own membership`, () => {
  it("under RLS a locking read of one's own row finds nothing; lock_my_membership holds it for share and the repo reads it after", async () => {
    await h.asUser(A.adminId).run(async (tx) => {
      expect(await repos.memberships.getActive(tx, A.businessId, A.adminId, { lock: "share" })).toBeNull();
      const mine = await repos.memberships.getMineForShare(tx, A.businessId, A.adminId);
      expect(mine).toMatchObject({ userId: A.adminId, role: "admin" });
      // The row's xmax is this transaction: the lock is held until it ends.
      const [held] = ((await tx.execute(sql`select xmax = pg_current_xact_id()::xid as held from memberships where business_id = ${A.businessId}::uuid and user_id = ${A.adminId}::uuid`)) as unknown as { rows: { held: boolean }[] }).rows;
      expect(held?.held).toBe(true);
    });
  });

  it("answers about the caller only: false outside the business and on the service connection; anon cannot call it", async () => {
    const outsider = await h.createUser("m94-outsider@test.local");
    expect(await h.asUser(outsider).execute<{ locked: boolean }>(sql`select lock_my_membership(${A.businessId}::uuid) as locked`)).toEqual([{ locked: false }]);
    expect(await h.service().execute<{ locked: boolean }>(sql`select lock_my_membership(${A.businessId}::uuid) as locked`)).toEqual([{ locked: false }]);
    await expect(h.anon().execute(sql`select lock_my_membership(${A.businessId}::uuid)`)).rejects.toThrow(/permission denied/);
    const [may] = await rows<{ anon: boolean; authenticated: boolean; service: boolean }>(sql`
      select has_function_privilege('anon', 'lock_my_membership(uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'lock_my_membership(uuid)', 'execute') as authenticated,
             has_function_privilege('service_role', 'lock_my_membership(uuid)', 'execute') as service`);
    expect(may).toEqual({ anon: false, authenticated: true, service: true });
  });

  it("getForUpdate locks only a row the caller may change: not their own, not an owner's for an admin", async () => {
    await h.asUser(A.adminId).run(async (tx) => {
      expect(await repos.memberships.getForUpdate(tx, A.businessId, A.memberId)).toMatchObject({ userId: A.memberId });
      expect(await repos.memberships.getForUpdate(tx, A.businessId, A.ownerId)).toBeNull();
      expect(await repos.memberships.getForUpdate(tx, A.businessId, A.adminId)).toBeNull();
    });
    await h.asUser(A.ownerId).run(async (tx) => expect(await repos.memberships.getForUpdate(tx, A.businessId, A.adminId)).toMatchObject({ userId: A.adminId }));
  });
});
