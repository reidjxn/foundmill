import { describe, expect, it } from "vitest";
import { DATE_FORMAT_PREFERENCES, DEFAULT_DATE_FORMAT_PREFS, TIME_FORMAT_PREFERENCES, dateFormatKeyOf, datePatternFor, isDateFormatKey, normalizeDateFormatPrefs, type DateFormatKey, type DateFormatPrefs } from "./date-preferences";
import { DATE_FORMATS, bindFormatters, formatDate, formatDateRange, formatDateShort, formatDateTime, formatDateYearParts, formatHourOfDay, formatMonthYear, formatRelative, formatTime } from "./format";

const US: DateFormatPrefs = { date: "us", time: "12h" };
const DAY_FIRST_24: DateFormatPrefs = { date: "day_first", time: "24h" };
const ISO_24: DateFormatPrefs = { date: "iso", time: "24h" };
const ISO_12: DateFormatPrefs = { date: "iso", time: "12h" };

// Wednesday, October 7, 2026, 3:45:09 PM (local time).
const d = new Date(2026, 9, 7, 15, 45, 9);

describe("the preference mapping (docs/DECISIONS.md table)", () => {
  const every: [DateFormatKey, string, string, string][] = [
    // key,              US,                          day first + 24-hour,          ISO + 24-hour
    ["date", "Oct 7, 2026", "7 Oct 2026", "2026-10-07"],
    ["dayMonth", "Oct 7", "7 Oct", "10-07"],
    ["weekdayDayMonth", "Wed, Oct 7", "Wed 7 Oct", "Wed 10-07"],
    ["weekdayDate", "Wed, Oct 7, 2026", "Wed 7 Oct 2026", "Wed 2026-10-07"],
    ["longDate", "Wednesday, October 7, 2026", "Wednesday 7 October 2026", "Wednesday 2026-10-07"],
    ["monthYear", "Oct 2026", "Oct 2026", "2026-10"],
    ["time", "3:45 PM", "15:45", "15:45"],
    ["timeSeconds", "3:45:09 PM", "15:45:09", "15:45:09"],
    ["dateTime", "Oct 7, 2026, 3:45 PM", "7 Oct 2026, 15:45", "2026-10-07 15:45"],
    ["dayMonthTime", "Oct 7, 3:45 PM", "7 Oct, 15:45", "10-07 15:45"],
  ];
  it.each(every)("%s reads %s / %s / %s", (key, us, dayFirst, iso) => {
    expect(formatDate(d, key)).toBe(us);
    expect(formatDate(d, key, US)).toBe(us);
    expect(formatDate(d, key, DAY_FIRST_24)).toBe(dayFirst);
    expect(formatDate(d, key, ISO_24)).toBe(iso);
  });

  it("the US patterns are DATE_FORMATS, and a US pattern follows the choice like its name", () => {
    for (const key of Object.keys(DATE_FORMATS) as (keyof typeof DATE_FORMATS)[]) {
      expect(datePatternFor(key)).toBe(DATE_FORMATS[key]);
      expect(dateFormatKeyOf(DATE_FORMATS[key])).toBe(key);
      expect(formatDate(d, DATE_FORMATS[key], DAY_FIRST_24)).toBe(formatDate(d, key, DAY_FIRST_24));
    }
  });

  it("mixes the date and time choices freely", () => {
    expect(formatDateTime(d, { date: "us", time: "24h" })).toBe("Oct 7, 2026, 15:45");
    expect(formatDateTime(d, { date: "day_first", time: "12h" })).toBe("7 Oct 2026, 3:45 PM");
    expect(formatDateTime(d, ISO_12)).toBe("2026-10-07 3:45 PM");
    expect(formatTime(new Date(2026, 9, 7, 0, 5), ISO_24)).toBe("00:05");
    expect(formatTime(new Date(2026, 9, 7, 0, 5), US)).toBe("12:05 AM");
  });

  it("leaves a literal pattern as written", () => {
    expect(formatDate(d, "yyyy", DAY_FIRST_24)).toBe("2026");
    expect(formatDate(d, "EEE", ISO_24)).toBe("Wed");
  });

  it("names every form once", () => {
    expect(isDateFormatKey("dayMonth")).toBe(true);
    expect(isDateFormatKey("MMM d")).toBe(false);
    expect(dateFormatKeyOf("MMM d")).toBe("dayMonth");
    expect(dateFormatKeyOf("d")).toBeUndefined();
    expect(DATE_FORMAT_PREFERENCES).toEqual(["us", "day_first", "iso"]);
    expect(TIME_FORMAT_PREFERENCES).toEqual(["12h", "24h"]);
  });
});

describe("helpers under a choice", () => {
  it("short date, month and year", () => {
    expect(formatDateShort(d)).toBe("Oct 7");
    expect(formatDateShort(d, DAY_FIRST_24)).toBe("7 Oct");
    expect(formatDateShort(d, ISO_24)).toBe("10-07");
    expect(formatMonthYear(d, ISO_24)).toBe("2026-10");
  });

  it("hours of the day on a 12- or 24-hour axis", () => {
    expect([0, 9, 12, 15, 23].map((h) => formatHourOfDay(h))).toEqual(["12 AM", "9 AM", "12 PM", "3 PM", "11 PM"]);
    expect([0, 9, 12, 15, 23].map((h) => formatHourOfDay(h, DAY_FIRST_24))).toEqual(["00:00", "09:00", "12:00", "15:00", "23:00"]);
    // Called with a stray second argument from plain JavaScript (Array.map's index): not a choice, so the default holds.
    expect([0, 15].map((h, i) => formatHourOfDay(h, i as never))).toEqual(["12 AM", "3 PM"]);
  });

  it("splits the year off for the top bar", () => {
    expect(formatDateYearParts(d)).toEqual({ lead: "", core: "Oct 7", tail: ", 2026" });
    expect(formatDateYearParts(d, DAY_FIRST_24)).toEqual({ lead: "", core: "7 Oct", tail: " 2026" });
    expect(formatDateYearParts(d, ISO_24)).toEqual({ lead: "2026-", core: "10-07", tail: "" });
    expect(formatDateYearParts("nope")).toEqual({ lead: "", core: "—", tail: "" });
  });

  it("ranges in each format", () => {
    const oct7 = new Date(2026, 9, 7);
    const oct21 = new Date(2026, 9, 21);
    const oct28 = new Date(2026, 9, 28);
    const nov3 = new Date(2026, 10, 3);
    const dec28 = new Date(2026, 11, 28);
    const jan4 = new Date(2027, 0, 4);
    const table: [DateFormatPrefs, string[]][] = [
      [US, ["Oct 7 – 21", "Oct 7 – 21, 2026", "Oct 28 – Nov 3", "Oct 28 – Nov 3, 2026", "Dec 28, 2026 – Jan 4, 2027", "Oct 7", "Oct 7, 2026"]],
      [DAY_FIRST_24, ["7 – 21 Oct", "7 – 21 Oct 2026", "28 Oct – 3 Nov", "28 Oct – 3 Nov 2026", "28 Dec 2026 – 4 Jan 2027", "7 Oct", "7 Oct 2026"]],
      [ISO_24, ["10-07 – 10-21", "2026-10-07 – 2026-10-21", "10-28 – 11-03", "2026-10-28 – 2026-11-03", "2026-12-28 – 2027-01-04", "10-07", "2026-10-07"]],
    ];
    for (const [prefs, want] of table) {
      expect([
        formatDateRange(oct7, oct21, { prefs }),
        formatDateRange(oct7, oct21, { prefs, withYear: true }),
        formatDateRange(oct28, nov3, { prefs }),
        formatDateRange(oct28, nov3, { prefs, withYear: true }),
        formatDateRange(dec28, jan4, { prefs }),
        formatDateRange(oct7, oct7, { prefs }),
        formatDateRange(oct7, oct7, { prefs, withYear: true }),
      ]).toEqual(want);
    }
  });

  it("relative times never change with the choice", () => {
    const now = new Date(2026, 9, 7, 15, 45);
    expect(formatRelative(new Date(now.getTime() - 3 * 60_000), now)).toBe("3 min ago");
    expect(bindFormatters(DAY_FIRST_24).formatDate(now)).toBe("7 Oct 2026");
  });

  it("reads a date-only string as that calendar day, wherever the reader is", () => {
    expect(formatDate("2026-10-07", "date", DAY_FIRST_24)).toBe("7 Oct 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-10-07T15:45:00", "time")).toBe("3:45 PM");
  });
});

describe("normalizeDateFormatPrefs", () => {
  it("keeps known values and defaults the rest", () => {
    expect(normalizeDateFormatPrefs(null)).toBe(DEFAULT_DATE_FORMAT_PREFS);
    expect(normalizeDateFormatPrefs(3)).toBe(DEFAULT_DATE_FORMAT_PREFS);
    expect(normalizeDateFormatPrefs({ date: "us", time: "12h" })).toBe(DEFAULT_DATE_FORMAT_PREFS);
    expect(normalizeDateFormatPrefs({ date: "iso" })).toEqual({ date: "iso", time: "12h" });
    expect(normalizeDateFormatPrefs({ date: "dmy", time: "24h" })).toEqual({ date: "us", time: "24h" });
  });
});

describe("bindFormatters", () => {
  it("binds every helper to one choice and ignores a stray argument", () => {
    const f = bindFormatters(DAY_FIRST_24);
    expect(f.prefs).toEqual(DAY_FIRST_24);
    expect(f.formatDate(d)).toBe("7 Oct 2026");
    expect(f.formatDate(d, "weekdayDate")).toBe("Wed 7 Oct 2026");
    expect(f.formatDate(d, DATE_FORMATS.dayMonth)).toBe("7 Oct");
    expect(f.formatDateShort(d)).toBe("7 Oct");
    expect(f.formatMonthYear(d)).toBe("Oct 2026");
    expect(f.formatTime(d)).toBe("15:45");
    expect(f.formatDateTime(d)).toBe("7 Oct 2026, 15:45");
    expect(f.formatRange(new Date(2026, 9, 7), new Date(2026, 9, 21))).toBe("7 – 21 Oct");
    expect(f.formatHourOfDay(9)).toBe("09:00");
    expect(f.formatDateYearParts(d)).toEqual({ lead: "", core: "7 Oct", tail: " 2026" });
    expect([d].map((x, i) => f.formatDate(x, i as never))).toEqual(["7 Oct 2026"]);
    expect(bindFormatters().formatDateTime(d)).toBe("Oct 7, 2026, 3:45 PM");
  });
});
