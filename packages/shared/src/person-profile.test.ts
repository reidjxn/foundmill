import { describe, expect, it } from "vitest";
import {
  EMPTY_PERSON_PROFILE,
  LOOKING_FOR_OPTIONS,
  PERSON_LOOKING_FOR,
  PERSON_TAGS_MAX,
  lookingForLine,
  normalizePersonProfile,
  normalizeTags,
  personDescription,
  personHandleProblem,
  personInitials,
  personPath,
  personProfileProblems,
  personStateLine,
  personTitle,
  personUrl,
  readPersonProfile,
  samePersonProfile,
  suggestPersonHandle,
} from "./person-profile";
import { PAGE_RESERVED_SLUGS } from "./project-page";
import { PersonHandle, PersonProfileContent } from "./types";

describe("person profile", () => {
  it("'Building on my own' is the default and says nothing about people on the page", () => {
    expect(EMPTY_PERSON_PROFILE.lookingFor).toBe("on_my_own");
    expect(LOOKING_FOR_OPTIONS[0]).toEqual({ value: "on_my_own", label: "Building on my own" });
    expect(LOOKING_FOR_OPTIONS.map((o) => o.value)).toEqual([...PERSON_LOOKING_FOR]);
    expect(lookingForLine("on_my_own")).toBeNull();
    expect(lookingForLine(null)).toBeNull();
    expect(lookingForLine("anything else")).toBeNull();
    expect(lookingForLine("open_to_people")).toBe("Open to building with people");
    expect(lookingForLine("looking_for_cofounder")).toBe("Looking for a cofounder");
    expect(lookingForLine("looking_to_join")).toBe("Looking to join a project");
  });

  it("tidies tags: one line, trimmed, no empties, no repeats in any case, order kept", () => {
    expect(normalizeTags(["  Writing ", "", "writing", "Talking\n to  people", "Design"])).toEqual(["Writing", "Talking to people", "Design"]);
  });

  it("tidies the fields and names what is over a limit", () => {
    const tidy = normalizePersonProfile({ headline: "  Baker\n in Leeds ", about: "One.\r\n\r\n\r\nTwo.  ", strengths: ["Baking", "baking"], wantsToLearn: [], lookingFor: "nonsense" as never, place: " Leeds,\nUK " });
    expect(tidy).toEqual({ headline: "Baker in Leeds", about: "One.\n\nTwo.", strengths: ["Baking"], wantsToLearn: [], lookingFor: "on_my_own", place: "Leeds, UK" });
    expect(personProfileProblems(EMPTY_PERSON_PROFILE)).toEqual({});
    const over = personProfileProblems({ ...EMPTY_PERSON_PROFILE, headline: "x".repeat(81), about: "x".repeat(601), place: "x".repeat(61), strengths: Array.from({ length: PERSON_TAGS_MAX + 1 }, (_, i) => `Tag ${i}`), wantsToLearn: ["x".repeat(31)] });
    expect(Object.keys(over).sort()).toEqual(["about", "headline", "place", "strengths", "wantsToLearn"]);
  });

  it("the Zod schema validates what is stored", () => {
    expect(PersonProfileContent.parse({})).toEqual(EMPTY_PERSON_PROFILE);
    expect(PersonProfileContent.parse({ headline: " Hi ", strengths: ["A", "a"] })).toMatchObject({ headline: "Hi", strengths: ["A"] });
    expect(PersonProfileContent.safeParse({ headline: "x".repeat(81) }).success).toBe(false);
    expect(PersonProfileContent.safeParse({ strengths: Array.from({ length: 9 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(PersonProfileContent.safeParse({ lookingFor: "hiring" }).success).toBe(false);
  });

  it("the handle follows the project page's address rule", () => {
    expect(personHandleProblem("maya-okafor")).toBeNull();
    expect(personHandleProblem("ab")).toMatch(/at least 3/);
    expect(personHandleProblem("Maya")).not.toBeNull();
    for (const r of PAGE_RESERVED_SLUGS.filter((x) => x.length >= 3)) expect(personHandleProblem(r), r).not.toBeNull();
    expect(PersonHandle.safeParse(" maya ").success).toBe(true);
    expect(PersonHandle.safeParse("login").success).toBe(false);
  });

  it("suggests a usable handle from any name", () => {
    expect(suggestPersonHandle("Maya Okafor")).toBe("maya-okafor");
    expect(suggestPersonHandle("Zoë Ångström")).toBe("zoe-angstrom");
    expect(suggestPersonHandle("Al")).toBe("al-profile");
    expect(suggestPersonHandle("")).toBe("profile");
    expect(suggestPersonHandle("Support")).toBe("support-profile");
    for (const name of ["Maya Okafor", "Al", "", "Support", "x".repeat(80), "!!!"]) expect(personHandleProblem(suggestPersonHandle(name)), name).toBeNull();
  });

  it("initials, address, titles and the state line", () => {
    expect(personInitials("Maya Okafor")).toBe("MO");
    expect(personInitials("maya")).toBe("M");
    expect(personInitials("  Sam  de la Cruz ")).toBe("SC");
    expect(personInitials("!!")).toBe("?");
    expect(personPath("maya")).toBe("/u/maya");
    expect(personUrl("https://foundmill.app/", "maya")).toBe("https://foundmill.app/u/maya");
    expect(personTitle("Maya", "Baker")).toBe("Maya: Baker");
    expect(personTitle("Maya", "")).toBe("Maya");
    expect(personDescription("Maya", "", "", "Foundmill")).toBe("Maya on Foundmill");
    expect(personDescription("Maya", "I bake.", "Baker", "Foundmill")).toBe("I bake.");
    expect(personStateLine({ public: true, publishedOn: "Oct 7, 2026" })).toBe("Public since Oct 7, 2026");
    expect(personStateLine({ public: false })).toBe("Only you can see this");
  });

  it("reads stored values defensively and compares tidied profiles", () => {
    expect(readPersonProfile(null)).toEqual(EMPTY_PERSON_PROFILE);
    expect(readPersonProfile({ headline: 3, strengths: ["a", 2], lookingFor: "looking_to_join" })).toEqual({ ...EMPTY_PERSON_PROFILE, strengths: ["a"], lookingFor: "looking_to_join" });
    expect(samePersonProfile({ ...EMPTY_PERSON_PROFILE, headline: " a " }, { ...EMPTY_PERSON_PROFILE, headline: "a" })).toBe(true);
    expect(samePersonProfile({ ...EMPTY_PERSON_PROFILE, strengths: ["a", "b"] }, { ...EMPTY_PERSON_PROFILE, strengths: ["b", "a"] })).toBe(false);
  });
});
