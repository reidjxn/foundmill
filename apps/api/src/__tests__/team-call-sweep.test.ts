/**
 * The team call sweep (services/team-call-sweep.ts): a call left live with no turn for 15 minutes is ended and written up
 * as the person who started it, through teamCall.end with `via: "idle"`; a call its starter can no longer end is marked
 * `wrap_up_failed` (Try again), never left "In progress"; a call still being spoken on is left alone.
 */
import { repos } from "@foundmill/db";
import { TEAM_CALL_LIMITS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepIdleTeamCalls } from "../services/team-call-sweep";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "tcsweep" });
}, 120_000);
afterAll(() => hz?.close());

const later = () => new Date(Date.now() + TEAM_CALL_LIMITS.idleEndMs + 60_000);
let n = 0;
const turnId = () => `sweep-turn-${++n}-xxxxxxxx`;

describe("sweepIdleTeamCalls", () => {
  it("leaves a call that is being spoken on, and ends one left open as its starter, files what was agreed and audits it as idle", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    await owner.teamCall.say({ businessId: hz.A.businessId, callId: call.id, text: "Let's build the signup page.", via: "typed", clientTurnId: turnId() });

    await sweepIdleTeamCalls(hz.deps);
    expect((await owner.teamCall.get({ businessId: hz.A.businessId, callId: call.id })).status).toBe("live");

    await sweepIdleTeamCalls(hz.deps, later());
    const ended = await owner.teamCall.get({ businessId: hz.A.businessId, callId: call.id });
    expect(ended.status).toBe("ended");
    expect(ended.summary).toBeTruthy();
    expect(ended.actions.length).toBeGreaterThan(0);
    const entries = await repos.audit.list(hz.db, hz.A.businessId, { action: "team_call.end", limit: 50 });
    const end = entries.items.find((e) => (e.target as { id?: string }).id === call.id);
    expect(end?.actorId).toBe(hz.A.ownerId);
    expect(end?.details.via).toBe("idle");
  });

  it("marks a call its starter can no longer end as not written up, with every turn kept", async () => {
    const member = hz.caller({ userId: hz.A.memberId });
    const call = await member.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    await member.teamCall.say({ businessId: hz.A.businessId, callId: call.id, text: "Let's plan the launch week.", via: "typed", clientTurnId: turnId() });
    await repos.memberships.remove(hz.db, hz.A.businessId, hz.A.memberId);

    await sweepIdleTeamCalls(hz.deps, later());
    const view = await hz.caller({ userId: hz.A.ownerId }).teamCall.get({ businessId: hz.A.businessId, callId: call.id });
    expect(view.status).toBe("wrap_up_failed");
    expect(view.turns.some((t) => t.text === "Let's plan the launch week.")).toBe(true);
  });
});

describe("leaving a call with two people on it", () => {
  it("stays live for the one still on the page, and ends when the last person leaves", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const cofounder = hz.caller({ userId: hz.A.adminId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    await owner.teamCall.say({ businessId: hz.A.businessId, callId: call.id, text: "Let's build the signup page.", via: "typed", clientTurnId: turnId() });
    await owner.teamCall.here({ businessId: hz.A.businessId, callId: call.id });
    await cofounder.teamCall.here({ businessId: hz.A.businessId, callId: call.id });

    const afterOwner = await owner.teamCall.end({ businessId: hz.A.businessId, callId: call.id, via: "left" });
    expect(afterOwner.status).toBe("live");
    await cofounder.teamCall.say({ businessId: hz.A.businessId, callId: call.id, text: "And the pricing page.", via: "typed", clientTurnId: turnId() });

    const afterCofounder = await cofounder.teamCall.end({ businessId: hz.A.businessId, callId: call.id, via: "left" });
    expect(afterCofounder.status).toBe("ended");
  });

  it("is ended by the sweep when everyone left without the leave arriving", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    await owner.teamCall.say({ businessId: hz.A.businessId, callId: call.id, text: "Let's write the launch post.", via: "typed", clientTurnId: turnId() });
    await owner.teamCall.here({ businessId: hz.A.businessId, callId: call.id });
    // Still on the page: the sweep leaves it.
    await sweepIdleTeamCalls(hz.deps);
    expect((await owner.teamCall.get({ businessId: hz.A.businessId, callId: call.id })).status).toBe("live");
    // Nobody seen for longer than presenceMs, though well inside the 15 idle minutes.
    await sweepIdleTeamCalls(hz.deps, new Date(Date.now() + TEAM_CALL_LIMITS.presenceMs + 5_000));
    expect((await owner.teamCall.get({ businessId: hz.A.businessId, callId: call.id })).status).toBe("ended");
  });
});
