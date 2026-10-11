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

  it("prints the signed-in person's own format, still in UTC (Settings › Preferences)", () => {
    const dayFirst = { date: "day_first", time: "24h" } as const;
    const iso = { date: "iso", time: "12h" } as const;
    expect(formatDate(LATE, dayFirst)).toBe("7 Oct 2026");
    expect(formatDate(LATE, iso)).toBe("2026-10-07");
    expect(formatDayMonth(LATE, dayFirst)).toBe("7 Oct");
    expect(formatDayMonth(LATE, iso)).toBe("10-07");
    expect(formatDateTime(LATE, dayFirst)).toBe("7 Oct, 23:45 UTC");
    expect(formatDateTime("2026-10-07T00:05:00Z", { date: "iso", time: "24h" })).toBe("10-07 00:05 UTC");
    expect(formatDateTime(LATE, iso)).toBe("10-07 11:45 PM UTC");
    expect(formatMonthYear(LATE, {}, iso)).toBe("2026-10");
    expect(formatMonthYear(new Date(Date.UTC(2026, 8, 1)), { long: true }, dayFirst)).toBe("September 2026");
    expect(formatMonthYear(new Date(Date.UTC(2026, 8, 1)), { long: true }, iso)).toBe("2026-09");
    // Without a choice: US and 12-hour, as before.
    expect(formatDateTime(LATE, null)).toBe("Oct 7, 11:45 PM UTC");
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
