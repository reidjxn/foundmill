/**
 * Minor units follow ISO 4217 (audit JM-14): 12.345 KWD is 12345 minor units, 5000 UGX is 5,000 UGX, not 50, and a
 * two-decimal currency is unchanged.
 */
import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinor, minorToMajor, minorUnitDigits } from "./money";

describe("minor units of a currency", () => {
  it("reads the decimals from the currency, not from a short list", () => {
    for (const c of ["USD", "EUR", "GBP", "SEK"]) expect(minorUnitDigits(c)).toBe(2);
    for (const c of ["JPY", "KRW", "CLP", "ISK", "VND", "XOF", "XAF", "UGX", "PYG", "RWF"]) expect(minorUnitDigits(c)).toBe(0);
    for (const c of ["KWD", "BHD", "OMR", "JOD", "TND"]) expect(minorUnitDigits(c)).toBe(3);
    expect(minorUnitDigits("kwd")).toBe(3);
    expect(minorUnitDigits("not a code")).toBe(2);
  });

  it("converts both ways", () => {
    expect(minorToMajor(12_345, "KWD")).toBeCloseTo(12.345);
    expect(minorToMajor(5_000, "UGX")).toBe(5_000);
    expect(minorToMajor(12_345, "GBP")).toBeCloseTo(123.45);
    expect(majorToMinor(12.345, "KWD")).toBe(12_345);
    expect(majorToMinor(5_000, "XOF")).toBe(5_000);
    expect(majorToMinor(123.45, "USD")).toBe(12_345);
  });

  it("formats three-decimal and zero-decimal amounts as what they are", () => {
    expect(formatMoney({ amountMinor: 12_345, currency: "KWD" })).toMatch(/12\.345$/);
    expect(formatMoney({ amountMinor: 5_000, currency: "XOF" })).toMatch(/5,000$/);
    expect(formatMoney({ amountMinor: 5_000, currency: "UGX" })).toMatch(/5,000$/);
    expect(formatMoney({ amountMinor: 12_345, currency: "USD" })).toBe("$123.45");
    expect(formatMoney({ amountMinor: 123_456, currency: "JPY" })).toBe("¥123,456");
  });
});
