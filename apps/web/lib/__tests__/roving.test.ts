import { describe, expect, it } from "vitest";
import { nextRovingIndex, rovingTabStop } from "../roving";

describe("nextRovingIndex (audit A11Y-20: arrows between the logo options)", () => {
  it("moves with the arrows and wraps at both ends", () => {
    expect(nextRovingIndex("ArrowRight", 0, 4)).toBe(1);
    expect(nextRovingIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextRovingIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextRovingIndex("ArrowUp", 2, 4)).toBe(1);
  });

  it("jumps with Home and End, and ignores every other key", () => {
    expect(nextRovingIndex("Home", 2, 4)).toBe(0);
    expect(nextRovingIndex("End", 0, 4)).toBe(3);
    expect(nextRovingIndex("Enter", 0, 4)).toBeNull();
    expect(nextRovingIndex("Tab", 0, 4)).toBeNull();
    expect(nextRovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("rovingTabStop", () => {
  const ids = ["a", "b", "c"];
  it("is the focused option, else the selected one, else the first: one Tab stop", () => {
    expect(rovingTabStop(ids, "c", "b")).toBe("c");
    expect(rovingTabStop(ids, null, "b")).toBe("b");
    expect(rovingTabStop(ids, null, null)).toBe("a");
    expect(rovingTabStop(ids, "gone", "gone")).toBe("a");
    expect(rovingTabStop([], null, null)).toBeNull();
  });
});
