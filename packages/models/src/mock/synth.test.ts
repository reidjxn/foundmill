import { describe, expect, it } from "vitest";
import { z } from "zod";
import { seededRng } from "../hash";
import { MockModelClient } from "./index";
import { synthesizeFromZod } from "./synth";

describe("synthesizeFromZod numbers", () => {
  it("treats zod's implicit safe-integer range as unbounded, never as a range to draw from (#354)", () => {
    const schema = z.object({ cost: z.number().int().nonnegative(), days: z.number().int(), score: z.number().int().min(1).max(5), capped: z.number().int().nonnegative().max(730) });
    for (let i = 0; i < 25; i += 1) {
      const out = schema.parse(synthesizeFromZod(schema, seededRng(`synth-${i}`)));
      expect(out.cost).toBeLessThanOrEqual(25);
      expect(Math.abs(out.days)).toBeLessThanOrEqual(25);
      expect(out.score).toBeGreaterThanOrEqual(1);
      expect(out.score).toBeLessThanOrEqual(5);
      expect(out.capped).toBeLessThanOrEqual(730);
    }
  });
});

describe("jurisdiction recommender mock (#354)", () => {
  const Card = z.object({
    jurisdiction: z.string().min(1),
    entity_type: z.string().min(1),
    formation_cost_minor: z.number().int().nonnegative().max(100_000_000),
    annual_cost_minor: z.number().int().nonnegative().max(100_000_000),
    minimum_capital_minor: z.number().int().nonnegative().max(10_000_000_000),
    time_to_form_days: z.number().int().nonnegative().max(730),
    banking: z.string(),
    investor_familiarity: z.number().int().min(1).max(5),
    tax_notes: z.string(),
    advantages: z.array(z.string()),
    disadvantages: z.array(z.string()),
    route: z.enum(["stripe_atlas", "companies_house_web", "kit"]),
  });
  const Recommendation = z.object({ headline: z.string().min(1), cards: z.array(Card).min(1).max(6) });

  it("answers with plausible cards from its own generator, not schema noise", async () => {
    const client = new MockModelClient();
    const result = await client.complete({ route: "departmentLead", system: "You are the Legal agent.", messages: [{ role: "user", content: "```json\n" + JSON.stringify({ fundraising: "vc", co_founders: 1 }) + "\n```" }], schema: Recommendation });
    expect(result.repaired).toBe(false);
    expect(result.json.headline).toBe("For your business, we recommend Delaware or the United Kingdom");
    expect(result.json.cards.map((c) => c.route)).toEqual(["stripe_atlas", "companies_house_web", "kit"]);
    for (const c of result.json.cards) {
      expect(c.formation_cost_minor).toBeLessThan(10_000_000);
      expect(c.time_to_form_days).toBeLessThan(60);
      expect(c.entity_type).not.toMatch(/mock/i);
    }
  });
});
