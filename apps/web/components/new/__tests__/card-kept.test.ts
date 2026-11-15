import { describe, expect, it } from "vitest";
import { CARD_KEPT_WORDS } from "../card/CardKeptView";

describe("the kept card (WP-02 T6)", () => {
  it("claims no checking against real sources until that check exists (WP-00 S6, WP-05)", () => {
    expect(CARD_KEPT_WORDS.lede).toBe("It is saved in your deck. Your team starts from your words.");
  });
});
