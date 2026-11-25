/** The Chief of Staff's build recommendation against its golden cases (evals/src/build-choice/cases.ts), offline. */
import { BUILD_CHOICE_NOTE, buildChoiceNote, chooseBuild, LOVABLE_PRICE_ESTIMATE } from "@foundmill/agents";
import { describe, expect, it } from "vitest";
import { BUILD_CHOICE_CASES, NEVER_ANY, unlabeledMoney } from "../build-choice/cases";

describe("build choice golden cases", () => {
  it("covers a clear Lovable fit, a clear build-ourselves fit and an idea with no software", () => {
    expect(new Set(BUILD_CHOICE_CASES.map((c) => c.expect))).toEqual(new Set(["lovable", "ours", "none"]));
  });

  for (const c of BUILD_CHOICE_CASES) {
    it(`${c.id}: recommends ${c.expect} and quotes the idea's own words`, () => {
      const result = chooseBuild({ ideaText: c.ideaText, archetype: c.archetype, founderFirstName: null });
      expect(result.choice).toBe(c.expect);
      const note = buildChoiceNote("b1", { ideaText: c.ideaText, archetype: c.archetype, founderFirstName: "Sam" }, result);
      for (const q of c.quotes) expect(note.bodyMd).toContain(q);
      for (const re of [...NEVER_ANY, ...c.never]) expect(note.bodyMd).not.toMatch(re);
      expect(unlabeledMoney(note.bodyMd)).toBe(false);
      expect(note.bodyMd.startsWith("Sam, ")).toBe(true);
      if (c.expect === "none") {
        expect(note.decision).toBeNull();
        // What is built comes first: the page, with its price and a button to pay or book (founder, Nov 25, 2026).
        expect(note.bodyMd).toMatch(/^Sam, the team builds your project's page at its free \w+ address, with your price and a button to pay or book/);
        return;
      }
      // Both buttons, one recommended; both costs once, Lovable's price labeled Estimate.
      const options = note.decision!.options;
      expect(options.map((o) => o.label)).toEqual([BUILD_CHOICE_NOTE.oursLabel, BUILD_CHOICE_NOTE.lovableLabel]);
      expect(options.filter((o) => o.recommended).map((o) => o.id)).toEqual([c.expect === "lovable" ? BUILD_CHOICE_NOTE.options.lovable : BUILD_CHOICE_NOTE.options.ours]);
      expect(note.bodyMd.split(BUILD_CHOICE_NOTE.lovableCost).length).toBe(2);
      expect(note.bodyMd.split(BUILD_CHOICE_NOTE.oursCost).length).toBe(2);
      expect(note.bodyMd).toContain(LOVABLE_PRICE_ESTIMATE);
      expect(note.bodyMd).toContain(BUILD_CHOICE_NOTE.noChoice);
    });
  }

  it("with nothing to go on, it is ours, which needs no other account or bill", () => {
    expect(chooseBuild({ ideaText: "Something for people who love jazz.", archetype: null, founderFirstName: null }).choice).toBe("ours");
  });

  it("never tells a solo founder they need someone, and never names jobs as the reason", () => {
    for (const c of BUILD_CHOICE_CASES) {
      const body = buildChoiceNote("b1", { ideaText: c.ideaText, archetype: c.archetype, founderFirstName: null }).bodyMd;
      expect(body).not.toMatch(/cofounder|partner|\bjobs?\b|employ|career/i);
    }
  });
});
