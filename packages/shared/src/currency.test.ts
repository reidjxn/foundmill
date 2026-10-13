import { describe, expect, it } from "vitest";
import { CurrencyCode, isCurrencyCode } from "./currency";
import { formatMoney } from "./money";
import { Money } from "./types";

describe("CurrencyCode (audit ARB-15)", () => {
  it("accepts ISO 4217 codes, trimmed and upper-cased", () => {
    expect(CurrencyCode.parse("gbp")).toBe("GBP");
    expect(CurrencyCode.parse(" usd ")).toBe("USD");
    expect(CurrencyCode.parse("EUR")).toBe("EUR");
    expect(CurrencyCode.parse("jpy")).toBe("JPY");
  });

  it("refuses anything Intl would throw on, or that is not a code at all", () => {
    for (const bad of ["1$x", "1$X", "US", "USDX", "", "   ", "€€€", "U S", "ZZZ"]) expect(CurrencyCode.safeParse(bad).success, bad).toBe(false);
    expect(isCurrencyCode("ABC")).toBe(false);
    expect(CurrencyCode.safeParse("1$x").error?.issues[0]?.message).toMatch(/three-letter currency code/);
  });

  it("is what the Money schema uses", () => {
    expect(Money.safeParse({ amountMinor: 100, currency: "gbp" }).data).toEqual({ amountMinor: 100, currency: "GBP" });
    expect(Money.safeParse({ amountMinor: 100, currency: "1$X" }).success).toBe(false);
  });
});

describe("formatMoney with a code Intl rejects", () => {
  it("falls back to the plain number and the code as written instead of throwing", () => {
    expect(formatMoney({ amountMinor: 123456, currency: "1$X" })).toBe("1,234.56 1$X");
    expect(formatMoney({ amountMinor: 123456, currency: "1$X" }, { compact: true })).toBe("1,235 1$X");
    expect(formatMoney({ amountMinor: 123456, currency: "GBP" })).toBe("£1,234.56");
  });
});
