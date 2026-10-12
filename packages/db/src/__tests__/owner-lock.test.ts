/**
 * The keep-owner trigger under real concurrency (security review S9; migrations 0026 and 0035).
 *
 * Two owners demote each other in two transactions at the same moment. Under 0026 alone each trigger counted the
 * other as the remaining owner (READ COMMITTED), both committed and the business had no owner. 0035 takes the
 * business's owner lock before counting: the second transaction waits for the first, then sees its change and is
 * refused. PGlite runs one session, so this needs a Postgres:
 *   FM_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:55432/postgres
 * Each case creates its own database with just the tables the trigger reads (businesses, auth.users, memberships)
 * and the trigger statements taken verbatim from the migration files.
 */
import { randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";

const DIRECT = process.env.FM_TEST_POSTGRES_URL;

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

/** The keep-owner function and trigger as a migration wrote them (0026 creates both; 0035 replaces the function). */
function keepOwnerStatements(tag: string): string[] {
  const migration = readMigrations().find((m) => m.tag === tag);
  if (!migration) throw new Error(`no migration ${tag}`);
  return migration.statements.filter((st) => /fm_memberships_keep_owner|memberships_keep_owner/.test(st));
}

const SCHEMA = [
  "create schema auth",
  "create table auth.users (id uuid primary key)",
  "create table businesses (id uuid primary key)",
  "create table memberships (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses (id) on delete cascade, user_id uuid not null references auth.users (id) on delete cascade, role text not null)",
];

describe.skipIf(!DIRECT)("the last owner under concurrent demotions (Postgres)", () => {
  let admin: Sql;
  const created: string[] = [];

  beforeAll(() => {
    admin = postgres(DIRECT!, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    for (const name of created) await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => undefined);
    await admin.end({ timeout: 5 });
  });

  /** A database with one business owned by two people, and the trigger of the given migrations. */
  async function businessWithTwoOwners(tags: string[]) {
    const name = `fm_owner_${randomBytes(4).toString("hex")}`;
    await admin.unsafe(`create database ${name}`);
    created.push(name);
    const sql = postgres(withDb(DIRECT!, name), { max: 1, onnotice: () => undefined });
    for (const st of SCHEMA) await sql.unsafe(st);
    for (const tag of tags) for (const st of keepOwnerStatements(tag)) await sql.unsafe(st);
    const [businessId, first, second] = [randomUUID(), randomUUID(), randomUUID()];
    await sql`insert into businesses (id) values (${businessId})`;
    await sql`insert into auth.users (id) values (${first}), (${second})`;
    await sql`insert into memberships (business_id, user_id, role) values (${businessId}, ${first}, 'owner'), (${businessId}, ${second}, 'owner')`;
    const owners = async () => (await sql<{ n: number }[]>`select count(*)::int as n from memberships where business_id = ${businessId} and role = 'owner'`)[0]!.n;
    const waitingOnAdvisoryLock = async () =>
      (await admin<{ n: number }[]>`select count(*)::int as n from pg_locks l join pg_database d on d.oid = l.database where d.datname = ${name} and l.locktype = 'advisory' and not l.granted`)[0]!.n;
    return { name, url: withDb(DIRECT!, name), sql, first, second, owners, waitingOnAdvisoryLock };
  }

  /**
   * The race: the first transaction demotes its owner and stays open; the second demotes the other owner. Returns how
   * the second statement ended ("committed" or the error message) and whether it had to wait for the first.
   */
  async function race(fx: Awaited<ReturnType<typeof businessWithTwoOwners>>) {
    const one = postgres(fx.url, { max: 1, onnotice: () => undefined });
    const two = postgres(fx.url, { max: 1, onnotice: () => undefined });
    let firstDemoted!: () => void;
    const demoted = new Promise<void>((resolve) => (firstDemoted = resolve));
    let releaseFirst!: () => void;
    const mayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
    const firstTx = one.begin(async (tx) => {
      await tx`update memberships set role = 'member' where user_id = ${fx.first}`;
      firstDemoted();
      await mayCommit;
    });
    await demoted;
    let secondDone = false;
    const secondTx = two
      .begin(async (tx) => {
        await tx`update memberships set role = 'member' where user_id = ${fx.second}`;
      })
      .then(
        () => "committed",
        (err: unknown) => (err as Error).message,
      )
      .finally(() => (secondDone = true));
    // Give the second statement time to finish on its own, or to queue behind the first one's lock.
    const deadline = Date.now() + 2_000;
    let waited = false;
    while (Date.now() < deadline && !secondDone) {
      if ((await fx.waitingOnAdvisoryLock()) > 0) {
        waited = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    releaseFirst();
    await firstTx;
    const second = await secondTx;
    await Promise.all([one.end({ timeout: 1 }), two.end({ timeout: 1 })]);
    return { second, waited };
  }

  it("0026 alone: both demotions commit and the business is left without an owner (the defect)", async () => {
    const fx = await businessWithTwoOwners(["0026_membership_guards"]);
    const { second, waited } = await race(fx);
    expect(waited).toBe(false);
    expect(second).toBe("committed");
    expect(await fx.owners()).toBe(0);
    await fx.sql.end({ timeout: 1 });
  });

  it("with 0035 the second demotion waits for the first, then is refused, and one owner remains", async () => {
    const fx = await businessWithTwoOwners(["0026_membership_guards", "0035_owner_lock"]);
    const { second, waited } = await race(fx);
    expect(waited).toBe(true);
    expect(second).toMatch(/at least one owner/);
    expect(await fx.owners()).toBe(1);
    // Removing the remaining owner is still refused, and demoting one of two owners still works.
    await expect(fx.sql`delete from memberships where role = 'owner'`).rejects.toThrow(/at least one owner/);
    await fx.sql`update memberships set role = 'owner' where user_id = ${fx.second}`;
    await fx.sql`update memberships set role = 'member' where user_id = ${fx.first}`;
    expect(await fx.owners()).toBe(1);
    await fx.sql.end({ timeout: 1 });
  });

  it("with 0035 two owners removing each other: one removal waits and is refused", async () => {
    const fx = await businessWithTwoOwners(["0026_membership_guards", "0035_owner_lock"]);
    const one = postgres(fx.url, { max: 1, onnotice: () => undefined });
    const two = postgres(fx.url, { max: 1, onnotice: () => undefined });
    let removed!: () => void;
    const firstRemoved = new Promise<void>((resolve) => (removed = resolve));
    let release!: () => void;
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    const firstTx = one.begin(async (tx) => {
      await tx`delete from memberships where user_id = ${fx.first}`;
      removed();
      await mayCommit;
    });
    await firstRemoved;
    const secondTx = two.begin((tx) => tx`delete from memberships where user_id = ${fx.second}`).then(
      () => "committed",
      (err: unknown) => (err as Error).message,
    );
    for (let i = 0; i < 80 && (await fx.waitingOnAdvisoryLock()) === 0; i++) await new Promise((r) => setTimeout(r, 25));
    release();
    await firstTx;
    expect(await secondTx).toMatch(/at least one owner/);
    expect(await fx.owners()).toBe(1);
    await Promise.all([one.end({ timeout: 1 }), two.end({ timeout: 1 }), fx.sql.end({ timeout: 1 })]);
  });
});
