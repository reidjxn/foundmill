/**
 * The ideation eval's checker, offline: the mock's slate-then-cards sets pass the structural checks for every brief
 * (the mock does not read constraints, so constraint problems are only checked on crafted sets), and crafted bad sets
 * fail for the right reason. The live run is ideation.eval.test.ts.
 */
import { MockModelClient, type ConceptCard, type IdeationSlateItem } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { checkIdeationSet, IDEATION_BRIEFS, runIdeationEval } from "../ideation";

const item = (i: number, over: Partial<IdeationSlateItem> = {}): IdeationSlateItem => ({ id: `c${i}`, name: `Concept ${i}`, archetype: "b2b_saas", angle: `Angle ${i} for a distinct customer.`, ...over });
const card = (slate: IdeationSlateItem, over: Partial<ConceptCard> = {}): ConceptCard => ({
  id: slate.id,
  name: slate.name,
  pitch: slate.angle,
  archetype: slate.archetype,
  stars_current: 3,
  stars_potential: 4,
  attributes: Array.from({ length: 10 }, (_, k) => ({ key: "market_pull" as const, value: 10 + k, evidence: "Unverified: forum threads mention it." })),
  citations: [
    { title: "Source A", url: "https://example.org", note: "check" },
    { title: "Source B", url: "https://example.net", note: "check" },
  ],
  crest_seed: slate.id,
  ...over,
});

describe("ideation eval checker", () => {
  it("passes the mock's sets on structure for every brief", async () => {
    const client = new MockModelClient();
    for (const entry of IDEATION_BRIEFS) {
      const r = await runIdeationEval(entry, client);
      expect(r.error, entry.id).toBeUndefined();
      expect(r.check.problems.filter((p) => p.kind !== "constraint"), entry.id).toEqual([]);
      expect(r.check.cards).toBe(r.check.slateSize);
      expect(r.cardCalls).toBe(r.check.slateSize);
      // The mock counts a repeated cached system prompt as a cache read: every card reads what the slate wrote.
      expect(r.cacheReads).toBe(r.cardCalls);
    }
  });

  it("passes a good set", () => {
    const slate = Array.from({ length: 6 }, (_, i) => item(i));
    expect(checkIdeationSet(slate, slate.map((s) => card(s)))).toMatchObject({ passed: true, slateSize: 6, cards: 6 });
  });

  it("fails a short slate, duplicate names, a missing or renamed card, loose cards and ruled-out archetypes", () => {
    const short = Array.from({ length: 5 }, (_, i) => item(i));
    expect(checkIdeationSet(short, short.map((s) => card(s))).problems.map((p) => p.message)).toContain("slate has 5 concepts (want 6-12)");

    const slate = [...Array.from({ length: 5 }, (_, i) => item(i)), item(5, { name: "Concept 0" })];
    const cards: (ConceptCard | undefined)[] = slate.map((s) => card(s));
    cards[1] = undefined;
    cards[2] = card(slate[2]!, { name: "Something else" });
    cards[3] = card(slate[3]!, { pitch: "word ".repeat(60) });
    cards[4] = card(slate[4]!, { stars_current: 5, stars_potential: 2, citations: [{ title: "Only", url: "https://example.org", note: "" }] });
    const r = checkIdeationSet(slate, cards, ["b2b_saas"]);
    const messages = r.problems.map((p) => p.message).join("\n");
    expect(r.passed).toBe(false);
    expect(messages).toMatch(/two slate items share a name/);
    expect(messages).toMatch(/no card for "Concept 1"/);
    expect(messages).toMatch(/card 2 is named "Something else"/);
    expect(messages).toMatch(/card 3 pitch runs 60 words/);
    expect(messages).toMatch(/card 4 potential below current/);
    expect(messages).toMatch(/card 4 has 1 citations/);
    expect(r.problems.some((p) => p.kind === "constraint")).toBe(true);
  });
});
