import { describe, expect, it } from "vitest";
import { VestingSchedule, parseVestingLength, readVesting } from "./vesting";

describe("VestingSchedule", () => {
  it("takes months, a cliff and a start date", () => {
    expect(VestingSchedule.parse({ months: 48, cliffMonths: 12, startDate: "2026-03-25" })).toEqual({ months: 48, cliffMonths: 12, startDate: "2026-03-25" });
    expect(VestingSchedule.parse({ months: 24 })).toMatchObject({ months: 24, cliffMonths: 0 });
    expect(VestingSchedule.parse({ months: 48, cliffMonths: 12, acceleration: "double-trigger" }).acceleration).toBe("double-trigger");
  });

  it("refuses the shapes the seed used to write and schedules that cannot work", () => {
    expect(VestingSchedule.safeParse({ schedule: "4y", startsAt: "2026-03-25", cliffMonths: 12 }).success).toBe(false);
    expect(VestingSchedule.safeParse({ months: 12, cliffMonths: 24 }).success).toBe(false);
    expect(VestingSchedule.safeParse({ months: 0 }).success).toBe(false);
    expect(VestingSchedule.safeParse({ months: 48, startDate: "25/03/2026" }).success).toBe(false);
  });
});

describe("parseVestingLength", () => {
  it("reads years and months written the ways people write them", () => {
    expect(parseVestingLength("4y")).toBe(48);
    expect(parseVestingLength("4 years")).toBe(48);
    expect(parseVestingLength("1.5y")).toBe(18);
    expect(parseVestingLength("48m")).toBe(48);
    expect(parseVestingLength("18 months")).toBe(18);
    expect(parseVestingLength("18")).toBe(18);
    expect(parseVestingLength(36)).toBe(36);
    expect(parseVestingLength("soon")).toBeNull();
    expect(parseVestingLength(null)).toBeNull();
  });
});

describe("readVesting", () => {
  it("reads the shared shape, the old seed shape and the older loose keys", () => {
    expect(readVesting({ months: 48, cliffMonths: 12, startDate: "2025-10-01" })).toEqual({ months: 48, cliffMonths: 12, startDate: "2025-10-01" });
    expect(readVesting({ schedule: "4y", startsAt: "2026-03-25", cliffMonths: 12 })).toEqual({ months: 48, cliffMonths: 12, startDate: "2026-03-25" });
    expect(readVesting({ totalMonths: 36, cliff: 6, start: "2026-01-01T00:00:00Z" })).toEqual({ months: 36, cliffMonths: 6, startDate: "2026-01-01" });
  });

  it("falls back to the issue date for a start, and to a 4-year schedule with a 1-year cliff", () => {
    expect(readVesting({ schedule: "4y" }, "2024-10-17")).toEqual({ months: 48, cliffMonths: 12, startDate: "2024-10-17" });
    expect(readVesting({}, null)).toEqual({ months: 48, cliffMonths: 12, startDate: null });
    expect(readVesting({ months: 6 }, "2026-01-01")).toMatchObject({ months: 6, cliffMonths: 6 }); // the cliff never outlasts the schedule
  });

  it("has nothing to read for an entry without vesting", () => {
    expect(readVesting(null)).toBeNull();
    expect(readVesting(undefined, "2026-01-01")).toBeNull();
  });
});
