/** The channel window is the 35 days every screen labels "last 35 days", today included (never 36). */
import { describe, expect, it } from "vitest";
import { CHANNEL_WINDOW_DAYS } from "@foundmill/shared";
import { channelWindow } from "../routers/distribution";

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

describe("channelWindow", () => {
  it("covers exactly CHANNEL_WINDOW_DAYS calendar days, both ends included", () => {
    const w = channelWindow(new Date("2026-10-12T15:00:00Z"));
    expect(w).toEqual({ from: "2026-09-08", to: "2026-10-12" });
    expect(days(w.from, w.to)).toBe(CHANNEL_WINDOW_DAYS);
    expect(CHANNEL_WINDOW_DAYS).toBe(35);
  });
  it("holds across a month boundary and just after midnight UTC", () => {
    const w = channelWindow(new Date("2026-03-01T00:05:00Z"));
    expect(w.to).toBe("2026-03-01");
    expect(days(w.from, w.to)).toBe(CHANNEL_WINDOW_DAYS);
  });
  it("ends on the business's today in its time zone (audit #196), still 35 days", () => {
    // 21:12 UTC on Oct 11 is already Oct 12 in Tokyo, still Oct 11 in Los Angeles.
    const at = new Date("2026-10-11T21:12:00Z");
    expect(channelWindow(at, "Asia/Tokyo")).toEqual({ from: "2026-09-08", to: "2026-10-12" });
    expect(channelWindow(at, "America/Los_Angeles")).toEqual({ from: "2026-09-07", to: "2026-10-11" });
    expect(days(channelWindow(at, "Asia/Tokyo").from, channelWindow(at, "Asia/Tokyo").to)).toBe(CHANNEL_WINDOW_DAYS);
  });
});
