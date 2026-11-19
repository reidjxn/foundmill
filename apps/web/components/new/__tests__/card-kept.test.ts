import { describe, expect, it } from "vitest";
import { CARD_KEPT_WORDS } from "../card/CardKeptView";

describe("the kept card (WP-02 T6, WP-04 T1)", () => {
  it("claims no checking against real sources until that check exists (WP-00 S6, WP-05)", () => {
    expect(CARD_KEPT_WORDS.lede).toBe("It is saved in your account. Your team starts from your own words.");
    expect(CARD_KEPT_WORDS.lede).not.toMatch(/real sources|checks/);
  });

  it("names the next step as the first profile, and says why in a sentence a first-timer can use", () => {
    expect(CARD_KEPT_WORDS.profileNext).toBe("Tell your team about you");
    expect(CARD_KEPT_WORDS.profileWhy).toBe("So your team knows what to call you and what you like doing. It takes under a minute.");
  });
});
