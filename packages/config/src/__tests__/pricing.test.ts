import { describe, expect, it } from "vitest";
import { CREDITS_CURRENCY, higherTier, includedCreditsMinor, initialModelBilling, TIER_ORDER, TIERS, tierBusinessLimit } from "../pricing";

describe("pricing tiers (BUILD §10.5)", () => {
  it("keeps credits in US dollars and includes a bounded platform credit on every tier", () => {
    expect(CREDITS_CURRENCY).toBe("USD");
    expect(includedCreditsMinor("free")).toBe(500);
    // A paid tier whose size is still an open decision never includes less than the free tier.
    for (const tier of TIER_ORDER) {
      expect(Number.isInteger(includedCreditsMinor(tier))).toBe(true);
      expect(includedCreditsMinor(tier)).toBeGreaterThanOrEqual(includedCreditsMinor("free"));
    }
  });

  it("starts every tier on its included credits (a key moves a business to byok later)", () => {
    for (const tier of TIER_ORDER) expect(initialModelBilling(tier)).toBe("credits");
  });

  it("states the free tier's limits: one business, four agents at once, one seat", () => {
    expect(TIERS.free).toMatchObject({ businesses: 1, maxConcurrentAgents: 4, seats: 1 });
    expect(tierBusinessLimit("free")).toBe(1);
    expect(tierBusinessLimit("pro")).toBe(3);
    expect(tierBusinessLimit("scale")).toBeNull();
  });

  it("orders tiers from free to scale", () => {
    expect(TIER_ORDER).toEqual(["free", "pro", "scale"]);
    expect(higherTier("free", "pro")).toBe("pro");
    expect(higherTier("scale", "pro")).toBe("scale");
    expect(higherTier("free", "free")).toBe("free");
  });
});
