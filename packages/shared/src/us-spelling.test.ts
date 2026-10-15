import { describe, expect, it } from "vitest";
import { usSpelling, usWord } from "./us-spelling";

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
  it("passes words that name Object.prototype members through instead of crashing or printing a function", () => {
    expect(usSpelling("Constructor fees")).toBe("Constructor fees");
    expect(usSpelling("the constructor fee")).toBe("the constructor fee");
    expect(usSpelling("CONSTRUCTOR")).toBe("CONSTRUCTOR");
    expect(usSpelling("awaiting constructor signoff")).toBe("awaiting constructor signoff");
    for (const w of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"])
      expect(usSpelling(`a ${w} b`)).toBe(`a ${w} b`);
    expect(usSpelling("a __proto__ b")).toBe("a __proto__ b");
    expect(usWord("constructor")).toBeUndefined();
    expect(usWord("colour")).toBe("color");
  });
});
