/**
 * The ideation mock's two shapes (audit P2): the full set it always drafted, and one card per request for the slate's
 * fan-out (the card keeps the slate item's name, archetype and angle) or for Import's single card.
 */
import { describe, expect, it } from "vitest";
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

  it("drafts a card from the prompt alone when no slate item is named (Import's single card)", async () => {
    const r = await new MockModelClient().complete({ route: "ideation", messages: promptWith({ prompt: "Import report: Lpgp, a B2B SaaS for invoices" }), schema: ConceptCard });
    expect(r.repaired).toBe(false);
    expect(r.json.name.length).toBeGreaterThan(0);
    expect(r.json.attributes).toHaveLength(10);
  });
});
