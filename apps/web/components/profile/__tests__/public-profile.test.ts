import { describe, expect, it } from "vitest";
import { EMPTY_PERSON_PROFILE } from "@foundmill/shared/person-profile";
import { PUBLIC_PROFILE_WORDS, publishProfileConsequence } from "../PublicProfileScreen";

describe("Your public profile", () => {
  it("the confirmation names what becomes public, field by field", () => {
    expect(publishProfileConsequence(EMPTY_PERSON_PROFILE, 0)).toBe("Anyone with the link can read your name. You can take it down any time.");
    expect(publishProfileConsequence({ ...EMPTY_PERSON_PROFILE, headline: "Baker", place: "Leeds", about: "Hi", strengths: ["Baking"], wantsToLearn: ["Selling"], lookingFor: "looking_for_cofounder" }, 2)).toBe(
      "Anyone with the link can read your name, your headline, your place, about, what you are good at, what you want to learn, what you are here for and your public project pages. You can take it down any time.",
    );
    expect(publishProfileConsequence({ ...EMPTY_PERSON_PROFILE, headline: "Baker" }, 1)).toBe("Anyone with the link can read your name, your headline and your public project page. You can take it down any time.");
  });

  it("building on my own: the confirmation and the screen's words ask nothing about people", () => {
    const text = [publishProfileConsequence({ ...EMPTY_PERSON_PROFILE, headline: "Baker" }, 0), ...Object.values(PUBLIC_PROFILE_WORDS).map((w) => (typeof w === "function" ? w("Maya") : w))].join(" ").toLowerCase();
    for (const word of ["cofounder", "alone", "team up", "partner", "staff", "seat", "job"]) expect(text, word).not.toContain(word);
  });
});
