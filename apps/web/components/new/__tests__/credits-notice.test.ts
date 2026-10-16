import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { creditsNoticeOf } from "../commit/credits-notice";

const day = (d: Date | string) => formatDate(d);
const pool = { places: 1, taken: 1, nextGrantAt: new Date("2026-11-01T00:00:00Z"), amountMinor: 500 };

describe("creditsNoticeOf (Commit, SEC2 S6)", () => {
  it("says nothing while the new business gets its included credits", () => {
    expect(creditsNoticeOf(undefined, day)).toBeNull();
    expect(creditsNoticeOf({ ...pool, places: null }, day)).toBeNull();
    expect(creditsNoticeOf({ ...pool, taken: 0 }, day)).toBeNull();
  });

  it("says the team starts paused once the month's pool is used, and what to do", () => {
    expect(creditsNoticeOf(pool, day)).toBe("This month's included credits ($5.00) already went to another business you took charge of, so this one starts with its team paused. Add your own Anthropic key in Settings › Keys to run it now, or wait for next month's credits on Nov 1, 2026.");
    expect(creditsNoticeOf({ ...pool, places: 3, taken: 3 }, day)).toMatch(/already went to 3 other businesses you took charge of/);
  });
});
