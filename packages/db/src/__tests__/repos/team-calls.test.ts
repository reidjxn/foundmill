/** repos.teamCalls (0084): turns numbered under the call's lock, retried sends, the counters, the limits, the wrap-up. */
import { NotFoundError, TEAM_CALL_LIMITS, ValidationError } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("tcall");
});
afterAll(() => r?.close());

const say = (userId: string, text: string, clientTurnId?: string) => ({ speaker: "founder" as const, userId, text, via: "spoken" as const, clientTurnId });
const reply = (agentId: string, text: string, to: "founder" | "team" | { agentId: string } = "founder") => ({ speaker: "agent" as const, agentId, text, to });

const start = (kind: "team" | "one_to_one" = "team") =>
  r.as(r.A.ownerId, (tx) => repos.teamCalls.create(tx, r.A.businessId, { kind, agentIds: kind === "team" ? [r.A.agentId, r.A.agent2Id] : [r.A.agent2Id], topic: "  Launch plan  ", startedBy: r.A.ownerId }));

describe("teamCalls.create / get", () => {
  it("starts a live call with no turns, the topic trimmed, and reads it back", async () => {
    const call = await start();
    expect(call).toMatchObject({ businessId: r.A.businessId, kind: "team", status: "live", topic: "Launch plan", agentIds: [r.A.agentId, r.A.agent2Id], startedBy: r.A.ownerId, turnCount: 0, agentRoundsSinceFounder: 0, endedAt: null, summary: null });
    expect((await r.as(r.A.memberId, (tx) => repos.teamCalls.get(tx, r.A.businessId, call.id))).id).toBe(call.id);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.get(tx, r.A.businessId, crypto.randomUUID()))).rejects.toBeInstanceOf(NotFoundError);
    const blank = await r.as(r.A.ownerId, (tx) => repos.teamCalls.create(tx, r.A.businessId, { kind: "one_to_one", agentIds: [r.A.agentId], topic: "   ", startedBy: r.A.ownerId }));
    expect(blank.topic).toBeNull();
  });
});

describe("teamCalls.appendTurns", () => {
  it("numbers turns 1, 2, 3… across rounds and keeps them in speaking order", async () => {
    const call = await start();
    const first = await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agentId, "What is on your mind?"), reply(r.A.agent2Id, "I can talk about the build.", { agentId: r.A.agentId })]));
    expect(first.turns.map((t) => [t.seq, t.speaker, t.agentId])).toEqual([
      [1, "agent", r.A.agentId],
      [2, "agent", r.A.agent2Id],
    ]);
    expect(first.turns[1]!.addressedTo).toEqual({ agentId: r.A.agentId });
    expect(first.replayedTurnIds).toEqual([]);
    const second = await r.as(r.A.memberId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.memberId, "  The launch email.  ", "c-1")]));
    expect(second.turns[0]).toMatchObject({ seq: 3, speaker: "founder", userId: r.A.memberId, agentId: null, text: "The launch email.", via: "spoken", addressedTo: null, clientTurnId: "c-1" });
    expect(second.call.turnCount).toBe(3);
    const all = await r.as(r.A.viewerId, (tx) => repos.teamCalls.turns(tx, r.A.businessId, call.id));
    expect(all.map((t) => t.seq)).toEqual([1, 2, 3]);
    expect((await r.as(r.A.viewerId, (tx) => repos.teamCalls.turns(tx, r.A.businessId, call.id, { limit: 2 }))).map((t) => t.seq)).toEqual([2, 3]);
  });

  it("two sends at once get different numbers (the call's row is locked)", async () => {
    const call = await start();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, `Point ${i}`, `p-${i}`), reply(r.A.agentId, `Answer ${i}`)]))));
    const seqs = results.flatMap((x) => x.turns.map((t) => t.seq)).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const x of results) expect(x.turns[1]!.seq).toBe(x.turns[0]!.seq + 1);
    expect((await r.svc((tx) => repos.teamCalls.get(tx, r.A.businessId, call.id))).turnCount).toBe(8);
  });

  it("a repeated client turn id returns the turn already written and writes nothing, even after the call moved on", async () => {
    const call = await start();
    const once = await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Price it at $20", "same")]));
    await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agentId, "Twenty works.")]));
    const again = await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Price it at $20", "same")]));
    expect(again.turns[0]!.id).toBe(once.turns[0]!.id);
    expect(again.replayedTurnIds).toEqual([once.turns[0]!.id]);
    expect(again.call.turnCount).toBe(2);
    // The counters are untouched by a replay: an agent round after it still counts.
    await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agentId, "More on that.")], { agentRound: true }));
    expect((await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Price it at $20", "same")]))).call.agentRoundsSinceFounder).toBe(1);
    // Two concurrent sends of the same id: one turn.
    const [x, y] = await Promise.all([1, 2].map(() => r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Ship Friday", "race")]))));
    expect(x!.turns[0]!.id).toBe(y!.turns[0]!.id);
    expect((await r.svc((tx) => repos.teamCalls.turns(tx, r.A.businessId, call.id))).filter((t) => t.clientTurnId === "race")).toHaveLength(1);
    // After the call ended, the retry still answers with the recorded turn; a new turn is refused.
    await r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, call.id));
    expect((await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Price it at $20", "same")]))).turns[0]!.id).toBe(once.turns[0]!.id);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "New point", "new")]))).rejects.toBeInstanceOf(ValidationError);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "a", "dup"), say(r.A.ownerId, "b", "dup")]))).rejects.toThrow(/its own client turn id/);
  });

  it("a founder turn resets the agent rounds; an agent-only round adds one; the limit refuses one more", async () => {
    const call = await start();
    const rounds = async (turns: Parameters<typeof repos.teamCalls.appendTurns>[3], agentRound?: boolean) =>
      (await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, turns, { agentRound }))).call.agentRoundsSinceFounder;
    expect(await rounds([reply(r.A.agentId, "Opening.")])).toBe(0);
    for (let i = 1; i <= TEAM_CALL_LIMITS.agentRoundsWithoutFounder; i++) expect(await rounds([reply(r.A.agentId, `Round ${i}`), reply(r.A.agent2Id, `Builds on ${i}`)], true)).toBe(i);
    await expect(rounds([reply(r.A.agentId, "One more")], true)).rejects.toThrow(/founder's turn/);
    expect(await rounds([say(r.A.ownerId, "Okay, my view:", "v")])).toBe(0);
    expect(await rounds([reply(r.A.agentId, "Thanks.")])).toBe(0);
    expect(await rounds([reply(r.A.agent2Id, "And more.")], true)).toBe(1);
    await expect(rounds([say(r.A.ownerId, "Me too")], true)).rejects.toThrow(/no founder turn/);
  });

  it("refuses a call that is not live, past its length, and agents not on the call", async () => {
    const call = await start("one_to_one");
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agentId, "Not my call")]))).rejects.toThrow(/agent on the call/);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agent2Id, "Hi", { agentId: r.A.agentId })]))).rejects.toThrow(/addresses an agent on the call/);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, []))).rejects.toBeInstanceOf(ValidationError);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agent2Id, "x".repeat(TEAM_CALL_LIMITS.maxTurnChars + 1))]))).rejects.toBeInstanceOf(ValidationError);

    await r.db.update(s.teamCalls).set({ turnCount: TEAM_CALL_LIMITS.maxTurnsPerCall - 1 }).where(eq(s.teamCalls.id, call.id));
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "a"), reply(r.A.agent2Id, "b")]))).rejects.toThrow(/reached its length/);
    const last = await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Last word")]));
    expect(last.call.turnCount).toBe(TEAM_CALL_LIMITS.maxTurnsPerCall);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [reply(r.A.agent2Id, "One more")]))).rejects.toThrow(/reached its length/);

    const other = await start();
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, other.id))).toBe(true);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, other.id, [say(r.A.ownerId, "Wait")]))).rejects.toThrow(/not live/);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, crypto.randomUUID(), [say(r.A.ownerId, "Hello")]))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("teamCalls wrap-up", () => {
  it("claims once, finishes with the summary and action items, and lists the counts", async () => {
    const call = await start();
    await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Let's file it"), reply(r.A.agentId, "Agreed.")]));
    const claims = await Promise.all([1, 2, 3].map(() => r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, call.id))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, crypto.randomUUID()))).rejects.toBeInstanceOf(NotFoundError);

    const at = new Date("2026-11-12T15:45:00.000Z");
    const { call: ended, actions } = await r.as(r.A.memberId, (tx) =>
      repos.teamCalls.finish(
        tx,
        r.A.businessId,
        call.id,
        {
          summary: "  We agreed the launch email and a budget.  ",
          actions: [
            { actionType: "create_task", title: "Draft the launch email", agentId: r.A.agent2Id, departmentId: r.A.departmentId, status: "filed", target: { kind: "task", id: r.A.taskId }, planId: r.A.planId, planActionId: r.A.planActionId },
            { actionType: "update_roadmap", title: "Add pricing to the roadmap", status: "filed", target: { kind: "roadmap_item", id: r.A.roadmapItemId }, planId: r.A.planId },
            { actionType: "set_budget", title: "Set a $200 ad budget", status: "awaiting_go_ahead", target: { kind: "plan", id: r.A.planId }, planId: r.A.planId, reason: "Spending money needs your go-ahead" },
            { actionType: "request_human_action", title: "Sign the supplier contract", detail: "", status: "founder_step" },
          ],
        },
        { at },
      ),
    );
    expect(ended).toMatchObject({ status: "ended", summary: "We agreed the launch email and a budget.", endedAt: at });
    expect(actions.map((a) => [a.position, a.actionType, a.status, a.targetKind])).toEqual([
      [0, "create_task", "filed", "task"],
      [1, "update_roadmap", "filed", "roadmap_item"],
      [2, "set_budget", "awaiting_go_ahead", "plan"],
      [3, "request_human_action", "founder_step", null],
    ]);
    expect(actions[3]!.detail).toBeNull();
    expect((await r.as(r.A.viewerId, (tx) => repos.teamCalls.actions(tx, r.A.businessId, call.id))).map((a) => a.id)).toEqual(actions.map((a) => a.id));
    await expect(r.as(r.A.ownerId, (tx) => repos.teamCalls.finish(tx, r.A.businessId, call.id, { summary: "Again", actions: [] }))).rejects.toThrow(/being wrapped up/);
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, r.A.businessId, call.id))).toBe(false);

    const listed = await r.as(r.A.viewerId, (tx) => repos.teamCalls.list(tx, r.A.businessId, { limit: 100 }));
    expect(listed.find((c) => c.id === call.id)).toMatchObject({ status: "ended", turnCount: 2, actionCount: 4, filedCount: 2, awaitingCount: 1 });
    expect(listed.find((c) => c.id !== call.id)).toMatchObject({ actionCount: 0, filedCount: 0, awaitingCount: 0 });
    const times = listed.map((c) => c.startedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await r.as(r.B.ownerId, (tx) => repos.teamCalls.list(tx, r.B.businessId))).toHaveLength(1);
  });

  it("a failed wrap-up reopens the call, which goes on and can be wrapped up again", async () => {
    const call = await start();
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, r.A.businessId, call.id))).toBe(false);
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, call.id))).toBe(true);
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, r.A.businessId, call.id))).toBe(true);
    const after = await r.as(r.A.ownerId, (tx) => repos.teamCalls.appendTurns(tx, r.A.businessId, call.id, [say(r.A.ownerId, "Still here")]));
    expect(after.call).toMatchObject({ status: "live", endedAt: null, turnCount: 1 });
    expect(await r.as(r.A.ownerId, (tx) => repos.teamCalls.claimWrapUp(tx, r.A.businessId, call.id))).toBe(true);
    const { call: ended, actions } = await r.as(r.A.ownerId, (tx) => repos.teamCalls.finish(tx, r.A.businessId, call.id, { summary: null, actions: [] }));
    expect(ended).toMatchObject({ status: "ended", summary: null });
    expect(actions).toEqual([]);
    await expect(
      r.as(r.A.ownerId, (tx) => repos.teamCalls.finish(tx, r.A.businessId, call.id, { summary: "x", actions: Array.from({ length: TEAM_CALL_LIMITS.maxActionsPerCall + 1 }, () => ({ actionType: "reply_only" as const, title: "x", status: "not_filed" as const })) })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
