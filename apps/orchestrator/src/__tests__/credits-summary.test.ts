/** The summaries of a task held back or stopped by an empty budget (WP-14 T1): they name no top-up, which only the note does where credits can be bought (WP-09 T13). */
import { describe, expect, it } from "vitest";
import { CREDITS_USED_UP_SUMMARY, RESTING_SUMMARY } from "../activities/session-credits";

describe("resting summaries", () => {
  it("say Resting, offer next month's budget and the own key, and name no top-up", () => {
    for (const summary of [RESTING_SUMMARY, CREDITS_USED_UP_SUMMARY]) {
      expect(summary).toMatch(/^Resting: /);
      expect(summary).not.toMatch(/Billing|top-up|Top up|credits are added/);
    }
    expect(RESTING_SUMMARY).toMatch(/your own Anthropic key in Settings › Keys/);
  });
});
