import { describe, expect, it } from "vitest";
import { GLITCHWICK } from "../examples/glitchwick";
import { TUTORLANE } from "../examples/tutorlane";
import { LARGE_ORDER_MINOR, exampleJourney, exampleMoney } from "../examples/helpers";
import type { ExampleBusiness } from "../examples/types";

/**
 * The Journey tells one story with the rest of the page: hovering a pin or a day on the Ribbon shows the same studio or
 * tutor, on the same day, at the same price as the milestone cards and the Customer Update beside it.
 */
describe.each([
  ["tutorlane", TUTORLANE],
  ["glitchwick", GLITCHWICK],
] as Array<[string, ExampleBusiness]>)("the %s Journey", (_id, business) => {
  const journey = exampleJourney(business);
  const pins = new Map(journey.milestones.map((m) => [m.label, m]));
  const payments = journey.conversions.filter((c) => c.kind === "payment");
  const plan = business.journey.planPrices!;

  it("puts every milestone card on its Ribbon pin's day, naming the payment the Ribbon records there at the same value", () => {
    for (const card of business.milestones) {
      const pin = pins.get(card.label);
      expect(pin?.achievedAt.slice(0, 10), card.label).toBe(card.achievedAt?.slice(0, 10));
      if (!card.customerName) continue;
      const paid = journey.conversions.find((c) => c.id === pin?.ref?.conversionId);
      expect(paid, card.label).toMatchObject({ entityName: card.customerName, amountMinor: card.amountMinor });
    }
    // The cards are in the order they happened.
    const dates = business.milestones.map((m) => m.achievedAt ?? "");
    expect(dates).toEqual([...dates].sort());
  });

  it("prices every payment at a plan's price and has no revenue before the first paying customer", () => {
    for (const p of payments) expect([...plan.pricesMinor, plan.largeMinor], exampleMoney(business, p.amountMinor)).toContain(p.amountMinor);
    expect(payments.some((p) => p.amountMinor === plan.largeMinor)).toBe(true);
    const firstPaid = payments[0]!.occurredAt.slice(0, 10);
    const days = journey.rows.filter((r) => r.departmentId === null);
    expect(days.filter((r) => r.day < firstPaid).every((r) => r.revenueMinor === 0)).toBe(true);
    expect(days.find((r) => r.revenueMinor > 0)?.day).toBe(firstPaid);
  });

  it("bears out the MRR pins: thirty days of revenue near $1K at the $1K pin and near $10K at the $10K pin", () => {
    const days = journey.rows.filter((r) => r.departmentId === null);
    const thirtyDays = (day: string) => {
      const i = days.findIndex((r) => r.day === day);
      return days.slice(i - 29, i + 1).reduce((sum, r) => sum + r.revenueMinor, 0);
    };
    const at = (label: string) => pins.get(label)!.achievedAt.slice(0, 10);
    expect(thirtyDays(at("$1K MRR"))).toBeGreaterThan(70_000);
    expect(thirtyDays(at("$1K MRR"))).toBeLessThan(150_000);
    expect(thirtyDays(at("$10K MRR"))).toBeGreaterThan(700_000);
    expect(thirtyDays(at("$10K MRR"))).toBeLessThan(1_500_000);
  });

  it("names the Customer Update's customer on its own payment only: the day its first touch and its days to convert give", () => {
    const u = business.customerUpdate;
    const theirs = journey.conversions.filter((c) => c.entityName === u.customer.name);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ kind: "payment", amountMinor: plan.pricesMinor[0] });
    // "First seen Sep 24" plus the update's days lands on the payment's day.
    const firstSeen = u.customer.facts.find((f) => f.label === "First seen")!.value;
    const seen = new Date(`${firstSeen}, 2026 12:00`);
    const paid = new Date(seen.getFullYear(), seen.getMonth(), seen.getDate() + u.stats.days, 12);
    expect(theirs[0]!.occurredAt.slice(0, 10)).toBe(`${paid.getFullYear()}-${String(paid.getMonth() + 1).padStart(2, "0")}-${String(paid.getDate()).padStart(2, "0")}`);
  });

  it("keeps the large payments to the fixture's large ones", () => {
    const large = payments.filter((p) => p.amountMinor === plan.largeMinor).length;
    expect(large).toBeGreaterThan(0);
    expect(large).toBeLessThan(payments.length / 5);
    expect(plan.largeMinor).toBeGreaterThanOrEqual(LARGE_ORDER_MINOR);
  });
});

describe("Glitchwick", () => {
  it("reads whole in the narrowest places: chapter titles on the Ribbon's day card and the cycle 1 plan's rows", () => {
    // The day card puts the chapter title beside a date such as "Wed 24 Sep 2025" (measured in Chromium at 1280 px).
    for (const title of GLITCHWICK.journey.chapterTitles) expect(title.length, title).toBeLessThanOrEqual(17);
    for (const p of GLITCHWICK.howItWorks.firstCyclePlan) expect(p.task.length, p.task).toBeLessThanOrEqual(27);
  });

  it("tells one story about pricing: Indie at $29, Team at $149, and a year of Team up front at $1,490", () => {
    expect(GLITCHWICK.journey.planPrices).toEqual({ pricesMinor: [2900], largeMinor: 149_000 });
    const win = GLITCHWICK.deck.outcomes.find((o) => o.kind === "win");
    expect(win?.kind === "win" && win.plan).toBe(GLITCHWICK.customerUpdate.plan);
    expect(GLITCHWICK.customerUpdate.plan).toContain("$29 a month");
    expect(GLITCHWICK.milestones.find((m) => m.key === "first_team_plan")?.amountMinor).toBe(149_000);
  });
});
