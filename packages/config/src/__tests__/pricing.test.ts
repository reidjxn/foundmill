import { describe, expect, it } from "vitest";
import { CREDITS_CURRENCY, FIRST_CYCLE_SESSION_CAP_MINOR, firstCycleInput, higherTier, includedCreditsMinor, initialModelBilling, sandboxCostMicroMinor, SANDBOX_MICRO_MINOR_PER_SECOND, TIER_ORDER, TIERS, tierBusinessLimit, tierShowsBuiltOnMark, tierSeatLimit, tierIncludedCreditPlaces } from "../pricing";

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

  it("states the free tier's other limit, four agents at once; people are free on every plan", () => {
    expect(TIERS.free).toMatchObject({ maxConcurrentAgents: 4, seats: "unlimited" });
    for (const tier of TIER_ORDER) expect(tierSeatLimit(tier)).toBeNull();
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

  it("only the free plan carries the 'Built on' mark; every paid plan removes it", () => {
    expect(tierShowsBuiltOnMark("free")).toBe(true);
    expect(TIER_ORDER.filter((t) => t !== "free").map(tierShowsBuiltOnMark)).toEqual([false, false]);
  });
});

describe("the first round of a free project (WP-09 T11, founder D6)", () => {
  it("runs one session at a time under a 75-cent cap (Estimate) on the free plan's credits", () => {
    expect(FIRST_CYCLE_SESSION_CAP_MINOR).toBe(75);
    expect(firstCycleInput({ modelBilling: "credits", tier: "free" })).toEqual({ budgetCapMinor: 75, maxConcurrent: 1 });
  });

  it("leaves a project on its own key or a paid plan as today", () => {
    expect(firstCycleInput({ modelBilling: "byok", tier: "free" })).toEqual({});
    expect(firstCycleInput({ modelBilling: "credits", tier: "pro" })).toEqual({});
    expect(firstCycleInput({ modelBilling: "credits", tier: "scale" })).toEqual({});
  });
});

describe("who pays for a model call (WP-13)", () => {
  it("puts everyone not on a paid plan on the free plan, a business on its own key on that key, and a paid plan on every model", async () => {
    const { modelFundingFor, tierIsPaid } = await import("../pricing");
    expect(tierIsPaid("free")).toBe(false);
    expect(tierIsPaid("pro")).toBe(true);
    expect(tierIsPaid("scale")).toBe(true);
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits" })).toBe("free_plan");
    expect(modelFundingFor({ planTier: "free", modelBilling: "byok" })).toBe("own_key");
    expect(modelFundingFor({ planTier: "pro", modelBilling: "credits" })).toBe("paid_plan");
    expect(modelFundingFor({ planTier: "pro", modelBilling: "byok" })).toBe("own_key");
    expect(modelFundingFor({ planTier: null, modelBilling: null })).toBe("free_plan");
  });
});

describe("credit packs (founder, Nov 17, 2026)", () => {
  it("add their price plus a bonus that grows with the pack, never less than they cost", async () => {
    const { CREDIT_PACKS_MINOR, creditPackCreditsMinor } = await import("../pricing");
    expect(CREDIT_PACKS_MINOR.map((p) => creditPackCreditsMinor(p))).toEqual([2000, 5250, 11000, 28750, 60000]);
    expect(creditPackCreditsMinor(1000)).toBeNull();
  });
});

