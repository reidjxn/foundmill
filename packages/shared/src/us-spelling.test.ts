import { describe, expect, it } from "vitest";
import { usSpelling } from "./us-spelling";

describe("usSpelling", () => {
  it("spells stored keys the US way and keeps each word's case", () => {
    expect(usSpelling("Organisation")).toBe("Organization");
    expect(usSpelling("uncategorised items")).toBe("uncategorized items");
    expect(usSpelling("CANCELLED")).toBe("CANCELED");
    expect(usSpelling("Creative judgement")).toBe("Creative judgment");
    expect(usSpelling("Categoriser")).toBe("Categorizer"); // the categoriser agent type
    expect(usSpelling("Transaction categorisation")).toBe("Transaction categorization");
  });
  it("matches whole words only and leaves everything else alone", () => {
    expect(usSpelling("Holiday season")).toBe("Holiday season");
    expect(usSpelling("Organisationsnummer")).toBe("Organisationsnummer"); // a Swedish word, not a key
    expect(usSpelling("Private limited company")).toBe("Private limited company");
    expect(usSpelling("")).toBe("");
  });
});
