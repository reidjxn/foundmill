import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { CONVERSION_KINDS, MATCHDAY_LEVEL_FOR_KIND } from "@foundmill/shared";
import { buildMarkovModel } from "../attribution";
import { buildJourney, matchdayLevelFor, shouldPlayFullMatchDay, type BuildJourneyInput } from "../builder";
import { generateSyntheticConversionPath } from "../synthetic";
import { Journey, type XcModel } from "../types";
import { XC_FEATURE_COUNT, XC_FEATURE_NAMES } from "../xc";
import { AGENTS, closeTo, CONVERTED_AT, ENTITY_ID, fid, FIVE_TOUCH, makeConversion, makeTouches, sum, VISITOR_ID } from "./fixtures";

const baseInput = (): BuildJourneyInput => ({
  conversion: makeConversion(),
  touches: makeTouches(FIVE_TOUCH),
  agents: AGENTS,
  consent: "granted",
  counts: { conversions: 12, nthOfKind: 3 },
  archetype: "b2b_saas",
  visitorIds: [VISITOR_ID],
  businessId: "b0000000-0000-0000-0000-000000000001",
});

describe("shouldPlayFullMatchDay — the 100th / 75th-percentile rule", () => {
  it("every conversion gets a full Match Day up to and including the 100th of its kind", () => {
    expect(LIMITS.matchDayFullUntilCount).toBe(100);
    for (const kind of CONVERSION_KINDS) {
      expect(shouldPlayFullMatchDay(kind, 1, 0, null, false)).toBe(true);
      expect(shouldPlayFullMatchDay(kind, 100, 0, null, false)).toBe(true);
      expect(shouldPlayFullMatchDay(kind, 100, 1, 1_000_000, false)).toBe(true);
    }
  });

  it("after the 100th, signups and activations roll into the round-up unless flagged high-value", () => {
    expect(shouldPlayFullMatchDay("signup", 101, 0, null, false)).toBe(false);
    expect(shouldPlayFullMatchDay("activation", 101, 0, null, false)).toBe(false);
    expect(shouldPlayFullMatchDay("signup", 101, 0, null, true)).toBe(true);
    expect(shouldPlayFullMatchDay("activation", 5_000, 0, 10, true)).toBe(true);
  });

  it("after the 100th payment only values strictly above the 75th percentile (or flagged accounts) play in full", () => {
    expect(shouldPlayFullMatchDay("payment", 101, 10_001, 10_000, false)).toBe(true);
    expect(shouldPlayFullMatchDay("payment", 101, 10_000, 10_000, false)).toBe(false);
    expect(shouldPlayFullMatchDay("payment", 101, 1, 10_000, false)).toBe(false);
    expect(shouldPlayFullMatchDay("payment", 101, 1, 10_000, true)).toBe(true);
    // Unknown percentile: nothing to compare against, so the round-up takes it.
    expect(shouldPlayFullMatchDay("payment", 101, 1_000_000, null, false)).toBe(false);
    expect(shouldPlayFullMatchDay("payment", 101, 1_000_000, undefined, false)).toBe(false);
  });

  it("matchday level follows the shared vocabulary", () => {
    expect(matchdayLevelFor("signup")).toBe("friendly");
    expect(matchdayLevelFor("activation")).toBe("league");
    expect(matchdayLevelFor("payment")).toBe("cup");
    for (const k of CONVERSION_KINDS) expect(matchdayLevelFor(k)).toBe(MATCHDAY_LEVEL_FOR_KIND[k]);
  });
});

describe("buildJourney", () => {
  it("is deterministic: same input → same record, whatever the touch order (AC-11.4.3)", () => {
    const input = baseInput();
    const a = buildJourney(input);
    const b = buildJourney(input);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const shuffled: BuildJourneyInput = { ...input, touches: [input.touches[3]!, input.touches[0]!, input.touches[4]!, input.touches[2]!, input.touches[1]!], agents: [...AGENTS].reverse() };
    const c = buildJourney(shuffled);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    const synthetic = generateSyntheticConversionPath("replay-7");
    expect(JSON.stringify(buildJourney(synthetic))).toBe(JSON.stringify(buildJourney(generateSyntheticConversionPath("replay-7"))));
  });

  it("produces a valid Journey with weights summing to 1, the captain on the heaviest touch and the level for the kind", () => {
    const j = buildJourney(baseInput());
    expect(Journey.parse(j)).toEqual(j);
    expect(j.conversionId).toBe(fid("c", 1));
    expect(j.entityId).toBe(ENTITY_ID);
    expect(j.kind).toBe("payment");
    expect(j.matchdayLevel).toBe("cup");
    expect(j.touchIds).toEqual([1, 2, 3, 4, 5].map((n) => fid("t", n)));
    expect(closeTo(sum(Object.values(j.weights)), 1)).toBe(true);
    expect(j.attributionModel).toBe("position_based_40_20_40");
    expect(j.weights[fid("t", 1)]).toBeCloseTo(0.4, 9);
    expect(j.weights[fid("t", 5)]).toBeCloseTo(0.4, 9);
    // Tie between first and last at 0.4: the later touch is captain.
    expect(j.captain).toEqual({ touchId: fid("t", 5), channelKey: "lead_generation", agentId: fid("a9", 4), weight: 0.4 });
    const best = Math.max(...Object.values(j.weights));
    expect(j.weights[j.captain!.touchId]).toBe(best);
    expect(j.convertedAt).toBe(CONVERTED_AT);
    expect(j.consent).toBe("granted");
    expect(j.partialJourney).toBe(false);
    expect(j.nthOfKind).toBe(3);
    expect(j.fullMatchDay).toBe(true);
    expect(j.viewedAt).toBeNull();
    expect(j.commentary).toEqual([]);
    expect(j.businessId).toBe("b0000000-0000-0000-0000-000000000001");
  });

  it("builds the team sheet: contributions follow the touches each agent worked, player of the match rates 10", () => {
    const j = buildJourney(baseInput());
    const byId = Object.fromEntries(j.agents.map((a) => [a.agentId, a]));
    // Outbound owns the last touch (0.4); Paid owns the first (0.4); Lifecycle is named on the email touch; Search owns the seo touch.
    expect(byId[fid("a9", 4)]!.contribution).toBeCloseTo(0.4, 9);
    expect(byId[fid("a9", 1)]!.contribution).toBeCloseTo(0.4, 9);
    expect(byId[fid("a9", 2)]!.contribution).toBeCloseTo(0.2 / 3, 9);
    expect(byId[fid("a9", 3)]!.contribution).toBeCloseTo(0.2 / 3, 9);
    expect(byId[fid("a9", 2)]!.touchIds).toEqual([fid("t", 3)]);
    expect(sum(j.agents.map((a) => a.contribution))).toBeLessThanOrEqual(1 + 1e-9);
    expect(j.agents[0]!.rating).toBe(10);
    expect(j.playerOfTheMatch).toBe(j.agents[0]!.agentId);
    // Sorted by contribution then id: the two 0.4 contributors come first, Paid (a9…1) before Outbound (a9…4).
    expect(j.agents.map((a) => a.agentId).slice(0, 2)).toEqual([fid("a9", 1), fid("a9", 4)]);
    for (const a of j.agents) {
      expect(a.rating).toBeGreaterThanOrEqual(1);
      expect(a.rating).toBeLessThanOrEqual(10);
      expect(a.departmentId).not.toBeNull();
    }
    // The direct touch has no agent and is not credited to anyone.
    expect(j.agents.some((a) => a.touchIds.includes(fid("t", 4)))).toBe(false);
  });

  it("an agent named on the touch beats the channel owner; campaigns beat channels", () => {
    const input = baseInput();
    input.touches = makeTouches([{ hoursBefore: 10, channelKey: "paid_ads", campaignId: fid("ca", 1) }, { hoursBefore: 1, channelKey: "seo", source: { agentId: fid("a9", 4) } }]);
    input.agents = [...AGENTS, { agentId: fid("a9", 5), name: "Campaigner", channelKeys: [], campaignIds: [fid("ca", 1)] }];
    const j = buildJourney(input);
    const byId = Object.fromEntries(j.agents.map((a) => [a.agentId, a]));
    expect(byId[fid("a9", 5)]!.contribution).toBeCloseTo(0.5, 9);
    expect(byId[fid("a9", 1)]).toBeUndefined();
    expect(byId[fid("a9", 4)]!.contribution).toBeCloseTo(0.5, 9);
    expect(byId[fid("a9", 3)]).toBeUndefined();
  });

  it("without consent shows first-party touches only and labels the journey partial", () => {
    const j = buildJourney({ ...baseInput(), consent: "denied" });
    expect(j.partialJourney).toBe(true);
    expect(j.consent).toBe("denied");
    expect(j.touchIds).not.toContain(fid("t", 1));
    expect(j.touchIds).toHaveLength(4);
    expect(closeTo(sum(Object.values(j.weights)), 1)).toBe(true);
    expect(j.agents.some((a) => a.agentId === fid("a9", 1))).toBe(false);
    expect(j.stats.touchCount).toBe(4);
  });

  it("computes stats: touch count, first/last touch, time to convert, acquisition cost estimate", () => {
    const j = buildJourney({ ...baseInput(), costs: { cpaByChannelMinor: { paid_ads: 10_000, lead_generation: 5_000 } } });
    expect(j.stats.touchCount).toBe(5);
    expect(j.stats.firstTouchAt).toBe(new Date(Date.parse(CONVERTED_AT) - 240 * 3_600_000).toISOString());
    expect(j.stats.lastTouchAt).toBe(new Date(Date.parse(CONVERTED_AT) - 6 * 3_600_000).toISOString());
    expect(j.stats.timeToConvertHours).toBe(240);
    expect(j.stats.acquisitionCostMinor).toBe(Math.round(0.4 * 10_000 + 0.4 * 5_000));
    expect(j.stats.currency).toBe("EUR");
    expect(buildJourney(baseInput()).stats.acquisitionCostMinor).toBeNull();
    const campaign = buildJourney({ ...baseInput(), touches: makeTouches([{ hoursBefore: 1, channelKey: "paid_ads", campaignId: fid("ca", 1) }]), costs: { cpaByChannelMinor: { paid_ads: 10 }, cpaByCampaignMinor: { [fid("ca", 1)]: 999 } } });
    expect(campaign.stats.acquisitionCostMinor).toBe(999);
  });

  it("the xC curve uses the archetype prior below 50 conversions and a trained model from 50", () => {
    const j = buildJourney(baseInput());
    expect(j.xcModelSource).toBe("archetype_prior");
    expect(j.xcSeries).toHaveLength(6);
    expect(j.xcSeries.at(-1)).toMatchObject({ cumulative: 1, touchId: null, at: CONVERTED_AT });
    const model: XcModel = { source: "trained", archetype: "b2b_saas", featureNames: [...XC_FEATURE_NAMES], weights: new Array<number>(XC_FEATURE_COUNT).fill(0.1), trainedOn: 50 };
    const trained = buildJourney({ ...baseInput(), counts: { conversions: 50, nthOfKind: 3 }, xcModel: model });
    expect(trained.xcModelSource).toBe("trained");
    expect(buildJourney({ ...baseInput(), counts: { conversions: 49, nthOfKind: 3 }, xcModel: model }).xcModelSource).toBe("archetype_prior");
  });

  it("switches to data-driven attribution at 200 conversions when a Markov model is supplied", () => {
    const markov = buildMarkovModel([
      { states: ["paid_ads", "seo", "email_automation", "direct", "lead_generation"], converted: true },
      { states: ["paid_ads", "seo"], converted: false },
      { states: ["social"], converted: false },
    ]);
    const j = buildJourney({ ...baseInput(), counts: { conversions: 200, nthOfKind: 150 }, markov });
    expect(j.attributionModel).toBe("data_driven_markov");
    expect(closeTo(sum(Object.values(j.weights)), 1)).toBe(true);
    expect(j.channels.every((c) => c.weight >= 0)).toBe(true);
    const without = buildJourney({ ...baseInput(), counts: { conversions: 200, nthOfKind: 150 } });
    expect(without.attributionModel).toBe("position_based_40_20_40");
  });

  it("applies the volume rule from the counts", () => {
    const roundup = buildJourney({ ...baseInput(), counts: { conversions: 500, nthOfKind: 101, valuePercentile75Minor: 10_000 } });
    expect(roundup.fullMatchDay).toBe(false);
    expect(roundup.matchdayLevel).toBe("cup");
    const big = buildJourney({ ...baseInput(), conversion: makeConversion({ amountMinor: 50_000 }), counts: { conversions: 500, nthOfKind: 101, valuePercentile75Minor: 10_000 } });
    expect(big.fullMatchDay).toBe(true);
    const flagged = buildJourney({ ...baseInput(), conversion: makeConversion({ kind: "signup", amountMinor: 0 }), counts: { conversions: 500, nthOfKind: 101, flaggedHighValue: true } });
    expect(flagged.fullMatchDay).toBe(true);
    expect(flagged.matchdayLevel).toBe("friendly");
  });

  it("handles a conversion with no touches at all", () => {
    const j = buildJourney({ ...baseInput(), touches: [] });
    expect(j.touchIds).toEqual([]);
    expect(j.weights).toEqual({});
    expect(j.captain).toBeNull();
    expect(j.agents).toEqual([]);
    expect(j.playerOfTheMatch).toBeNull();
    expect(j.xcSeries).toEqual([{ index: 0, touchId: null, at: CONVERTED_AT, p: 0, cumulative: 1 }]);
    expect(j.stats).toMatchObject({ touchCount: 0, firstTouchAt: null, lastTouchAt: null, timeToConvertHours: null });
  });

  it("ignores touches after the conversion and touches belonging to other entities; orphans count as the entity's", () => {
    const input = baseInput();
    const late = { ...input.touches[0]!, id: fid("x", 1), occurredAt: "2025-06-12T09:31:00.000Z" };
    const other = { ...input.touches[1]!, id: fid("x", 2), visitorId: fid("v", 2), entityId: fid("e", 9) };
    const orphan = { ...input.touches[1]!, id: fid("x", 3), visitorId: null, entityId: null };
    const j = buildJourney({ ...input, touches: [...input.touches, late, other, orphan] });
    expect(j.touchIds).not.toContain(fid("x", 1));
    expect(j.touchIds).not.toContain(fid("x", 2));
    expect(j.touchIds).toContain(fid("x", 3));
  });

  it("accepts Date inputs and normalises them to ISO strings", () => {
    const input = baseInput();
    const j = buildJourney({ ...input, conversion: { ...input.conversion, occurredAt: new Date(CONVERTED_AT) as unknown as string } });
    expect(j.convertedAt).toBe(CONVERTED_AT);
  });
});
