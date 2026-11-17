/**
 * "Use my idea as written" and Edit (first-time founder report, Nov 8, 2026): a founder with a clear idea gets one card
 * in their own words, rated by the Ideation agent and never rewritten by it; any card can be edited before Commit, and
 * the words the founder changes become the card's `founder_words`, the ground truth the foundations build on.
 */
import { repos } from "@foundmill/db";
import { MockModelClient, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readMeta } from "../routers/idea";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ideawrite" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => hz.limits.reset());

const callerFor = async (models: ModelClient, email: string) => {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  return { userId, caller: createCaller({ ...hz.deps, models }, { userId, email }) };
};

const WORDS = "Students at my university struggle to find short-notice part-time shifts, and local cafes and bars near campus struggle to fill last-minute gaps. A simple app that matches verified students to same-day shifts at independent venues around Manchester.";

describe("idea.write (Use my idea as written)", () => {
  it("saves one card in the founder's words, rated by the agent, flagged as theirs, with the brief and the sample mark", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "write-a@test.local");
    const res = await caller.idea.write({ title: "ShiftMate", pitch: WORDS, archetype: "marketplace" });
    // One card call, no slate.
    expect(mock.history.map((h) => h.route)).toEqual(["ideation"]);
    expect(res.idea.title).toBe("ShiftMate");
    expect(res.idea.pitch).toBe(WORDS);
    expect(res.idea.archetype).toBe("marketplace");
    expect(res.idea.current).toMatchObject({ version: 1, action: "edited", title: "ShiftMate", pitch: WORDS });
    expect(Object.keys(res.idea.current!.attributes)).toHaveLength(10);
    const meta = readMeta(res.idea.current!.research);
    expect(meta).toMatchObject({ founder_words: WORDS, brief: WORDS, sample: true });
    expect(res.mode).toBe("mock");
    expect(res.costLabel).toBe("Estimate");
    // In the founder's deck like any card; another founder never sees it.
    expect((await caller.idea.list()).items.map((i) => i.id)).toContain(res.idea.id);
    const other = await callerFor(mock, "write-b@test.local");
    await expect(other.caller.idea.get({ ideaId: res.idea.id })).rejects.toThrow();
    expect(userId).toBeTruthy();
  });

  it("lets the agent pick the kind of business when the founder leaves it open, and refuses empty words", async () => {
    const mock = new MockModelClient();
    const { caller } = await callerFor(mock, "write-c@test.local");
    const res = await caller.idea.write({ title: "Clinic Reminders", pitch: "Small clinics with two to five staff cannot keep up with appointment reminders and waste hours a week on the phone." });
    expect(res.idea.archetype).toBeTruthy();
    expect(res.idea.pitch).toMatch(/^Small clinics/);
    await expect(caller.idea.write({ title: "Nothing", pitch: "   " })).rejects.toThrow();
    await expect(caller.idea.write({ title: "", pitch: WORDS })).rejects.toThrow();
  });
});

describe("idea.edit", () => {
  it("saves the name, the pitch and the kind of business as a new version; changed words become the founder's", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "edit-a@test.local");
    const generated = await caller.idea.generate({ prompt: "bookkeeping for independent accountants in the Nordics" });
    const card = generated.ideas[0]!;
    expect(readMeta(card.current!.research).founder_words).toBeUndefined();
    const res = await caller.idea.edit({ ideaId: card.id, title: "Ledger Nord", pitch: "Independent accountants in the Nordics close their clients' months in one afternoon.", archetype: "services" });
    expect(res.version).toMatchObject({ version: 2, action: "edited", title: "Ledger Nord", pitch: "Independent accountants in the Nordics close their clients' months in one afternoon.", parentVersionId: card.current!.id });
    // The ratings and the citations carry over; the founder's words are recorded; the brief stays.
    expect(res.version.attributes).toEqual(card.current!.attributes);
    expect(readMeta(res.version.research)).toMatchObject({ founder_words: "Independent accountants in the Nordics close their clients' months in one afternoon.", brief: "bookkeeping for independent accountants in the Nordics" });
    expect(res.idea).toMatchObject({ title: "Ledger Nord", archetype: "services", currentVersionId: res.version.id });
    // Renaming alone leaves the pitch the agent's (no founder_words).
    const fresh = generated.ideas[1]!;
    const renamed = await caller.idea.edit({ ideaId: fresh.id, title: "Just a name" });
    expect(readMeta(renamed.version.research).founder_words).toBeUndefined();
    expect(renamed.version.pitch).toBe(fresh.current!.pitch);
    // Nothing to change is refused; another founder's card is not found.
    await expect(caller.idea.edit({ ideaId: card.id })).rejects.toThrow();
    const other = await callerFor(mock, "edit-b@test.local");
    await expect(other.caller.idea.edit({ ideaId: card.id, title: "Mine now" })).rejects.toThrow();
    expect(userId).toBeTruthy();
  });

  it("the committed card's founder words and brief reach the foundations' inputs", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "edit-c@test.local");
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Maya", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 13, sales: 3 }, targetMarkets: ["UK"], riskAppetite: "medium", budgetMinor: 150_000, currency: "GBP" });
    const written = await caller.idea.write({ title: "ShiftMate", pitch: WORDS, archetype: "marketplace" });
    const result = await caller.idea.commit({ ideaId: written.idea.id, name: "ShiftMate", archetype: "marketplace", gameMode: "personal" });
    const inputs = await repos.foundations.inputs(hz.db, result.business.id);
    expect(inputs.idea).toMatchObject({ title: "ShiftMate", pitch: WORDS, founderWords: WORDS, brief: WORDS });
    expect(userId).toBeTruthy();
  });

  it("the first cards are one idea.drafted fact for the account; a second write adds none (WP-02 T9)", async () => {
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "write-facts@test.local");
    await caller.idea.write({ title: "First", pitch: WORDS, archetype: "marketplace" });
    await caller.idea.write({ title: "Second", pitch: WORDS, archetype: "marketplace" });
    const facts = (await repos.accountEvents.list(hz.db, userId, { limit: 50 })).items.filter((e) => e.type === "idea.drafted");
    expect(facts.map((e) => e.payload)).toEqual([{ source: "written", cards: 1 }]);
  });
});
