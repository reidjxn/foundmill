/**
 * Round trips per procedure (docs/DECISIONS.md "Round trips per procedure"). Production reaches Supabase's transaction
 * pooler through postgres.js, about 28 ms away from Railway's Amsterdam region, so a procedure's latency is roughly its
 * round trips times that. In October 2026 business.get made 20 of them (about 560 ms) and Home's first batch took
 * 1.7-3 s. The budgets below are counted on the wire (packages/db testing/wire.ts: the very messages postgres.js sends,
 * answered by PGlite's protocol handler) on one connection, so statements a procedure sends in parallel outside a
 * transaction are counted one after another here; production spreads them over the pool.
 *
 * A business procedure costs: the access lookup (membership and business, one statement, once per HTTP request), then
 * its RLS transaction: BEGIN, the setup sent with the first statements, any later dependent statements, COMMIT.
 */
import { repos } from "@foundmill/db";
import { createWireDb, type WireDb } from "@foundmill/db/testing/wire";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { ApiDeps } from "../context";
import { createCaller } from "../router";
import { silentLog } from "../services/log";
import { createApiModelClient } from "../services/models";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let wire: WireDb;
let deps: ApiDeps;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "trips" });
  wire = await createWireDb(hz.h.pg);
  deps = { ...hz.deps, db: wire.db };
}, 120_000);

afterAll(async () => {
  await wire?.close();
  await hz?.close();
});

type Procedure = (input?: unknown) => Promise<unknown>;
function procedure(caller: unknown, path: string): Procedure {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller) as Procedure;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

/**
 * Home's and the shell's first reads, with the most round trips each may take. Before 2026-10-12 each took 10-24; the
 * comments give the count before 2026-10-15 where it has come down since (audit api-db F3).
 */
const BUDGETS: Array<[path: string, input: (businessId: string) => unknown, trips: number]> = [
  ["business.get", (b) => ({ businessId: b }), 4],
  ["department.list", (b) => ({ businessId: b }), 4],
  ["inbox.list", (b) => ({ businessId: b }), 4],
  ["finance.overview", (b) => ({ businessId: b }), 4],
  // The cycle events, running tasks, agents and the pause, continue and queue rows, read once under RLS (was 9: read
  // twice, the first time outside a transaction on five connections).
  ["cycle.status", (b) => ({ businessId: b }), 4],
  // The same plus the vacation, the blocking count and the waiting win, in the same wave (was 10).
  ["cycle.continueState", (b) => ({ businessId: b }), 4],
  // No question to the server about which role reads (was 5 slim, 7 in full).
  ["journey.ribbon", (b) => ({ businessId: b, from: monthAgo(), to: today(), slim: true }), 4],
  ["journey.ribbon", (b) => ({ businessId: b, from: monthAgo(), to: today() }), 6],
  // Eight reads on one connection in one transaction, the business taken from the access lookup (was 10 here, up to
  // eight connections in production, the business read twice).
  ["business.autopilot.get", (b) => ({ businessId: b }), 4],
  ["dev.tasks.list", (b) => ({ businessId: b }), 4],
  ["dev.sessions.list", (b) => ({ businessId: b, limit: 200 }), 4],
  ["team.agents.list", (b) => ({ businessId: b }), 5],
  ["billing.plan", (b) => ({ businessId: b }), 4],
  ["product.roadmap.list", (b) => ({ businessId: b }), 4],
  ["product.foundations.get", (b) => ({ businessId: b }), 4],
  ["distribution.channels.list", (b) => ({ businessId: b }), 4],
  // The profile, memberships and businesses in one statement (was 3 statements on three connections).
  ["founder.profile.get", () => undefined, 1],
  ["founder.preferences.get", () => undefined, 3],
  // The guided layer's half of the same row, its own procedure (perf audit item 11): BEGIN with the setup and the read, COMMIT.
  ["founder.preferences.guidance", () => undefined, 3],
  // Home's first-week checklist: the latest sign-off rounds, a cycle event, a note opened, a founder message, the
  // accounts and Stripe, in parallel in one transaction (perf audit item 10).
  ["business.firstWeek.get", (b) => ({ businessId: b }), 4],
];

describe("round trips per procedure, on the wire", () => {
  it.each(BUDGETS)("%s stays within its budget and answers what PGlite's own driver answers", async (path, input, budget) => {
    const user = { userId: hz.A.ownerId, email: "owner@a.test" };
    const viaPglite = await procedure(hz.caller(user), path)(input(hz.A.businessId));
    wire.reset();
    const viaWire = await procedure(createCaller(deps, user), path)(input(hz.A.businessId));
    expect(wire.roundTrips(), wire.statements().join("\n")).toBeLessThanOrEqual(budget);
    expect(viaWire).toEqual(viaPglite);
  });

  it("live.summary counts the Network badge in one statement (was five, on five connections)", async () => {
    // LIVE is closed by default; the badge is read only where it is open.
    const env = { ...deps.env, LIVE_MODE: "on" };
    const user = { userId: hz.A.ownerId, email: "owner@a.test" };
    const viaPglite = await createCaller({ ...hz.deps, env }, user).live.summary();
    wire.reset();
    const viaWire = await createCaller({ ...deps, env }, user).live.summary();
    expect(wire.statements()).toHaveLength(1);
    expect(wire.roundTrips()).toBe(1);
    expect(viaWire).toEqual(viaPglite);
  });

  it("business.setTimeZone answers without waiting for the Journey's rebuild (was 11 round trips and the rebuild)", async () => {
    const refresh = vi.spyOn(repos.journeys, "refreshDaily").mockImplementation(() => new Promise<void>(() => undefined));
    try {
      wire.reset();
      const set = await createCaller(deps, { userId: hz.A.ownerId, email: "owner@a.test" }).business.setTimeZone({ businessId: hz.A.businessId, timeZone: "Asia/Tokyo" });
      expect(set.timeZone).toBe("Asia/Tokyo");
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(wire.statements().some((q) => /refresh_journey_daily/.test(q))).toBe(false);
      expect(wire.roundTrips(), wire.statements().join("\n")).toBeLessThanOrEqual(10);
    } finally {
      refresh.mockRestore();
    }
  });

  it("business.get: one access lookup, then BEGIN, the setup with all seven reads, and COMMIT", async () => {
    wire.reset();
    await createCaller(deps, { userId: hz.A.memberId }).business.get({ businessId: hz.A.businessId });
    const statements = wire.statements();
    expect(statements[0]).toMatch(/^select .* from "memberships" left join "businesses"/);
    expect(statements[1]).toBe("begin ");
    expect(statements[2]).toMatch(/^select set_config\('role', \$1, true\)/);
    expect(statements.at(-1)).toBe("commit");
    expect(wire.roundTrips()).toBe(4);
  });

  it("business.firstWeek.get never reads the specification versions (their snapshots), only the latest sign-off rounds", async () => {
    wire.reset();
    await createCaller(deps, { userId: hz.A.ownerId }).business.firstWeek.get({ businessId: hz.A.businessId });
    const statements = wire.statements();
    expect(statements.filter((q) => /from "spec_versions"/.test(q))).toEqual([]);
    expect(statements.filter((q) => /from "product_signoffs"/.test(q))).toHaveLength(1);
  });

  it("team.agents.list reads every agent's skills in one statement, however many agents there are", async () => {
    wire.reset();
    const { agents } = await createCaller(deps, { userId: hz.A.ownerId }).team.agents.list({ businessId: hz.A.businessId });
    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(wire.statements().filter((s) => /from "agent_skills"/.test(s))).toHaveLength(1);
  });

  it("an HTTP batch for one business looks up access once, and every procedure in it still answers", async () => {
    const owner = { userId: hz.A.ownerId, email: null, authenticatedAt: new Date() };
    const app = createApp({ ...deps, auth: { ...deps.auth, resolve: async () => owner, verify: async () => owner } });
    const calls = ["business.get", "department.list", "inbox.list", "cycle.status"];
    const batchInput = Object.fromEntries(calls.map((_, i) => [String(i), { json: { businessId: hz.A.businessId } }]));
    wire.reset();
    const res = await app.request(`/trpc/${calls.join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`, { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ error?: unknown }>).filter((r) => r.error)).toEqual([]);
    expect(wire.statements().filter((s) => /from "memberships" left join "businesses"/.test(s))).toHaveLength(1);
  });

  it("writes through the wire land exactly as written (json, arrays, text with quotes)", async () => {
    const owner = createCaller(deps, { userId: hz.A.ownerId, email: "owner@a.test" });
    const glossary = { revenue: `Takings "net" o'clock \\ é`, team: "The agents" };
    await owner.business.update({ businessId: hz.A.businessId, name: `Trips' "Co" ✓`, glossary });
    const created = await owner.department.create({ businessId: hz.A.businessId, name: "Wire dept", moduleKeys: ["development", "product"] });
    const stored = await hz.caller({ userId: hz.A.ownerId }).business.get({ businessId: hz.A.businessId });
    expect(stored.business.name).toBe(`Trips' "Co" ✓`);
    expect(stored.business.glossary).toEqual(glossary);
    expect(stored.departments.find((d) => d.id === created.id)?.moduleKeys).toEqual(["development", "product"]);
  });

  it("agent.conversation.send: the desk and the reply's context in one transaction, the exchange in one more (34 round trips before 2026-10-15)", async () => {
    // The api's model client without a database: its credits gate and usage booking (services/models.ts) have budgets of
    // their own; this counts what the conversation itself sends.
    const models = createApiModelClient({ MODEL_MODE: "mock", ANTHROPIC_API_KEY: undefined }, silentLog());
    const owner = createCaller({ ...deps, models }, { userId: hz.A.ownerId, email: "owner@a.test" });
    const subject = { kind: "agent" as const, id: hz.A.agentId };
    await owner.agent.conversation.send({ businessId: hz.A.businessId, subject, text: "How is it going?" });
    wire.reset();
    const sent = await owner.agent.conversation.send({ businessId: hz.A.businessId, subject, text: "What is next on your list?" });
    expect(sent.messages.map((m) => m.author)).toEqual(["founder", "agent"]);
    expect(wire.roundTrips(), wire.statements().join("\n")).toBeLessThanOrEqual(15);
    const statements = wire.statements();
    expect(statements.filter((s) => /^begin/.test(s))).toHaveLength(2);
    // Both messages in one insert, both events in one, already narrated (no update afterwards).
    expect(statements.filter((s) => /^insert into "agent_messages"/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^insert into "events"/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^update "events"/.test(s))).toHaveLength(0);
    // The audit chain is kept: one entry, linked to the one before it.
    expect(statements.filter((s) => /^insert into "audit_log"/.test(s))).toHaveLength(1);
  });

  it("a non-member is refused after the one access lookup, before any transaction", async () => {
    wire.reset();
    await expect(createCaller(deps, { userId: hz.B.ownerId }).business.get({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(wire.statements()).toHaveLength(1);
    expect(wire.roundTrips()).toBe(1);
  });
});
