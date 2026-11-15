import { describe, expect, it } from "vitest";
import { RUNWAY_WORDS, runwayFigure, runwayState, runwayWords, type RunwayFinanceInput } from "./runway";

const finance = (over: { amountMinor?: number; accounts?: number; netBurnMinor?: number; months?: number | null } = {}): RunwayFinanceInput => ({
  cash: { amountMinor: over.amountMinor ?? 1_840_000, accounts: over.accounts ?? 1 },
  burn: { netBurnMinor: over.netBurnMinor ?? 120_000 },
  runway: { months: over.months === undefined ? 15.3 : over.months },
});

describe("runway words (one wording for every screen)", () => {
  it("says nothing when there is a figure, or no finance data at all", () => {
    expect(runwayState(finance())).toBeNull();
    expect(runwayWords(finance())).toBeNull();
    expect(runwayFigure(finance())).toBe(15.3);
    expect(runwayWords(null)).toBeNull();
    expect(runwayFigure(undefined)).toBeNull();
  });

  it("reads Not running out when cash-flow positive, Not known yet without a bank or with too little history, with the reason and its short form", () => {
    expect(runwayWords(finance({ months: null, netBurnMinor: -5_000 }))).toEqual(RUNWAY_WORDS.positive);
    // A month where nothing moved at all is not "you earn more than you spend": it is too little history (Nov 7, 2026).
    expect(runwayState({ cash: { amountMinor: 50_000, accounts: 1 }, burn: { netBurnMinor: 0, grossBurnMinor: 0 }, runway: { months: null } })).toBe("short_history");
    expect(runwayState({ cash: { amountMinor: 50_000, accounts: 1 }, burn: { netBurnMinor: 0, grossBurnMinor: 40_000 }, runway: { months: null } })).toBe("positive");
    expect(runwayWords(finance({ months: null, accounts: 0, amountMinor: 0 }))).toMatchObject({ value: "Not known yet", caption: "Not enough data yet: connect your bank", brief: "connect a bank" });
    expect(runwayWords(finance({ months: null, netBurnMinor: 9_000 }))).toMatchObject({ value: "Not known yet", caption: "Not enough data yet: needs three months of bank history" });
    expect(RUNWAY_WORDS.positive.estimate).toBeUndefined();
  });

  it("never reads Not running out for a bank balance below zero: Cash is below zero, with Estimate, whatever the months say (B8)", () => {
    // Negative cash and no burn: the API returns no months, which used to read as cash-flow positive.
    const overdrawn = finance({ amountMinor: -42_000, netBurnMinor: 0, months: null });
    expect(runwayState(overdrawn)).toBe("negative");
    expect(runwayWords(overdrawn)).toMatchObject({ value: "Cash is below zero", estimate: true });
    expect(runwayWords(overdrawn)?.value).not.toBe("Not running out");
    // Negative cash and a burn: the API divides and gets a negative figure; the words stand in for it.
    const sinking = finance({ amountMinor: -42_000, netBurnMinor: 10_000, months: -4.2 });
    expect(runwayWords(sinking)?.value).toBe("Cash is below zero");
    expect(runwayFigure(sinking)).toBeNull();
    // No account at all is "Not known yet", never "below zero" (a zero without a bank is not a balance).
    expect(runwayState(finance({ accounts: 0, amountMinor: -1, months: null }))).toBe("no_bank");
  });
});
