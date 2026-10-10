/**
 * Ask on a concept (audit-conversation §4 "Ask on a concept"): `idea.askDesk` gives the Research agent and the starters
 * with no model call; `idea.ask` answers through `replyAboutConcept` (the conversation route, house rules first, the
 * card's own text as untrusted data), keeps the single-answer `answer` field, adds the conversation (bubbles, 2–4 quick
 * replies, persona, reaction) and records the exchange as a new version without moving any rating.
 */
import { repos } from "@foundmill/db";
import { MockModelClient, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMeta } from "../routers/idea";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ideaask" });
}, 120_000);
afterAll(() => hz.close());

const callerFor = async (models: ModelClient, email: string) => {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  return { userId, caller: createCaller({ ...hz.deps, models }, { userId, email }) };
};

const attributes = {
  market_pull: { value: 15, evidence: "Patch-test kits sell out at two pharmacies." },
  market_size: { value: 12, evidence: "About 2.1M UK adults report reactive skin." },
  competition: { value: 9, evidence: "Three subscription rivals." },
};

describe("idea.askDesk / idea.ask", () => {
  it("opens with the Research agent and four starters, no model call", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "ask-desk@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Patchwise", pitch: "Patch-test kits by post.", attributes });
    const desk = await caller.idea.askDesk({ ideaId: idea.id });
    expect(desk.persona).toMatchObject({ name: "Research agent", isAgent: true });
    expect(desk.persona.thinkingLine.length).toBeGreaterThan(0);
    expect(desk.starters.map((s) => s.id)).toEqual(["biggest_risk", "who_pays_first", "competitors", "first_customer"]);
    expect(mock.history).toHaveLength(0);
  });

  it("answers a starter by id: bubbles, 2–4 quick replies, the persona, the stored Q&A, ratings unchanged", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "ask-chip@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Patchwise", pitch: "Patch-test kits by post.", attributes });
    const r = await caller.idea.ask({ ideaId: idea.id, quickReplyId: "who_pays_first" });
    expect(mock.history).toHaveLength(1);
    expect(mock.history[0]!.route).toBe("conversation");
    expect(r.bubbles.length).toBeGreaterThanOrEqual(1);
    expect(r.bubbles.length).toBeLessThanOrEqual(3);
    expect(r.answer).toBe(r.bubbles.join("\n\n"));
    expect(r.answer).not.toMatch(/mock/i);
    expect(r.quickReplies.length).toBeGreaterThanOrEqual(2);
    expect(r.quickReplies.length).toBeLessThanOrEqual(4);
    expect(r.quickReplies.map((q) => q.id)).not.toContain("who_pays_first");
    expect(r.persona.name).toBe("Research agent");
    expect(r.question).toBe("Who would pay for this first?");
    expect(r.version.attributes).toEqual(attributes);
    const qa = readMeta(r.version.research).qa as Array<Record<string, unknown>>;
    expect(qa.at(-1)).toMatchObject({ question: "Who would pay for this first?", answer: r.answer, quick_reply_id: "who_pays_first" });
  });

  it("answers typed text and carries the earlier exchange as history; refuses neither-or-both", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "ask-text@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Patchwise", pitch: "Patch-test kits by post.", attributes });
    await caller.idea.ask({ ideaId: idea.id, quickReplyId: "biggest_risk" });
    const r = await caller.idea.ask({ ideaId: idea.id, question: "How big is the market?" });
    expect(r.question).toBe("How big is the market?");
    expect(r.bubbles.length).toBeGreaterThanOrEqual(1);
    expect(readMeta(r.version.research).qa).toHaveLength(2);
    await expect(caller.idea.ask({ ideaId: idea.id })).rejects.toThrow();
    await expect(caller.idea.ask({ ideaId: idea.id, question: "Why?", quickReplyId: "biggest_risk" })).rejects.toThrow();
    await expect(caller.idea.ask({ ideaId: idea.id, quickReplyId: "not_a_starter" })).rejects.toThrow(/no longer available/);
  });
});
