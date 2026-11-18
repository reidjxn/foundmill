/** The summary of a session stopped at zero credits (WP-09 T13): a top-up is named only where credits can be bought. */
import { describe, expect, it } from "vitest";
import { CREDITS_USED_UP_SUMMARY, creditsUsedUpSummary } from "../activities/session-credits";

describe("creditsUsedUpSummary", () => {
  it("names credits first where they can be bought, and always the own key and next month's credits", () => {
    expect(creditsUsedUpSummary(true)).toMatch(/after credits are added in Settings › Billing, with your own Anthropic key in Settings › Keys, or with next month's credits\.$/);
    expect(creditsUsedUpSummary(false)).toMatch(/with your own Anthropic key in Settings › Keys or with next month's credits\.$/);
    expect(creditsUsedUpSummary(false)).not.toMatch(/Billing|top-up|Top up/);
  });

  it("the constant a caller uses without knowing names no top-up", () => {
    expect(CREDITS_USED_UP_SUMMARY).toBe(creditsUsedUpSummary(false));
  });
});
