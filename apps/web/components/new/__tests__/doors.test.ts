import { describe, expect, it } from "vitest";
import { CONCEPTS_SHOWN, DOORS, EXAMPLE_DOOR, conceptsMeta, doorsLede, doorsTitle, ownBusinessCount, recommendedDoor, showsExampleDoor } from "../Doors";

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
    for (const d of [...DOORS, EXAMPLE_DOOR]) {
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

describe("the example door (§12 item 5)", () => {
  it("says what it is for, that nothing is saved, and what pressing it does", () => {
    expect(EXAMPLE_DOOR).toMatchObject({ id: "example", kicker: "Example", title: "Explore an example", lede: "Walk around a running business before you start yours. Nothing you do there is saved.", cta: "Open the example" });
  });

  it("shows only when the deployment has an example the founder does not belong to for real", () => {
    expect(showsExampleDoor(null)).toBe(false);
    expect(showsExampleDoor(undefined)).toBe(false);
    expect(showsExampleDoor({ id: "b1", name: "Northwind Skincare", membership: "none" })).toBe(true);
    // An example membership that exists is reopened by the same door.
    expect(showsExampleDoor({ id: "b1", name: "Northwind Skincare", membership: "example" })).toBe(true);
    // Its owner, or someone invited, opens it from Switch business instead.
    expect(showsExampleDoor({ id: "b1", name: "Northwind Skincare", membership: "member" })).toBe(false);
  });

  it("an example membership is not a business of the founder's own: the title stays Your first business", () => {
    expect(ownBusinessCount(1, { id: "b1", name: "Northwind Skincare", membership: "example" })).toBe(0);
    expect(doorsTitle(ownBusinessCount(1, { id: "b1", name: "Northwind Skincare", membership: "example" }))).toBe("Your first business");
    expect(ownBusinessCount(2, { id: "b1", name: "Northwind Skincare", membership: "member" })).toBe(2);
    expect(ownBusinessCount(0, null)).toBe(0);
    expect(ownBusinessCount(0, { id: "b1", name: "Northwind Skincare", membership: "example" })).toBe(0);
  });

  it("the lede counts the doors when there is no profile line, and keeps the profile line when there is one", () => {
    expect(doorsLede(null, 2)).toBe("Two doors. Both end at the same Launch screen.");
    expect(doorsLede(null, 3)).toBe("Two doors to a business of your own, and an example to walk around first.");
    expect(doorsLede("First-time founder · full time", 3)).toBe("Your profile: First-time founder · full time.");
  });
});
