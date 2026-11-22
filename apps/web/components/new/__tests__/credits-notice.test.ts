import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { creditsNoticeOf } from "../commit/credits-notice";

const day = (d: Date | string) => formatDate(d);
const pool = { monthlyMinor: 500, remainingMinor: 0, nextGrantAt: new Date("2026-11-01T00:00:00Z") };

describe("creditsNoticeOf (Commit)", () => {
  it("says nothing while the shared team budget still has something in it", () => {
    expect(creditsNoticeOf(undefined, day)).toBeNull();
    expect(creditsNoticeOf({ ...pool, remainingMinor: 1 }, day)).toBeNull();
    expect(creditsNoticeOf({ ...pool, monthlyMinor: 0 }, day)).toBeNull();
  });

  it("says the new project starts resting once the month's budget is used, and what to do", () => {
    expect(creditsNoticeOf(pool, day)).toBe(`This month's team budget ($5.00) is already used by your other projects, so this one starts resting. Add your own Anthropic key in Settings › Keys to run it now, or wait for next month's budget on ${day(pool.nextGrantAt)}.`);
  });
});
