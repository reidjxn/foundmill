import { describe, expect, it } from "vitest";
import { currencySymbol, formatCompact, formatDate, formatDelta, formatDuration, formatMoney, formatMoneyDelta, formatMoneyInput, formatNumber, formatOrdinal, formatPercent, formatRelative, initials, truncate } from "./format";

describe("formatNumber", () => {
  it("groups thousands and caps decimals at 2", () => {
    expect(formatNumber(1234567.891)).toBe("1,234,567.89");
    expect(formatNumber(12)).toBe("12");
  });
  it("fixes digits and signs", () => {
    expect(formatNumber(3.5, { digits: 2 })).toBe("3.50");
    expect(formatNumber(3, { signed: true })).toBe("+3");
    expect(formatNumber(0, { signed: true })).toBe("0");
  });
  it("returns a dash for non-finite", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
  });
});

describe("formatCompact", () => {
  it("abbreviates", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1200)).toBe("1.2K");
    expect(formatCompact(125000)).toBe("125K");
    expect(formatCompact(3_400_000)).toBe("3.4M");
    expect(formatCompact(12_000_000_000)).toBe("12B");
    expect(formatCompact(-1500)).toBe("-1.5K");
  });
});

describe("formatPercent", () => {
  it("formats ratios and hundreds", () => {
    expect(formatPercent(0.125)).toBe("12.5%");
    expect(formatPercent(12.5, { ofHundred: true })).toBe("12.5%");
    expect(formatPercent(0.5, { digits: 0 })).toBe("50%");
  });
});

describe("money", () => {
  it("uses shared minor-unit formatting", () => {
    expect(formatMoney({ amountMinor: 123456, currency: "EUR" })).toBe("€1,234.56");
    expect(formatMoney({ amountMinor: 1_250_000_00, currency: "GBP" }, { compact: true })).toMatch(/^£1[mM]$/);
  });
  it("signs deltas", () => {
    expect(formatMoneyDelta({ amountMinor: 120000, currency: "EUR" })).toBe("+€1,200.00");
    expect(formatMoneyDelta({ amountMinor: -30000, currency: "EUR" })).toBe("−€300.00");
    expect(formatMoneyDelta({ amountMinor: 0, currency: "EUR" })).toBe("€0.00");
  });
});

describe("dates", () => {
  const d = new Date(2026, 9, 5, 14, 5);
  it("formats dates", () => {
    expect(formatDate(d)).toBe("5 Oct 2026");
    expect(formatDate("not a date")).toBe("—");
  });
  it("formats relative time deterministically", () => {
    const now = new Date(2026, 9, 5, 14, 5, 0);
    expect(formatRelative(new Date(now.getTime() - 10_000), now)).toBe("just now");
    expect(formatRelative(new Date(now.getTime() - 3 * 60_000), now)).toBe("3 min ago");
    expect(formatRelative(new Date(now.getTime() + 2 * 3600_000), now)).toBe("in 2 hr");
    expect(formatRelative(new Date(now.getTime() - 24 * 3600_000), now)).toBe("yesterday");
    expect(formatRelative(new Date(now.getTime() - 4 * 24 * 3600_000), now)).toBe("4 days ago");
  });
  it("formats durations", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(3840_000)).toBe("1h 04m");
    expect(formatDuration(27 * 3600_000)).toBe("1d 3h");
  });
});

describe("misc", () => {
  it("delta arrows", () => {
    expect(formatDelta(0.125, { percent: true })).toBe("▲ 12.5%");
    expect(formatDelta(-3)).toBe("▼ 3");
    expect(formatDelta(0)).toBe("— 0");
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 102].map(formatOrdinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "102nd"]);
  });
  it("initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ledgerly")).toBe("LE");
    expect(initials("Jean-Luc Picard")).toBe("JL");
    expect(initials("")).toBe("");
    expect(initials("Patch & Co.")).toBe("PC");
    expect(initials("(Re)Fill")).toBe("RE");
    expect(initials("“Quoted” name")).toBe("QN");
    expect(initials("&")).toBe("");
  });
  it("truncates", () => {
    expect(truncate("Founder Manager", 8)).toBe("Founder…");
    expect(truncate("short", 8)).toBe("short");
  });
});

describe("formatMoneyInput (MoneyInput at rest)", () => {
  it("groups plain amounts and keeps the decimals as typed", () => {
    expect(formatMoneyInput("60000")).toBe("60,000");
    expect(formatMoneyInput("1250000000")).toBe("1,250,000,000");
    expect(formatMoneyInput("1234.50")).toBe("1,234.50");
    expect(formatMoneyInput("60,000")).toBe("60,000");
    expect(formatMoneyInput(" 7 500 ")).toBe("7,500");
  });
  it("expands the shorthand callers already parse", () => {
    expect(formatMoneyInput("25k")).toBe("25,000");
    expect(formatMoneyInput("1.2m")).toBe("1,200,000");
    expect(formatMoneyInput("2.5K")).toBe("2,500");
  });
  it("leaves anything else alone", () => {
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("about 5k")).toBe("about 5k");
    expect(formatMoneyInput("12/3")).toBe("12/3");
  });
  it("follows the locale's separators", () => {
    expect(formatMoneyInput("60000", "de-DE")).toBe("60.000");
  });
});

describe("currencySymbol", () => {
  it("finds the narrow symbol, or nothing when the locale only has the code", () => {
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("eur")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CHF")).toBeUndefined();
    expect(currencySymbol("NOPE")).toBeUndefined();
    expect(currencySymbol(undefined)).toBeUndefined();
  });
});
