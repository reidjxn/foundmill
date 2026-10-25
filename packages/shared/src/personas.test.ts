import { describe, expect, it } from "vitest";
import {
  AGENT_STYLES,
  AGENT_STYLE_META,
  DEFAULT_AGENT_STYLE,
  PERSONAS,
  STYLE_CATALOGS,
  agentDisplayName,
  agentLabel,
  characterFor,
  characterPortraitPrompt,
  isAgentStyle,
  personaByKey,
  personaOrder,
  personaPortraitPrompt,
  pickPersonaKeys,
} from "./personas";

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
  it("defaults to the humans style and names the character of the chosen style", () => {
    expect(DEFAULT_AGENT_STYLE).toBe("humans");
    expect(agentDisplayName(cos, true, "humans")).toBe(agentDisplayName(cos, true));
    expect(agentDisplayName(cos, true, "cartoon_3d")).toBe("Malik");
    // "malik" is index 1: odd, so the 2D catalog shows an animal there.
    expect(agentDisplayName(cos, true, "cartoon_2d")).toBe("Bramble");
    expect(agentLabel(cos, true, "cartoon_2d")).toBe("Bramble (Chief of Staff)");
    expect(agentLabel(cos, true, "fantasy")).toBe("Thandor (Chief of Staff)");
    expect(agentDisplayName({ name: "Planner", personaKey: "amara" }, true, "cartoon_2d")).toBe("Amara");
    expect(agentDisplayName(cos, false, "fantasy")).toBe("Chief of Staff");
    expect(agentLabel({ name: "Planner", personaKey: "nobody" }, true, "fantasy")).toBe("Planner");
  });
});

/** Names that belong to well-known copyrighted characters; none may appear in a catalog. */
const FORBIDDEN_FRANCHISE_NAMES = [
  "gandalf", "legolas", "hermione", "frodo", "bilbo", "aragorn", "arwen", "galadriel", "elrond", "gimli", "samwise",
  "pippin", "merry", "boromir", "faramir", "eowyn", "thorin", "smaug", "sauron", "saruman", "gollum", "tauriel",
  "thranduil", "harry", "dumbledore", "snape", "draco", "hagrid", "voldemort", "sirius", "bellatrix", "neville",
  "ginny", "dobby", "geralt", "yennefer", "ciri", "triss", "daenerys", "tyrion", "arya", "sansa", "cersei", "jaime",
  "brienne", "drizzt", "elminster", "raistlin", "tanis", "zelda", "link", "ganon", "aslan", "caspian", "tumnus",
  "reepicheep", "eragon", "saphira", "kvothe", "kaladin", "shallan", "vin", "kelsier", "elsa", "olaf", "merida",
  "rapunzel", "maleficent", "ariel", "tinkerbell", "shrek", "fiona", "totoro", "chihiro", "howl", "sophie", "kiki",
  "aerith", "sephiroth", "tifa", "cloud", "hiccup", "toothless", "astrid", "aang", "katara", "zuko", "korra",
  "alistair", "morrigan", "hawke", "varric", "solas", "astarion", "shadowheart", "karlach", "thrall", "jaina",
  "sylvanas", "arthas", "illidan", "tyrande", "rincewind", "buttercup", "primrose", "cogsworth", "jinx", "lyra",
];

describe("character styles", () => {
  const humanNames = new Set(PERSONAS.map((p) => p.name.toLowerCase()));

  it("lists four styles with labels and descriptions", () => {
    expect([...AGENT_STYLES]).toEqual(["humans", "cartoon_3d", "cartoon_2d", "fantasy"]);
    for (const s of AGENT_STYLES) {
      expect(AGENT_STYLE_META[s].label.length).toBeGreaterThan(0);
      expect(AGENT_STYLE_META[s].description.length).toBeGreaterThan(0);
      expect(isAgentStyle(s)).toBe(true);
    }
    expect(isAgentStyle("anime")).toBe(false);
    expect(isAgentStyle(null)).toBe(false);
    expect(isAgentStyle(3)).toBe(false);
  });

  it("gives every style exactly PERSONAS.length characters, index-aligned by key", () => {
    for (const s of AGENT_STYLES) {
      const catalog = STYLE_CATALOGS[s];
      expect(catalog).toHaveLength(PERSONAS.length);
      catalog.forEach((c, i) => {
        expect(c.key).toBe(PERSONAS[i]!.key);
        expect(c.style).toBe(s);
        expect(c.name.trim().length).toBeGreaterThan(0);
        expect(c.look.trim().length).toBeGreaterThan(0);
        expect(c.look).not.toMatch(/\n/);
        expect(characterFor(c.key, s)).toBe(c);
      });
    }
  });

  it("keeps names unique within a style", () => {
    for (const s of AGENT_STYLES) {
      const names = STYLE_CATALOGS[s].map((c) => c.name.toLowerCase());
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      expect(dupes, `${s} duplicates`).toEqual([]);
    }
  });

  it("reuses the human persona for humans and 3D cartoon humans", () => {
    for (const s of ["humans", "cartoon_3d"] as const) {
      STYLE_CATALOGS[s].forEach((c, i) => {
        const p = PERSONAS[i]!;
        expect(c.kind).toBe("human");
        expect(c.name).toBe(p.name);
        expect(c.presentation).toBe(p.presentation);
        expect(c.species).toBeUndefined();
        expect(c.look).toContain(p.presentation);
        expect(c.look).toContain(p.age);
      });
    }
  });

  it("alternates flat-drawn humans and 120 friendly animals in the 2D catalog", () => {
    const catalog = STYLE_CATALOGS.cartoon_2d;
    const animals = catalog.filter((c) => c.kind === "animal");
    expect(animals).toHaveLength(120);
    catalog.forEach((c, i) => {
      if (i % 2 === 0) {
        expect(c.kind).toBe("human");
        expect(c.name).toBe(PERSONAS[i]!.name);
      } else {
        expect(c.kind).toBe("animal");
        expect(c.species?.length).toBeGreaterThan(0);
        expect(c.presentation).toBeNull();
        expect(humanNames.has(c.name.toLowerCase()), `${c.name} is a human catalog name`).toBe(false);
      }
    });
    expect(new Set(animals.map((a) => a.species)).size).toBe(120);
    expect(animals.map((a) => a.species)).toEqual(expect.arrayContaining(["red fox", "river otter", "deer", "toucan", "sea turtle", "clownfish"]));
  });

  it("fills the fantasy catalog with 240 fantasy folk, half women and half men, across many species", () => {
    const catalog = STYLE_CATALOGS.fantasy;
    expect(catalog.filter((c) => c.presentation === "woman")).toHaveLength(120);
    expect(catalog.filter((c) => c.presentation === "man")).toHaveLength(120);
    for (const c of catalog) {
      expect(c.kind).toBe("fantasy");
      expect(c.species?.length).toBeGreaterThan(0);
      expect(humanNames.has(c.name.toLowerCase()), `${c.name} is a human catalog name`).toBe(false);
    }
    const species = new Set(catalog.map((c) => c.species));
    expect(species.size).toBeGreaterThanOrEqual(15);
    expect([...species]).toEqual(expect.arrayContaining(["elf", "wizard", "dwarf", "fairy", "gnome", "druid", "knight", "ranger", "bard", "merfolk", "centaur", "dryad", "halfling", "dragon-kin"]));
    // Neighbors alternate presentation, like the human catalog.
    catalog.forEach((c, i) => expect(c.presentation).toBe(i % 2 === 0 ? "woman" : "man"));
  });

  it("never uses the name of a well-known copyrighted character", () => {
    for (const s of ["cartoon_2d", "fantasy"] as const) {
      for (const c of STYLE_CATALOGS[s]) {
        expect(FORBIDDEN_FRANCHISE_NAMES.includes(c.name.toLowerCase()), `${s}: ${c.name}`).toBe(false);
      }
    }
  });

  it("returns null for an unknown or missing key", () => {
    expect(characterFor("nobody", "fantasy")).toBeNull();
    expect(characterFor(null, "humans")).toBeNull();
    expect(characterFor(undefined, "cartoon_2d")).toBeNull();
    expect(characterFor("amara", "fantasy")?.name).toBe("Elowen");
    expect(characterFor("malik", "cartoon_2d")?.name).toBe("Bramble");
  });

  it("writes the human prompt word for word and a styled prompt for the other styles", () => {
    for (const p of PERSONAS) {
      expect(characterPortraitPrompt(characterFor(p.key, "humans")!)).toBe(personaPortraitPrompt(p));
    }
    const three = characterPortraitPrompt(characterFor("amara", "cartoon_3d")!);
    expect(three).toContain("3D animated feature film style character portrait");
    expect(three).toContain("big expressive eyes");
    const flat = characterPortraitPrompt(characterFor("malik", "cartoon_2d")!);
    expect(flat).toContain("flat 2D cartoon illustration");
    expect(flat).toContain("a red fox with a bushy tail in a knitted sweater");
    const fantasy = characterPortraitPrompt(characterFor("amara", "fantasy")!);
    expect(fantasy).toContain("3D rendered fantasy character portrait");
    expect(fantasy).toContain("Painterly fantasy lighting");
    for (const prompt of [three, flat, fantasy]) {
      expect(prompt).toContain("smiling warmly");
      expect(prompt).toContain("head and shoulders");
      expect(prompt).toContain("no text");
      expect(prompt).toContain("one character only");
    }
  });

  it("never names a studio, brand or franchise in a prompt", () => {
    const brands = /\b(pixar|disney|dreamworks|ghibli|illumination|nintendo|marvel|tolkien|warcraft|hogwarts|middle[- ]earth|narnia|dungeons|d&d|blizzard studio|sony|cartoon network|nickelodeon|hanna|looney|peanuts|muppets|sesame street)\b/i;
    for (const s of AGENT_STYLES) {
      for (const c of STYLE_CATALOGS[s]) {
        const prompt = characterPortraitPrompt(c);
        expect(prompt, `${s}/${c.key}`).not.toMatch(brands);
        expect(prompt).toContain(c.style === "humans" ? "one person only" : "one character only");
      }
    }
  });
});
