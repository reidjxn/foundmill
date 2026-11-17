import { describe, expect, it } from "vitest";
import { formatDate } from "./format";
import { RATING_SHOWS_FIGURE_WITHOUT_BUILDER, ratingSourceLine, ratingText } from "./rating-words";

describe("rating words (WP-10 T9)", () => {
  it("names every band, with 'of 20' whenever the figure shows", () => {
    expect([3, 8, 14, 18].map((v) => ratingText(v, { figure: true }))).toEqual(["3 of 20 · Poor", "8 of 20 · Average", "14 of 20 · Good", "18 of 20 · Excellent"]);
    expect([3, 8, 14, 18].map((v) => ratingText(v, { figure: false }))).toEqual(["Poor", "Average", "Good", "Excellent"]);
  });
  it("never shows a bare number", () => {
    for (let v = 1; v <= 20; v++) {
      expect(ratingText(v, { figure: true })).toMatch(/ of 20 · (Poor|Average|Good|Excellent)$/);
      expect(ratingText(v, { figure: false })).not.toMatch(/\d/);
    }
  });
  it("shows the figure with Builder view off (founder decision 5)", () => {
    expect(RATING_SHOWS_FIGURE_WITHOUT_BUILDER).toBe(true);
  });
  it("says what a rating is from, with a US date", () => {
    const day = (iso: string) => formatDate(iso, "dayMonth");
    expect(ratingSourceLine({ kind: "starting" }, day)).toBe("Starting estimate. Not tested yet.");
    expect(ratingSourceLine({ kind: "tested", on: "2026-11-14T15:00:00Z" }, day)).toBe("From practice tests on Nov 14.");
    expect(ratingSourceLine({ kind: "work", tasks: 12 }, day)).toBe("From 12 tasks of real work.");
    expect(ratingSourceLine({ kind: "work", tasks: 1 }, day)).toBe("From 1 task of real work.");
  });
});
