import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDayMonth, formatMoney, formatMonthYear, formatNumber, plural } from "../format";

// 23:45 UTC on Oct 7: the day before or after in most zones, so a local-time format would show a different date.
const LATE = "2026-10-07T23:45:00Z";

describe("US English formats (founder, 2026-10-10)", () => {
  it("prints dates month first, in UTC, whatever the process's zone", () => {
    expect(formatDate(LATE)).toBe("Oct 7, 2026");
    expect(formatDayMonth(LATE)).toBe("Oct 7");
    expect(formatMonthYear(LATE)).toBe("Oct 2026");
    expect(formatMonthYear(new Date(Date.UTC(2026, 8, 1)), { long: true })).toBe("September 2026");
    expect(formatDate(new Date(LATE))).toBe("Oct 7, 2026");
    expect(formatDate(Date.parse(LATE))).toBe("Oct 7, 2026");
  });

  it("prints times on a 12-hour clock with a plain space and says UTC", () => {
    expect(formatDateTime("2026-10-07T15:45:00Z")).toBe("Oct 7, 3:45 PM UTC");
    expect(formatDateTime("2026-10-07T00:05:00Z")).toBe("Oct 7, 12:05 AM UTC");
    expect(formatDateTime(LATE)).not.toMatch(/[\u202f\u00a0]/);
  });

  it("dashes out missing or invalid values", () => {
    for (const v of [null, undefined, "", "not a date"]) {
      expect(formatDate(v)).toBe("—");
      expect(formatDateTime(v)).toBe("—");
      expect(formatDayMonth(v)).toBe("—");
      expect(formatMonthYear(v)).toBe("—");
    }
  });

  it("groups numbers the en-US way and keeps each currency's own symbol", () => {
    expect(formatNumber(1234567.5)).toBe("1,234,567.5");
    expect(formatNumber(1234.567, { maximumFractionDigits: 0 })).toBe("1,235");
    expect(plural(1, "business", "businesses")).toBe("1 business");
    expect(plural(12480, "token")).toBe("12,480 tokens");
    expect(formatMoney({ amountMinor: 124_000, currency: "GBP" })).toBe("£1,240.00");
    expect(formatMoney({ amountMinor: 124_000, currency: "USD" })).toBe("$1,240.00");
    expect(formatMoney({ amountMinor: 124_050, currency: "EUR" })).toBe("€1,240.50");
    expect(formatMoney(null)).toBe("—");
  });
});
