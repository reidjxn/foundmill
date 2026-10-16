import { describe, expect, it } from "vitest";
import { CONCEPTS_SHOWN, conceptsMeta, doorsTitle } from "../Doors";

/** /new "Concepts in progress" (audit IAE-17): the count never claims a capped page is all there is. */
describe("conceptsMeta", () => {
  it("says the true count when every concept is listed", () => {
    expect(conceptsMeta(1, false)).toBe("1 concept");
    expect(conceptsMeta(7, false)).toBe("7 concepts");
    expect(conceptsMeta(0, false)).toBeUndefined();
  });

  it("says 'newest' when more concepts exist than the panel lists", () => {
    expect(conceptsMeta(CONCEPTS_SHOWN, true)).toBe(`${CONCEPTS_SHOWN} newest`);
    expect(conceptsMeta(CONCEPTS_SHOWN, true)).not.toMatch(/concepts$/);
  });
});

describe("doorsTitle", () => {
  it("is Create a new business once the founder has one, Your first business before", () => {
    expect(doorsTitle(0)).toBe("Your first business");
    expect(doorsTitle(2)).toBe("Create a new business");
  });
});
