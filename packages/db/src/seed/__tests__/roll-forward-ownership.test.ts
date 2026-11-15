/**
 * The roll-forward moves only the sample's own rows, for good, and never wedges (security review of PR #74):
 *
 * - M1: the nightly agent rollup writes `agent_metrics (agent_id, day)` rows for the demo businesses; a seeded row that
 *   would move onto a day the rollup already wrote is dropped (the writer's row wins) instead of rolling the whole
 *   transaction back every hour. Same for a campaign's day in `channel_metrics`.
 * - M2: a row a person writes after the seed never moves, across any number of rolls (the old cutoff became "now" after
 *   one roll and swept it in); a seeded row a person changes (an approval they resolve) leaves the sample; billing,
 *   secrets, consent and the network's posts are never touched; a seed older than the sample list gets one at its
 *   first roll from the rows created before its own entry.
 * - L4: a newer row with a far-future date is never moved back from the park; a unique index with an expression over a
 *   moved date leaves its table alone; any other key violation rolls back that table alone.
 *
 * Times are relative to the wall clock and every roll's `now` is in the past: the updated_at trigger stamps a person's
 * write with the database's now(), which must read as after the last roll.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import { rowsOf } from "../../repos/_shared";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { DEMO_OWNER_USER_ID, LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID as NW, demoAnchor, rollDemoForward, seedDemo, type DemoRollResult } from "../index";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const REAL = Date.now();
const SEEDED = new Date(REAL - 40 * DAY);
/** The first roll: 10 days after the seed's today, still 30 days before the wall clock. */
const R1 = new Date(SEEDED.getTime() + 10 * DAY + HOUR);

let h: TestHarness;
let db: Db;

const all = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> => rowsOf<T>(await db.execute(q));
const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => (await all<T>(q))[0]!;
const ms = (v: unknown): number => new Date(v as string).getTime();
const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10);
const roll = (at: Date, businessIds: readonly string[] = [NW]): Promise<DemoRollResult[]> => rollDemoForward(db, { now: at, businessIds });

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  await seedDemo(db, { today: SEEDED, days: 60, volumeScale: 0.05, refreshDaily: false });
}, 600_000);

afterAll(async () => {
  await h?.close();
});

describe("the sample list", () => {
  it("records every seeded row of a dated table, and none of the excluded tables", async () => {
    const lists = await all<{ table_name: string; n: number }>(sql`select table_name, cardinality(row_ids)::int n from demo_sample_rows where business_id = ${NW}::uuid`);
    const by = new Map(lists.map((l) => [l.table_name, l.n]));
    for (const table of ["conversions", "tasks", "inbox_items", "channel_metrics", "entities", "agent_sessions"]) {
      const count = (await one<{ n: number }>(sql.raw(`select count(*)::int n from ${table} where business_id = '${NW}'`))).n;
      expect(by.get(table), table).toBe(count);
    }
    for (const table of ["usage_ledger", "audit_log", "memberships", "posts", "demo_sample_rows"]) expect(by.has(table), table).toBe(false);
  });
});

describe("rolls never collide (M1) and never move a newer row (L4)", () => {
  let agentId: string;
  let channelRow: { channel_id: string; campaign_id: string | null; day: string };
  const rollup = async (day: string, tasksDone: number) => repos.agents.upsertMetric(db, NW, { agentId, day, tasksDone, successRate: 1, reviewFindings: 0, approvalsRejected: 0, ratingAvg: null, costMinor: 0 });

  it("survives the nightly rollup writing the day a seeded row moves onto, night after night", async () => {
    // An agent with two seeded weeks of days up to the seed's today (on the sample list, as the seed's own rows are):
    // they move onto the days the rollup writes.
    agentId = (await one<{ id: string }>(sql`select id from agents where business_id = ${NW}::uuid order by id limit 1`)).id;
    const seeded = await all<{ id: string }>(
      sql`insert into agent_metrics (business_id, agent_id, day, tasks_done) select ${NW}::uuid, ${agentId}::uuid, ${dayOf(SEEDED.getTime())}::date - n, 3 from generate_series(0, 13) n returning id`,
    );
    await db.execute(sql`insert into demo_sample_rows (business_id, table_name, row_ids) values (${NW}::uuid, 'agent_metrics', ${`{${seeded.map((r) => r.id).join(",")}}`}::uuid[]) on conflict (business_id, table_name) do update set row_ids = demo_sample_rows.row_ids || excluded.row_ids`);
    // A channel's last seeded day; a channel engine writes the day it will move onto (created after the seed). The
    // seed's days name no campaign, which the unique index lets through twice; a roll still never doubles a day.
    channelRow = await one(sql`select channel_id, campaign_id, day::text from channel_metrics where business_id = ${NW}::uuid order by day desc limit 1`);
    await db.execute(sql`insert into channel_metrics (business_id, channel_id, campaign_id, day, currency, impressions, source) values (${NW}::uuid, ${channelRow.channel_id}::uuid, ${channelRow.campaign_id}::uuid, ${channelRow.day}::date + 10, 'GBP', 4242, 'estimate')`);
    // A newer row parked a century ahead by its writer (a sentinel): never "moved back".
    await rollup("2125-06-01", 7);

    // The night before the first roll, the rollup wrote yesterday.
    await rollup(dayOf(R1.getTime() - DAY), 11);
    const nights: { at: Date; write?: string }[] = [
      { at: R1, write: dayOf(R1.getTime()) },
      { at: new Date(R1.getTime() + DAY), write: dayOf(R1.getTime() + DAY) },
      { at: new Date(R1.getTime() + 2 * DAY) },
      { at: new Date(R1.getTime() + 3 * DAY) },
    ];
    let dropped = 0;
    for (const night of nights) {
      const moved = await roll(night.at);
      expect(moved.map((m) => m.days), night.at.toISOString()).toEqual([night.at === R1 ? 10 : 1]);
      expect(moved[0]!.skipped).toEqual([]);
      dropped += moved[0]!.dropped;
      if (night.write) await rollup(night.write, 11);
    }
    expect(dropped).toBeGreaterThan(0);
    // One row per agent and day; the rollup's rows kept their figures and their days; the sentinel stayed put.
    const rows = await all<{ day: string; tasks_done: number }>(sql`select day::text, tasks_done from agent_metrics where agent_id = ${agentId}::uuid order by day`);
    expect(new Set(rows.map((r) => r.day)).size).toBe(rows.length);
    for (const d of [dayOf(R1.getTime() - DAY), dayOf(R1.getTime()), dayOf(R1.getTime() + DAY)]) expect(rows.find((r) => r.day === d)?.tasks_done, d).toBe(11);
    expect(rows.find((r) => r.day === "2125-06-01")?.tasks_done).toBe(7);
    // The written day is the engine's alone; the seeded ones that would have landed on it are gone.
    const written = new Date(Date.parse(channelRow.day) + 10 * DAY).toISOString().slice(0, 10);
    const days = await all<{ impressions: number }>(sql`select impressions::int from channel_metrics where channel_id = ${channelRow.channel_id}::uuid and campaign_id is not distinct from ${channelRow.campaign_id}::uuid and day = ${written}::date`);
    expect(days).toEqual([{ impressions: 4242 }]);
    expect(await repos.audit.verify(db, NW)).toMatchObject({ ok: true });
  });
});

describe("rows people write never move (M2)", () => {
  const LG = LEDGERLY_BUSINESS_ID;
  let personal: { inbox: string; task: string; approval: string; resolvedAt: number; usage: { id: string; at: number }; post: { id: string; at: number } | null; conversion: { id: string; at: number } };

  it("keeps a person's rows, and a seeded row they changed, where they are across three rolls; the sample keeps moving", async () => {
    const anchor = (await demoAnchor(db, LG))!;
    const window = new Date(anchor.cutoff.getTime() + 5 * DAY);
    // A note and a task an owner wrote after the seed; dated inside the window the sample's rows move through.
    const note = await repos.inbox.createHumanMessage(db, LG, { fromUserId: DEMO_OWNER_USER_ID, subject: "Real note", bodyMd: "Written by a person." });
    await db.execute(sql`update inbox_items set created_at = ${window.toISOString()}::timestamptz where id = ${note.id}::uuid`);
    const task = await one<{ id: string }>(
      sql`insert into tasks (business_id, title, kind, status, created_at) select ${LG}::uuid, 'A task a person filed', kind, 'planned', ${window.toISOString()}::timestamptz from tasks where business_id = ${LG}::uuid limit 1 returning id`,
    );
    // A seeded approval the owner resolves now: from then on it is theirs.
    const approval = await one<{ id: string }>(sql`select id from approvals where business_id = ${LG}::uuid order by requested_at desc limit 1`);
    const resolvedAt = new Date(REAL - HOUR);
    await db.execute(sql`update approvals set resolved_at = ${resolvedAt.toISOString()}::timestamptz, outcome = 'approved', by_kind = 'user', by_id = ${DEMO_OWNER_USER_ID}::uuid where id = ${approval.id}::uuid`);
    const usage = await one<{ id: string; at: string }>(sql`select id, created_at at from usage_ledger where business_id = ${LG}::uuid order by created_at desc limit 1`);
    const post = (await all<{ id: string; at: string }>(sql`select id, created_at at from posts where business_id = ${LG}::uuid order by created_at desc limit 1`))[0] ?? null;
    const conversion = await one<{ id: string; at: string }>(sql`select id, occurred_at at from conversions where business_id = ${LG}::uuid order by occurred_at desc limit 1`);
    personal = { inbox: note.id, task: task.id, approval: approval.id, resolvedAt: resolvedAt.getTime(), usage: { id: usage.id, at: ms(usage.at) }, post: post ? { id: post.id, at: ms(post.at) } : null, conversion: { id: conversion.id, at: ms(conversion.at) } };

    const at = (t: number) => new Date(anchor.anchor.getTime() + t * DAY + HOUR);
    let shifted = 0;
    for (const [i, t] of [10, 11, 13].entries()) {
      const moved = await roll(at(t), [LG]);
      expect(moved).toHaveLength(1);
      shifted += moved[0]!.days;
      expect(moved[0]!.backfilled).toBe(false);
      if (i === 0) expect(moved[0]!.released).toBeGreaterThanOrEqual(1);
      // The person's rows: exactly where they were.
      expect(ms((await one<{ at: string }>(sql`select created_at at from inbox_items where id = ${personal.inbox}::uuid`)).at), `note after roll ${i + 1}`).toBe(window.getTime());
      expect(ms((await one<{ at: string }>(sql`select created_at at from tasks where id = ${personal.task}::uuid`)).at), `task after roll ${i + 1}`).toBe(window.getTime());
      expect(ms((await one<{ at: string }>(sql`select resolved_at at from approvals where id = ${personal.approval}::uuid`)).at), `approval after roll ${i + 1}`).toBe(personal.resolvedAt);
      // Billing and the network's posts: never touched, seeded or not.
      expect(ms((await one<{ at: string }>(sql`select created_at at from usage_ledger where id = ${personal.usage.id}::uuid`)).at)).toBe(personal.usage.at);
      if (personal.post) expect(ms((await one<{ at: string }>(sql`select created_at at from posts where id = ${personal.post.id}::uuid`)).at)).toBe(personal.post.at);
      // The sample: moved by every roll so far.
      expect(ms((await one<{ at: string }>(sql`select occurred_at at from conversions where id = ${personal.conversion.id}::uuid`)).at), `sample after roll ${i + 1}`).toBe(personal.conversion.at + shifted * DAY);
    }
    expect(shifted).toBe(13);
    expect(await repos.audit.verify(db, LG)).toMatchObject({ ok: true });
  });

  it("gives a seed older than the sample list one at its first roll, from the rows created before its own entry", async () => {
    // Rebuild the situation of a deployment seeded before 0074: Northwind's list is gone and nothing has rolled since.
    await db.execute(sql`delete from demo_sample_rows where business_id = ${NW}::uuid`);
    const anchor = (await demoAnchor(db, NW))!;
    const settled = anchor.settledAt ?? anchor.cutoff;
    // A note a person writes now (after every roll so far, after the cutoff of the last one).
    const note = await repos.inbox.createHumanMessage(db, NW, { fromUserId: DEMO_OWNER_USER_ID, subject: "Real note", bodyMd: "Written by a person." });
    const noteAt = ms((await one<{ at: string }>(sql`select created_at at from inbox_items where id = ${note.id}::uuid`)).at);
    expect(noteAt).toBeGreaterThan(settled.getTime());
    const sample = await one<{ id: string; at: string }>(sql`select id, occurred_at at from conversions where business_id = ${NW}::uuid order by occurred_at desc limit 1`);
    const moved = await roll(new Date(anchor.anchor.getTime() + 2 * DAY + HOUR));
    expect(moved.map((m) => [m.days, m.backfilled])).toEqual([[2, true]]);
    expect(ms((await one<{ at: string }>(sql`select created_at at from inbox_items where id = ${note.id}::uuid`)).at)).toBe(noteAt);
    expect(ms((await one<{ at: string }>(sql`select occurred_at at from conversions where id = ${sample.id}::uuid`)).at)).toBe(ms(sample.at) + 2 * DAY);
    expect((await one<{ n: number }>(sql`select count(*)::int n from demo_sample_rows where business_id = ${NW}::uuid`)).n).toBeGreaterThan(10);
  });
});

describe("guards (L4)", () => {
  it("leaves a table alone when its unique index is an expression over a moved date, and rolls back a table that would break a key", async () => {
    // A table whose unique key is an expression over its date, and one whose key is a generated column the checks cannot see.
    await db.execute(sql.raw(`create table rf_probe_expr (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, day date not null, created_at timestamptz not null default now())`));
    await db.execute(sql.raw(`create unique index rf_probe_expr_day on rf_probe_expr (business_id, (day + 0))`));
    await db.execute(sql.raw(`create table rf_probe_gen (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, day date not null, day_n int generated always as (day - date '2000-01-01') stored, created_at timestamptz not null default now(), unique (business_id, day_n))`));
    try {
      const anchor = (await demoAnchor(db, NW))!;
      const d0 = dayOf(anchor.anchor.getTime() - 3 * DAY);
      const expr = await one<{ id: string }>(sql`insert into rf_probe_expr (business_id, day) values (${NW}::uuid, ${d0}::date) returning id`);
      const gen = await one<{ id: string }>(sql`insert into rf_probe_gen (business_id, day) values (${NW}::uuid, ${d0}::date) returning id`);
      // The day the sample's row would move onto, held by a row written after the seed.
      await db.execute(sql`insert into rf_probe_gen (business_id, day) values (${NW}::uuid, ${d0}::date + 1)`);
      await db.execute(sql`insert into demo_sample_rows (business_id, table_name, row_ids) values (${NW}::uuid, 'rf_probe_expr', array[${expr.id}::uuid]), (${NW}::uuid, 'rf_probe_gen', array[${gen.id}::uuid])`);
      const sample = await one<{ id: string; at: string }>(sql`select id, occurred_at at from conversions where business_id = ${NW}::uuid order by occurred_at desc limit 1`);

      const moved = await roll(new Date(anchor.anchor.getTime() + DAY + HOUR));
      expect(moved.map((m) => m.days)).toEqual([1]);
      expect(moved[0]!.skipped.map((s) => s.table).sort()).toEqual(["rf_probe_expr", "rf_probe_gen"]);
      expect(moved[0]!.skipped.find((s) => s.table === "rf_probe_expr")?.reason).toMatch(/expression/);
      expect(moved[0]!.skipped.find((s) => s.table === "rf_probe_gen")?.reason).toMatch(/key violation/);
      // Both probe tables as they were; the rest of the sample moved.
      expect((await one<{ d: string }>(sql`select day::text d from rf_probe_expr where id = ${expr.id}::uuid`)).d).toBe(d0);
      expect((await one<{ d: string }>(sql`select day::text d from rf_probe_gen where id = ${gen.id}::uuid`)).d).toBe(d0);
      expect(ms((await one<{ at: string }>(sql`select occurred_at at from conversions where id = ${sample.id}::uuid`)).at)).toBe(ms(sample.at) + DAY);
    } finally {
      await db.execute(sql.raw(`delete from demo_sample_rows where table_name in ('rf_probe_expr', 'rf_probe_gen')`));
      await db.execute(sql.raw(`drop table if exists rf_probe_expr`));
      await db.execute(sql.raw(`drop table if exists rf_probe_gen`));
    }
  });
});
