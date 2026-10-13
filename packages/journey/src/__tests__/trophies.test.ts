import { describe, expect, it } from "vitest";
import { customerTrophyFor, detectTrophies, ENTERPRISE_CONTRACT_MIN_MINOR, enterpriseContractMinMinor, formatThreshold, isEnterpriseContract, isTrophyKey, thresholdFor, TROPHIES, TROPHY_BY_KEY, type TrophyCounters } from "../trophies";
import { Milestone, TROPHY_KEYS } from "../types";

const at = "2025-04-01T10:00:00.000Z";
const counters = (over: Partial<TrophyCounters> = {}): TrophyCounters => ({ customers: 0, mrrMinor: 0, enterpriseContracts: 0, ...over });

describe("trophy cabinet", () => {
  it("defines exactly the eight trophies of BUILD §11.4", () => {
    expect(TROPHIES.map((t) => t.key)).toEqual([...TROPHY_KEYS]);
    expect(TROPHIES.filter((t) => t.metric === "customers").map((t) => t.threshold)).toEqual([1, 10, 100, 1000]);
    expect(TROPHIES.filter((t) => t.metric === "mrrMinor").map((t) => t.threshold)).toEqual([100_000, 1_000_000, 10_000_000]);
    expect(TROPHY_BY_KEY.first_enterprise_contract.threshold).toBe(1);
    expect(isTrophyKey("mrr_1k")).toBe(true);
    expect(isTrophyKey("mrr_1m")).toBe(false);
  });

  it.each([
    [0, 1, ["customer_1"]],
    [1, 2, []],
    [9, 10, ["customer_10"]],
    [10, 10, []],
    [10, 11, []],
    [99, 100, ["customer_100"]],
    [999, 1000, ["customer_1000"]],
    [1000, 5000, []],
  ])("customers %i → %i fires %j", (before, after, keys) => {
    const out = detectTrophies({ before: counters({ customers: before }), after: counters({ customers: after }), at });
    expect(out.map((m) => m.trophyKey)).toEqual(keys);
  });

  it("fires every trophy whose threshold was crossed in one step, in cabinet order", () => {
    const out = detectTrophies({ before: counters(), after: counters({ customers: 150, mrrMinor: 10_000_000, enterpriseContracts: 1 }), at, currency: "EUR" });
    expect(out.map((m) => m.trophyKey)).toEqual(["customer_1", "customer_10", "customer_100", "mrr_1k", "mrr_10k", "mrr_100k", "first_enterprise_contract"]);
    expect(out.map((m) => m.label)).toEqual(["First customer", "10th customer", "100th customer", "First €1K MRR", "First €10K MRR", "First €100K MRR", "First enterprise contract"]);
    expect(out.map((m) => m.kind)).toEqual(["customer", "customer", "customer", "revenue", "revenue", "revenue", "trophy"]);
    for (const m of out) {
      expect(Milestone.parse(m)).toEqual(m);
      expect(m.achievedAt).toBe(at);
      expect(m.visibility).toBe("private");
    }
  });

  it("MRR trophies fire at exactly the threshold and not below", () => {
    expect(detectTrophies({ before: counters({ mrrMinor: 99_999 }), after: counters({ mrrMinor: 100_000 }), at }).map((m) => m.trophyKey)).toEqual(["mrr_1k"]);
    expect(detectTrophies({ before: counters({ mrrMinor: 0 }), after: counters({ mrrMinor: 99_999 }), at })).toEqual([]);
    expect(detectTrophies({ before: counters({ mrrMinor: 100_000 }), after: counters({ mrrMinor: 999_999 }), at })).toEqual([]);
    expect(detectTrophies({ before: counters({ mrrMinor: 999_999 }), after: counters({ mrrMinor: 1_000_000 }), at }).map((m) => m.trophyKey)).toEqual(["mrr_10k"]);
    // MRR falling back and crossing again does not re-fire when the trophy is already in the cabinet.
    expect(detectTrophies({ before: counters({ mrrMinor: 90_000 }), after: counters({ mrrMinor: 120_000 }), at, awarded: ["mrr_1k"] })).toEqual([]);
  });

  it("never awards a trophy twice and never for a drop", () => {
    expect(detectTrophies({ before: counters({ customers: 0 }), after: counters({ customers: 1 }), at, awarded: ["customer_1"] })).toEqual([]);
    expect(detectTrophies({ before: counters({ customers: 10 }), after: counters({ customers: 9 }), at })).toEqual([]);
  });

  it("formats labels in the business's currency and attaches refs", () => {
    const [m] = detectTrophies({ before: counters(), after: counters({ mrrMinor: 100_000 }), at, currency: "USD", ref: { conversionId: "abc" }, businessId: "b0000000-0000-0000-0000-000000000001" });
    expect(m!.label).toMatch(/^First (US)?\$1K MRR$/);
    expect(m!.ref).toEqual({ trophyKey: "mrr_1k", metric: "mrrMinor", threshold: 100_000, value: 100_000, conversionId: "abc" });
    expect(m!.businessId).toBe("b0000000-0000-0000-0000-000000000001");
    expect(formatThreshold(10_000_000, "GBP")).toBe("£100K");
  });

  it("revenue thresholds scale from major units of the business's currency, so the label and the award agree (JM-14)", () => {
    // 100,000 yen of MRR is not "First 1K MRR" in disguise: 1K of yen is 1,000 yen, 1K of dinars is 1,000.000 dinars.
    expect(detectTrophies({ before: counters(), after: counters({ mrrMinor: 999 }), at, currency: "JPY" })).toEqual([]);
    const yen = detectTrophies({ before: counters(), after: counters({ mrrMinor: 1_000 }), at, currency: "JPY" });
    expect(yen.map((m) => [m.trophyKey, m.label])).toEqual([["mrr_1k", "First ¥1K MRR"]]);
    expect(yen[0]!.ref).toMatchObject({ threshold: 1_000, value: 1_000 });
    expect(detectTrophies({ before: counters(), after: counters({ mrrMinor: 100_000 }), at, currency: "KWD" })).toEqual([]);
    const dinar = detectTrophies({ before: counters(), after: counters({ mrrMinor: 1_000_000 }), at, currency: "KWD" });
    expect(dinar.map((m) => m.trophyKey)).toEqual(["mrr_1k"]);
    expect(dinar[0]!.label).toMatch(/1K MRR$/);
    expect(thresholdFor(TROPHY_BY_KEY.mrr_10k, "KWD")).toBe(10_000_000);
    expect(thresholdFor(TROPHY_BY_KEY.mrr_10k, "GBP")).toBe(1_000_000);
    expect(thresholdFor(TROPHY_BY_KEY.customer_10, "KWD")).toBe(10);
    expect(formatThreshold(10_000_000, "KWD")).toMatch(/10K$/);
    expect(formatThreshold(1_000, "JPY")).toBe("¥1K");
  });

  it("the enterprise minimum is 10,000 of the business's currency", () => {
    expect(enterpriseContractMinMinor("EUR")).toBe(1_000_000);
    expect(enterpriseContractMinMinor("JPY")).toBe(10_000);
    expect(enterpriseContractMinMinor("KWD")).toBe(10_000_000);
    expect(isEnterpriseContract(10_000, enterpriseContractMinMinor("JPY"))).toBe(true);
    expect(isEnterpriseContract(9_999, enterpriseContractMinMinor("JPY"))).toBe(false);
  });

  it("enterprise contracts count from the configured minimum", () => {
    expect(ENTERPRISE_CONTRACT_MIN_MINOR).toBe(1_000_000);
    expect(isEnterpriseContract(999_999)).toBe(false);
    expect(isEnterpriseContract(1_000_000)).toBe(true);
    expect(isEnterpriseContract(500_000, 500_000)).toBe(true);
    expect(detectTrophies({ before: counters({ enterpriseContracts: 0 }), after: counters({ enterpriseContracts: 1 }), at }).map((m) => m.trophyKey)).toEqual(["first_enterprise_contract"]);
    expect(detectTrophies({ before: counters({ enterpriseContracts: 1 }), after: counters({ enterpriseContracts: 2 }), at })).toEqual([]);
  });

  it("customerTrophyFor names the trophy the nth customer earns", () => {
    expect(customerTrophyFor(1)?.key).toBe("customer_1");
    expect(customerTrophyFor(10)?.key).toBe("customer_10");
    expect(customerTrophyFor(11)).toBeNull();
    expect(customerTrophyFor(1000)?.label("EUR")).toBe("1,000th customer");
  });
});
