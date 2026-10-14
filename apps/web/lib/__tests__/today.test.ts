import { describe, expect, it } from "vitest";
import { dateOfDayKey, localDayKey, timeZoneToClaim, todayKey } from "../today";

describe("today in the business's time zone (audit #196)", () => {
  it("names the business's day once it has a zone, the browser's before that", () => {
    const at = new Date("2026-10-11T21:12:00Z");
    expect(todayKey(at, "Asia/Tokyo")).toBe("2026-10-12");
    expect(todayKey(at, "America/Los_Angeles")).toBe("2026-10-11");
    expect(todayKey(at, null)).toBe(localDayKey(at));
    expect(todayKey(at, "Mars/Olympus")).toBe(localDayKey(at));
  });

  it("claims the browser's zone for a business without one, only for an owner or admin", () => {
    expect(timeZoneToClaim(null, "owner", "America/New_York")).toBe("America/New_York");
    expect(timeZoneToClaim(null, "admin", "Europe/Berlin")).toBe("Europe/Berlin");
    expect(timeZoneToClaim(null, "member", "America/New_York")).toBeNull();
    expect(timeZoneToClaim("Asia/Tokyo", "owner", "America/New_York")).toBeNull();
    expect(timeZoneToClaim(null, "owner", null)).toBeNull();
  });
});

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
