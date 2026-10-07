import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { ARCHETYPES, CHANNEL_KEYS } from "@foundmill/shared";
import { generateSyntheticConversionPath, generateSyntheticJourneyData, syntheticConversionGroups } from "../synthetic";
import { archetypePrior, pathFeatures, selectXcModel, sigmoid, touchFeatures, trainXcModel, XC_FEATURE_COUNT, XC_FEATURE_NAMES, xcSamplesFromPaths, xcSeries } from "../xc";
import { XcModel } from "../types";
import { FIVE_TOUCH, makeConversion, makeTouches } from "./fixtures";

const DEPTS = [{ id: "d0000000-0000-0000-0000-000000000001", name: "Distribution", moduleKeys: ["distribution" as const] }];

describe("features and priors", () => {
  it("has one feature per base signal plus one per channel", () => {
    expect(XC_FEATURE_COUNT).toBe(9 + CHANNEL_KEYS.length);
    expect(XC_FEATURE_NAMES[0]).toBe("bias");
    expect(XC_FEATURE_NAMES).toContain("channel:seo");
  });

  it("touchFeatures is bounded and one-hot on the channel", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const rows = pathFeatures(touches);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r).toHaveLength(XC_FEATURE_COUNT);
      expect(r[0]).toBe(1);
      for (const v of r) expect(v).toBeGreaterThanOrEqual(0);
      expect(r.slice(9).filter((v) => v === 1).length).toBeLessThanOrEqual(1);
    }
    expect(rows[0]![3]).toBe(0); // no previous touch → recency 0
    expect(rows[1]![3]).toBeGreaterThan(0);
    expect(rows[3]![8]).toBe(1); // direct
    expect(rows[2]![4]).toBe(1); // identified
    const f = touchFeatures({ occurredAt: "2025-01-01T00:00:00Z", channelKey: "print", kind: "code_redeemed", entityId: null }, { index: 0, firstTouchAt: "2025-01-01T00:00:00Z", previousTouchAt: null, distinctChannelsSoFar: 1 });
    expect(f[5]).toBe(1); // code
    expect(f[7]).toBe(1); // offline
  });

  it("every archetype has a valid prior with its own channel emphasis", () => {
    for (const a of ARCHETYPES) {
      const prior = archetypePrior(a);
      expect(XcModel.parse(prior)).toEqual(prior);
      expect(prior.source).toBe("archetype_prior");
      expect(prior.trainedOn).toBe(0);
      expect(prior.weights).toHaveLength(XC_FEATURE_COUNT);
    }
    const idx = (k: string) => XC_FEATURE_NAMES.indexOf(`channel:${k}`);
    expect(archetypePrior("b2b_saas").weights[idx("lead_generation")]!).toBeGreaterThan(archetypePrior("consumer_app").weights[idx("lead_generation")]!);
    expect(archetypePrior("dtc_physical").weights[idx("influencer")]!).toBeGreaterThan(archetypePrior("b2b_saas").weights[idx("influencer")]!);
  });

  it("sigmoid is numerically stable at the extremes", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBeCloseTo(0, 12);
    expect(sigmoid(-1000)).toBeGreaterThanOrEqual(0);
  });
});

describe("xcSeries — monotone and bounded", () => {
  it("is non-decreasing, inside [0, 1], and closes at 1 on the conversion", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const series = xcSeries({ touches, model: archetypePrior("b2b_saas"), conversion: makeConversion() });
    expect(series).toHaveLength(6);
    let prev = 0;
    for (const p of series) {
      expect(p.p).toBeGreaterThanOrEqual(0);
      expect(p.p).toBeLessThanOrEqual(1);
      expect(p.cumulative).toBeGreaterThanOrEqual(prev);
      expect(p.cumulative).toBeLessThanOrEqual(1);
      prev = p.cumulative;
    }
    expect(series[0]!.cumulative).toBe(series[0]!.p);
    expect(series.at(-1)).toMatchObject({ touchId: null, p: 0, cumulative: 1 });
    expect(series.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(series.slice(0, 5).map((p) => p.touchId)).toEqual(touches.map((t) => t.id));
  });

  it("stays strictly below 1 before the conversion, even with extreme weights", () => {
    const loud: XcModel = { ...archetypePrior("b2b_saas"), weights: archetypePrior("b2b_saas").weights.map(() => 50) };
    const series = xcSeries({ touches: makeTouches(FIVE_TOUCH), model: loud });
    for (const p of series) expect(p.cumulative).toBeLessThanOrEqual(1);
    expect(series.at(-1)!.cumulative).toBeGreaterThan(0.99);
    const quiet: XcModel = { ...loud, weights: loud.weights.map(() => -50) };
    for (const p of xcSeries({ touches: makeTouches(FIVE_TOUCH), model: quiet })) expect(p.cumulative).toBeGreaterThanOrEqual(0);
  });

  it("holds for synthetic paths of every archetype", () => {
    for (const a of ARCHETYPES) {
      for (const seed of [1, 2, 3]) {
        const path = generateSyntheticConversionPath(`${a}:${seed}`, { archetype: a });
        const series = xcSeries({ touches: path.touches, model: archetypePrior(a), conversion: path.conversion });
        let prev = 0;
        for (const p of series) {
          expect(p.cumulative).toBeGreaterThanOrEqual(prev - 1e-12);
          expect(p.cumulative).toBeLessThanOrEqual(1);
          prev = p.cumulative;
        }
        expect(series.at(-1)!.cumulative).toBe(1);
      }
    }
  });

  it("is deterministic and independent of touch order", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const a = xcSeries({ touches, model: archetypePrior("services"), conversion: makeConversion() });
    const b = xcSeries({ touches: [...touches].reverse(), model: archetypePrior("services"), conversion: makeConversion() });
    expect(b).toEqual(a);
    expect(xcSeries({ touches: [], model: archetypePrior("services") })).toEqual([]);
  });
});

describe("training", () => {
  it("is deterministic and moves weights towards the labels", () => {
    const positive = makeTouches([{ hoursBefore: 30, channelKey: "lead_generation", identified: true }, { hoursBefore: 2, channelKey: "email_automation", identified: true }]);
    const negative = makeTouches([{ hoursBefore: 30, channelKey: "social" }, { hoursBefore: 2, channelKey: "social" }]);
    const samples = xcSamplesFromPaths([{ touches: positive, converted: true }, { touches: negative, converted: false }, { touches: positive, converted: true }, { touches: negative, converted: false }]);
    expect(samples).toHaveLength(8);
    const zero: XcModel = { ...archetypePrior("b2b_saas"), weights: archetypePrior("b2b_saas").weights.map(() => 0) };
    const a = trainXcModel(samples, { init: zero, archetype: "b2b_saas", conversionCount: 2 });
    const b = trainXcModel(samples, { init: zero, archetype: "b2b_saas", conversionCount: 2 });
    expect(b).toEqual(a);
    expect(a.source).toBe("trained");
    expect(a.trainedOn).toBe(2);
    const idx = (k: string) => XC_FEATURE_NAMES.indexOf(k);
    expect(a.weights[idx("channel:social")]!).toBeLessThan(0);
    expect(a.weights[idx("channel:lead_generation")]!).toBeGreaterThan(0);
    expect(a.weights[idx("identified")]!).toBeGreaterThan(0);
    // The fitted model separates the two paths.
    const pos = xcSeries({ touches: positive, model: a }).at(-1)!.cumulative;
    const neg = xcSeries({ touches: negative, model: a }).at(-1)!.cumulative;
    expect(pos).toBeGreaterThan(neg + 0.3);
  });

  it("with no samples returns the warm start unchanged", () => {
    const prior = archetypePrior("hardware");
    const m = trainXcModel([], { init: prior });
    expect(m.weights).toEqual(prior.weights);
    expect(m.archetype).toBe("hardware");
  });

  it("learns from the synthetic generator's labelled paths", () => {
    const data = generateSyntheticJourneyData({ seed: "xc-train", startDate: "2024-03-01", days: 120, departments: DEPTS, archetype: "b2b_saas" });
    const groups = syntheticConversionGroups(data);
    expect(groups.length).toBeGreaterThan(50);
    const samples = xcSamplesFromPaths(groups);
    const trained = trainXcModel(samples, { init: archetypePrior("b2b_saas"), archetype: "b2b_saas", conversionCount: groups.filter((g) => g.converted).length, epochs: 60 });
    const logLoss = (m: XcModel) => {
      let loss = 0;
      for (const s of samples) {
        let z = 0;
        for (let i = 0; i < m.weights.length; i++) z += m.weights[i]! * s.features[i]!;
        const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
        loss -= s.label ? Math.log(p) : Math.log(1 - p);
      }
      return loss / samples.length;
    };
    expect(logLoss(trained)).toBeLessThan(logLoss(archetypePrior("b2b_saas")));
  });
});

describe("selectXcModel — archetype prior until 50 labelled conversions", () => {
  const trained: XcModel = { ...archetypePrior("b2b_saas"), source: "trained", trainedOn: 50 };

  it("uses the prior below the threshold and the trained model from it", () => {
    expect(LIMITS.xcArchetypePriorUntilConversions).toBe(50);
    expect(selectXcModel({ archetype: "b2b_saas", conversionCount: 49, trained }).source).toBe("archetype_prior");
    expect(selectXcModel({ archetype: "b2b_saas", conversionCount: 50, trained }).source).toBe("trained");
    expect(selectXcModel({ archetype: "b2b_saas", conversionCount: 500, trained: null }).source).toBe("archetype_prior");
    expect(selectXcModel({ archetype: "b2b_saas", conversionCount: 500, trained: archetypePrior("b2b_saas") }).source).toBe("archetype_prior");
  });
});
