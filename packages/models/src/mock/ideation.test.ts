/**
 * The ideation mock's two shapes (audit P2): the full set it always drafted, and one card per request for the slate's
 * fan-out (the card keeps the slate item's name, archetype and angle) or for Import's single card.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConceptCard, IdeationOutput, IdeationSlateOutput } from "../schemas";
import { promptWith } from "./fixtures.test-helpers";
import { MockModelClient } from "./index";

const BRIEF = { prompt: "bookkeeping for freelancers in the EU", founder: { constraints: ["bootstrapped"], skills: { engineering: 15, sales: 8 } } };

describe("ideation mock", () => {
  it("still drafts a full set of 6-12 cards for a set schema", async () => {
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith(BRIEF), schema: IdeationOutput });
    expect(r.repaired).toBe(false);
    expect(r.json.concepts.length).toBeGreaterThanOrEqual(6);
    expect(r.json.concepts.length).toBeLessThanOrEqual(12);
  });

  it("writes one card for a single-card schema, keeping the slate item's id, name, archetype and angle", async () => {
    const client = new MockModelClient();
    const slate = await client.complete({ route: "ideationSlate", messages: promptWith(BRIEF), schema: IdeationSlateOutput });
    const item = slate.json.slate[2]!;
    const card = await client.complete({ route: "ideation", messages: promptWith({ ...BRIEF, concept: item }), schema: ConceptCard });
    expect(card.repaired).toBe(false);
    expect(card.json).toMatchObject({ id: item.id, name: item.name, archetype: item.archetype, pitch: item.angle });
    expect(card.json.attributes).toHaveLength(10);
    expect(card.json.citations.length).toBeGreaterThanOrEqual(2);
    // Deterministic: the same request gives the same card; another slate item gives another card.
    const again = await client.complete({ route: "ideation", messages: promptWith({ ...BRIEF, concept: item }), schema: ConceptCard });
    expect(again.json).toEqual(card.json);
    const other = await client.complete({ route: "ideation", messages: promptWith({ ...BRIEF, concept: slate.json.slate[3] }), schema: ConceptCard });
    expect(other.json.name).toBe(slate.json.slate[3]!.name);
  });

  it("describes the imported business in Import's single card: its own name, the report's archetype, what exists (audit IAE-10)", async () => {
    const importReport = ["Existing business import: Verifier Audit Co.", "What exists: A GitHub repository acme/verifier; Linear issues.", "Strengths: Code exists.", "Weaknesses: No revenue source.", "Missing: Bank."].join("\n");
    for (const hint of ["b2b_saas", "services"] as const) {
      const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith({ prompt: "Produce one concept card that describes the existing business.", archetype_hint: hint, import_report: importReport }), schema: ConceptCard });
      expect(r.repaired).toBe(false);
      expect(r.json.name).toBe("Verifier Audit Co");
      expect(r.json.archetype).toBe(hint);
      expect(r.json.pitch).toMatch(/^Verifier Audit Co is an existing .+ business: A GitHub repository acme\/verifier; Linear issues\.$/);
      expect(r.json.pitch).not.toMatch(/renters|new parents/);
    }
  });

  it("drafts a card from the prompt alone when no slate item is named (Import's single card)", async () => {
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith({ prompt: "Import report: Lpgp, a B2B SaaS for invoices" }), schema: ConceptCard });
    expect(r.repaired).toBe(false);
    expect(r.json.name.length).toBeGreaterThan(0);
    expect(r.json.attributes).toHaveLength(10);
  });
});

describe("ideation mock reads the founder's brief (first-time founder report, Nov 8, 2026)", () => {
  const brief = { prompt: "Students at my university struggle to find short-notice part-time shifts, and local cafes and bars near campus struggle to fill last-minute gaps. I want to build a simple app that matches verified students to same-day shifts at independent venues around Manchester.", founder: { constraints: ["bootstrapped"] } };

  it("echoes the people and the struggle the brief names on most cards, and leads with the founder's own product sentence", async () => {
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith(brief), schema: IdeationOutput });
    const pitches = r.json.concepts.map((c) => c.pitch);
    const echoing = pitches.filter((p) => /students at my university|local cafes and bars near campus/.test(p));
    expect(echoing.length).toBeGreaterThanOrEqual(Math.ceil(pitches.length * 0.6));
    expect(pitches[0]).toMatch(/a simple app that matches verified students to same-day shifts at independent venues around Manchester/);
    expect(pitches.join(" ")).toMatch(/find short-notice part-time shifts|fill last-minute gaps/);
    // Never the padding of a brief that named nobody.
    expect(pitches.join(" ")).not.toMatch(/built around/);
  });

  it("a brief that names nobody still draws its audiences from the archetype, as before", async () => {
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith(BRIEF), schema: IdeationOutput });
    expect(r.json.concepts.every((c) => /helps .+ through .+/.test(c.pitch))).toBe(true);
  });

  it("Compare's verdict is written from the cards' own ratings: a ranking that names every card, no placeholder text", async () => {
    const Verdict = z.object({ verdict_md: z.string().min(1), ranking: z.array(z.object({ idea_id: z.string(), rank: z.number().int().min(1), reason: z.string() })).min(1) });
    const concepts = [
      { id: "11111111-1111-4111-8111-111111111111", title: "Shiftnest", pitch: "A", attributes: { market_pull: { value: 13 }, distribution_clarity: { value: 9 }, defensibility: { value: 14 } } },
      { id: "22222222-2222-4222-8222-222222222222", title: "Studentwave", pitch: "B", attributes: { market_pull: { value: 14 }, distribution_clarity: { value: 5 }, defensibility: { value: 8 } } },
    ];
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith({ concepts }), schema: Verdict });
    expect(r.repaired).toBe(false);
    expect(r.json.verdict_md).not.toMatch(/mock/i);
    expect(r.json.verdict_md).toMatch(/Shiftnest/);
    expect(r.json.verdict_md).toMatch(/Commit Shiftnest/);
    expect(r.json.ranking.map((x) => x.idea_id).sort()).toEqual(concepts.map((c) => c.id).sort());
    expect(r.json.ranking[0]).toMatchObject({ idea_id: concepts[0]!.id, rank: 1 });
    expect(r.json.ranking[0]!.reason).toMatch(/defensibility \(14\)/);
  });
});
