/**
 * Anthropomorphic agents (0067), the api side the DATA brief owns: idea.commit's Launch switch writes the founder's
 * preference (and a failed write never fails the commit), the committed team carries persona keys unique in the
 * business and away from the founder's other business, every agent read the web shows carries `personaKey`, the
 * EntityLink lookup never hands out another business's agent's key, and the boot backfill is idempotent and never throws.
 */
import { repos, entities as entitiesTable, agents as agentsTable } from "@foundmill/db";
import { personaByKey, type AgentStyle } from "@foundmill/shared";
import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backfillPersonasOnBoot } from "../services/persona-backfill";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "anthropomorphic", temporalClient: fakeTemporalClient() });
}, 120_000);
afterAll(() => hz.close());

async function founder(email: string) {
  const userId = await hz.h.createUser(email);
  const caller = hz.caller({ userId, email });
  await caller.founder.profile.update({ confirmAdult: true, displayName: "Reid", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 12 }, targetMarkets: ["US"], riskAppetite: "medium" });
  ownerOf.set(caller, userId);
  return { userId, caller };
}

/** Whose caller it is, so a test that commits several projects can move the owner to Studio (Try holds one project). */
const ownerOf = new WeakMap<object, string>();

async function commit(caller: Awaited<ReturnType<typeof founder>>["caller"], name: string, extra: { anthropomorphicAgents?: boolean; agentStyle?: AgentStyle } = {}) {
  const generated = await caller.idea.generate({ prompt: `${name} for small teams` });
  // Try holds one project (A14): this owner takes charge of several, so their plan is Studio before the next commit.
  await hz.db.execute(sql`update businesses set plan_tier = 'scale' where created_by = ${ownerOf.get(caller) ?? null}`);
  return caller.idea.commit({ ideaId: generated.ideas[0]!.id, name, archetype: "b2b_saas", gameMode: "personal", ...extra });
}

const quiet = { info: () => undefined, warn: () => undefined };

describe("idea.commit and the Launch step's switch", () => {
  it("writes the choice to the founder's preferences; leaving it out changes nothing", async () => {
    const { caller } = await founder("persona-launch@test.local");
    // A first-time founder's new profile starts with named agents on (WP-14 T6); the Launch step's choice still decides.
    expect((await caller.founder.preferences.guidance()).anthropomorphicAgents).toBe(true);
    await commit(caller, "Plain Roles", { anthropomorphicAgents: false });
    expect((await caller.founder.preferences.guidance()).anthropomorphicAgents).toBe(false);
    await commit(caller, "Second Without Choice");
    expect((await caller.founder.preferences.guidance()).anthropomorphicAgents).toBe(false);
    await commit(caller, "Friendly Faces", { anthropomorphicAgents: true });
    expect((await caller.founder.preferences.guidance()).anthropomorphicAgents).toBe(true);
    await expect(commit(caller, "Bad Input", { anthropomorphicAgents: "yes" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("0069: the Launch step's style goes on the account with the switch, alone or together; leaving it out changes nothing", async () => {
    const { caller } = await founder("persona-launch-style@test.local");
    expect(await caller.founder.preferences.guidance()).toMatchObject({ anthropomorphicAgents: true, agentStyle: "humans" });
    await commit(caller, "Elves And Wizards", { anthropomorphicAgents: true, agentStyle: "fantasy" });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ anthropomorphicAgents: true, agentStyle: "fantasy" });
    await commit(caller, "Style Only", { agentStyle: "cartoon_2d" });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ anthropomorphicAgents: true, agentStyle: "cartoon_2d" });
    await commit(caller, "Switch Only");
    expect(await caller.founder.preferences.guidance()).toMatchObject({ anthropomorphicAgents: true, agentStyle: "cartoon_2d" });
    await commit(caller, "Off Keeps Style", { anthropomorphicAgents: false });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ anthropomorphicAgents: false, agentStyle: "cartoon_2d" });
    await expect(commit(caller, "Bad Style", { agentStyle: "anime" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a preference that fails to save never fails the commit", async () => {
    const { caller } = await founder("persona-launch-fail@test.local");
    const spy = vi.spyOn(repos.preferences, "update").mockRejectedValueOnce(new Error("database blip"));
    try {
      const result = await commit(caller, "Still Committed", { anthropomorphicAgents: false });
      expect(result.alreadyCommitted).toBe(false);
      expect(result.agentIds.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
    // The choice was not saved: the account keeps what it had (on, for this first-time founder).
    expect((await caller.founder.preferences.guidance()).anthropomorphicAgents).toBe(true);
  });

  it("the committed team has catalog keys, unique in the business, and the founder's next business avoids them", async () => {
    const { caller } = await founder("persona-two-businesses@test.local");
    const first = await commit(caller, "First Of Two");
    const second = await commit(caller, "Second Of Two");
    const keysOf = async (bid: string) => (await repos.agents.list(hz.db, bid, { limit: 500 })).items.map((a) => a.personaKey);
    const a = await keysOf(first.business.id);
    const b = await keysOf(second.business.id);
    for (const keys of [a, b]) {
      expect(keys.every((k) => personaByKey(k) !== null)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(b.filter((k) => a.includes(k))).toEqual([]);
  });
});

describe("agent reads carry personaKey", () => {
  it("department.list squads and leads, team.agents.list, agent.profile.get, inbox.get fromAgent and the desk", async () => {
    await repos.agents.backfillPersonas(hz.db);
    const { businessId, ownerId, agentId, agent2Id, inboxItemId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const [expected] = await hz.db.select({ k: agentsTable.personaKey }).from(agentsTable).where(eq(agentsTable.id, agentId));
    expect(expected?.k).toBeTruthy();

    const departments = await owner.department.list({ businessId });
    const lead = departments.find((d) => d.lead?.id === agentId)?.lead;
    expect(lead?.personaKey).toBe(expected!.k);
    for (const d of departments) for (const m of d.squad) expect(personaByKey(m.personaKey)).not.toBeNull();

    const team = await owner.team.agents.list({ businessId });
    expect(team.agents.find((x) => x.id === agentId)?.personaKey).toBe(expected!.k);

    const profile = await owner.agent.profile.get({ businessId, agentId: agent2Id });
    expect(personaByKey(profile.agent.personaKey)).not.toBeNull();

    const note = await owner.inbox.get({ businessId, itemId: inboxItemId });
    expect(note.fromAgent?.personaKey).toBe(expected!.k);
  });

  it("crm.entity.lookup gives an agent record its agent's key, and never another business's agent's key", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const own = await repos.entities.create(hz.db, businessId, { kind: "agent", displayName: "Own agent record", agentId });
    // A record that points at B's agent (the foreign key knows no tenants): written raw, as only a bug could.
    const [crossed] = await hz.db.insert(entitiesTable).values({ businessId, kind: "agent", displayName: "Crossed record", agentId: hz.B.agentId }).returning({ id: entitiesTable.id });
    const [ownKey] = await hz.db.select({ k: agentsTable.personaKey }).from(agentsTable).where(eq(agentsTable.id, agentId));
    const rows = await hz.caller({ userId: ownerId }).crm.entity.lookup({ businessId, entityIds: [own.id, crossed!.id] });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(own.id)?.personaKey).toBe(ownKey!.k);
    expect(byId.get(crossed!.id)?.personaKey).toBeNull();
    // B's owner learns nothing about A's records at all.
    await expect(hz.caller({ userId: hz.B.ownerId }).crm.entity.lookup({ businessId, entityIds: [own.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("boot backfill (services/persona-backfill.ts)", () => {
  it("gives agents without a key one, is idempotent, and reports a failure instead of throwing", async () => {
    await hz.db.update(agentsTable).set({ personaKey: null }).where(eq(agentsTable.id, hz.B.agent2Id));
    const first = await backfillPersonasOnBoot({ db: hz.db, log: quiet });
    expect(first).toMatchObject({ status: "done", failed: 0 });
    expect(first.status === "done" && first.agents).toBeGreaterThanOrEqual(1);
    expect(await hz.db.select({ id: agentsTable.id }).from(agentsTable).where(isNull(agentsTable.personaKey))).toEqual([]);
    expect(await backfillPersonasOnBoot({ db: hz.db, log: quiet })).toEqual({ status: "done", businesses: 0, agents: 0, failed: 0 });

    const warn = vi.fn();
    const spy = vi.spyOn(repos.agents, "backfillPersonas").mockRejectedValueOnce(new Error("database down"));
    try {
      expect(await backfillPersonasOnBoot({ db: hz.db, log: { info: () => undefined, warn } })).toEqual({ status: "failed", error: "database down" });
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
