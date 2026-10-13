/** AC-11.13.6: renamed nouns reach notes, updates and panel captions through one deterministic substitution. */
import { describe, expect, it } from "vitest";
import { applyGlossary, glossaryTerms, pluralOf } from "./glossary";

const glossary = { customer: "client", team: "crew" };

describe("applyGlossary", () => {
  it("renames whole words in any case, keeping the case of what it replaces", () => {
    expect(applyGlossary("Customers this week", glossary)).toBe("Clients this week");
    expect(applyGlossary("CUSTOMERS THIS WEEK", glossary)).toBe("CLIENTS THIS WEEK");
    expect(applyGlossary("First customer", glossary)).toBe("First client");
    expect(applyGlossary("Team health", glossary)).toBe("Crew health");
    expect(applyGlossary("the team keeps working; the customers week stands at 0", glossary)).toBe("the crew keeps working; the clients week stands at 0");
  });

  it("matches whole words only", () => {
    expect(applyGlossary("Customerized teams teamwork", glossary)).toBe("Customerized crews teamwork");
    expect(applyGlossary("steam", glossary)).toBe("steam");
  });

  it("uses the glossary's own plural when it names one, and plural rules otherwise", () => {
    expect(applyGlossary("customers and a customer", { customer: "patient", customers: "patient list" })).toBe("patient list and a patient");
    expect(applyGlossary("leads", { lead: "agency" })).toBe("agencies");
    expect(pluralOf("business")).toBe("businesses");
    expect(pluralOf("CLIENT")).toBe("CLIENTS");
  });

  it("never rewrites entity mentions, code or links, and reads the text once (a swap does not undo itself)", () => {
    expect(applyGlossary("[[ent:00000000-0000-4000-8000-000000000001|Customer Success Ltd]] is a customer", glossary)).toBe("[[ent:00000000-0000-4000-8000-000000000001|Customer Success Ltd]] is a client");
    expect(applyGlossary("Run `customer.sync` at https://example.com/customer", glossary)).toBe("Run `customer.sync` at https://example.com/customer");
    expect(applyGlossary("A lead becomes a prospect", { lead: "prospect", prospect: "lead" })).toBe("A prospect becomes a lead");
  });

  it("ignores settings stored in the same map and empty entries", () => {
    expect(glossaryTerms({ currency: "GBP", customer: "", team: "crew" })).toEqual([["team", "crew"]]);
    expect(applyGlossary("Pick a currency", { currency: "GBP" })).toBe("Pick a currency");
    expect(applyGlossary("unchanged", {})).toBe("unchanged");
    expect(applyGlossary("unchanged", null)).toBe("unchanged");
  });
});
