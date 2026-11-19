/** The business day (audit #196): one zone for Home's "today", the Journey's rows and the top bar. */
import { describe, expect, it } from "vitest";
import { businessTimeZone, dayHourIn, dayKeyIn, dayRangeIn, isValidTimeZone, startOfDayIn, timeZoneLabel, timeZoneNames } from "./time-zone";

describe("business time zone", () => {
  it("reads the day in the business's zone: 21:12 UTC on Oct 11 is Oct 12 in Tokyo, still Oct 11 in UTC", () => {
    const at = new Date("2026-10-11T21:12:00Z");
    expect(dayKeyIn(at, "Asia/Tokyo")).toBe("2026-10-12");
    expect(dayKeyIn(at, "UTC")).toBe("2026-10-11");
    // A project in Los Angeles at 11:30 PM on Oct 11 is still on Oct 11, when UTC is already Oct 12 (WP-10 T12, Milestones).
    expect(dayKeyIn(new Date("2026-10-12T06:30:00Z"), "America/Los_Angeles")).toBe("2026-10-11");
    expect(dayKeyIn(new Date("2026-10-12T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-11");
  });

  it("places an instant on the zone's day and hour (a heatmap cell)", () => {
    expect(dayHourIn(new Date("2026-10-11T21:12:00Z"), "Asia/Tokyo")).toEqual({ day: "2026-10-12", hour: 6 });
    expect(dayHourIn(new Date("2026-10-11T21:12:00Z"), null)).toEqual({ day: "2026-10-11", hour: 21 });
    expect(dayHourIn(new Date("2026-10-12T00:30:00Z"), "America/New_York")).toEqual({ day: "2026-10-11", hour: 20 });
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(businessTimeZone(null)).toBe("UTC");
    expect(businessTimeZone("Mars/Olympus")).toBe("UTC");
    expect(dayKeyIn(new Date("2026-10-11T21:12:00Z"), null)).toBe("2026-10-11");
  });

  it("finds the instant a day starts and ends in the zone, across a DST change", () => {
    expect(startOfDayIn("2026-10-12", "Asia/Tokyo").toISOString()).toBe("2026-10-11T15:00:00.000Z");
    expect(startOfDayIn("2026-10-12", "America/Los_Angeles").toISOString()).toBe("2026-10-12T07:00:00.000Z");
    // London moves from BST to GMT on Oct 25, 2026.
    expect(startOfDayIn("2026-10-25", "Europe/London").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(startOfDayIn("2026-10-26", "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(dayRangeIn("2026-10-12", "2026-10-12", "Asia/Tokyo")).toEqual({ from: new Date("2026-10-11T15:00:00.000Z"), to: new Date("2026-10-12T14:59:59.999Z") });
  });
});

describe("time zone picker", () => {
  it("lists UTC first and then every zone the runtime knows, each one valid", () => {
    const names = timeZoneNames();
    expect(names[0]).toBe("UTC");
    expect(names.filter((z) => z === "UTC")).toHaveLength(1);
    expect(names).toContain("America/New_York");
    expect(names.every(isValidTimeZone)).toBe(true);
  });

  it("reads a zone with spaces for underscores", () => {
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos Aires");
  });
});
