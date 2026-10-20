import { describe, expect, it } from "vitest";
import { CONCEPTS_SHOWN, DOORS, conceptsMeta, doorsTitle, recommendedDoor } from "../Doors";

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

describe("doors copy (§7.4, A8)", () => {
  it("leads each door with who it is for, one sentence, and four steps behind the disclosure", () => {
    expect(DOORS.map((d) => d.title)).toEqual(["I have an idea, or none yet", "I already run something"]);
    for (const d of DOORS) {
      expect(d.steps).toHaveLength(4);
      // The lede never claims the Research agent grounds every card at draft time: research runs on Ask.
      expect(d.lede).not.toMatch(/grounds each/);
    }
    // Door B says when the reading happens and that it never writes.
    expect(DOORS[1]!.lede).toMatch(/once you take charge/);
    expect(DOORS[1]!.lede).toMatch(/never writes/);
  });

  it("recommends Door A to a first-time founder only", () => {
    expect(recommendedDoor("first_time")).toBe("ideate");
    expect(recommendedDoor("exited")).toBeNull();
    expect(recommendedDoor(null)).toBeNull();
    expect(recommendedDoor(undefined)).toBeNull();
  });
});
