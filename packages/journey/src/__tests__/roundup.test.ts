import { describe, expect, it } from "vitest";
import { applyVolumeRules, buildDailyRoundup, percentile75 } from "../roundup";
import type { Conversion } from "../types";
import { fid, makeConversion } from "./fixtures";

const START = Date.UTC(2025, 0, 1, 9);

/** n conversions of one kind, one hour apart, values from `value(i)`. */
function series(kind: Conversion["kind"], n: number, value: (i: number) => number = () => 0, offset = 0): Conversion[] {
  return Array.from({ length: n }, (_, i) =>
    makeConversion({ id: fid(kind[0]!, offset + i + 1), kind, amountMinor: value(i), entityId: fid("e", offset + i + 1), occurredAt: new Date(START + (offset + i) * 3_600_000).toISOString() }),
  );
}

describe("percentile75", () => {
  it("uses linear interpolation and returns null for no values", () => {
    expect(percentile75([])).toBeNull();
    expect(percentile75([10])).toBe(10);
    expect(percentile75([1, 2, 3, 4])).toBe(3.25);
    expect(percentile75([4, 1, 3, 2])).toBe(3.25);
    expect(percentile75([1, 2, 3, 4, 5])).toBe(4);
  });
});

describe("applyVolumeRules — round-up after the 100th of a kind", () => {
  it("gives the first 100 signups a friendly and rolls the rest into the round-up", () => {
    const decisions = applyVolumeRules(series("signup", 130));
    expect(decisions).toHaveLength(130);
    expect(decisions.map((d) => d.nthOfKind)).toEqual(Array.from({ length: 130 }, (_, i) => i + 1));
    expect(decisions.slice(0, 100).every((d) => d.fullMatchDay && d.matchdayLevel === "friendly")).toBe(true);
    expect(decisions.slice(100).every((d) => !d.fullMatchDay)).toBe(true);
    expect(decisions[99]!.fullMatchDay).toBe(true);
    expect(decisions[100]!.fullMatchDay).toBe(false);
  });

  it("counts each kind independently", () => {
    const mixed = [...series("signup", 101), ...series("activation", 101, () => 0, 101), ...series("payment", 3, () => 100, 202)];
    const decisions = applyVolumeRules(mixed);
    const byKind = (k: Conversion["kind"]) => decisions.filter((d) => d.conversion.kind === k);
    expect(byKind("signup").filter((d) => d.fullMatchDay)).toHaveLength(100);
    expect(byKind("activation").filter((d) => d.fullMatchDay)).toHaveLength(100);
    expect(byKind("activation").at(-1)!.matchdayLevel).toBe("league");
    expect(byKind("payment").every((d) => d.fullMatchDay && d.matchdayLevel === "cup")).toBe(true);
  });

  it("after 100 payments, only values above the running 75th percentile get a cup tie", () => {
    // Values 1..100, then four more: 50 (below p75), 76 (above p75 of 1..100 = 75.25), 75 (not strictly above), 1000.
    const payments = [...series("payment", 100, (i) => i + 1), ...series("payment", 4, (i) => [50, 76, 75, 1_000][i]!, 100)];
    const decisions = applyVolumeRules(payments);
    expect(decisions.slice(0, 100).every((d) => d.fullMatchDay)).toBe(true);
    expect(decisions[100]!.valuePercentile75Minor).toBe(75.25);
    expect(decisions[100]!.fullMatchDay).toBe(false);
    expect(decisions[101]!.fullMatchDay).toBe(true);
    expect(decisions[102]!.fullMatchDay).toBe(false);
    expect(decisions[103]!.fullMatchDay).toBe(true);
    // The percentile moves as payments come in.
    expect(decisions[103]!.valuePercentile75Minor).toBeGreaterThan(75.25);
  });

  it("honours counts and values seen before this batch, and flagged accounts", () => {
    const decisions = applyVolumeRules(series("payment", 2, () => 10), {
      countsBefore: { payment: 100 },
      paymentValuesBefore: Array.from({ length: 100 }, (_, i) => i + 1),
      flaggedEntityIds: [fid("e", 2)],
    });
    expect(decisions.map((d) => d.nthOfKind)).toEqual([101, 102]);
    expect(decisions[0]!.fullMatchDay).toBe(false);
    expect(decisions[1]!.fullMatchDay).toBe(true);
  });

  it("walks conversions in time order regardless of input order", () => {
    const ordered = series("signup", 101);
    const reversed = [...ordered].reverse();
    expect(applyVolumeRules(reversed).map((d) => d.conversion.id)).toEqual(ordered.map((c) => c.id));
  });
});

describe("buildDailyRoundup", () => {
  it("tabulates the day's results with a headline and totals, ignoring other days", () => {
    const entries = [
      { conversion: makeConversion({ id: fid("c", 1), kind: "signup", amountMinor: 0, occurredAt: "2025-03-04T08:00:00.000Z" }), entityName: "Ada Holm" },
      { conversion: makeConversion({ id: fid("c", 2), kind: "signup", amountMinor: 0, occurredAt: "2025-03-04T07:00:00.000Z" }) },
      { conversion: makeConversion({ id: fid("c", 3), kind: "activation", amountMinor: 0, occurredAt: "2025-03-04T12:00:00.000Z" }) },
      {
        conversion: makeConversion({ id: fid("c", 4), kind: "payment", amountMinor: 12_000, occurredAt: "2025-03-04T23:59:59.000Z" }),
        journey: { captain: { touchId: fid("t", 1), channelKey: "seo" as const, agentId: null, weight: 0.4 }, stats: { touchCount: 3, firstTouchAt: null, lastTouchAt: null, timeToConvertHours: 48, acquisitionCostMinor: null, currency: "EUR" }, matchdayLevel: "cup" as const },
      },
      { conversion: makeConversion({ id: fid("c", 5), kind: "payment", amountMinor: 500, currency: "USD", occurredAt: "2025-03-04T10:00:00.000Z" }) },
      { conversion: makeConversion({ id: fid("c", 6), kind: "payment", amountMinor: 999, occurredAt: "2025-03-05T00:00:00.000Z" }) },
    ];
    const table = buildDailyRoundup({ day: "2025-03-04", entries });
    expect(table.day).toBe("2025-03-04");
    expect(table.rows.map((r) => r.conversionId)).toEqual([fid("c", 2), fid("c", 1), fid("c", 5), fid("c", 3), fid("c", 4)]);
    expect(table.kinds).toEqual({ signup: 2, activation: 1, payment: 2 });
    expect(table.totals).toEqual({ signups: 2, activations: 1, payments: 2, revenueByCurrency: { EUR: 12_000, USD: 500 } });
    expect(table.headline).toMatch(/^2 signups · 1 activation · 2 payments \(.* \+ .*\)$/);
    expect(table.headline).toContain("120.00");
    expect(table.headline).toContain("5.00");
    const paid = table.rows.find((r) => r.conversionId === fid("c", 4))!;
    expect(paid).toMatchObject({ captainChannelKey: "seo", touchCount: 3, timeToConvertHours: 48, matchdayLevel: "cup", amountMinor: 12_000 });
    expect(table.rows[0]!).toMatchObject({ entityName: null, captainChannelKey: null, touchCount: null, matchdayLevel: "friendly" });
    expect(table.rows[1]!.entityName).toBe("Ada Holm");
  });

  it("reports no results for an empty day", () => {
    const table = buildDailyRoundup({ day: "2025-03-04", entries: [] });
    expect(table.rows).toEqual([]);
    expect(table.headline).toBe("No results");
  });
});
