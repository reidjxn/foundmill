/** agent_threads + agent_messages (0020): one thread per agent and subject, appended messages, staged hand-offs. */
import { NotFoundError, ValidationError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("conv");
});
afterAll(() => r?.close());

const chip = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, say: `${label}.`, kind: "ask" as const, option_id: null, recommended: false, ...extra });

describe("conversations repo", () => {
  it("ensureThread is idempotent per agent and subject; findThread reads it back", async () => {
    const { businessId, ownerId, agentId, taskId } = r.A;
    const subject = { agentId, subjectKind: "task" as const, subjectId: taskId };
    expect(await r.as(ownerId, (tx) => repos.conversations.findThread(tx, businessId, subject))).toBeNull();
    const [a, b] = await Promise.all([r.as(ownerId, (tx) => repos.conversations.ensureThread(tx, businessId, subject)), r.as(ownerId, (tx) => repos.conversations.ensureThread(tx, businessId, subject))]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ businessId, agentId, subjectKind: "task", subjectId: taskId, messageCount: 0, lastMessageAt: null });
    expect((await r.as(ownerId, (tx) => repos.conversations.findThread(tx, businessId, subject)))?.id).toBe(a.id);
    const listed = await r.as(ownerId, (tx) => repos.conversations.listThreads(tx, businessId, { agentId }));
    expect(listed.map((t) => t.id)).toContain(a.id);
  });

  it("appends founder and agent messages in order and bumps the thread's activity", async () => {
    const { businessId, ownerId, agentId } = r.A;
    const thread = await r.as(ownerId, (tx) => repos.conversations.ensureThread(tx, businessId, { agentId, subjectKind: "agent", subjectId: agentId }));
    const t0 = new Date("2026-10-09T10:00:00.000Z");
    const [founder, agent] = await r.as(ownerId, async (tx) => [
      await repos.conversations.appendMessage(tx, businessId, { threadId: thread.id, authorKind: "founder", authorUserId: ownerId, bubbles: ["How's it going?"], chosenQuickReplyId: "how_is_it_going" }, { at: t0 }),
      await repos.conversations.appendMessage(
        tx,
        businessId,
        { threadId: thread.id, authorKind: "agent", bubbles: ["About 45% through.", "Nothing blocking."], reaction: "noted", quickReplies: [chip("whats_next", "What's next?", { recommended: true }), chip("thanks", "Thanks", { kind: "acknowledge" })], refersTo: ["task-1"], meta: { route: "conversation" } },
        { at: new Date(t0.getTime() + 1) },
      ),
    ]);
    expect(founder).toMatchObject({ authorKind: "founder", authorUserId: ownerId, agentId: null, chosenQuickReplyId: "how_is_it_going", quickReplies: [] });
    expect(agent).toMatchObject({ authorKind: "agent", agentId, reaction: "noted", refersTo: ["task-1"] });
    expect(agent.quickReplies.map((q) => q.id)).toEqual(["whats_next", "thanks"]);

    const messages = await r.as(ownerId, (tx) => repos.conversations.listMessages(tx, businessId, thread.id));
    expect(messages.map((m) => m.id)).toEqual([founder.id, agent.id]);
    expect((await r.as(ownerId, (tx) => repos.conversations.listMessages(tx, businessId, thread.id, { limit: 1 }))).map((m) => m.id)).toEqual([agent.id]);
    expect((await r.as(ownerId, (tx) => repos.conversations.latestAgentMessage(tx, businessId, thread.id)))?.id).toBe(agent.id);
    const after = await r.as(ownerId, (tx) => repos.conversations.getThread(tx, businessId, thread.id));
    expect(after.messageCount).toBe(2);
    expect(after.lastMessageAt?.toISOString()).toBe(new Date(t0.getTime() + 1).toISOString());
  });

  it("refuses shapes the contract forbids: founder chips, agent presses, two recommended, oversized labels", async () => {
    const { businessId, ownerId, agentThreadId } = r.A;
    const bad = [
      { threadId: agentThreadId, authorKind: "founder" as const, bubbles: ["Hi"], quickReplies: [chip("a", "Ask")] },
      { threadId: agentThreadId, authorKind: "agent" as const, bubbles: ["Hi"], chosenQuickReplyId: "a" },
      { threadId: agentThreadId, authorKind: "agent" as const, bubbles: ["Hi"], quickReplies: [chip("a", "Ask", { recommended: true }), chip("b", "Bask", { recommended: true })] },
      { threadId: agentThreadId, authorKind: "agent" as const, bubbles: ["Hi"], quickReplies: [chip("a", "A label far too long to ever fit on one chip")] },
      { threadId: agentThreadId, authorKind: "agent" as const, bubbles: [] },
    ];
    for (const input of bad) await expect(r.as(ownerId, (tx) => repos.conversations.appendMessage(tx, businessId, input))).rejects.toBeInstanceOf(ValidationError);
  });

  it("stages a hand-off as a plan only on an agent message that carries one", async () => {
    const { businessId, ownerId, agentThreadId, planId } = r.A;
    const [plain, handOff] = await r.as(ownerId, async (tx) => [
      await repos.conversations.appendMessage(tx, businessId, { threadId: agentThreadId, authorKind: "agent", bubbles: ["Noted."], quickReplies: [chip("a", "Ask"), chip("b", "Bask")] }),
      await repos.conversations.appendMessage(tx, businessId, { threadId: agentThreadId, authorKind: "agent", bubbles: ["I've written it up."], quickReplies: [chip("review_plan", "Review the plan", { kind: "hand_off" }), chip("not_now", "Not now", { kind: "decline" })], handOff: { instruction: "Pause the LinkedIn ads" } }),
    ]);
    await expect(r.as(ownerId, (tx) => repos.conversations.setMessagePlan(tx, businessId, plain.id, planId))).rejects.toBeInstanceOf(ValidationError);
    const staged = await r.as(ownerId, (tx) => repos.conversations.setMessagePlan(tx, businessId, handOff.id, planId));
    expect(staged.planId).toBe(planId);
  });

  it("claimMessagePlan records a plan only once (a double press never stages two plans)", async () => {
    const { businessId, ownerId, agentThreadId, planId } = r.A;
    const handOff = await r.as(ownerId, (tx) => repos.conversations.appendMessage(tx, businessId, { threadId: agentThreadId, authorKind: "agent", bubbles: ["Written up."], quickReplies: [chip("review_plan", "Review the plan", { kind: "hand_off" }), chip("not_now", "Not now", { kind: "decline" })], handOff: { instruction: "Pause the Meta ads" } }));
    const first = await r.as(ownerId, (tx) => repos.conversations.claimMessagePlan(tx, businessId, handOff.id, planId));
    expect(first?.planId).toBe(planId);
    expect(await r.as(ownerId, (tx) => repos.conversations.claimMessagePlan(tx, businessId, handOff.id, planId))).toBeNull();
    const plain = await r.as(ownerId, (tx) => repos.conversations.appendMessage(tx, businessId, { threadId: agentThreadId, authorKind: "agent", bubbles: ["Noted."], quickReplies: [chip("a", "Ask"), chip("b", "Bask")] }));
    await expect(r.as(ownerId, (tx) => repos.conversations.claimMessagePlan(tx, businessId, plain.id, planId))).rejects.toBeInstanceOf(ValidationError);
  });

  it("is scoped to the business: another business's thread is not found, even through the service role", async () => {
    const { businessId, ownerId } = r.A;
    await expect(r.as(ownerId, (tx) => repos.conversations.getThread(tx, businessId, r.B.agentThreadId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(r.svc((tx) => repos.conversations.getThread(tx, businessId, r.B.agentThreadId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(r.svc((tx) => repos.conversations.appendMessage(tx, businessId, { threadId: r.B.agentThreadId, authorKind: "agent", bubbles: ["Hi"] }))).rejects.toBeInstanceOf(NotFoundError);
  });
});
