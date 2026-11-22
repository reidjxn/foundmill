import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKLY_HOURS, bookingTimeLabel, busyRangeOf, durationLabel, instantOfWallTime, isOfferedSlot, minutesLabel, slotStarts, weeklyHoursProblem, type WeeklyHours } from "./booking";

const HOUR = { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, minNoticeMin: 0, maxDaysAhead: 60 };
const EVERY_DAY_9_TO_5: WeeklyHours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: 540, end: 1020 }]]));
const utc = (iso: string) => new Date(`${iso}Z`);
const local = (starts: Date[], zone: string) => starts.map((s) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(s));

describe("wall time to instant", () => {
  it("reads a wall time in the zone's offset for that day", () => {
    expect(instantOfWallTime("2026-07-01", 540, "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(instantOfWallTime("2026-12-01", 540, "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(instantOfWallTime("2026-07-01", 540, "Europe/Berlin")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(instantOfWallTime("2026-07-01", 540, "Asia/Kolkata")?.toISOString()).toBe("2026-07-01T03:30:00.000Z");
  });

  it("a time the spring change skips does not exist; the fall's repeated time gives the first", () => {
    // US: Mar 8, 2026, 2:00 AM jumps to 3:00 AM. Nov 1, 2026, 2:00 AM falls back to 1:00 AM.
    expect(instantOfWallTime("2026-03-08", 150, "America/New_York")).toBeNull();
    expect(instantOfWallTime("2026-03-08", 210, "America/New_York")?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(instantOfWallTime("2026-11-01", 90, "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // Europe: Mar 29, 2026, 2:00 AM jumps to 3:00 AM. Oct 25, 2026, 3:00 AM falls back to 2:00 AM.
    expect(instantOfWallTime("2026-03-29", 150, "Europe/Berlin")).toBeNull();
    expect(instantOfWallTime("2026-10-25", 150, "Europe/Berlin")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("slots", () => {
  it("offers the founder's hours as the founder's clock reads them, every 30 minutes, ending inside the hours", () => {
    const slots = slotStarts({ service: HOUR, hours: DEFAULT_WEEKLY_HOURS, timeZone: "America/Chicago", busy: [], now: utc("2026-11-23T00:00:00"), from: utc("2026-11-23T00:00:00"), to: utc("2026-11-24T05:59:00") });
    const shown = local(slots, "America/Chicago");
    expect(shown[0]).toBe("11/23, 09:00");
    expect(shown.at(-1)).toBe("11/23, 16:00");
    expect(slots).toHaveLength(15);
  });

  it.each([
    ["the US spring change", "America/New_York", "2026-03-06", "2026-03-10"],
    ["the US fall change", "America/New_York", "2026-10-30", "2026-11-03"],
    ["the European spring change", "Europe/Berlin", "2026-03-27", "2026-03-31"],
    ["the European fall change", "Europe/Berlin", "2026-10-23", "2026-10-27"],
  ])("across %s no slot moves on the founder's clock and none doubles", (_name, zone, from, to) => {
    const slots = slotStarts({ service: { ...HOUR, maxDaysAhead: 400 }, hours: EVERY_DAY_9_TO_5, timeZone: zone, busy: [], now: utc("2026-01-01T00:00:00"), from: utc(`${from}T00:00:00`), to: utc(`${to}T23:59:00`) });
    expect(new Set(slots.map((s) => s.getTime())).size).toBe(slots.length);
    const byDay = new Map<string, string[]>();
    for (const label of local(slots, zone)) {
      const [day, time] = label.split(", ") as [string, string];
      byDay.set(day, [...(byDay.get(day) ?? []), time]);
    }
    // Every full day in the range has the same fifteen starts, 9:00 AM to 4:00 PM, on the founder's clock.
    const full = [...byDay.values()].filter((times) => times.length === 15);
    expect(full.length).toBeGreaterThanOrEqual(4);
    for (const times of full) {
      expect(times[0]).toBe("09:00");
      expect(times.at(-1)).toBe("16:00");
    }
    expect([...byDay.values()].every((times) => times.length <= 15)).toBe(true);
  });

  it("hours that include a skipped or repeated hour offer no slot twice and none that does not exist", () => {
    const night: WeeklyHours = { "0": [{ start: 0, end: 300 }] };
    const spring = slotStarts({ service: HOUR, hours: night, timeZone: "America/New_York", busy: [], now: utc("2026-03-01T00:00:00"), from: utc("2026-03-08T00:00:00"), to: utc("2026-03-08T12:00:00") });
    expect(local(spring, "America/New_York").map((l) => l.split(", ")[1])).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00"]);
    const fall = slotStarts({ service: HOUR, hours: night, timeZone: "America/New_York", busy: [], now: utc("2026-10-25T00:00:00"), from: utc("2026-11-01T00:00:00"), to: utc("2026-11-01T12:00:00") });
    expect(new Set(fall.map((s) => s.getTime())).size).toBe(fall.length);
    expect(local(fall, "America/New_York").map((l) => l.split(", ")[1])).toEqual(["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30", "04:00"]);
  });

  it("never offers a time that overlaps a booking with its buffers, or the founder's calendar", () => {
    const service = { ...HOUR, bufferBeforeMin: 15, bufferAfterMin: 15 };
    const booked = busyRangeOf(service, utc("2026-11-23T16:00:00"));
    const calendar = { start: utc("2026-11-23T20:00:00"), end: utc("2026-11-23T21:00:00") };
    const slots = slotStarts({ service, hours: DEFAULT_WEEKLY_HOURS, timeZone: "America/Chicago", busy: [booked, calendar], now: utc("2026-11-23T00:00:00"), from: utc("2026-11-23T00:00:00"), to: utc("2026-11-24T05:59:00") });
    const shown = local(slots, "America/Chicago").map((l) => l.split(", ")[1]);
    // Booked 10:00 to 11:00 with 15 minutes each side; the calendar is busy 2:00 PM to 3:00 PM.
    expect(shown).toEqual(["11:30", "12:00", "12:30", "15:30", "16:00"]);
    expect(isOfferedSlot({ service, hours: DEFAULT_WEEKLY_HOURS, timeZone: "America/Chicago", busy: [booked, calendar], now: utc("2026-11-23T00:00:00") }, utc("2026-11-23T16:00:00"))).toBe(false);
    expect(isOfferedSlot({ service, hours: DEFAULT_WEEKLY_HOURS, timeZone: "America/Chicago", busy: [booked, calendar], now: utc("2026-11-23T00:00:00") }, utc("2026-11-23T17:30:00"))).toBe(true);
  });

  it("keeps the notice and how far ahead a service can be booked", () => {
    const service = { ...HOUR, minNoticeMin: 24 * 60, maxDaysAhead: 2 };
    const slots = slotStarts({ service, hours: EVERY_DAY_9_TO_5, timeZone: "UTC", busy: [], now: utc("2026-11-23T10:00:00"), from: utc("2026-11-23T00:00:00"), to: utc("2026-12-23T00:00:00") });
    expect(slots[0]!.toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(slots.at(-1)!.toISOString()).toBe("2026-11-25T10:00:00.000Z");
  });
});

describe("words and checks", () => {
  it("writes times in US English in the reader's zone", () => {
    expect(bookingTimeLabel(utc("2026-10-07T20:45:00"), "America/New_York")).toBe("Wed, Oct 7, 4:45 PM EDT");
    expect(minutesLabel(540)).toBe("9:00 AM");
    expect(minutesLabel(0)).toBe("12:00 AM");
    expect(minutesLabel(765)).toBe("12:45 PM");
    expect(durationLabel(90)).toBe("1 hour 30 minutes");
    expect(durationLabel(45)).toBe("45 minutes");
  });

  it("refuses hours that overlap, run backward or name no weekday", () => {
    expect(weeklyHoursProblem(DEFAULT_WEEKLY_HOURS)).toBeNull();
    expect(weeklyHoursProblem({ "1": [{ start: 600, end: 540 }] })).toMatch(/start before they end/);
    expect(weeklyHoursProblem({ "1": [{ start: 540, end: 720 }, { start: 660, end: 900 }] })).toMatch(/overlap/);
    expect(weeklyHoursProblem({ "7": [] })).toMatch(/not valid/);
  });
});
