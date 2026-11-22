import { describe, expect, it } from "vitest";
import { CREDIT_PACK_UNLOCK_MIN_MINOR, CREDITS_CURRENCY, EARLY_ACCESS_PRICE_LABEL, EARLY_ACCESS_STAGE, ENTRY_PLAN, indicativePricesFor, INVITED_FOUNDERS_LINE, listPriceMinor, PARTNER_PLAN, PLAN_FEATURE_FROM, PLAN_FEATURES, planAdds, planFor, planIncludes, planName, planPriceLabel, planWithRoomFor, PRICE_SETS, PRICE_TEST, subscriptionChargeMinor, subscriptionChargingOpen, tierForInvited, FIRST_CYCLE_SESSION_CAP_MINOR, firstCycleInput, higherTier, includedCreditsMinor, initialModelBilling, sandboxCostMicroMinor, SANDBOX_MICRO_MINOR_PER_SECOND, TIER_ORDER, TIERS, tierBusinessLimit, tierShowsBuiltOnMark, tierSeatLimit } from "../pricing";

describe("pricing tiers (BUILD §10.5)", () => {
  it("keeps credits in US dollars and includes a bounded platform credit on every tier", () => {
    expect(CREDITS_CURRENCY).toBe("USD");
    // The month's team budget (founder, Nov 17, 2026, A15): Try $5.00, Founder $10.00, Studio $50.00.
    expect(TIER_ORDER.map(includedCreditsMinor)).toEqual([500, 1000, 5000]);
  });

  it("starts every tier on its included credits (a key moves a business to byok later)", () => {
    for (const tier of TIER_ORDER) expect(initialModelBilling(tier)).toBe("credits");
  });

  it("a plan limits projects, not people: Try 1, Founder up to 5, Studio any number, at every stage (A14; founder, Nov 19, 2026)", () => {
    expect(TIER_ORDER.map(tierBusinessLimit)).toEqual([1, 5, null]);
    // The plan a refusal names: the lowest one with room for another.
    expect(planWithRoomFor("free", 1)).toBe("pro");
    expect(planWithRoomFor("free", 5)).toBe("scale");
    expect(planWithRoomFor("pro", 5)).toBe("scale");
    expect(planWithRoomFor("scale", 40)).toBeNull();
  });

  it("Studio adds more agents at once; Try and Founder run four; people are free on every plan", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].maxConcurrentAgents)).toEqual([4, 4, 64]);
    for (const tier of TIER_ORDER) expect(TIERS[tier].seats).toBe("unlimited");
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

describe("the reserve before a session starts (WP-14 T1)", () => {
  it("is the larger of the minimum and the type's recent average times the safety factor", async () => {
    const { SESSION_RESERVE, sessionReserveMinor } = await import("../pricing");
    expect(SESSION_RESERVE).toEqual({ minMinor: 10, safetyFactor: 1.5, sampleSessions: 20, backstopCeilingMinor: 50 });
    expect(sessionReserveMinor(null)).toBe(10);
    expect(sessionReserveMinor(0.68)).toBe(10);
    expect(sessionReserveMinor(14)).toBe(21);
    expect(sessionReserveMinor(15)).toBe(23);
    expect(sessionReserveMinor(-4)).toBe(10);
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

  it("Try reaches Opus and Sonnet by a credit pack only from the day sign-up opens, or by the founder's own key on any day (A15, A16)", async () => {
    const { modelFundingFor } = await import("../pricing");
    expect(CREDIT_PACK_UNLOCK_MIN_MINOR).toBe(2000);
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits", creditPack: true, stage: "invite_only" })).toBe("free_plan");
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits", creditPack: true })).toBe("free_plan");
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits", creditPack: true, stage: "open" })).toBe("paid_plan");
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits", creditPack: false, stage: "open" })).toBe("free_plan");
    // Try does not reach them by its $5 alone.
    expect(modelFundingFor({ planTier: "free", modelBilling: "credits", stage: "open" })).toBe("free_plan");
    expect(modelFundingFor({ planTier: "free", modelBilling: "byok", stage: "open" })).toBe("own_key");
    // A person with no project has no pack to count.
    expect(modelFundingFor({ planTier: null, modelBilling: null, creditPack: true, stage: "open" })).toBe("free_plan");
  });
});

describe("plans, prices and what each plan includes (WP-14 T14; founder, Nov 17, 2026)", () => {
  it("names the plans Try, Founder and Studio on the old keys, with Partner as display data that cannot be bought", () => {
    expect(TIER_ORDER.map(planName)).toEqual(["Try", "Founder", "Studio"]);
    expect(PARTNER_PLAN).toMatchObject({ name: "Partner", priceMonthlyMinor: 25000, purchasable: false, action: "Join the Partner waitlist" });
    expect(PARTNER_PLAN.adds).toContain("experienced venture-backed founders and venture capital investors");
    // No date is promised for the reviews.
    expect(`${PARTNER_PLAN.adds} ${PARTNER_PLAN.opens}`).not.toMatch(/\b(20\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|next month|soon)\b/);
  });

  it("every plan reads 'Free while in early access' now, and nothing says it stays free", () => {
    for (const tier of TIER_ORDER) expect(planPriceLabel(tier)).toBe("Free while in early access");
    expect(EARLY_ACCESS_PRICE_LABEL).not.toMatch(/forever|always|for good|never pay/i);
    // The one promise is to the people invited now (A12).
    expect(INVITED_FOUNDERS_LINE).toBe("Free while in early access. Founders invited now keep it free for good.");
  });

  it("on the day sign-up opens Try is $5 a month with $5.00 of credits: one switch, and the entry plan follows it", () => {
    expect(ENTRY_PLAN).toEqual({ name: "Try", tier: "free", priceMonthlyMinor: 500, includedCreditsMinor: 500 });
    expect(planPriceLabel("free", "open")).toBe("$5 / month");
    expect(planPriceLabel("pro", "open", "a")).toBe("$15 / month");
    expect(planPriceLabel("scale", "open", "b")).toBe("$100 / month");
    expect(subscriptionChargingOpen()).toBe(false);
    expect(subscriptionChargingOpen("open")).toBe(true);
  });

  it("the Founder price test is two paired sets behind a switch that is off", () => {
    expect(PRICE_SETS).toEqual({ a: { pro: 1500, scale: 5000 }, b: { pro: 2500, scale: 10000 } });
    expect(PRICE_TEST.enabled).toBe(false);
    expect(indicativePricesFor("visitor-1")).toBeNull();
    const on = { enabled: true };
    const seen = Array.from({ length: 400 }, (_, i) => indicativePricesFor(`visitor-${i}`, null, on)!);
    const a = seen.filter((p) => p.set === "a").length;
    // Half of visitors see each set (a stable hash, so within a few percent over 400).
    expect(a).toBeGreaterThan(160);
    expect(a).toBeLessThan(240);
    for (const p of seen) expect(p).toMatchObject({ label: "Indicative", partnerMinor: 25000, founderMinor: PRICE_SETS[p.set].pro, studioMinor: PRICE_SETS[p.set].scale });
    // The same visitor gets the same set, and a visitor keeps the set first given.
    expect(indicativePricesFor("visitor-7", null, on)).toEqual(indicativePricesFor("visitor-7", null, on));
    expect(indicativePricesFor("visitor-7", "b", on)?.set).toBe("b");
    expect(indicativePricesFor("visitor-7", "a", on)?.set).toBe("a");
  });

  it("nobody is charged a subscription while sign-up is invite-only, whatever the plan", () => {
    for (const tier of TIER_ORDER) {
      expect(subscriptionChargeMinor({ tier, invited: false })).toBe(0);
      expect(subscriptionChargeMinor({ tier, invited: true, stage: "invite_only" })).toBe(0);
      expect(subscriptionChargeMinor({ tier, invited: false, stage: "invite_only", stored: { tier, priceMinor: 9900 } })).toBe(0);
    }
  });

  it("a person invited while sign-up was invite-only is on Founder and is never charged its fee (A12)", () => {
    expect(tierForInvited("free", true, "open")).toBe("pro");
    expect(tierForInvited("scale", true, "open")).toBe("scale");
    expect(tierForInvited("free", false, "open")).toBe("free");
    expect(tierForInvited("free", true, "invite_only")).toBe("free");
    expect(subscriptionChargeMinor({ tier: "pro", invited: true, stage: "open" })).toBe(0);
    expect(subscriptionChargeMinor({ tier: "free", invited: true, stage: "open" })).toBe(0);
    // Whatever the test showed them, whatever was stored, and whatever the config becomes.
    expect(subscriptionChargeMinor({ tier: "pro", invited: true, stage: "open", shownSet: "b", stored: { tier: "pro", priceMinor: 2500 }, sets: { a: { pro: 9900, scale: 9900 }, b: { pro: 9900, scale: 9900 } } })).toBe(0);
    // The promise names the Founder fee: Studio is charged.
    expect(subscriptionChargeMinor({ tier: "scale", invited: true, stage: "open" })).toBe(listPriceMinor("scale"));
  });

  it("nobody pays more than the figures they were shown, and a stored price survives a price change in config", () => {
    expect(subscriptionChargeMinor({ tier: "free", invited: false, stage: "open" })).toBe(500);
    expect(subscriptionChargeMinor({ tier: "pro", invited: false, stage: "open" })).toBe(listPriceMinor("pro", PRICE_TEST.listSet));
    expect(subscriptionChargeMinor({ tier: "pro", invited: false, stage: "open", shownSet: "b" })).toBe(1500);
    const raised = { a: { pro: 3000, scale: 12000 }, b: { pro: 2500, scale: 10000 } };
    // Shown $25, the list is now $30: they pay $25.
    expect(subscriptionChargeMinor({ tier: "pro", invited: false, stage: "open", shownSet: "b", sets: raised })).toBe(2500);
    // The first price paid is kept for as long as they stay subscribed.
    expect(subscriptionChargeMinor({ tier: "pro", invited: false, stage: "open", stored: { tier: "pro", priceMinor: 1500 }, sets: raised })).toBe(1500);
    expect(subscriptionChargeMinor({ tier: "scale", invited: false, stage: "open", stored: { tier: "scale", priceMinor: 5000 }, sets: raised })).toBe(5000);
    // A price stored for another plan is not this plan's price.
    expect(subscriptionChargeMinor({ tier: "scale", invited: false, stage: "open", stored: { tier: "pro", priceMinor: 1500 }, sets: raised })).toBe(12000);
  });

  it("what each plan includes is one table: Founder adds four things, Studio one, and everyone has everything until sign-up opens", () => {
    expect(PLAN_FEATURE_FROM).toEqual({ vacation_mode: "pro", card_sharing: "pro", named_agents: "pro", phone_inbox: "pro", more_agents_at_once: "scale" });
    expect(planAdds("free")).toEqual([]);
    expect(planAdds("pro")).toEqual(["vacation_mode", "card_sharing", "named_agents", "phone_inbox"]);
    expect(planAdds("scale")).toEqual(["more_agents_at_once"]);
    expect(planFor("vacation_mode")).toBe("pro");
    for (const feature of PLAN_FEATURES) {
      for (const tier of TIER_ORDER) expect(planIncludes(tier, feature)).toBe(true);
      expect(planIncludes("free", feature, "open")).toBe(false);
      expect(planIncludes("scale", feature, "open")).toBe(true);
    }
    expect(planIncludes("pro", "vacation_mode", "open")).toBe(true);
    expect(planIncludes("pro", "more_agents_at_once", "open")).toBe(false);
  });
});

describe("credit packs (founder, Nov 17, 2026)", () => {
  it("add their price plus a bonus that grows with the pack, never less than they cost", async () => {
    const { CREDIT_PACKS_MINOR, creditPackCreditsMinor } = await import("../pricing");
    expect(CREDIT_PACKS_MINOR.map((p) => creditPackCreditsMinor(p))).toEqual([2000, 5250, 11000, 28750, 60000]);
    expect(creditPackCreditsMinor(1000)).toBeNull();
  });
});

