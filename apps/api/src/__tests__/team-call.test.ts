/**
 * teamCall.* and agent.speechAccent.* — Team call (docs/TEAM_CALL.md §5; services/team-call.ts).
 *
 * A call opens with the team's greeting; the founder's words are stored before the agents answer and a retried send is
 * not answered twice; agents take at most `agentRoundsWithoutFounder` rounds on their own; speech is simulated in mock
 * mode and names agents as the listener reads them; viewers listen but never speak; ending files what policy allows (a
 * task in its department, a new roadmap item), stages a budget for the founder's go-ahead on the Chief of Staff's note
 * and never runs it; the accent an owner chooses is the one every call uses.
 */
import { repos } from "@foundmill/db";
import { MockModelClient, type ModelClient } from "@foundmill/models";
import { SPEECH_ACCENTS, TEAM_CALL_LIMITS } from "@foundmill/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FILED_AT_ONCE, modelRoundsOf, routeOf } from "../services/team-call";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let original: ModelClient;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "teamcall" });
  original = hz.deps.models;
}, 120_000);
afterEach(() => {
  hz.deps.models = original;
  hz.limits.reset();
});
afterAll(() => hz?.close());

const owner = () => hz.caller({ userId: hz.A.ownerId });
const member = () => hz.caller({ userId: hz.A.memberId });
const viewer = () => hz.caller({ userId: hz.A.viewerId });
const A = () => hz.A.businessId;
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");
let n = 0;
const turnId = () => `client-turn-${++n}-xxxxxxxx`;

describe("teamCall.start", () => {
  it("opens a team call with the team on it and the opening round already said", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    expect(call.status).toBe("live");
    expect(call.participants.length).toBeGreaterThan(0);
    expect(call.participants.length).toBeLessThanOrEqual(TEAM_CALL_LIMITS.maxAgentsInTeamCall);
    expect(call.turns.length).toBeGreaterThan(0);
    expect(call.turns.every((t) => t.speaker === "agent")).toBe(true);
    // Every participant has an accent from the catalog, and the same agent keeps it on another read.
    for (const p of call.participants) expect(SPEECH_ACCENTS.some((s) => s.key === p.speechAccent)).toBe(true);
    const again = await member().teamCall.get({ businessId: A(), callId: call.id });
    expect(again.participants.map((p) => p.speechAccent)).toEqual(call.participants.map((p) => p.speechAccent));
    const events = (await repos.events.outboxPending(hz.db, A())).filter((o) => o.event.type === "team_call.started");
    expect(events.some((o) => (o.event.payload as { callId: string }).callId === call.id)).toBe(true);
  });

  it("puts exactly one agent on a one-to-one call, and only that agent speaks", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "one_to_one", agentIds: [hz.A.agent2Id] });
    expect(call.participants.map((p) => p.agentId)).toEqual([hz.A.agent2Id]);
    const round = await owner().teamCall.say({ businessId: A(), callId: call.id, text: "What should we look at this week?", via: "typed", clientTurnId: turnId() });
    expect(round.turns.every((t) => t.agentId === hz.A.agent2Id)).toBe(true);
    expect(await code(owner().teamCall.start({ businessId: A(), kind: "one_to_one", agentIds: [] }))).toBe("BAD_REQUEST");
  });

  it("refuses an agent from another business", async () => {
    expect(await code(owner().teamCall.start({ businessId: A(), kind: "team", agentIds: [hz.B.agentId] }))).toBe("BAD_REQUEST");
  });

  it("lets a viewer read a call but never start, speak or end one", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const seen = await viewer().teamCall.get({ businessId: A(), callId: call.id });
    expect(seen.canSpeak).toBe(false);
    expect(await code(viewer().teamCall.start({ businessId: A(), kind: "team" }))).toBe("FORBIDDEN");
    expect(await code(viewer().teamCall.say({ businessId: A(), callId: call.id, text: "Hello", via: "typed", clientTurnId: turnId() }))).toBe("FORBIDDEN");
    expect(await code(viewer().teamCall.end({ businessId: A(), callId: call.id }))).toBe("FORBIDDEN");
  });

  it("never shows one business's call to another", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const other = hz.caller({ userId: hz.B.ownerId });
    expect(await code(other.teamCall.get({ businessId: hz.B.businessId, callId: call.id }))).toBe("NOT_FOUND");
  });
});

describe("teamCall.say and continue", () => {
  it("stores the founder's words, answers with the team, and does not answer a retried send twice", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const id = turnId();
    const first = await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Let's plan the launch email and a landing page.", via: "spoken", clientTurnId: id });
    expect(first.founderTurn?.text).toBe("Let's plan the launch email and a landing page.");
    expect(first.founderTurn?.via).toBe("spoken");
    expect(first.turns.length).toBeGreaterThan(0);
    const models = new MockModelClient();
    let calls = 0;
    const counting = { ...models, mode: models.mode, complete: (...args: Parameters<ModelClient["complete"]>) => (calls++, models.complete(...args)) } as unknown as ModelClient;
    hz.deps.models = counting;
    const retried = await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Let's plan the launch email and a landing page.", via: "spoken", clientTurnId: id });
    expect(calls).toBe(0);
    expect(retried.turns.map((t) => t.id)).toEqual(first.turns.map((t) => t.id));
    const view = await owner().teamCall.get({ businessId: A(), callId: call.id });
    expect(view.turns.filter((t) => t.speaker === "founder")).toHaveLength(1);
  });

  it("lets the agents carry on alone at most the limit, then hands back with no model call", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Talk it through between you.", via: "typed", clientTurnId: turnId() });
    for (let i = 0; i < TEAM_CALL_LIMITS.agentRoundsWithoutFounder; i++) {
      const round = await owner().teamCall.continue({ businessId: A(), callId: call.id });
      expect(round.turns.length).toBeGreaterThan(0);
    }
    const held = await owner().teamCall.continue({ businessId: A(), callId: call.id });
    expect(held).toMatchObject({ turns: [], handBack: true, agentRoundsSinceFounder: TEAM_CALL_LIMITS.agentRoundsWithoutFounder });
    // The founder speaking again resets the count.
    const after = await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Thanks, noted.", via: "typed", clientTurnId: turnId() });
    expect(after.agentRoundsSinceFounder).toBe(0);
  });

  it("counts model rounds by the instants their turns were written", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 10, 0, s));
    expect(modelRoundsOf([{ speaker: "agent", createdAt: at(1) }, { speaker: "agent", createdAt: at(1) }, { speaker: "founder", createdAt: at(2) }, { speaker: "agent", createdAt: at(3) }])).toBe(2);
  });
});

describe("teamCall.speech and transcribe (mock mode)", () => {
  it("speaks an agent turn as simulated audio with the agent's accent and the listener's names", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const turn = call.turns[0]!;
    const speech = await owner().teamCall.speech({ businessId: A(), callId: call.id, turnId: turn.id });
    expect(speech.simulated).toBe(true);
    expect(speech.mime).toBe("audio/wav");
    expect(speech.base64.length).toBeGreaterThan(40);
    expect(speech.speechAccent).toBe(call.participants.find((p) => p.agentId === turn.agentId)!.speechAccent);
    expect(speech.spokenText).not.toMatch(/\[\[ent:/);
    const modes = await owner().teamCall.speechModes({ businessId: A() });
    expect(modes).toMatchObject({ speech: "simulated", transcription: "simulated" });
    expect(modes.notice).toBeTruthy();
  });

  it("answers an empty simulated transcript, so the browser's recognizer stands in", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const heard = await owner().teamCall.transcribe({ businessId: A(), callId: call.id, mime: "audio/webm", base64: Buffer.from("a short recording").toString("base64") });
    expect(heard).toEqual({ text: "", simulated: true });
  });
});

describe("teamCall.end", () => {
  it("files the tasks and the new roadmap item, stages the budget for a go-ahead, and writes one note", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Let's build the signup page, add a referral program to the roadmap and put 300 a month on ads.", via: "typed", clientTurnId: turnId() });
    hz.deps.models = new MockModelClient({
      overrides: {
        teamCallWrapUp: () => ({
          summary: "You agreed to build the signup page, add a referral program to the roadmap and look at an ads budget.",
          actions: [
            { title: "Build the signup page", detail: "One page with the waitlist form.", agent_id: hz.A.agent2Id, action: { type: "create_task", params: { kind: "code", title: "Build the signup page", goal: "A signup page with the waitlist form" }, agent_id: hz.A.agent2Id } },
            { title: "Add a referral program to the roadmap", detail: null, agent_id: null, action: { type: "update_roadmap", params: { create: true, title: "Referral program", horizon: "next", change: "Add a referral program" }, agent_id: null } },
            { title: "Set an ads budget of 300 a month", detail: null, agent_id: null, action: { type: "set_budget", params: { amount_minor: 30000, currency: "USD", scope: "business", period: "monthly" }, agent_id: null } },
          ],
        }),
      },
    });
    const ended = await owner().teamCall.end({ businessId: A(), callId: call.id });
    expect(ended.status).toBe("ended");
    expect(ended.summary).toContain("signup page");
    const byType = Object.fromEntries(ended.actions.map((a) => [a.actionType, a]));
    expect(byType.create_task).toMatchObject({ status: "filed", target: { kind: "task" } });
    expect(byType.update_roadmap).toMatchObject({ status: "filed", target: { kind: "roadmap_item" } });
    expect(byType.set_budget).toMatchObject({ status: "awaiting_go_ahead", target: { kind: "plan" } });
    // The task exists where its department's work is, and the roadmap has the new item.
    const task = await repos.tasks.get(hz.db, A(), byType.create_task!.target!.id);
    expect(task.title).toBe("Build the signup page");
    const roadmap = await repos.product.listRoadmap(hz.db, A());
    expect(roadmap.some((r) => r.id === byType.update_roadmap!.target!.id && r.title === "Referral program")).toBe(true);
    // The budget is staged and nothing was spent: its plan waits for the go-ahead on the call's note.
    const staged = await repos.plans.get(hz.db, A(), byType.set_budget!.planId!);
    expect(staged.status).toBe("pending_confirmation");
    expect(staged.origin).toBe("team_call");
    expect(staged.actions.every((a) => a.status === "pending")).toBe(true);
    const note = await repos.inbox.get(hz.db, A(), staged.inboxItemId!);
    expect(note.subject).toBe("Notes from your team call");
    expect(note.blocksContinue).toBe(false);
    const ev = (await repos.events.outboxPending(hz.db, A())).find((o) => o.event.type === "team_call.ended" && (o.event.payload as { callId: string }).callId === call.id);
    expect(ev?.event.payload).toMatchObject({ actionCount: 3, filedCount: 2, awaitingCount: 1 });
    // A second End is the same answer, nothing filed twice; the call takes no more turns.
    const again = await owner().teamCall.end({ businessId: A(), callId: call.id });
    expect(again.actions).toHaveLength(3);
    expect(await code(owner().teamCall.say({ businessId: A(), callId: call.id, text: "One more thing", via: "typed", clientTurnId: turnId() }))).not.toBe("ok");
  });

  it("reopens the call when the wrap-up fails, so nothing said is lost", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    await owner().teamCall.say({ businessId: A(), callId: call.id, text: "Let's write the launch post.", via: "typed", clientTurnId: turnId() });
    hz.deps.models = new MockModelClient({ overrides: { teamCallWrapUp: () => { throw new Error("model down"); } } });
    expect(await code(owner().teamCall.end({ businessId: A(), callId: call.id }))).not.toBe("ok");
    const view = await owner().teamCall.get({ businessId: A(), callId: call.id });
    expect(view.status).toBe("live");
    expect(view.turns.some((t) => t.text === "Let's write the launch post.")).toBe(true);
  });

  it("files nothing for a call where the founder said nothing", async () => {
    const call = await owner().teamCall.start({ businessId: A(), kind: "team" });
    const ended = await owner().teamCall.end({ businessId: A(), callId: call.id });
    expect(ended.status).toBe("ended");
    expect(ended.actions).toEqual([]);
  });
});

describe("routing an action", () => {
  const e = (type: string, outcome: "allow" | "ask" | "deny", params: Record<string, unknown> = {}) => ({ action: { type, params, agent_id: null }, outcome, reasons: [], policyIds: [], hardGate: type === "request_human_action" }) as never;
  it("files only allowed filing work, stages the rest and refuses past a wall or a deny", () => {
    const all = () => true;
    expect(routeOf(e("create_task", "allow", { kind: "research" }), all).route).toBe("file");
    expect(routeOf(e("enable_channel", "allow", { channel: "seo" }), all).route).toBe("stage");
    expect(routeOf(e("set_budget", "ask"), all).route).toBe("stage");
    expect(routeOf(e("send_message", "deny"), all).route).toBe("refuse");
    expect(routeOf(e("create_task", "allow", { kind: "code" }), () => false).route).toBe("refuse");
    expect([...FILED_AT_ONCE]).toEqual(expect.arrayContaining(["create_task", "update_roadmap"]));
  });
});

describe("agent.speechAccent", () => {
  it("lets an owner choose an agent's accent, which every call then uses; a member cannot", async () => {
    const before = await owner().agent.speechAccent.list({ businessId: A() });
    const row = before.find((r) => r.agentId === hz.A.agent2Id)!;
    const other = SPEECH_ACCENTS.find((s) => s.key !== row.speechAccent)!.key;
    expect(await code(member().agent.speechAccent.set({ businessId: A(), agentId: hz.A.agent2Id, speechAccent: other }))).toBe("FORBIDDEN");
    const set = await owner().agent.speechAccent.set({ businessId: A(), agentId: hz.A.agent2Id, speechAccent: other });
    expect(set).toMatchObject({ speechAccent: other, chosen: other });
    const call = await owner().teamCall.start({ businessId: A(), kind: "one_to_one", agentIds: [hz.A.agent2Id] });
    expect(call.participants[0]!.speechAccent).toBe(other);
    expect(await code(owner().agent.speechAccent.set({ businessId: A(), agentId: hz.A.agent2Id, speechAccent: "nope" }))).toBe("BAD_REQUEST");
    const reset = await owner().agent.speechAccent.set({ businessId: A(), agentId: hz.A.agent2Id, speechAccent: null });
    expect(reset.speechAccent).toBe(row.defaultSpeechAccent);
    const preview = await owner().agent.speechAccent.preview({ businessId: A(), agentId: hz.A.agent2Id, speechAccent: other });
    expect(preview).toMatchObject({ speechAccent: other, simulated: true });
  });
});
