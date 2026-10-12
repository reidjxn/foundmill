/**
 * 0023 over data that already exists: sessions stored with the `session:pending` placeholder get their real workflow id,
 * and a business whose team was stopped and never resumed (its whole team paused, or part of it after a stop its audit
 * trail records) is marked stopped with the reason and the time its audit trail names.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0023_business_controls";
let h: TestHarness;
const ids: Record<"killed" | "revoked" | "plain" | "running" | "empty" | "restarted" | "archived", string> = { killed: "", revoked: "", plain: "", running: "", empty: "", restarted: "", archived: "" };
const STOPPED_AT = new Date("2026-10-09T14:30:00.000Z");
let pendingSession = "";
let realSession = "";

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  const owner = await h.createUser("owner@m23.test");
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const r = await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by) values ($1, $1, $2) returning id`, [`m23-${key}`, owner]);
    ids[key] = r.rows[0]!.id;
  }
  const agent = async (businessId: string, status: string, archived = false) =>
    (await h.pg.query<{ id: string }>(`insert into agents (business_id, name, agent_type, status, archived_at) values ($1, 'A', 'engineer', $2, $3) returning id`, [businessId, status, archived ? new Date() : null])).rows[0]!.id;
  const killedAgent = await agent(ids.killed, "paused");
  await agent(ids.killed, "paused");
  await agent(ids.killed, "healthy", true); // archived: does not count
  await agent(ids.revoked, "paused");
  await agent(ids.plain, "paused");
  await agent(ids.running, "paused");
  await agent(ids.running, "idle");
  // Stop all agents, then a task start set one agent back to work: the rest stayed paused with no way back.
  await agent(ids.restarted, "paused");
  await agent(ids.restarted, "healthy");
  await agent(ids.archived, "paused");
  await h.pg.query(`update businesses set archived_at = now() where id = $1`, [ids.archived]);
  const audit = (businessId: string, action: string, at?: Date) =>
    at ? h.pg.query(`insert into audit_log (business_id, actor_kind, action, created_at) values ($1, 'system', $2, $3)`, [businessId, action, at]) : h.pg.query(`insert into audit_log (business_id, actor_kind, action) values ($1, 'system', $2)`, [businessId, action]);
  await audit(ids.restarted, "business.stop_all_agents", STOPPED_AT);
  await audit(ids.restarted, "dev.tasks.start");
  await audit(ids.archived, "business.stop_all_agents");
  await audit(ids.running, "dev.tasks.start");
  await audit(ids.killed, "keys.revoke");
  await audit(ids.killed, "business.stop_all_agents");
  await audit(ids.revoked, "business.stop_all_agents");
  await audit(ids.revoked, "keys.revoke");
  pendingSession = (await h.pg.query<{ id: string }>(`insert into agent_sessions (business_id, agent_id, workflow_id) values ($1, $2, 'session:pending') returning id`, [ids.killed, killedAgent])).rows[0]!.id;
  realSession = (await h.pg.query<{ id: string }>(`insert into agent_sessions (business_id, agent_id, workflow_id) values ($1, $2, 'holiday:x:y') returning id`, [ids.killed, killedAgent])).rows[0]!.id;
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

const one = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;

describe("0023 applied over existing rows", () => {
  it("gives placeholder sessions their real workflow id and leaves the others alone", async () => {
    const rows = await one<{ id: string; workflow_id: string }>(sql`select id, workflow_id from agent_sessions order by workflow_id`);
    expect(rows.find((r) => r.id === pendingSession)?.workflow_id).toBe(`session:${pendingSession}`);
    expect(rows.find((r) => r.id === realSession)?.workflow_id).toBe("holiday:x:y");
    expect(rows.some((r) => r.workflow_id === "session:pending")).toBe(false);
  });

  it("marks a business stopped when its whole live team is paused, or part of it after a recorded stop, with the latest stop's reason", async () => {
    const rows = await one<{ id: string; reason: string | null; at: Date | null }>(sql`select id, agents_stopped_reason as reason, agents_stopped_at as at from businesses`);
    const reason = (id: string) => rows.find((r) => r.id === id)?.reason ?? null;
    expect(reason(ids.killed)).toBe("kill_switch");
    expect(reason(ids.revoked)).toBe("key_revoked");
    expect(reason(ids.plain)).toBe("kill_switch");
    expect(reason(ids.restarted)).toBe("kill_switch");
    expect(reason(ids.archived)).toBe("kill_switch");
    // Paused agents with no recorded team-wide stop (seeded or hand-made states) stay as they are.
    expect(reason(ids.running)).toBeNull();
    expect(reason(ids.empty)).toBeNull();
    expect(rows.filter((r) => r.reason !== null).every((r) => r.at !== null)).toBe(true);
    // The time is the stop's own, when the audit trail has it.
    expect(new Date(rows.find((r) => r.id === ids.restarted)!.at!).toISOString()).toBe(STOPPED_AT.toISOString());
  });

  it("records the reason on the paused agents of a stopped business only", async () => {
    const rows = await one<{ business_id: string; status: string; paused_reason: string | null; archived_at: Date | null }>(sql`select business_id, status, paused_reason, archived_at from agents`);
    expect(rows.filter((r) => r.business_id === ids.killed && r.archived_at === null).every((r) => r.paused_reason === "kill_switch")).toBe(true);
    expect(rows.find((r) => r.business_id === ids.revoked)?.paused_reason).toBe("key_revoked");
    expect(rows.filter((r) => r.business_id === ids.running).every((r) => r.paused_reason === null)).toBe(true);
    expect(rows.filter((r) => r.business_id === ids.restarted).map((r) => [r.status, r.paused_reason]).sort()).toEqual([["healthy", null], ["paused", "kill_switch"]]);
  });

  it("then keeps the flag and its reason together", async () => {
    await expect(h.pg.query(`update businesses set agents_stopped_reason = null where id = $1`, [ids.killed])).rejects.toThrow(/businesses_agents_stopped_check/);
  });
});
