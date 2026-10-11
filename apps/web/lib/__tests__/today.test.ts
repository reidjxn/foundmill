import { describe, expect, it } from "vitest";
import { dateOfDayKey, localDayKey } from "../today";

describe("today in the founder's time zone", () => {
  it("names the local calendar day, zero-padded", () => {
    expect(localDayKey(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
    expect(localDayKey(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("turns a day key back into local noon of that day, so formatting it never slips a day", () => {
    const d = dateOfDayKey("2026-10-10");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 10, 12]);
    expect(localDayKey(d)).toBe("2026-10-10");
  });
});
