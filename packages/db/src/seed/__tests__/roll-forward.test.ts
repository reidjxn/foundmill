/**
 * The sample businesses roll forward with the calendar (DECISIONS 2026-11-10): a seed dated Oct 7, 2026 read on
 * Nov 10 moves every demo timestamp forward 33 whole days (never past now), keeps founders' businesses and real
 * people's rows untouched, keeps updated_at shifted rather than stamped, redates the goal sentence, and is idempotent.
 * Also the seed's internal consistency: the customer milestones reached agree with the first payments counted, and
 * Finance's monthly figure is the three-month total over three.
 */
import { TROPHIES } from "@foundmill/journey";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import { rowsOf } from "../../repos/_shared";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { DEMO_ROLL_AUDIT_ACTION, LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID, anchorOf, demoAnchor, rollDays, rollDemoForward, seedDemo } from "../index";

const SEEDED = new Date("2026-10-07T12:00:00.000Z");
const NOW = new Date("2026-11-10T09:00:00.000Z");
const DAY = 86_400_000;

let h: TestHarness;
let db: Db;
let founderBusinessId: string;

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => rowsOf<T>(await db.execute(q))[0]!;
const ms = (v: unknown): number => new Date(v as string).getTime();

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  await seedDemo(db, { today: SEEDED, days: 730, volumeScale: 0.1 });
  // A founder's own business with a payment dated at the seed's today: a roll never moves it.
  const owner = rowsOf<{ id: string }>(await db.execute(sql`select id from auth.users limit 1`))[0]!.id;
  const b = await repos.businesses.create(db, { name: "Real Founder Co", createdBy: owner });
  founderBusinessId = b.id;
  await db.execute(sql`insert into conversions (business_id, kind, occurred_at, amount_minor, currency, first_payment) values (${b.id}::uuid, 'payment', ${SEEDED.toISOString()}::timestamptz, 1000, 'GBP', true)`);
}, 600_000);

afterAll(async () => {
  await h?.close();
});

describe("anchors and whole days", () => {
  it("reads the seed's today (or its own time for an older seed) and a roll's anchor and cutoff", () => {
    const at = new Date("2026-10-07T12:03:00.000Z");
    expect(anchorOf({ action: "seed.demo", details: { anchor: SEEDED.toISOString() }, createdAt: at })).toEqual({ anchor: SEEDED, cutoff: at });
    expect(anchorOf({ action: "seed.demo", details: {}, createdAt: at })).toEqual({ anchor: at, cutoff: at });
    expect(anchorOf({ action: DEMO_ROLL_AUDIT_ACTION, details: { anchor: "2026-11-09T12:00:00.000Z", cutoff: "2026-11-09T12:03:00.000Z" }, createdAt: NOW })).toEqual({ anchor: new Date("2026-11-09T12:00:00.000Z"), cutoff: new Date("2026-11-09T12:03:00.000Z") });
  });

  it("shifts whole days so the sample's now never passes the real one", () => {
    expect(rollDays(SEEDED, NOW)).toBe(33);
    expect(rollDays(SEEDED, new Date("2026-10-08T11:59:00.000Z"))).toBe(0);
    expect(rollDays(SEEDED, new Date("2026-10-08T12:00:00.000Z"))).toBe(1);
    expect(rollDays(SEEDED, new Date("2026-10-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("the seed agrees with itself", () => {
  it("reaches exactly the customer milestones its first payments count, and has customers in its last week", async () => {
    for (const id of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const payments = (await repos.journeys.countConversions(db, id)).payment;
      const won = new Set((await repos.journeys.listMilestones(db, id, {})).map((m) => (m.ref as { trophyKey?: string } | null)?.trophyKey).filter(Boolean));
      for (const t of TROPHIES.filter((t) => t.metric === "customers")) expect(won.has(t.key), `${id} ${t.key} at ${payments} customers`).toBe(payments >= t.threshold);
      const week = (await repos.journeys.countConversions(db, id, { from: new Date(SEEDED.getTime() - 7 * DAY), to: SEEDED })).payment;
      expect(week, id).toBeGreaterThan(0);
    }
  });
});

describe("rollDemoForward", () => {
  let before: { maxConversion: number; payments: number; milestone: number; roleUpdated: { id: string; at: number }; goalDue: string; founder: number; viewerSeat: number };

  it("moves every demo timestamp 33 days, keeps counts, and leaves the founder's business alone", async () => {
    before = {
      maxConversion: ms((await one<{ m: string }>(sql`select max(occurred_at) m from conversions where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m),
      payments: (await repos.journeys.countConversions(db, NORTHWIND_BUSINESS_ID)).payment,
      milestone: ms((await one<{ m: string }>(sql`select max(achieved_at) m from milestones where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m),
      roleUpdated: await one<{ id: string; at: string }>(sql`select id, updated_at at from entity_roles where business_id = ${LEDGERLY_BUSINESS_ID}::uuid order by updated_at limit 1`).then((r) => ({ id: r.id, at: ms(r.at) })),
      goalDue: (await one<{ d: string }>(sql`select due_on::text d from goals where business_id = ${NORTHWIND_BUSINESS_ID}::uuid limit 1`)).d,
      founder: ms((await one<{ m: string }>(sql`select max(occurred_at) m from conversions where business_id = ${founderBusinessId}::uuid`)).m),
      viewerSeat: ms((await one<{ m: string }>(sql`select max(created_at) m from memberships where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m),
    };
    // Before the roll, the calendar's last 7 days hold nothing: what the founder's report saw on Home.
    expect((await repos.journeys.countConversions(db, NORTHWIND_BUSINESS_ID, { from: new Date(NOW.getTime() - 7 * DAY), to: NOW })).payment).toBe(0);

    const moved = await rollDemoForward(db, { now: NOW });
    expect(moved.map((m) => [m.businessId, m.days])).toEqual([
      [NORTHWIND_BUSINESS_ID, 33],
      [LEDGERLY_BUSINESS_ID, 33],
    ]);

    const after = ms((await one<{ m: string }>(sql`select max(occurred_at) m from conversions where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m);
    expect(after - before.maxConversion).toBe(33 * DAY);
    expect(after).toBeLessThanOrEqual(NOW.getTime());
    expect((await repos.journeys.countConversions(db, NORTHWIND_BUSINESS_ID)).payment).toBe(before.payments);
    expect((await repos.journeys.countConversions(db, NORTHWIND_BUSINESS_ID, { from: new Date(NOW.getTime() - 7 * DAY), to: NOW })).payment).toBeGreaterThan(0);
    expect(ms((await one<{ m: string }>(sql`select max(achieved_at) m from milestones where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m) - before.milestone).toBe(33 * DAY);
    // A seeded updated_at is shifted and capped at now, never stamped with the wall clock (0074).
    const role = await one<{ at: string }>(sql`select updated_at at from entity_roles where id = ${before.roleUpdated.id}::uuid`);
    expect(ms(role.at)).toBe(Math.min(before.roleUpdated.at + 33 * DAY, NOW.getTime()));
    // Nothing reads as written after now.
    for (const table of ["conversions", "tasks", "inbox_items", "entities", "agent_sessions"]) {
      const m = await one<{ m: string | null }>(sql.raw(`select max(created_at) m from ${table} where business_id in ('${NORTHWIND_BUSINESS_ID}', '${LEDGERLY_BUSINESS_ID}')`));
      if (m.m) expect(ms(m.m), table).toBeLessThanOrEqual(NOW.getTime());
    }
    // A due date ahead stays ahead by the same distance, and the sentence names the moved date.
    const goal = await one<{ d: string; sentence: string }>(sql`select due_on::text d, sentence from goals where business_id = ${NORTHWIND_BUSINESS_ID}::uuid limit 1`);
    expect(Date.parse(goal.d) - Date.parse(before.goalDue)).toBe(33 * DAY);
    const [, m, d] = goal.d.split("-").map(Number) as [number, number, number];
    expect(goal.sentence).toMatch(new RegExp(` by ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}$`));
    // The founder's own business and real people's rows keep their times.
    expect(ms((await one<{ m: string }>(sql`select max(occurred_at) m from conversions where business_id = ${founderBusinessId}::uuid`)).m)).toBe(before.founder);
    expect(ms((await one<{ m: string }>(sql`select max(created_at) m from memberships where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`)).m)).toBe(before.viewerSeat);
    // The daily rows Home reads are refreshed: the last week has first payments again.
    const daily = await repos.journeys.dailyTotals(db, NORTHWIND_BUSINESS_ID, { from: "2026-11-03", to: "2026-11-10" });
    expect(daily.reduce((n, r) => n + r.payments, 0)).toBeGreaterThan(0);
    // The audit chain records the roll and stays intact.
    const anchor = await demoAnchor(db, NORTHWIND_BUSINESS_ID);
    expect(anchor?.anchor.toISOString()).toBe(new Date(SEEDED.getTime() + 33 * DAY).toISOString());
    expect(await repos.audit.verify(db, NORTHWIND_BUSINESS_ID)).toMatchObject({ ok: true });
  });

  it("0074: the updated_at trigger keeps the written value only while fm.demo_roll_forward is on", async () => {
    const id = before.roleUpdated.id;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('fm.demo_roll_forward', 'on', true)`);
      await tx.execute(sql`update entity_roles set updated_at = '2020-01-01T00:00:00Z' where id = ${id}::uuid`);
    });
    expect(ms((await one<{ at: string }>(sql`select updated_at at from entity_roles where id = ${id}::uuid`)).at)).toBe(Date.parse("2020-01-01T00:00:00Z"));
    await db.execute(sql`update entity_roles set updated_at = '2020-01-01T00:00:00Z' where id = ${id}::uuid`);
    expect(ms((await one<{ at: string }>(sql`select updated_at at from entity_roles where id = ${id}::uuid`)).at)).toBeGreaterThan(Date.parse("2026-01-01"));
  });

  it("is idempotent the same day and moves one day the next", async () => {
    expect(await rollDemoForward(db, { now: NOW })).toEqual([]);
    const next = await rollDemoForward(db, { now: new Date(NOW.getTime() + DAY) });
    expect(next.map((m) => m.days)).toEqual([1, 1]);
    expect(await rollDemoForward(db, { now: NOW, businessIds: [founderBusinessId] })).toEqual([]);
  });
});
