import { describe, expect, it } from "vitest";
import {
  BLEND_HALF_LIFE_TASKS,
  CALIBRATION_ANCHORS,
  FLAWLESS_MEAN_SCORE,
  REFERENCE_GENERALIST_MEAN_SCORE,
  blendDisplayed,
  blendDisplayedExact,
  blendWeight,
  calibrate,
  describeRating,
  isSignificantDrop,
  meanScore,
  potentialRating,
  provenScore,
  ratingBand,
  ratingFromProven,
  ratingFromTested,
} from "../calibration";

describe("calibration curve (BUILD §11.10 scoring)", () => {
  it("anchors are monotone non-decreasing in both axes and span 0..1", () => {
    for (let i = 1; i < CALIBRATION_ANCHORS.length; i++) {
      expect(CALIBRATION_ANCHORS[i]!.meanScore).toBeGreaterThanOrEqual(CALIBRATION_ANCHORS[i - 1]!.meanScore);
      expect(CALIBRATION_ANCHORS[i]!.value).toBeGreaterThanOrEqual(CALIBRATION_ANCHORS[i - 1]!.value);
    }
    expect(CALIBRATION_ANCHORS[0]).toEqual({ meanScore: 0, value: 0 });
    expect(CALIBRATION_ANCHORS[CALIBRATION_ANCHORS.length - 1]).toEqual({ meanScore: 1, value: 1 });
  });

  it("the reference generalist template scores exactly 10", () => {
    expect(ratingFromTested(REFERENCE_GENERALIST_MEAN_SCORE)).toBe(10);
    expect(1 + 19 * calibrate(REFERENCE_GENERALIST_MEAN_SCORE)).toBeCloseTo(10, 6);
  });

  it("20 is reserved for consistently flawless results", () => {
    expect(ratingFromTested(1)).toBe(20);
    expect(ratingFromTested(FLAWLESS_MEAN_SCORE)).toBe(20);
    expect(ratingFromTested(0.9)).toBeLessThan(20);
    expect(ratingFromTested(0.95)).toBeLessThan(20);
  });

  it("tested rating is 1 + 19 * calibrate(mean), rounded and clamped 1-20, monotone", () => {
    expect(ratingFromTested(0)).toBe(1);
    expect(ratingFromTested(-3)).toBe(1);
    expect(ratingFromTested(7)).toBe(20);
    let prev = 0;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const r = ratingFromTested(x);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r).toBe(Math.min(20, Math.max(1, Math.round(1 + 19 * calibrate(x)))));
      prev = r;
    }
    expect(() => calibrate(Number.NaN)).toThrow(RangeError);
  });

  it("meanScore averages per-task scores and rejects out-of-range values", () => {
    expect(meanScore([])).toBe(0);
    expect(meanScore([0.5, 1, 0])).toBeCloseTo(0.5);
    expect(() => meanScore([1.2])).toThrow(RangeError);
  });
});

describe("displayed rating blend (AC-11.10.3)", () => {
  it("w = n / (n + 20)", () => {
    expect(BLEND_HALF_LIFE_TASKS).toBe(20);
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(20)).toBe(0.5);
    expect(blendWeight(60)).toBe(0.75);
    expect(blendWeight(-5)).toBe(0);
    expect(blendWeight(2.9)).toBe(2 / 22);
  });

  it.each([
    // tested, proven, n, exact
    [15, 13, 42, (42 / 62) * 13 + (20 / 62) * 15],
    [10, 18, 0, 10],
    [10, 18, 20, 14],
    [12, 6, 10, (10 / 30) * 6 + (20 / 30) * 12],
    [20, 1, 1000, (1000 / 1020) * 1 + (20 / 1020) * 20],
  ])("tested %i, proven %i, n=%i → %f", (tested, proven, n, exact) => {
    expect(blendDisplayedExact(tested, proven, n)).toBeCloseTo(exact, 9);
    expect(blendDisplayed(tested, proven, n)).toBe(Math.min(20, Math.max(1, Math.round(exact))));
  });

  it("the BUILD hover example reads 'Tested 15 · Proven 13 · 42 tasks'", () => {
    expect(describeRating(15, 13, 42)).toBe("Tested 15 · Proven 13 · 42 tasks");
    expect(describeRating(15, null, 0)).toBe("Tested 15 · 0 tasks");
    expect(describeRating(9, 12, 1)).toBe("Tested 9 · Proven 12 · 1 task");
  });

  it("clamps inputs to 1-20", () => {
    expect(blendDisplayed(50, 50, 10)).toBe(20);
    expect(blendDisplayed(-4, -4, 10)).toBe(1);
  });
});

describe("proven rating and potential", () => {
  it("maps live outcomes to 1-20: perfect → 20, worst → 1", () => {
    expect(provenScore({ taskSuccessRate: 1, reviewFindingsPerTask: 0, approvalsRejectedRate: 0, replyOrMergeRate: 1 })).toBe(1);
    expect(ratingFromProven({ taskSuccessRate: 1, reviewFindingsPerTask: 0, approvalsRejectedRate: 0, replyOrMergeRate: 1 })).toBe(20);
    expect(ratingFromProven({ taskSuccessRate: 0, reviewFindingsPerTask: 5, approvalsRejectedRate: 1, replyOrMergeRate: 0 })).toBe(1);
    const mid = ratingFromProven({ taskSuccessRate: 0.5, reviewFindingsPerTask: 1.5, approvalsRejectedRate: 0.5, replyOrMergeRate: 0.5 });
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(13);
  });

  it("potential is the best tested score with the current model + tools over the last 5 runs, never below current", () => {
    const current = { modelKey: "sonnet", toolsHash: "abc" };
    const runs = [
      { tested: 14, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-09-01T00:00:00Z" },
      { tested: 17, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-08-01T00:00:00Z" },
      { tested: 19, modelKey: "opus", toolsHash: "abc", completedAt: "2026-09-15T00:00:00Z" }, // different model: ignored
      { tested: 18, modelKey: "sonnet", toolsHash: "old", completedAt: "2026-09-20T00:00:00Z" }, // different tools: ignored
      { tested: 16, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-07-01T00:00:00Z" },
      { tested: 15, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-06-01T00:00:00Z" },
      { tested: 13, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-05-01T00:00:00Z" },
      { tested: 20, modelKey: "sonnet", toolsHash: "abc", completedAt: "2026-01-01T00:00:00Z" }, // outside the 5-run window
    ];
    expect(potentialRating(12, runs, current)).toBe(17);
    expect(potentialRating(18, runs, current)).toBe(18);
    expect(potentialRating(11, [], current)).toBe(11);
    expect(potentialRating(12, runs, current, 8)).toBe(20);
  });

  it("rating bands and drop highlighting", () => {
    expect([ratingBand(1), ratingBand(5), ratingBand(6), ratingBand(10), ratingBand(11), ratingBand(15), ratingBand(16), ratingBand(20)]).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(isSignificantDrop(14, 12)).toBe(true);
    expect(isSignificantDrop(14, 13)).toBe(false);
    expect(isSignificantDrop(12, 14)).toBe(false);
  });
});
