import { describe, expect, it } from "vitest";
import { attributeReason } from "../routers/idea";

const card = (values: Record<string, number>) => ({ current: { attributes: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])) } }) as never;

/** Compare's fallback ranking reason (mock mode, or a model ranking that names no compared card): from the cards' own ratings. */
describe("attributeReason", () => {
  it("names where a card leads outright and where it is weakest", () => {
    const a = card({ market_pull: 14, capital_intensity: 16, defensibility: 9 });
    const b = card({ market_pull: 13, capital_intensity: 14, defensibility: 10 });
    expect(attributeReason(a, [b])).toBe("Leads on capital intensity (16) and market pull (14); weakest on defensibility (9).");
    expect(attributeReason(b, [a])).toBe("Leads on defensibility (10).");
    const c = card({ market_pull: 1, capital_intensity: 2, defensibility: 3 });
    expect(attributeReason(c, [a, b])).toBe("Leads on no attribute outright; weakest on market pull (1).");
  });
  it("never says 'no model ranking' and copes with a card without ratings", () => {
    expect(attributeReason(card({}), [])).toMatch(/no attribute ratings yet/);
    expect(attributeReason(card({ agent_executability: 12 }), [card({ agent_executability: 3 })])).toBe("Leads on agent-executability (12).");
  });
});
