/**
 * The Ideation Studio's deck on the API (BUILD §11.1 Door A, AC-11.1.3):
 * - Discard is reversible: `idea.restore` puts a discarded card back, and Ask, History and Commit work on it again
 *   (audit FR-12: a restored card was a dead card, every action answered "idea <uuid> not found").
 * - `idea.listByIds` gives the Studio its shortlisted and restored cards that are older than the loaded pages, and
 *   leaves out what is no longer in the deck (audit FR-22).
 * - Compare and Merge refuse the same card twice before any model call or write (audit ARB-30).
 * - Asks on one card at the same moment each get their own version and keep every answer (audit ARB-13).
 */
import { repos } from "@foundmill/db";
import { MockModelClient, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMeta } from "../routers/idea";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ideadeck" });
}, 120_000);
afterAll(() => hz.close());

const callerFor = async (models: ModelClient, email: string) => {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  return { userId, caller: createCaller({ ...hz.deps, models }, { userId, email }) };
};

const attributes = { market_pull: { value: 14, evidence: "Waitlist of 300." }, competition: { value: 9, evidence: "Three rivals." } };

describe("idea.restore", () => {
  it("brings a discarded card back: get, askDesk, ask and the list all see it again", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "deck-restore@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Mardesk", pitch: "Desk booking for clinics.", attributes });
    await caller.idea.discard({ ideaId: idea.id });
    await expect(caller.idea.get({ ideaId: idea.id })).rejects.toThrow(/not found/);
    expect((await caller.idea.list()).items.map((i) => i.id)).not.toContain(idea.id);

    const restored = await caller.idea.restore({ ideaId: idea.id });
    expect(restored.id).toBe(idea.id);
    expect(restored.archivedAt).toBeNull();
    expect(restored.current?.id).toBe(idea.current?.id);
    expect((await caller.idea.get({ ideaId: idea.id })).idea.id).toBe(idea.id);
    expect((await caller.idea.askDesk({ ideaId: idea.id })).starters.length).toBeGreaterThan(0);
    const answer = await caller.idea.ask({ ideaId: idea.id, quickReplyId: "biggest_risk" });
    expect(answer.version.version).toBe(2);
    expect((await caller.idea.list()).items.map((i) => i.id)).toContain(idea.id);
  });

  it("is idempotent on a card in the deck and refuses someone else's card", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "deck-restore-2@test.local");
    const other = await callerFor(mock, "deck-restore-other@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Tidewell", pitch: "Tide tables for kayak clubs." });
    expect((await caller.idea.restore({ ideaId: idea.id })).id).toBe(idea.id);
    await caller.idea.discard({ ideaId: idea.id });
    await expect(other.caller.idea.restore({ ideaId: idea.id })).rejects.toThrow(/not found/);
    // Still discarded for its owner: the other founder's call changed nothing.
    await expect(caller.idea.get({ ideaId: idea.id })).rejects.toThrow(/not found/);
  });
});

describe("idea.listByIds", () => {
  it("answers with the founder's cards still in the deck, newest first, and leaves out the rest", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "deck-byids@test.local");
    const other = await callerFor(mock, "deck-byids-other@test.local");
    const kept = await repos.ideas.create(hz.h.db, userId, { title: "Kept", pitch: "" });
    const newer = await repos.ideas.create(hz.h.db, userId, { title: "Newer", pitch: "" });
    const discarded = await repos.ideas.create(hz.h.db, userId, { title: "Discarded", pitch: "" });
    const committed = await repos.ideas.create(hz.h.db, userId, { title: "Committed", pitch: "" });
    const theirs = await repos.ideas.create(hz.h.db, other.userId, { title: "Theirs", pitch: "" });
    await repos.ideas.discard(hz.h.db, userId, discarded.id);
    await repos.ideas.claimForCommit(hz.h.db, userId, committed.id);

    const { items, discardedIds } = await caller.idea.listByIds({ ideaIds: [kept.id, discarded.id, committed.id, theirs.id, newer.id, kept.id] });
    expect(items.map((i) => i.title)).toEqual(["Newer", "Kept"]);
    expect(items[0]!.current?.version).toBe(1);
    // Only the founder's own discarded card is restorable; the committed one and someone else's are simply absent.
    expect(discardedIds).toEqual([discarded.id]);
    expect(await caller.idea.listByIds({ ideaIds: [] })).toEqual({ items: [], discardedIds: [] });
  });
});

describe("idea.compare / idea.merge with the same card twice", () => {
  it("compare refuses before the model call; merge refuses before any write", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "deck-dupes@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Selfsame", pitch: "One card." });
    await expect(caller.idea.compare({ ideaIds: [idea.id, idea.id] })).rejects.toThrow(/Pick different concepts/);
    expect(mock.history).toHaveLength(0);
    await expect(caller.idea.merge({ ideaIds: [idea.id, idea.id] })).rejects.toThrow(/Pick different concepts/);
    expect((await caller.idea.get({ ideaId: idea.id })).versions.map((v) => v.version)).toEqual([1]);
    expect((await caller.idea.list()).items.map((i) => i.title)).toEqual(["Selfsame"]);
  });
});

describe("idea.ask, several at once on one card", () => {
  it("numbers the versions one after another and keeps every answer in the Q&A", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "deck-concurrent@test.local");
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Quickfire", pitch: "Three questions at once.", attributes });
    const answers = await Promise.all([caller.idea.ask({ ideaId: idea.id, quickReplyId: "biggest_risk" }), caller.idea.ask({ ideaId: idea.id, quickReplyId: "who_pays_first" }), caller.idea.ask({ ideaId: idea.id, question: "How big is the market?" })]);
    expect(answers.map((a) => a.version.version).sort()).toEqual([2, 3, 4]);
    const { idea: latest, versions } = await caller.idea.get({ ideaId: idea.id });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    const qa = readMeta(versions.at(-1)!.research).qa as Array<{ question: string }>;
    expect(qa.map((q) => q.question).sort()).toEqual(["How big is the market?", "What's the biggest risk with this concept?", "Who would pay for this first?"].sort());
    expect(latest.current?.version).toBe(4);
  });
});
