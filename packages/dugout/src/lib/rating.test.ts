import { describe, expect, it } from "vitest";
import { clampRating, ratingBandLabel, ratingCells, ratingClass, ratingTone, ratingVar } from "./rating";

describe("rating ramp", () => {
  it("maps the four bands", () => {
    expect([1, 5].map(ratingTone)).toEqual(["rating-1", "rating-1"]);
    expect([6, 10].map(ratingTone)).toEqual(["rating-2", "rating-2"]);
    expect([11, 15].map(ratingTone)).toEqual(["rating-3", "rating-3"]);
    expect([16, 20].map(ratingTone)).toEqual(["rating-4", "rating-4"]);
  });
  it("clamps and rounds", () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(25)).toBe(20);
    expect(clampRating(12.6)).toBe(13);
    expect(ratingTone(Number.NaN)).toBe("rating-1");
  });
  it("sets weight 600 only for 16–20", () => {
    expect(ratingClass(17)).toContain("font-semibold");
    expect(ratingClass(15)).not.toContain("font-semibold");
    expect(ratingClass(3)).toBe("text-rating-1 tabular-nums");
    expect(ratingClass(18, { background: true })).toBe("bg-rating-4 text-base font-semibold");
  });
  it("exposes vars, words and cells", () => {
    expect(ratingVar(8)).toBe("var(--rating-2)");
    expect(ratingBandLabel(2)).toBe("Poor");
    expect(ratingBandLabel(19)).toBe("Excellent");
    const cells = ratingCells(7);
    expect(cells).toHaveLength(20);
    expect(cells.filter(Boolean)).toHaveLength(7);
  });
});
