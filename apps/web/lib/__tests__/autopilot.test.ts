import { describe, expect, it } from "vitest";
import { CADENCE_OPTIONS, HOUR_OPTIONS, cyclesTodayLine, draftChanged, draftOf, hourLabel, parseDraft } from "../autopilot";

const SAVED = { cadence: "every_4h" as const, dailyHour: 9, maxCyclesPerDay: 6, spendCeilingMinor: null, maxIdleCycles: 3 };

describe("Autopilot settings draft", () => {
  it("offers the five cadences the brief names, every third day (the overnight shift, WP-09 T12), and 24 UTC hours", () => {
    expect(CADENCE_OPTIONS.map((o) => o.label)).toEqual(["As soon as the last cycle ends", "Every hour", "Every 4 hours", "Every 12 hours", "Daily", "Every third day"]);
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(hourLabel(0)).toBe("12:00 AM UTC");
    expect(hourLabel(9)).toBe("9:00 AM UTC");
    expect(hourLabel(12)).toBe("12:00 PM UTC");
    expect(hourLabel(15)).toBe("3:00 PM UTC");
  });

  it("round-trips the saved settings", () => {
    const d = draftOf({ ...SAVED, spendCeilingMinor: 1250 });
    expect(d).toEqual({ cadence: "every_4h", dailyHour: "9", maxCyclesPerDay: "6", spendCeiling: "12.5", maxIdleCycles: "3", ownMaxCyclesPerDay: "", ownSpendCeiling: "" });
    expect(parseDraft(d)).toEqual({ ok: true, change: { ...SAVED, spendCeilingMinor: 1250, ownMaxCyclesPerDay: null, ownSpendCeilingMinor: null } });
    expect(draftChanged(d, { ...SAVED, spendCeilingMinor: 1250 })).toBe(false);
  });

  it("limits cycles per day to 1 to 24 and idle cycles to 1 to 10", () => {
    const base = draftOf(SAVED);
    for (const bad of ["0", "25", "-1", "2.5", "six", ""]) expect(parseDraft({ ...base, maxCyclesPerDay: bad })).toMatchObject({ ok: false, errors: { maxCyclesPerDay: expect.stringContaining("1 to 24") } });
    for (const good of ["1", "24"]) expect(parseDraft({ ...base, maxCyclesPerDay: good }).ok).toBe(true);
    for (const bad of ["0", "11", "x"]) expect(parseDraft({ ...base, maxIdleCycles: bad })).toMatchObject({ ok: false, errors: { maxIdleCycles: expect.stringContaining("1 to 10") } });
  });

  it("reads the ceiling in dollars; empty means the credits left", () => {
    const base = draftOf(SAVED);
    expect(parseDraft({ ...base, spendCeiling: "" })).toMatchObject({ ok: true, change: { spendCeilingMinor: null } });
    expect(parseDraft({ ...base, spendCeiling: "5" })).toMatchObject({ ok: true, change: { spendCeilingMinor: 500 } });
    expect(parseDraft({ ...base, spendCeiling: "1,250.40" })).toMatchObject({ ok: true, change: { spendCeilingMinor: 125_040 } });
    expect(parseDraft({ ...base, spendCeiling: "lots" })).toMatchObject({ ok: false, errors: { spendCeiling: expect.any(String) } });
  });

  it("only counts the hour as a change for the daily cadence", () => {
    const d = draftOf(SAVED);
    expect(draftChanged({ ...d, dailyHour: "14" }, SAVED)).toBe(false);
    expect(draftChanged({ ...d, cadence: "daily", dailyHour: "14" }, SAVED)).toBe(true);
    expect(draftChanged({ ...d, maxCyclesPerDay: "7" }, SAVED)).toBe(true);
    expect(draftChanged({ ...d, maxCyclesPerDay: "99" }, SAVED)).toBe(true);
  });

  it("says how many cycles ran today", () => {
    expect(cyclesTodayLine(2, 6)).toBe("2 of 6 cycles today");
    expect(cyclesTodayLine(0, 1)).toBe("0 of 1 cycle today");
  });
});

describe("Autopilot's own limits in the draft (0084)", () => {
  it("reads and parses its own cycles and dollars, empty meaning none", () => {
    const d = draftOf({ ...SAVED, ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 });
    expect(d).toMatchObject({ ownMaxCyclesPerDay: "1", ownSpendCeiling: "0.15" });
    expect(parseDraft(d)).toMatchObject({ ok: true, change: { ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 } });
    expect(parseDraft({ ...d, ownMaxCyclesPerDay: "", ownSpendCeiling: "" })).toMatchObject({ ok: true, change: { ownMaxCyclesPerDay: null, ownSpendCeilingMinor: null } });
    expect(parseDraft({ ...d, ownMaxCyclesPerDay: "30" })).toMatchObject({ ok: false, errors: { ownMaxCyclesPerDay: expect.any(String) } });
    expect(draftChanged({ ...d, ownSpendCeiling: "0.25" }, { ...SAVED, ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 })).toBe(true);
    expect(draftChanged(d, { ...SAVED, ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 })).toBe(false);
  });
});
