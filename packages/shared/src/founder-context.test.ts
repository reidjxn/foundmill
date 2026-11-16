import { describe, expect, it } from "vitest";
import { UNKNOWN_FOUNDER_CONTEXT, firstNameOf, founderBriefSection, founderBudgetOf, founderContextFrom, founderContextJson, founderExperienceFrom } from "./founder-context";

const maya = { displayName: "  Maya   Lopez ", experience: "first_time", strengths: ["Design", " Design ", "Writing"], wantsToLearn: ["Selling"], lookingFor: "on_my_own", budgetMinor: null };

/** Words that would frame a one-person project as short of someone. */
const LACKING = /\b(?:alone|solo|only|lack\w*|missing|without|no\s+(?:co-?founder|partner|one)|co-?founders?|partners?|others?|nobody|by\s+(?:them|him|her)self)\b/i;

describe("founder context", () => {
  it("takes the first word of the display name as the first name, and none when there is no name", () => {
    expect(firstNameOf("Maya Lopez")).toBe("Maya");
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it("reads the budget as none, some or not said, never a guess", () => {
    expect(founderBudgetOf(0)).toBe("none");
    expect(founderBudgetOf(25_000)).toBe("some");
    expect(founderBudgetOf(null)).toBe("not_said");
  });

  it("builds the context from the profile: trimmed, deduplicated tags, the experience answer, the other founders' first names", () => {
    const ctx = founderContextFrom(maya, [{ displayName: "Sam Okafor" }, { displayName: null }]);
    expect(ctx).toEqual({ firstName: "Maya", experience: "first_time", strengths: ["Design", "Writing"], wantsToLearn: ["Selling"], lookingFor: "on_my_own", budget: "not_said", others: [{ firstName: "Sam" }] });
    expect(founderContextFrom(null)).toEqual(UNKNOWN_FOUNDER_CONTEXT);
    expect(founderExperienceFrom("Operator ")).toBe("operator");
    expect(founderExperienceFrom("twenty years in retail")).toBe("first_time");
  });

  it("carries unknown fields as not_said in the prompt JSON", () => {
    expect(founderContextJson(UNKNOWN_FOUNDER_CONTEXT)).toEqual({ first_name: "not_said", experience: "first_time", good_at: "not_said", wants_to_learn: "not_said", here_for: "on_my_own", budget: "not_said" });
  });

  it("never describes a one-person project as short of anyone: no field about people, no word of lack", () => {
    const solo = founderContextFrom({ ...maya, budgetMinor: 0 });
    const json = founderContextJson(solo);
    expect(Object.keys(json)).not.toContain("other_founders");
    expect(JSON.stringify(json)).not.toMatch(LACKING);
    expect(founderBriefSection(solo)).not.toMatch(LACKING);
    expect(founderBriefSection(UNKNOWN_FOUNDER_CONTEXT)).not.toMatch(LACKING);
  });

  it("names every founder of a shared project, so notes go to them all", () => {
    const ctx = founderContextFrom(maya, [{ displayName: "Sam" }]);
    expect(founderContextJson(ctx).other_founders).toEqual(["Sam"]);
    expect(founderBriefSection(ctx)).toContain("The founders: Maya, Sam; write to them all.");
  });

  it("writes the brief section in plain lines, quoting the founder's own tags", () => {
    expect(founderBriefSection(founderContextFrom({ ...maya, budgetMinor: 0 }))).toBe(
      ['## Founder', 'Name: Maya; running a business for the first time.', 'Good at (their words): "Design", "Writing".', 'Wants to learn (their words): "Selling".', "Money: nothing to spend for now; free options come first unless they said they can spend."].join("\n"),
    );
  });
});
