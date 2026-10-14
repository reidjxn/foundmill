import { describe, expect, it } from "vitest";
import { SECTOR_GATES, SECTOR_KEYS, detectSectors, gateState, mentionsKeyword, openSectorGates, sectorSelection } from "./sectors";

describe("mentionsKeyword (#353)", () => {
  const text = (s: string) => s.toLowerCase();
  it("matches whole words, with a plural", () => {
    expect(mentionsKeyword(text("fresh tea and cakes"), "tea")).toBe(true);
    expect(mentionsKeyword(text("loose leaf teas"), "tea")).toBe(true);
    expect(mentionsKeyword(text("dishware"), "dish")).toBe(false); // only "s" and "es" are allowed after a whole word
    expect(mentionsKeyword(text("peaches"), "peach")).toBe(true);
  });

  it("does not match inside another word", () => {
    expect(mentionsKeyword(text("lab team"), "tea")).toBe(false);
    expect(mentionsKeyword(text("a chair"), "hair")).toBe(false);
    expect(mentionsKeyword(text("the canteen"), "teen")).toBe(false);
    expect(mentionsKeyword(text("transparent pricing"), "parent")).toBe(false);
  });

  it("matches a stem with a star and a phrase as words in a row", () => {
    expect(mentionsKeyword(text("early diagnosis tool"), "diagnos*")).toBe(true);
    expect(mentionsKeyword(text("a diagnostic kit"), "diagnos*")).toBe(true);
    expect(mentionsKeyword(text("contract review for startups"), "contract review")).toBe(true);
    expect(mentionsKeyword(text("contract reviews"), "contract review")).toBe(false);
  });
});

describe("detectSectors", () => {
  it("suggests a sector from the name, pitch and glossary with the words that caused it", () => {
    const hits = detectSectors({ name: "Northwind Skincare", pitch: "Serums for sensitive skin", archetype: "dtc_physical", glossary: { squad: "lab team" } });
    expect(hits.map((h) => h.key)).toEqual(["food", "cosmetics"]); // food by archetype only, never by "team"
    expect(hits.find((h) => h.key === "food")!.reasons.join(" ")).not.toContain("tea");
    expect(hits.find((h) => h.key === "cosmetics")!.reasons.join(" ")).toContain('"skincare"');
  });

  it("suggests nothing for a business that mentions nothing", () => {
    expect(detectSectors({ name: "Steady Teams", pitch: "Rota software", archetype: "b2b_saas" })).toEqual([]);
  });
});

describe("gates", () => {
  it("is open until every checklist item is done, cleared after, and not applicable when the sector is off", () => {
    const all = SECTOR_GATES.food.checklist.map((i) => `food:${i.id}`);
    expect(gateState("food", new Set(["food"] as const), new Set())).toBe("open");
    expect(gateState("food", new Set(["food"] as const), new Set(all.slice(1)))).toBe("open");
    expect(gateState("food", new Set(["food"] as const), new Set(all))).toBe("clear");
    expect(gateState("food", new Set(), new Set(all))).toBe("not_applicable");
  });

  it("follows the saved choice over the suggestion, per sector", () => {
    const { selected, done } = sectorSelection([{ sector: "food", applies: false, done: [] }, { sector: "health", applies: true, done: ["claims", "professional"] }], ["food", "cosmetics"]);
    expect([...selected].sort()).toEqual(["cosmetics", "health"]);
    expect(done.has("health:claims")).toBe(true);
    expect(openSectorGates([{ sector: "food", applies: false, done: [] }], ["food"])).toEqual([]);
    expect(openSectorGates([], ["cosmetics"]).map((g) => g.key)).toEqual(["cosmetics"]);
  });

  it("describes every sector with what the team does not do and a checklist", () => {
    for (const key of SECTOR_KEYS) {
      expect(SECTOR_GATES[key].blocked.length).toBeGreaterThan(0);
      expect(SECTOR_GATES[key].checklist.length).toBeGreaterThan(0);
      expect(new Set(SECTOR_GATES[key].checklist.map((i) => i.id)).size).toBe(SECTOR_GATES[key].checklist.length);
    }
  });
});
