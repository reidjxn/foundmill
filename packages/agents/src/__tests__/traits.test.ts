import { describe, expect, it } from "vitest";
import { MAX_TRAITS, TRAIT_LABELS, deriveTraits } from "../traits";
import { backendEngineer, channelEmailAutomation, sourcingManufacturing } from "../templates";
import { SHARED_RULE_FRAGMENTS } from "../templates/_shared";

describe("deriveTraits (BUILD §11.10 'Traits derived from instructions')", () => {
  it("derives the spec's example traits from matching instructions", () => {
    const traits = deriveTraits({
      role: "Backend engineer",
      goals: ["Ship small changes"],
      rules: ["Write the failing test first, then the code.", "Ask for approval before any spend above the threshold."],
      playbook: ["Read the whole file before editing."],
      tone: "Terse",
      examples: [],
    });
    expect(traits).toContain("Writes tests first");
    expect(traits).toContain("Asks before spending");
    expect(traits).toContain("Reads the whole thing");
    expect(traits.length).toBeLessThanOrEqual(MAX_TRAITS);
  });

  it("prefers template-specific text over shared layer rules", () => {
    const traits = deriveTraits(backendEngineer.instructions, { sharedRules: SHARED_RULE_FRAGMENTS });
    expect(traits.length).toBeGreaterThan(0);
    expect(traits).toEqual(backendEngineer.traits);
    expect(channelEmailAutomation.traits).toContain("Checks consent first");
    expect(sourcingManufacturing.traits).toContain("Negotiates within limits");
  });

  it("is deterministic and only emits catalogue labels", () => {
    const a = deriveTraits(backendEngineer.instructions);
    const b = deriveTraits(backendEngineer.instructions);
    expect(a).toEqual(b);
    for (const t of a) expect(TRAIT_LABELS).toContain(t);
    expect(deriveTraits({ role: "x", goals: ["y"], rules: ["z"], playbook: ["w"], tone: "t", examples: [] })).toEqual([]);
  });
});
