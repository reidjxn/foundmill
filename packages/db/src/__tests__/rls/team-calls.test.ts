/**
 * 0082 Team call: `team_calls`, `team_call_turns`, `team_call_actions`, the widened `plans.origin` and
 * `agents.speech_accent`. The generated suite (tables.ts) covers the generic tenancy cases per table; this one exercises
 * the repo as the api uses it under RLS and the parts the generic suite cannot see: the column grants on a call, the
 * insert-only turns and action items, references across businesses, the turn shape, the example viewer, the plan origin
 * and who may choose how an agent sounds.
 */
import { NotFoundError, PLAN_ACTION_TYPES, ValidationError } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, unwrapDbError, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;
let exampleViewerId: string;
/** A live call of B with one turn and one action item, written by the service role. */
let bCallId: string;

/** A superuser write's Postgres error as the runners report it (Drizzle wraps it in "Failed query"). */
const raw = <T>(p: Promise<T>): Promise<T> => p.catch((err: unknown) => Promise.reject(unwrapDbError(err)));
/** A repo's ValidationError whose issues (or message) say `re`. */
const invalid = (re: RegExp) => (err: unknown) => err instanceof ValidationError && re.test(`${err.message} ${JSON.stringify(err.details ?? null)}`);

const say = (userId: string, text: string, clientTurnId?: string) => ({ speaker: "founder" as const, userId, text, via: "typed" as const, clientTurnId });
const reply = (agentId: string, text: string) => ({ speaker: "agent" as const, agentId, text, to: "founder" as const });

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "call-a");
  B = await createBusinessFixture(h, "call-b");
  outsiderId = await h.createUser("call-outsider@test.local");
  exampleViewerId = await h.createUser("call-example@test.local");
  await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: exampleViewerId, role: "viewer", source: "example" });
  bCallId = await h.service().run(async (tx) => {
    const call = await repos.teamCalls.create(tx, B.businessId, { kind: "team", agentIds: [B.agentId, B.agent2Id], topic: "Pricing", startedBy: B.ownerId });
    await repos.teamCalls.appendTurns(tx, B.businessId, call.id, [say(B.ownerId, "Where are we on pricing?", "b-1"), reply(B.agentId, "We have two options.")]);
    await tx.insert(s.teamCallActions).values({ businessId: B.businessId, callId: call.id, position: 0, actionType: "update_roadmap", title: "Add pricing page", status: "not_filed" });
    return call.id;
  });
}, 120_000);
afterAll(() => h?.close());

describe("team calls (0082): tenancy through the repo", () => {
  it("a member of A reads nothing of B's calls, turns or action items", async () => {
    await expect(h.asUser(A.memberId).run((tx) => repos.teamCalls.get(tx, B.businessId, bCallId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await h.asUser(A.memberId).run((tx) => repos.teamCalls.list(tx, B.businessId))).toEqual([]);
    expect(await h.asUser(A.memberId).run((tx) => repos.teamCalls.turns(tx, B.businessId, bCallId))).toEqual([]);
    expect(await h.asUser(A.memberId).run((tx) => repos.teamCalls.actions(tx, B.businessId, bCallId))).toEqual([]);
    // Even naming its own business, A's member never reaches B's rows.
    await expect(h.asUser(A.memberId).run((tx) => repos.teamCalls.get(tx, A.businessId, bCallId))).rejects.toBeInstanceOf(NotFoundError);
    const visible = await h.asUser(A.ownerId).run((tx) => tx.select({ businessId: s.teamCallTurns.businessId }).from(s.teamCallTurns));
    expect(visible.every((r) => r.businessId === A.businessId)).toBe(true);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.teamCalls))).toEqual([]);
  });

  it("a member of A writes nothing of B: no call, no turn, no wrap-up, no reopening", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.create(tx, B.businessId, { kind: "one_to_one", agentIds: [B.agentId], startedBy: A.ownerId }))).rejects.toThrow();
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.teamCalls).values({ businessId: B.businessId, kind: "team", agentIds: [B.agentId] }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.appendTurns(tx, B.businessId, bCallId, [say(A.ownerId, "Hello?")]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.claimWrapUp(tx, B.businessId, bCallId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, B.businessId, bCallId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.finish(tx, B.businessId, bCallId, { summary: "x", actions: [] }))).rejects.toThrow();
    const b = await h.service().run((tx) => repos.teamCalls.get(tx, B.businessId, bCallId));
    expect(b).toMatchObject({ status: "live", turnCount: 2 });
  });

  it("an app role starts a call only as itself, live, and speaks only as itself", async () => {
    const forged = (values: Partial<typeof s.teamCalls.$inferInsert>) =>
      h.asUser(A.memberId).run((tx) => tx.insert(s.teamCalls).values({ businessId: A.businessId, kind: "team", agentIds: [A.agentId], startedBy: A.memberId, ...values }));
    await expect(forged({ startedBy: A.ownerId })).rejects.toThrow(/permission denied/);
    await expect(forged({ status: "ended" })).rejects.toThrow(/permission denied/);
    await expect(forged({ turnCount: 5 })).rejects.toThrow();
    await expect(forged({ agentIds: [B.agentId] })).rejects.toThrow(/permission denied/);
    const callId = await h.asUser(A.memberId).run(async (tx) => (await repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.memberId })).id);
    await expect(h.asUser(A.memberId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.ownerId, "Words put in the owner's mouth")]))).rejects.toThrow(/permission denied/);
    const own = await h.asUser(A.memberId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.memberId, "My own words")]));
    expect(own.turns[0]!.userId).toBe(A.memberId);
  });

  it("a row of A cannot point at B's call, agents, departments or plans", async () => {
    // A turn or an action item of A on B's call: refused by the insert policy (the call is not one A can see), and by the composite key (call_id, business_id).
    await expect(
      h.asUser(A.ownerId).run((tx) => tx.insert(s.teamCallTurns).values({ businessId: A.businessId, callId: bCallId, seq: 99, speaker: "founder", userId: A.ownerId, text: "Hi" })),
    ).rejects.toThrow(/foreign key|row-level security/);
    await expect(
      h.asUser(A.ownerId).run((tx) => tx.insert(s.teamCallActions).values({ businessId: A.businessId, callId: bCallId, position: 99, actionType: "create_task", title: "x", status: "not_filed" })),
    ).rejects.toThrow(/foreign key|row-level security/);
    // The repo checks the ids an array or a plain foreign key would accept from another business.
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId, B.agentId], startedBy: A.ownerId }))).rejects.toThrow(/agent of this business/);
    const callId = await h.asUser(A.ownerId).run(async (tx) => (await repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.ownerId })).id);
    await h.asUser(A.ownerId).run((tx) => repos.teamCalls.claimWrapUp(tx, A.businessId, callId));
    for (const bad of [{ agentId: B.agentId }, { departmentId: B.departmentId }, { planId: B.planId }, { planActionId: B.planActionId }]) {
      await expect(
        h.asUser(A.ownerId).run((tx) => repos.teamCalls.finish(tx, A.businessId, callId, { summary: "s", actions: [{ actionType: "create_task", title: "Do it", status: "filed", ...bad }] })),
      ).rejects.toThrow(/of this business/);
    }
  });
});

describe("team calls (0082): viewers never write", () => {
  for (const who of ["viewer", "example viewer"] as const) {
    it(`a ${who} reads A's calls and writes none of them`, async () => {
      const userId = who === "viewer" ? A.viewerId : exampleViewerId;
      const call = await h.asUser(A.memberId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.memberId }));
      expect((await h.asUser(userId).run((tx) => repos.teamCalls.get(tx, A.businessId, call.id))).id).toBe(call.id);
      await expect(h.asUser(userId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "one_to_one", agentIds: [A.agentId], startedBy: userId }))).rejects.toThrow(RLS_DENIED);
      // The row lock is an update: a reader takes none, so the call is not found to append to.
      await expect(h.asUser(userId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, call.id, [say(userId, "Can I speak?")]))).rejects.toThrow();
      await expect(
        h.asUser(userId).run((tx) => tx.insert(s.teamCallTurns).values({ businessId: A.businessId, callId: call.id, seq: 50, speaker: "founder", userId, text: "Hi" })),
      ).rejects.toThrow(RLS_DENIED);
      await expect(
        h.asUser(userId).run((tx) => tx.insert(s.teamCallActions).values({ businessId: A.businessId, callId: call.id, position: 50, actionType: "reply_only", title: "x", status: "not_filed" })),
      ).rejects.toThrow(RLS_DENIED);
      expect(await h.asUser(userId).run((tx) => repos.teamCalls.claimWrapUp(tx, A.businessId, call.id))).toBe(false);
      expect((await h.service().run((tx) => repos.teamCalls.get(tx, A.businessId, call.id))).status).toBe("live");
      await h.service().run((tx) => repos.teamCalls.claimWrapUp(tx, A.businessId, call.id));
      expect(await h.asUser(userId).run((tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, A.businessId, call.id))).toBe(false);
      await expect(h.asUser(userId).run((tx) => repos.teamCalls.finish(tx, A.businessId, call.id, { summary: "x", actions: [] }))).rejects.toThrow();
      expect((await h.service().run((tx) => repos.teamCalls.get(tx, A.businessId, call.id))).status).toBe("wrapping_up");
    });
  }
});

describe("team calls (0082): what app roles may change", () => {
  it("turns and action items are never updated or deleted by an app role, owner included", async () => {
    const call = await h.asUser(A.ownerId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.ownerId }));
    const { turns } = await h.asUser(A.ownerId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, call.id, [say(A.ownerId, "Let's plan the launch")]));
    await h.asUser(A.ownerId).run((tx) => repos.teamCalls.claimWrapUp(tx, A.businessId, call.id));
    const { actions } = await h.asUser(A.ownerId).run((tx) => repos.teamCalls.finish(tx, A.businessId, call.id, { summary: "We planned the launch.", actions: [{ actionType: "reply_only", title: "Nothing to do", status: "not_filed" }] }));
    for (const who of [A.ownerId, A.adminId, A.memberId]) {
      await expect(h.asUser(who).run((tx) => tx.update(s.teamCallTurns).set({ text: "I never said that" }).where(eq(s.teamCallTurns.id, turns[0]!.id)))).rejects.toThrow(/permission denied/);
      await expect(h.asUser(who).run((tx) => tx.delete(s.teamCallTurns).where(eq(s.teamCallTurns.id, turns[0]!.id)))).rejects.toThrow(/permission denied/);
      await expect(h.asUser(who).run((tx) => tx.update(s.teamCallActions).set({ status: "filed" }).where(eq(s.teamCallActions.id, actions[0]!.id)))).rejects.toThrow(/permission denied/);
      await expect(h.asUser(who).run((tx) => tx.delete(s.teamCallActions).where(eq(s.teamCallActions.id, actions[0]!.id)))).rejects.toThrow(/permission denied/);
    }
    const [kept] = await h.db.select().from(s.teamCallTurns).where(eq(s.teamCallTurns.id, turns[0]!.id));
    expect(kept?.text).toBe("Let's plan the launch");
  });

  it("on a call an app role changes only status, summary, counters, ended_at and updated_at, and deletes nothing", async () => {
    const call = await h.asUser(A.memberId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], topic: "Hiring", startedBy: A.memberId }));
    const where = eq(s.teamCalls.id, call.id);
    for (const patch of [{ kind: "one_to_one" as const }, { agentIds: [A.agent2Id] }, { topic: "Something else" }, { startedBy: A.ownerId }, { startedAt: new Date("2020-01-01T00:00:00Z") }, { businessId: B.businessId }]) {
      await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.teamCalls).set(patch).where(where))).rejects.toThrow(/permission denied/);
    }
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.teamCalls).where(where))).rejects.toThrow(/permission denied/);
    const rows = await h.asUser(A.memberId).run((tx) => tx.update(s.teamCalls).set({ turnCount: 0, agentRoundsSinceFounder: 0, summary: null, updatedAt: new Date() }).where(where).returning({ id: s.teamCalls.id }));
    expect(rows).toHaveLength(1);
  });
});

describe("team calls (0082): the database's checks", () => {
  const callOf = async () => (await h.service().run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId, A.agent2Id], startedBy: A.ownerId }))).id;

  it("a call has 1 to 8 distinct agents, exactly one when one-to-one, and an end time exactly when ended", async () => {
    const ids = Array.from({ length: 9 }, () => crypto.randomUUID());
    await expect(raw(h.db.insert(s.teamCalls).values({ businessId: A.businessId, kind: "team", agentIds: [] }))).rejects.toThrow(/team_calls_agents_size/);
    await expect(raw(h.db.insert(s.teamCalls).values({ businessId: A.businessId, kind: "team", agentIds: ids }))).rejects.toThrow(/team_calls_agents_size/);
    await expect(raw(h.db.insert(s.teamCalls).values({ businessId: A.businessId, kind: "one_to_one", agentIds: [A.agentId, A.agent2Id] }))).rejects.toThrow(/team_calls_one_to_one_single/);
    await expect(raw(h.db.insert(s.teamCalls).values({ businessId: A.businessId, kind: "team", agentIds: [A.agentId], status: "ended" }))).rejects.toThrow(/team_calls_ended_dated/);
    await expect(raw(h.db.insert(s.teamCalls).values({ businessId: A.businessId, kind: "team", agentIds: [A.agentId], topic: "x".repeat(201) }))).rejects.toThrow(/team_calls_topic_size/);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "one_to_one", agentIds: [A.agentId, A.agent2Id], startedBy: A.ownerId }))).rejects.toSatisfy(invalid(/exactly one agent/));
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId, A.agentId], startedBy: A.ownerId }))).rejects.toSatisfy(invalid(/on a call once/));
  });

  it("a new turn names its speaker; the shape survives the agent or the account going", async () => {
    const callId = await callOf();
    await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "agent", text: "Hi" }))).rejects.toThrow(/names the agent/);
    await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "founder", text: "Hi" }))).rejects.toThrow(/names the person/);
    await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "agent", agentId: A.agentId, via: "typed", text: "Hi" }))).rejects.toThrow(/agent_shape/);
    await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "founder", userId: A.ownerId, agentId: A.agentId, text: "Hi" }))).rejects.toThrow(/founder_shape/);
    await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "founder", userId: A.ownerId, text: "" }))).rejects.toThrow(/text_size/);
    for (const bad of [{ agentId: "not-a-uuid" }, { agentId: A.agentId, extra: 1 }, "everyone", 7]) {
      await expect(raw(h.db.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 1, speaker: "agent", agentId: A.agentId, text: "Hi", addressedTo: bad as never }))).rejects.toThrow(/addressed_to_shape/);
    }

    // A deleted agent and a deleted account leave the turns (with nobody named), and the business still deletes cleanly.
    const user = await h.createUser("call-leaver@test.local");
    const [gone] = await h.db.insert(s.agents).values({ businessId: A.businessId, name: "Temp", agentType: "engineer" }).returning({ id: s.agents.id });
    const tempCall = (await h.service().run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [gone!.id], startedBy: user }))).id;
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: user, role: "member" });
    await h.service().run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, tempCall, [say(user, "Hello team"), { ...reply(gone!.id, "Hello"), to: { agentId: gone!.id } }]));
    await h.db.delete(s.agents).where(eq(s.agents.id, gone!.id));
    await h.db.delete(s.memberships).where(eq(s.memberships.userId, user));
    await h.db.execute(sql`delete from auth.users where id = ${user}::uuid`);
    const left = await h.service().run((tx) => repos.teamCalls.turns(tx, A.businessId, tempCall));
    expect(left.map((t) => [t.speaker, t.agentId, t.userId])).toEqual([
      ["founder", null, null],
      ["agent", null, null],
    ]);
    expect((await h.service().run((tx) => repos.teamCalls.get(tx, A.businessId, tempCall))).startedBy).toBeNull();

    const doomed = await createBusinessFixture(h, "call-doomed");
    await h.service().run((tx) => repos.teamCalls.appendTurns(tx, doomed.businessId, doomed.teamCallId, [say(doomed.ownerId, "One last thing"), reply(doomed.agentId, "Sure.")]));
    // As the seed's rebuild deletes a business (0053 lets the named business's audit chain go with it).
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('fm.purge_business', ${doomed.businessId}, true)`);
      await tx.delete(s.businesses).where(eq(s.businesses.id, doomed.businessId));
    });
    expect(await h.db.select().from(s.teamCallTurns).where(eq(s.teamCallTurns.businessId, doomed.businessId))).toEqual([]);
  });

  it("an action item takes every plan action type, a known status, and a target only as a pair", async () => {
    const callId = await callOf();
    await h.db.insert(s.teamCallActions).values(PLAN_ACTION_TYPES.map((actionType, position) => ({ businessId: A.businessId, callId, position, actionType, title: actionType, status: "not_filed" as const })));
    await expect(raw(h.db.insert(s.teamCallActions).values({ businessId: A.businessId, callId, position: 90, actionType: "launch_rocket" as never, title: "x", status: "filed" }))).rejects.toThrow(/action_type_known/);
    await expect(raw(h.db.insert(s.teamCallActions).values({ businessId: A.businessId, callId, position: 91, actionType: "create_task", title: "x", status: "done" as never }))).rejects.toThrow(/status_known/);
    await expect(raw(h.db.insert(s.teamCallActions).values({ businessId: A.businessId, callId, position: 92, actionType: "create_task", title: "x", status: "filed", targetKind: "task" }))).rejects.toThrow(/target_pair/);
    await expect(raw(h.db.insert(s.teamCallActions).values({ businessId: A.businessId, callId, position: 0, actionType: "create_task", title: "x", status: "filed" }))).rejects.toThrow(/position_key/);
  });
});

describe("plans.origin (0082)", () => {
  it("accepts team_call, written by a member under RLS, and still refuses an unknown origin", async () => {
    const [plan] = await h.asUser(A.memberId).run((tx) => tx.insert(s.plans).values({ businessId: A.businessId, origin: "team_call", status: "executing" }).returning());
    expect(plan?.origin).toBe("team_call");
    for (const origin of ["option", "free_text", "playbook", "holiday"] as const) {
      await h.db.insert(s.plans).values({ businessId: A.businessId, origin });
    }
    await expect(raw(h.db.insert(s.plans).values({ businessId: A.businessId, origin: "meeting" as never }))).rejects.toThrow(/plans_origin_check/);
    await expect(h.asUser(A.viewerId).run((tx) => tx.insert(s.plans).values({ businessId: A.businessId, origin: "team_call" }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("one-to-one calls are private by default (0082)", () => {
  it("only the person who made a private call reads it, its turns and its actions, or speaks on it", async () => {
    // The database decides from the person's own setting, whatever the caller asks for.
    const callId = await h.asUser(A.memberId).run(async (tx) => (await repos.teamCalls.create(tx, A.businessId, { kind: "one_to_one", agentIds: [A.agentId], startedBy: A.memberId, visibility: "project" })).id);
    expect((await h.asUser(A.memberId).run((tx) => repos.teamCalls.get(tx, A.businessId, callId))).visibility).toBe("private");
    await h.asUser(A.memberId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.memberId, "Just between us")]));
    expect((await h.asUser(A.memberId).run((tx) => repos.teamCalls.turns(tx, A.businessId, callId))).map((t) => t.text)).toEqual(["Just between us"]);
    // The owner of the business sees none of it, and cannot add to it.
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.get(tx, A.businessId, callId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await h.asUser(A.ownerId).run((tx) => repos.teamCalls.turns(tx, A.businessId, callId))).toEqual([]);
    expect((await h.asUser(A.ownerId).run((tx) => repos.teamCalls.list(tx, A.businessId))).some((c) => c.id === callId)).toBe(false);
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.ownerId, "Let me in")]))).rejects.toThrow();
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.teamCallTurns).values({ businessId: A.businessId, callId, seq: 50, speaker: "founder", userId: A.ownerId, text: "Let me in" }))).rejects.toThrow();
    // A team call is always the project's.
    await expect(h.asUser(A.memberId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.memberId, visibility: "private" }))).rejects.toThrow();
    // An app role cannot change visibility itself.
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.teamCalls).set({ visibility: "project" }).where(eq(s.teamCalls.id, callId)))).rejects.toThrow();
  });

  it("sharing changes the setting and the person's calls together; shared calls are read by the project but spoken on only by their person", async () => {
    const callId = await h.asUser(A.adminId).run(async (tx) => (await repos.teamCalls.create(tx, A.businessId, { kind: "one_to_one", agentIds: [A.agentId], startedBy: A.adminId })).id);
    await h.asUser(A.adminId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.adminId, "Thinking out loud")]));
    expect(await h.asUser(A.adminId).run((tx) => repos.preferences.shareOneToOneCalls(tx, A.adminId))).toBe(false);
    const shared = await h.asUser(A.adminId).run((tx) => repos.preferences.setShareOneToOneCalls(tx, true));
    expect(shared.share).toBe(true);
    expect(shared.calls).toBeGreaterThanOrEqual(1);
    expect(await h.asUser(A.adminId).run((tx) => repos.preferences.shareOneToOneCalls(tx, A.adminId))).toBe(true);
    // Read by the project now…
    expect((await h.asUser(A.ownerId).run((tx) => repos.teamCalls.turns(tx, A.businessId, callId))).map((t) => t.text)).toEqual(["Thinking out loud"]);
    // …but nobody else speaks on it, ends it or changes it.
    await expect(h.asUser(A.ownerId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [say(A.ownerId, "Me too")]))).rejects.toThrow();
    expect(await h.asUser(A.ownerId).run((tx) => repos.teamCalls.claimWrapUp(tx, A.businessId, callId)).catch(() => false)).toBe(false);
    // A new call follows the setting.
    const next = await h.asUser(A.adminId).run((tx) => repos.teamCalls.create(tx, A.businessId, { kind: "one_to_one", agentIds: [A.agentId], startedBy: A.adminId }));
    expect(next.visibility).toBe("project");
    // Off again: private again, and changing it twice reports no calls the second time.
    expect((await h.asUser(A.adminId).run((tx) => repos.preferences.setShareOneToOneCalls(tx, false))).calls).toBeGreaterThanOrEqual(2);
    expect((await h.asUser(A.adminId).run((tx) => repos.preferences.setShareOneToOneCalls(tx, false))).calls).toBe(0);
    expect(await h.asUser(A.ownerId).run((tx) => repos.teamCalls.turns(tx, A.businessId, callId))).toEqual([]);
    // Nobody else's calls move: the member's private call above stays private for the admin's switch.
    expect(await h.asUser(A.memberId).run((tx) => repos.preferences.shareOneToOneCalls(tx, A.memberId))).toBe(false);
  });

  it("no member writes an agent's turn: agent turns are the service's", async () => {
    const callId = await h.asUser(A.memberId).run(async (tx) => (await repos.teamCalls.create(tx, A.businessId, { kind: "team", agentIds: [A.agentId], startedBy: A.memberId })).id);
    await expect(h.asUser(A.memberId).run((tx) => repos.teamCalls.appendTurns(tx, A.businessId, callId, [reply(A.agentId, "Planted words")]))).rejects.toThrow();
    const written = await repos.teamCalls.appendTurns(h.db, A.businessId, callId, [reply(A.agentId, "The api's own words")]);
    expect(written.turns[0]!.speaker).toBe("agent");
  });
});

describe("agents.speech_accent (0082)", () => {
  it("an owner or an admin chooses it; a member, a viewer and another business cannot; the shape is checked", async () => {
    const owner = await h.asUser(A.ownerId).run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agentId, "talia"));
    expect(owner.speechAccent).toBe("talia");
    expect((await h.asUser(A.adminId).run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agentId, null))).speechAccent).toBeNull();
    await expect(h.asUser(A.memberId).run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agentId, "darian"))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.agents).values({ businessId: A.businessId, name: "New", agentType: "engineer", speechAccent: "darian" }))).rejects.toThrow(/permission denied/);
    // A member still edits every other column of an agent (the 0004 policy is unchanged).
    await h.asUser(A.memberId).run((tx) => repos.agents.setModel(tx, A.businessId, A.agentId, "sonnet"));
    await expect(h.asUser(A.viewerId).run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agentId, "darian"))).rejects.toThrow();
    await expect(h.asUser(A.ownerId).run((tx) => repos.agents.setSpeechAccent(tx, B.businessId, B.agentId, "darian"))).rejects.toBeInstanceOf(NotFoundError);
    expect((await h.db.select({ v: s.agents.speechAccent }).from(s.agents).where(eq(s.agents.id, B.agentId)))[0]?.v).toBeNull();
    await expect(h.asUser(A.ownerId).run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agentId, "Talia"))).rejects.toSatisfy(invalid(/lowercase/));
    await expect(raw(h.db.update(s.agents).set({ speechAccent: "x" }).where(eq(s.agents.id, A.agentId)))).rejects.toThrow(/speech_accent_shape/);
    // Service code (the seed, the api's service connection) is not an app role.
    expect((await h.service().run((tx) => repos.agents.setSpeechAccent(tx, A.businessId, A.agent2Id, "eldrin"))).speechAccent).toBe("eldrin");
  });
});
