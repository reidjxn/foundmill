/**
 * WP-08 T1: the first positioning draft is checked strictly, and every marketing request builder carries the approved
 * notes as one data block. The contract test enumerates `MARKETING_REQUEST_BUILDERS` by name: a builder added to the
 * list without a case here fails.
 */
import { describe, expect, it } from "vitest";
import { buildChannelCreativeRequest } from "./channel-creative";
import type { FoundationsInputs } from "./foundations";
import { buildPostDraftRequest, postDraftFacts } from "./post-draft";
import { buildProjectPageRequest } from "./project-page";
import { MARKETING_REQUEST_BUILDERS, POSITIONING_BLOCK_HEADING, distributionStrategistMessage, finalisePositioning, founderSupports, starterPositioning } from "./positioning";

const inputs = {
  businessId: "00000000-0000-4000-8000-000000000001",
  businessName: "Saturday Loaf",
  archetype: null,
  currency: "USD",
  door: "ideation",
  outline: [],
  idea: { title: "Saturday Loaf", pitch: "Weekly bread delivery", founderWords: "I bake sourdough every weekend and want to sell a loaf a week to people near me.", brief: null, archetype: null, starsCurrent: 3, starsPotential: 4 },
  founder: null,
  importReport: null,
  importedSources: [],
  authorAgentId: null,
} as unknown as FoundationsInputs;

const NOTES = "Positioning notes\nVersion: v1, Nov 15, 2026\nOne line: A fresh sourdough loaf on your porch every Saturday.";

const builders: Record<(typeof MARKETING_REQUEST_BUILDERS)[number], (positioning: string | null) => string> = {
  buildChannelCreativeRequest: (positioning) => buildChannelCreativeRequest({ businessName: "Saturday Loaf", channelKey: "social", campaignName: "Week one", objective: "First followers", learnings: [], kitMode: false, positioning }).messages[0]!.content,
  buildPostDraftRequest: (positioning) =>
    buildPostDraftRequest(postDraftFacts({ businessName: "Saturday Loaf", page: { pitch: "Bread on your porch", about: "Sourdough.", forWhom: "", stage: "idea" }, trigger: "page_published", subject: "page_live", at: new Date("2026-11-15T12:00:00Z"), link: "https://foundmill.com/p/saturday-loaf", positioning })).messages[0]!.content,
  buildProjectPageRequest: (positioning) => buildProjectPageRequest(inputs, { positioning }).messages[0]!.content,
  distributionStrategistMessage: (positioning) => distributionStrategistMessage({ business: { name: "Saturday Loaf" } }, positioning),
};

describe("every marketing request builder includes the positioning block when given one", () => {
  it("covers every builder by name", () => {
    expect(Object.keys(builders).sort()).toEqual([...MARKETING_REQUEST_BUILDERS].sort());
  });
  for (const name of MARKETING_REQUEST_BUILDERS) {
    it(name, () => {
      const withNotes = builders[name](NOTES);
      expect(withNotes).toContain(POSITIONING_BLOCK_HEADING);
      expect(withNotes).toContain("A fresh sourdough loaf on your porch every Saturday.");
      expect(withNotes).toContain('<untrusted_content kind="positioning_notes">');
      expect(builders[name](null)).not.toContain(POSITIONING_BLOCK_HEADING);
    });
  }
});

describe("finalisePositioning", () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    one_line: "A fresh sourdough loaf on your porch every Saturday.",
    step: "follow",
    for_whom: [{ text: "People near me who want sourdough every weekend", label: "founder", source: "idea" }],
    problem: [{ text: "Good bread sells out early downtown", label: "customer", source: "a reply" }],
    today: [],
    different: [{ text: "Because I bake sourdough every weekend, people near me get a loaf a week", label: "founder", source: "x" }],
    proof: [
      { text: "I bake sourdough every weekend", label: "founder", source: "x" },
      { text: "Neighbors love it", label: "customer", source: "y" },
    ],
    objections: [{ doubt: "Is this real yet?", answer: "Not yet.", label: "founder" }],
    voice: { traits: [], uses: [], never: [] },
    ...over,
  });

  it("keeps founder only where the founder's words support it; everything else is an assumption", () => {
    const n = finalisePositioning(answer(), inputs, "2026-11-15")!;
    expect(n.forWhom[0]).toMatchObject({ label: "founder", source: "your words" });
    expect(n.problem[0]!.label).toBe("assumption");
    expect(n.objections[0]!.label).toBe("assumption");
  });

  it("drops proof that is not the founder's own", () => {
    const n = finalisePositioning(answer(), inputs, "2026-11-15")!;
    expect(n.proof.map((l) => l.text)).toEqual(["I bake sourdough every weekend"]);
  });

  it("drops lines with figures or quotes the founder never gave", () => {
    const n = finalisePositioning(answer({ problem: [{ text: "40 neighbors asked for it", label: "assumption", source: null }, { text: '"Best bread ever"', label: "customer", source: null }] }), inputs, "2026-11-15")!;
    expect(n.problem).toEqual([]);
  });

  it("returns null without a usable one line, and the starter keeps the founder's first sentence only", () => {
    expect(finalisePositioning(answer({ one_line: "" }), inputs, "2026-11-15")).toBeNull();
    expect(finalisePositioning("nope", inputs, "2026-11-15")).toBeNull();
    const s = starterPositioning(inputs, "2026-11-15");
    expect(s.oneLine).toBe("I bake sourdough every weekend and want to sell a loaf a week to people near me.");
    expect(s.forWhom).toEqual([]);
  });

  it("founderSupports needs most content words to come from the founder", () => {
    expect(founderSupports("sell a loaf a week to people near me", inputs.idea!.founderWords!)).toBe(true);
    expect(founderSupports("busy parents in Denver", inputs.idea!.founderWords!)).toBe(false);
  });
});
