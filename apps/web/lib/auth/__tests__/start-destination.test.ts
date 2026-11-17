import { describe, expect, it } from "vitest";
import { keepCardPathFor, startDestination } from "../start-destination";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const EXAMPLE = "33333333-3333-4333-8333-333333333333";

describe("startDestination (the routing table for a person just signed in)", () => {
  it("lands on the idea box's waiting card before anything else, profile or not (founder, 2026-11-13)", () => {
    expect(startDestination({ profileComplete: false, businesses: [], lastBusinessId: null, keepCardPath: "/new/card/keep" })).toBe("/new/card/keep");
    expect(startDestination({ profileComplete: true, businesses: [{ id: B }], lastBusinessId: B, keepCardPath: "/new/card/keep?claim=x" })).toBe("/new/card/keep?claim=x");
    expect(startDestination({ profileComplete: true, businesses: [{ id: B }], lastBusinessId: B, keepCardPath: null })).toBe(`/b/${B}/today`);
  });

  it("asks for the profile first", () => {
    expect(startDestination({ profileComplete: false, businesses: [{ id: A }], lastBusinessId: A })).toBe("/onboarding");
    expect(startDestination({ profileComplete: false, businesses: [], lastBusinessId: null })).toBe("/onboarding");
  });

  it("opens the last project, else the newest of their own", () => {
    expect(startDestination({ profileComplete: true, businesses: [{ id: A }, { id: B }], lastBusinessId: B })).toBe(`/b/${B}/today`);
    expect(startDestination({ profileComplete: true, businesses: [{ id: A }, { id: B }], lastBusinessId: null })).toBe(`/b/${A}/today`);
    expect(startDestination({ profileComplete: true, businesses: [{ id: A }], lastBusinessId: "gone" })).toBe(`/b/${A}/today`);
  });

  it("sends a person with no project to their home, never into the studio (2.4)", () => {
    expect(startDestination({ profileComplete: true, businesses: [], lastBusinessId: null })).toBe("/home");
    // The example they walked around is not a project of their own unless it is the one they last opened.
    expect(startDestination({ profileComplete: true, businesses: [{ id: EXAMPLE, isExample: true }], lastBusinessId: null })).toBe("/home");
    expect(startDestination({ profileComplete: true, businesses: [{ id: EXAMPLE, isExample: true }], lastBusinessId: EXAMPLE })).toBe(`/b/${EXAMPLE}/today`);
  });
});

describe("keepCardPathFor: the waiting card's keep step", () => {
  it("is null with no card, and carries the link's claim token only for a card that came by the link", () => {
    expect(keepCardPathFor(null, { claim: "c", studio: true })).toBeNull();
    expect(keepCardPathFor({ source: "browser", then: null }, { claim: null, studio: false })).toBe("/new/card/keep");
    expect(keepCardPathFor({ source: "link", then: null }, { claim: "abc", studio: false })).toBe("/new/card/keep?claim=abc");
    expect(keepCardPathFor({ source: "browser", then: null }, { claim: "abc", studio: false })).toBe("/new/card/keep");
  });

  it("goes on to the Studio when the address chose it, or when the waitlist kept that choice with its card (0127)", () => {
    expect(keepCardPathFor({ source: "link", then: null }, { claim: "abc", studio: true })).toBe("/new/card/keep?claim=abc&then=studio");
    // Let in from the waitlist, signing in on any browser with no link: the choice the waitlist kept.
    expect(keepCardPathFor({ source: "waitlist", then: "studio" }, { claim: null, studio: false })).toBe("/new/card/keep?then=studio");
    expect(keepCardPathFor({ source: "waitlist", then: null }, { claim: null, studio: false })).toBe("/new/card/keep");
  });
});

