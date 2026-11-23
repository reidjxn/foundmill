import { describe, expect, it } from "vitest";
import { TOOL_CATEGORIES, TOOL_CATEGORY_LABELS, TOOL_PICK_NOTE, describesInvention, regulatedAreasOf, toolPickCategory } from "./tool-needs";

describe("tool needs (founder, Nov 22, 2026)", () => {
  it("labels every category in words a founder reads", () => {
    for (const c of TOOL_CATEGORIES) expect(TOOL_CATEGORY_LABELS[c], c).toMatch(/^[a-zA-Z]/);
  });

  it("reads a money product from the founder's words, and not a project that only takes payments", () => {
    expect(regulatedAreasOf("A fintech app that lets housemates split rent and holds the money for three days")).toContain("payments");
    expect(regulatedAreasOf("Small loans for market traders, repaid weekly")).toEqual(["lending"]);
    expect(regulatedAreasOf("A crypto exchange for beginners")).toEqual(["crypto"]);
    expect(regulatedAreasOf("Home cleaning in Austin. Customers book a slot and pay by card.")).toEqual([]);
    expect(regulatedAreasOf("A tutoring business that accepts payments online")).toEqual([]);
  });

  it("marks the recommendation's note by its decision key, with a known category only", () => {
    expect(toolPickCategory({ key: `${TOOL_PICK_NOTE.keyPrefix}booking` })).toBe("booking");
    expect(toolPickCategory({ key: `${TOOL_PICK_NOTE.keyPrefix}rockets` })).toBeNull();
    expect(toolPickCategory({ key: "project_page.ready" })).toBeNull();
    expect(toolPickCategory(null)).toBeNull();
  });
});

describe("describesInvention", () => {
  it("reads an invention from the founder's words and ignores an ordinary product", () => {
    for (const text of ["A new method for leveling a bike rack", "our own sensor that reads soil moisture", "We invented a hinge", "a proprietary algorithm for routing", "I want to patent this", "a novel enzyme blend"]) expect(describesInvention(text), text).toBe(true);
    for (const text of ["An online store for handmade candles", "A newsletter about cycling", "Coaching for first-time managers"]) expect(describesInvention(text), text).toBe(false);
  });
});
