import { describe, expect, it } from "vitest";
import { QUICK_PROFILE_RATINGS, QUICK_PROFILE_SKILLS, QUICK_PROFILE_TAGS, fitBasisOf, fitLine, quickSkillRatings, reratedFounderFit, skillsFit } from "../quick-profile";

describe("the quick profile's ratings", () => {
  it("offers one tag for each of the five skills", () => {
    expect(QUICK_PROFILE_TAGS.map((t) => t.skill)).toEqual([...QUICK_PROFILE_SKILLS]);
  });

  it("rates a picked tag strong and the rest modest, case aside", () => {
    expect(quickSkillRatings(["building software", "Money and pricing", "Sailing"])).toEqual({ engineering: 14, sales: 7, design: 7, finance: 14, domain: 7 });
  });

  it("is neutral when none of the five was picked", () => {
    const neutral = QUICK_PROFILE_RATINGS.neutral;
    expect(quickSkillRatings([])).toEqual({ engineering: neutral, sales: neutral, design: neutral, finance: neutral, domain: neutral });
    expect(quickSkillRatings(["Sailing"])).toEqual(quickSkillRatings([]));
  });
});

describe("Founder fit from the ratings", () => {
  it("is the mean of the two skills a kind of business leans on", () => {
    expect(skillsFit({ engineering: 14, sales: 7 }, "b2b_saas")).toBe(11);
    expect(skillsFit({}, "b2b_saas")).toBe(10);
    expect(skillsFit({ engineering: 20 }, "not_a_kind")).toBe(10);
    expect(skillsFit(null, null)).toBe(10);
  });

  it("moves a card's rating by how much its two skills moved, within 1 to 20", () => {
    // Rated with no profile (neutral), then the quick profile picks both skills: +4.
    expect(reratedFounderFit(12, null, { engineering: 14, sales: 14 }, "b2b_saas")).toBe(16);
    // Sharpened down.
    expect(reratedFounderFit(16, { engineering: 14, sales: 14 }, { engineering: 6, sales: 8 }, "b2b_saas")).toBe(9);
    // The same ratings change nothing.
    expect(reratedFounderFit(9, { engineering: 6 }, { engineering: 6 }, "b2b_saas")).toBe(9);
    expect(reratedFounderFit(19, null, { engineering: 20, sales: 20 }, "b2b_saas")).toBe(20);
    expect(reratedFounderFit(2, { domain: 20, design: 20 }, { domain: 1, design: 1 }, "content_media")).toBe(1);
    expect(reratedFounderFit(undefined, null, { domain: 14, sales: 14 }, "services")).toBe(14);
  });

  it("says what a fit number rests on until the long profile is saved", () => {
    expect(fitBasisOf(null)).toBe("quick");
    expect(fitBasisOf({ experience: null })).toBe("quick");
    expect(fitBasisOf({ experience: "first_time" })).toBe("full");
    expect(fitLine(15, "quick")).toBe("Fit: 15 (quick profile)");
    expect(fitLine(15, "full")).toBe("Fit: 15");
  });
});
