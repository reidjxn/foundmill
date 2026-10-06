import { describe, expect, it } from "vitest";
import { buildManifest, lookupByName, manifestLine, normalizeName } from "../index";
import { FIXTURE_ENTITIES, FIXTURE_IDS, fixtureManifest } from "../testing";

describe("buildManifest", () => {
  const m = fixtureManifest();

  it("indexes by id and by normalised name/alias, visible only", () => {
    expect(m.byId.get(FIXTURE_IDS.meridian)?.name).toBe("Meridian Labs");
    expect(m.byAlias.get("meridian labs")?.map((e) => e.id)).toEqual([FIXTURE_IDS.meridian]);
    expect(m.byAlias.get("meridian")?.map((e) => e.id)).toEqual([FIXTURE_IDS.meridian]);
    expect(m.byAlias.get("npab")?.map((e) => e.id)).toEqual([FIXTURE_IDS.nordicPackaging]);
    expect(m.byAlias.get("hidden investor")).toBeUndefined();
    expect(m.visibleIds.has(FIXTURE_IDS.hiddenInvestor)).toBe(false);
    expect(m.visibleIds.size).toBe(FIXTURE_ENTITIES.length - 1);
  });

  it("writes prompt text as `id | kind | name | aliases` lines for visible entities only", () => {
    expect(m.lines).toHaveLength(FIXTURE_ENTITIES.length - 1);
    expect(m.text).toContain(`${FIXTURE_IDS.meridian} | organisation | Meridian Labs | Meridian | supplier`);
    expect(m.text).not.toContain("Hidden Investor");
    expect(m.text.split("\n")).toEqual(m.lines);
  });

  it("toJSON gives the mock model client what it reads (id, kind, name, aliases)", () => {
    const json = m.toJSON();
    expect(json.find((e) => e.id === FIXTURE_IDS.nordicPackaging)).toEqual({ id: FIXTURE_IDS.nordicPackaging, kind: "organisation", name: "Nordic Packaging AB", aliases: ["Nordic Packaging", "NPAB"] });
    expect(json.some((e) => e.id === FIXTURE_IDS.hiddenInvestor)).toBe(false);
    expect(JSON.parse(JSON.stringify({ manifest: m }))).toEqual({ manifest: json });
  });

  it("deduplicates ids, trims names, drops aliases equal to the name and blank rows", () => {
    const built = buildManifest([
      { id: "a", kind: "person", name: "  Sara   Lindqvist ", aliases: ["sara lindqvist", "Sara", "", "Sara"] },
      { id: "a", kind: "organisation", name: "Duplicate" },
      { id: "b", kind: "organisation", name: "   " },
    ]);
    expect(built.entities).toHaveLength(1);
    expect(built.entities[0]).toMatchObject({ id: "a", kind: "person", name: "Sara Lindqvist", aliases: ["Sara"], keys: ["sara lindqvist", "sara"] });
  });

  it("several entities can share an alias", () => {
    const built = buildManifest([
      { id: "a", kind: "person", name: "Sara Lindqvist", aliases: ["Sara"] },
      { id: "b", kind: "person", name: "Sara Novak", aliases: ["Sara"] },
    ]);
    expect(lookupByName(built, "sara").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("rejects unknown kinds unless strictKinds is off", () => {
    expect(() => buildManifest([{ id: "x", kind: "robot" as never, name: "X" }])).toThrow(/unknown kind/);
    expect(buildManifest([{ id: "x", kind: "robot" as never, name: "X" }], { strictKinds: false }).get("x")?.kind).toBe("organisation");
  });

  it("normalizeName folds diacritics, case, punctuation and whitespace", () => {
    expect(normalizeName("  Meridian-Labs. ")).toBe("meridian labs");
    expect(normalizeName("Åkesson & Söner")).toBe("akesson & soner");
    expect(normalizeName("O’Neil")).toBe("o neil");
  });

  it("manifestLine includes role and org when present", () => {
    const e = m.get(FIXTURE_IDS.saraLindqvist);
    expect(e && manifestLine(e)).toBe(`${FIXTURE_IDS.saraLindqvist} | person | Sara Lindqvist | - | procurement lead, Meridian Labs`);
  });
});
