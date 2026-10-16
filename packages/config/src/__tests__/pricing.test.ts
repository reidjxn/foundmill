import { describe, expect, it } from "vitest";
import { CREDITS_CURRENCY, higherTier, includedCreditsMinor, initialModelBilling, sandboxCostMicroMinor, SANDBOX_MICRO_MINOR_PER_SECOND, TIER_ORDER, TIERS, tierBusinessLimit, tierIncludedCreditPlaces } from "../pricing";

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

  it("no business limit on any plan until paid plans launch (founder, 2026-10-16); the included-credit pool keeps its size", () => {
    for (const tier of TIER_ORDER) {
      expect(TIERS[tier].businesses).toBe("unlimited");
      expect(tierBusinessLimit(tier)).toBeNull();
    }
    // The founder's monthly pool of included credits (SEC2 S6) is its own number, so more businesses never mean more free credits.
    expect(tierIncludedCreditPlaces("free")).toBe(1);
    expect(tierIncludedCreditPlaces("pro")).toBe(3);
    expect(tierIncludedCreditPlaces("scale")).toBeNull();
  });

  it("states the free tier's other limits: four agents at once, one seat", () => {
    expect(TIERS.free).toMatchObject({ maxConcurrentAgents: 4, seats: 1 });
  });

  it("orders tiers from free to scale", () => {
    expect(TIER_ORDER).toEqual(["free", "pro", "scale"]);
    expect(higherTier("free", "pro")).toBe("pro");
    expect(higherTier("scale", "pro")).toBe("scale");
    expect(higherTier("free", "free")).toBe("free");
  });
});

describe("sandbox time (audit BILL-11, O-32)", () => {
  it("an E2B sandbox is priced per second at its list prices: 2 vCPU and 512 MiB, about $0.11 an hour (Estimate)", () => {
    // $0.000014 per vCPU-second x 2 + $0.0000045 per GiB-second x 0.5 = $0.00003025 a second = 3,025 millionths of a cent.
    expect(SANDBOX_MICRO_MINOR_PER_SECOND.e2b).toBe(3_025);
    expect(sandboxCostMicroMinor("e2b", 3_600_000)).toBe(10_890_000);
    expect(Math.round(sandboxCostMicroMinor("e2b", 3_600_000) / 1_000_000)).toBe(11);
    expect(sandboxCostMicroMinor("e2b", 150_000)).toBe(453_750);
  });

  it("a Docker sandbox runs on the platform's own host and a replay runs nowhere: both cost nothing; time never goes negative", () => {
    expect(sandboxCostMicroMinor("docker", 3_600_000)).toBe(0);
    expect(sandboxCostMicroMinor("mock", 3_600_000)).toBe(0);
    expect(sandboxCostMicroMinor("e2b", -5)).toBe(0);
  });
});
