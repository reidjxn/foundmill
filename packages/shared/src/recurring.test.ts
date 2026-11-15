import { describe, expect, it } from "vitest";
import { ARCHETYPES, RECURRING_ARCHETYPES, revenueIsRecurring } from "./constants";

describe("revenueIsRecurring (DECISIONS 2026-11-10: MRR only where revenue recurs)", () => {
  it("subscriptions and retainers recur; a physical product, a marketplace and hardware sell once", () => {
    expect(ARCHETYPES.filter((a) => revenueIsRecurring(a))).toEqual(["b2b_saas", "consumer_app", "services", "content_media"]);
    expect(revenueIsRecurring("dtc_physical")).toBe(false);
    expect(revenueIsRecurring("marketplace")).toBe(false);
    expect(revenueIsRecurring("hardware")).toBe(false);
    expect(RECURRING_ARCHETYPES.every((a) => (ARCHETYPES as readonly string[]).includes(a))).toBe(true);
  });

  it("is null before an archetype is chosen", () => {
    expect(revenueIsRecurring(null)).toBeNull();
    expect(revenueIsRecurring(undefined)).toBeNull();
    expect(revenueIsRecurring("")).toBeNull();
  });
});
