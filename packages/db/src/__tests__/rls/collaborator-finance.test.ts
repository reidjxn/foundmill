/**
 * 0107 — a collaborator reads no Finance figure of the tables a collaborator's own screens read (the migration's header
 * gives the reasons):
 *
 *   - `conversions`: a collaborator reads no row of the table; every row through `member_conversions`, with
 *     `amount_minor` null. The repos read the view on every client role's connection, so the collaborator's counts,
 *     lists and Customer Updates are whole and only the money is gone; everyone else reads the amounts as before;
 *   - `journey_daily`: a collaborator's `spend_minor` and `revenue_minor` are null (the repo reads them as 0); the counts
 *     stay; everyone else as before;
 *   - nobody reaches another business through either view, and an ended collaborator reaches nothing;
 *   - `member_conversions` is SELECT only for the signed-in and the service, nothing for anon: a write through the view
 *     (a single-table view, so auto-updatable, and run as its owner) is refused by its grants.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let cofounder: string;
let collaborator: string;
let ended: string;
let paymentId: string;
let paymentB: string;

const AMOUNT = 4_900;
const DAY = "2026-11-02";

type Rows<T> = { rows: T[] };
const rows = async <T>(id: string, q: ReturnType<typeof sql>): Promise<T[]> => ((await h.asUser(id).run((tx) => tx.execute(q))) as unknown as Rows<T>).rows;
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (err) {
    const messages: string[] = [];
    for (let e: unknown = err; e && typeof e === "object" && messages.length < 4; e = (e as { cause?: unknown }).cause) messages.push(String((e as { message?: unknown }).message ?? ""));
    return messages.join(" | ");
  }
};

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "money-a");
  B = await createBusinessFixture(h, "money-b");
  [cofounder, collaborator, ended] = await Promise.all([h.createUser("money-cofounder@test.local"), h.createUser("money-collaborator@test.local"), h.createUser("money-ended@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: A.businessId, userId: cofounder, role: "cofounder" },
    { businessId: A.businessId, userId: collaborator, role: "collaborator" },
    { businessId: A.businessId, userId: ended, role: "collaborator", expiresAt: new Date(Date.now() - 60_000) },
  ]);
  // A first payment in each business, written by the service (the table is read-only for the client roles).
  const at = new Date(`${DAY}T12:00:00Z`);
  paymentId = (await repos.journeys.recordConversion(h.db, A.businessId, { entityId: A.entityId, kind: "payment", amountMinor: AMOUNT, currency: "EUR", occurredAt: at })).id;
  paymentB = (await repos.journeys.recordConversion(h.db, B.businessId, { entityId: B.entityId, kind: "payment", amountMinor: 7_700, currency: "EUR", occurredAt: at })).id;
  await repos.journeys.refreshDaily(h.db);
}, 120_000);
afterAll(() => h?.close());

describe("conversions 0107: a collaborator reads them without the amounts", () => {
  it("reads no row of the table, and every row through member_conversions with amount_minor null", async () => {
    expect(await rows(collaborator, sql`select id from conversions where business_id = ${A.businessId}::uuid`)).toHaveLength(0);
    const seen = await rows<{ id: string; kind: string; amount_minor: string | number | null; currency: string }>(collaborator, sql`select id, kind, amount_minor, currency from member_conversions where business_id = ${A.businessId}::uuid`);
    const truth = (await h.db.select({ id: s.conversions.id }).from(s.conversions).where(eq(s.conversions.businessId, A.businessId))).map((r) => r.id);
    expect(seen.map((r) => r.id).sort()).toEqual([...truth].sort());
    expect(seen.every((r) => r.amount_minor === null)).toBe(true);
    expect(seen.find((r) => r.id === paymentId)).toMatchObject({ kind: "payment", currency: "EUR" });
  });

  it("the repos read the view for a client role: the collaborator's counts and lists are whole, without money", async () => {
    const asCollaborator = h.asUser(collaborator);
    const list = await asCollaborator.run((tx) => repos.journeys.listConversions(tx, A.businessId, { kind: "payment", limit: 50 }));
    expect(list.items.map((c) => c.id)).toContain(paymentId);
    expect(list.items.every((c) => c.amountMinor === null)).toBe(true);
    const counts = await asCollaborator.run((tx) => repos.journeys.countConversions(tx, A.businessId));
    const truth = await repos.journeys.countConversions(h.db, A.businessId);
    expect(counts).toEqual(truth);
    expect(counts.payment).toBeGreaterThanOrEqual(1);
    expect((await asCollaborator.run((tx) => repos.journeys.getConversion(tx, A.businessId, paymentId))).amountMinor).toBeNull();
    // A Customer Update joins its conversion: listed, with the amount gone.
    const journey = await repos.journeys.create(h.db, A.businessId, { conversionId: paymentId, matchdayLevel: "league" });
    const updates = await asCollaborator.run((tx) => repos.journeys.list(tx, A.businessId, { limit: 50 }));
    const row = updates.items.find((j) => j.id === journey.id);
    expect(row?.conversion).toMatchObject({ id: paymentId, kind: "payment", amountMinor: null });
    expect((await asCollaborator.run((tx) => repos.journeys.get(tx, A.businessId, journey.id))).conversion.amountMinor).toBeNull();
    expect(await asCollaborator.run((tx) => repos.journeys.paymentPercentile75(tx, A.businessId))).toBeNull();
  });

  it("the owner, a cofounder, an admin, a member and a viewer read the amounts as before, through the table and the view", async () => {
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId, A.viewerId]) {
      expect(await rows<{ amount_minor: string | number }>(id, sql`select amount_minor from conversions where id = ${paymentId}::uuid`), id).toEqual([{ amount_minor: expect.anything() }]);
      const [viewRow] = await rows<{ amount_minor: string | number }>(id, sql`select amount_minor from member_conversions where id = ${paymentId}::uuid`);
      expect(Number(viewRow?.amount_minor), id).toBe(AMOUNT);
      expect((await h.asUser(id).run((tx) => repos.journeys.getConversion(tx, A.businessId, paymentId))).amountMinor, id).toBe(AMOUNT);
      expect(await h.asUser(id).run((tx) => repos.journeys.paymentPercentile75(tx, A.businessId)), id).not.toBeNull();
    }
    // The service reads the table.
    expect((await h.service().run((tx) => repos.journeys.getConversion(tx, A.businessId, paymentId))).amountMinor).toBe(AMOUNT);
  });

  it("an ended collaborator reads nothing, and nobody reaches another business through the view", async () => {
    expect(await rows(ended, sql`select id from member_conversions`)).toHaveLength(0);
    expect(await rows(ended, sql`select id from conversions`)).toHaveLength(0);
    // A's collaborator and A's owner see none of B's; B's owner none of A's.
    for (const id of [collaborator, A.ownerId]) expect(await rows(id, sql`select id from member_conversions where business_id = ${B.businessId}::uuid or id = ${paymentB}::uuid`), id).toHaveLength(0);
    expect(await rows(B.ownerId, sql`select id from member_conversions where business_id = ${A.businessId}::uuid or id = ${paymentId}::uuid`)).toHaveLength(0);
    expect(await rows(B.ownerId, sql`select id from member_conversions where id = ${paymentB}::uuid`)).toHaveLength(1);
    expect(await h.anon().run((tx) => tx.execute(sql`select id from member_conversions`)).then(() => "read", (e: Error) => e.message)).toMatch(/permission denied/);
  });

  it("member_conversions is SELECT only for the signed-in and the service: no write through it, for anyone", async () => {
    const privileges = ((await h.db.execute(sql`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'member_conversions' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') order by 1, 2`)) as unknown as Rows<{ grantee: string; privilege_type: string }>).rows;
    expect(privileges).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
    for (const id of [A.ownerId, collaborator]) {
      expect(await failure(h.asUser(id).run((tx) => tx.execute(sql`update member_conversions set kind = 'signup' where id = ${paymentId}::uuid`))), id).toMatch(/permission denied/);
      expect(await failure(h.asUser(id).run((tx) => tx.execute(sql`delete from member_conversions where id = ${paymentId}::uuid`))), id).toMatch(/permission denied/);
      expect(await failure(h.asUser(id).run((tx) => tx.execute(sql`insert into member_conversions (business_id, kind) values (${A.businessId}::uuid, 'payment')`))), id).toMatch(/permission denied/);
    }
    expect(await failure(h.service().run((tx) => tx.execute(sql`update member_conversions set kind = 'signup' where id = ${paymentId}::uuid`)))).toMatch(/permission denied/);
    const [still] = await h.db.select({ kind: s.conversions.kind, amount: s.conversions.amountMinor }).from(s.conversions).where(eq(s.conversions.id, paymentId));
    expect(still).toEqual({ kind: "payment", amount: AMOUNT });
  });

  it("the table has the one select policy 0107 wrote, closed to a collaborator", async () => {
    const policies = (await h.db.execute(sql`select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'conversions'`)) as unknown as Rows<{ policyname: string; cmd: string; qual: string }>;
    expect(policies.rows).toEqual([{ policyname: "conversions_select", cmd: "SELECT", qual: "is_member_not_collaborator(business_id)" }]);
  });
});

describe("journey_daily 0107: a collaborator's spend and revenue are null", () => {
  const dayRow = (id: string, businessId: string) => rows<{ spend_minor: string | number | null; revenue_minor: string | number | null; payments: number }>(id, sql`select spend_minor, revenue_minor, payments from journey_daily where business_id = ${businessId}::uuid and day = ${DAY}::date`);

  it("a collaborator reads the day with its counts and without its money; the repo reads 0", async () => {
    const seen = await dayRow(collaborator, A.businessId);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.spend_minor === null && r.revenue_minor === null)).toBe(true);
    expect(seen.reduce((n, r) => n + Number(r.payments), 0)).toBeGreaterThanOrEqual(1);
    const repoRows = await h.asUser(collaborator).run((tx) => repos.journeys.dailyRange(tx, A.businessId, { from: DAY, to: DAY }));
    expect(repoRows.length).toBeGreaterThan(0);
    expect(repoRows.every((r) => r.spendMinor === 0 && r.revenueMinor === 0)).toBe(true);
    const quarters = await h.asUser(collaborator).run((tx) => repos.journeys.quarterTotals(tx, A.businessId, { from: DAY, to: DAY }));
    expect(quarters.map((q) => [q.revenueMinor, q.spendMinor])).toEqual([[0, 0]]);
    expect(quarters[0]?.payments).toBeGreaterThanOrEqual(1);
  });

  it("everyone else reads the revenue as before; nobody reads another business's days; an ended collaborator nothing", async () => {
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId, A.viewerId]) {
      const revenue = (await dayRow(id, A.businessId)).reduce((n, r) => n + Number(r.revenue_minor ?? 0), 0);
      expect(revenue, id).toBe(AMOUNT);
    }
    expect((await h.asUser(A.ownerId).run((tx) => repos.journeys.quarterTotals(tx, A.businessId, { from: DAY, to: DAY })))[0]?.revenueMinor).toBe(AMOUNT);
    for (const id of [collaborator, A.ownerId]) expect(await dayRow(id, B.businessId), id).toHaveLength(0);
    expect(await dayRow(B.ownerId, A.businessId)).toHaveLength(0);
    expect(await rows(ended, sql`select day from journey_daily`)).toHaveLength(0);
  });
});
