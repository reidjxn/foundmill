import { describe, expect, it } from "vitest";
import { PERSONAS, agentDisplayName, agentLabel, personaByKey, personaOrder, personaPortraitPrompt, pickPersonaKeys } from "./personas";

describe("persona catalog", () => {
  it("has 240 personas with unique keys and names, half women and half men", () => {
    expect(PERSONAS).toHaveLength(240);
    expect(new Set(PERSONAS.map((p) => p.key)).size).toBe(240);
    expect(new Set(PERSONAS.map((p) => p.name.toLowerCase())).size).toBe(240);
    expect(PERSONAS.filter((p) => p.presentation === "woman")).toHaveLength(120);
    for (const p of PERSONAS) expect(p.key).toMatch(/^[a-z]+$/);
  });

  it("keeps its first keys stable (they are stored on agents)", () => {
    expect(PERSONAS.slice(0, 4).map((p) => p.key)).toEqual(["amara", "malik", "mei", "kenji"]);
  });

  it("writes a warm, photographic headshot prompt", () => {
    const prompt = personaPortraitPrompt(personaByKey("amara")!);
    expect(prompt).toContain("smiling warmly");
    expect(prompt).toContain("woman");
  });
});

describe("pickPersonaKeys", () => {
  it("is stable for a seed and differs between seeds", () => {
    expect(pickPersonaKeys(5, { seed: "b1" })).toEqual(pickPersonaKeys(5, { seed: "b1" }));
    expect(pickPersonaKeys(5, { seed: "b1" })).not.toEqual(pickPersonaKeys(5, { seed: "b2" }));
    expect(personaOrder("b1")).toHaveLength(240);
  });

  it("never repeats a key within a business and avoids the owner's other businesses while it can", () => {
    const other = pickPersonaKeys(27, { seed: "first" });
    const next = pickPersonaKeys(27, { seed: "second", avoid: other });
    expect(new Set(next).size).toBe(27);
    expect(next.filter((k) => other.includes(k))).toEqual([]);
    const more = pickPersonaKeys(3, { seed: "second", taken: next, avoid: other });
    expect(more.filter((k) => next.includes(k) || other.includes(k))).toEqual([]);
  });

  it("uses avoided keys only when nothing else is left, and repeats past the catalog", () => {
    const all = PERSONAS.map((p) => p.key);
    expect(pickPersonaKeys(2, { seed: "s", avoid: all.slice(1) })[0]).toBe(all[0]);
    expect(pickPersonaKeys(241, { seed: "s" })).toHaveLength(241);
  });
});

describe("display", () => {
  const cos = { name: "Chief of Staff", role: "Chief of Staff", personaKey: "malik" };
  it("shows the first name and the position when on", () => {
    expect(agentDisplayName(cos, true)).toBe("Malik");
    expect(agentLabel(cos, true)).toBe("Malik (Chief of Staff)");
  });
  it("shows the agent as today when off, or when the agent has no persona", () => {
    expect(agentDisplayName(cos, false)).toBe("Chief of Staff");
    expect(agentLabel(cos, false)).toBe("Chief of Staff");
    expect(agentLabel({ name: "Planner", role: "", personaKey: null }, true)).toBe("Planner");
    expect(agentLabel({ name: "Planner", role: "", personaKey: "mei" }, true)).toBe("Mei (Planner)");
  });
});
