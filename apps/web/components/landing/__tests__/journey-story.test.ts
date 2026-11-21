import { describe, expect, it } from "vitest";
import { GLITCHWICK } from "../examples/glitchwick";
import { NORTHWIND } from "../examples/northwind";
import { TUTORLANE } from "../examples/tutorlane";
import { LARGE_ORDER_MINOR, STORY_DAY, customerCountOf, datedCustomerUpdate, exampleJourney, exampleMoney } from "../examples/helpers";
import type { ExampleBusiness } from "../examples/types";

/** The running count of customers a pin's label names: "First customer" 1, "10 studios" 10, "1,000th customer" 1,000. */
function countIn(label: string): number | null {
  if (/^First (paying )?(customer|studio|tutor)$/.test(label)) return 1;
  const m = /^([\d,]+)(?:st|nd|rd|th)? (customer|studio|tutor)s?$/.exec(label);
  return m ? Number(m[1]!.replaceAll(",", "")) : null;
}

/** A revenue milestone card's line: "mrr_10k" is MRR of $10,000, "month_50k" thirty days of sales of $50,000. */
function revenueLine(key: string): { kind: "mrr" | "month"; minor: number } | null {
  const m = /^(mrr|month)_(\d+)k$/.exec(key);
  return m ? { kind: m[1] as "mrr" | "month", minor: Number(m[2]) * 100_000 } : null;
}

const dayOf = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);

/**
 * The Journey tells one story with the rest of the page, for every example business: the Ribbon's paying customers
 * reach each customer milestone on the day its card says, its revenue is what those customers pay at the business's
 * own prices (so the revenue milestones are true on their days), and hovering a pin or a day shows the same customer,
 * on the same day, at the same value as the milestone cards and the Customer Update beside it.
 */
describe.each([
  ["tutorlane", TUTORLANE],
  ["glitchwick", GLITCHWICK],
  ["northwind", NORTHWIND],
] as Array<[string, ExampleBusiness]>)("the %s Journey", (_id, business) => {
  const journey = exampleJourney(business);
  const { ledger } = journey;
  const days = journey.rows.filter((r) => r.departmentId === null);
  const index = new Map(days.map((r, i) => [r.day, i]));
  const pins = new Map(journey.milestones.map((m) => [m.label, m]));
  const payments = journey.conversions.filter((c) => c.kind === "payment").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const firstPaymentsOn = (day: string) => payments.filter((p) => dayOf(p.occurredAt) === day).reduce((s, p) => s + p.amountMinor, 0);
  // Paying customers so far at the end of each day, as the Ribbon's paying-customers row adds them up.
  let running = 0;
  const customers = days.map((r) => (running += r.payments));
  const thirtyDays = (day: string) => {
    const i = index.get(day)!;
    return days.slice(Math.max(0, i - 29), i + 1).reduce((sum, r) => sum + r.revenueMinor, 0);
  };
  const { billing, updatePayment } = { ...business.journey.customers, updatePayment: business.journey.updatePayment };
  const named = [
    updatePayment,
    ...business.journey.customers.large,
    ...business.milestones.filter((m) => m.customerName).map((m) => ({ day: dayOf(m.achievedAt), name: m.customerName!, amountMinor: m.amountMinor! })),
  ];

  it("puts every milestone card on its Ribbon pin's day, naming the payment the Ribbon records there at the same value", () => {
    for (const card of business.milestones) {
      const pin = pins.get(card.label);
      expect(dayOf(pin?.achievedAt), card.label).toBe(dayOf(card.achievedAt));
      if (!card.customerName) continue;
      const paid = journey.conversions.find((c) => c.id === pin?.ref?.conversionId);
      expect(paid, card.label).toMatchObject({ kind: "payment", entityName: card.customerName, amountMinor: card.amountMinor });
      expect(dayOf(paid?.occurredAt), card.label).toBe(dayOf(card.achievedAt));
    }
    // The cards are in the order they happened.
    const dates = business.milestones.map((m) => m.achievedAt ?? "");
    expect(dates).toEqual([...dates].sort());
  });

  it("counts paying customers the way its milestones do: the Nth customer pays on the day the card and the pin say", () => {
    // The Ribbon's paying-customers row and its day card's payments are the same payments.
    const perDay = new Map<string, number>();
    for (const p of payments) perDay.set(dayOf(p.occurredAt), (perDay.get(dayOf(p.occurredAt)) ?? 0) + 1);
    for (const r of days) expect(r.payments, r.day).toBe(perDay.get(r.day) ?? 0);
    const counted = [
      ...business.milestones.flatMap((m) => {
        const n = customerCountOf(m.key);
        return n === null ? [] : [{ label: m.label, n, day: dayOf(m.achievedAt) }];
      }),
      ...journey.milestones.flatMap((m) => {
        const n = countIn(m.label);
        return n === null ? [] : [{ label: m.label, n, day: dayOf(m.achievedAt) }];
      }),
    ];
    expect(counted.some((c) => c.n >= 100)).toBe(true);
    for (const c of counted) {
      const i = index.get(c.day)!;
      expect(i === 0 ? 0 : customers[i - 1], `${c.label}: customers the day before`).toBeLessThan(c.n);
      expect(customers[i], `${c.label}: customers that day`).toBeGreaterThanOrEqual(c.n);
      expect(dayOf(payments[c.n - 1]?.occurredAt), `${c.label}: the customer's payment`).toBe(c.day);
    }
    // The ledger's running count is the Ribbon's.
    expect(ledger.customers).toEqual(customers);
  });

  it("has no revenue before the first paying customer, and never less on a day than the payments its day card lists", () => {
    const first = dayOf(payments[0]?.occurredAt);
    expect(days.filter((r) => r.day < first).every((r) => r.revenueMinor === 0)).toBe(true);
    expect(days.find((r) => r.revenueMinor > 0)?.day).toBe(first);
    expect(ledger.firstRepeatDay! > first).toBe(true);
    days.forEach((r, i) => {
      // A day's revenue is its first payments plus what earlier customers paid again (renewals, reorders).
      expect(r.revenueMinor, r.day).toBe(firstPaymentsOn(r.day) + ledger.repeatMinor[i]!);
      expect(ledger.repeatMinor[i]! >= 0 && (ledger.repeatMinor[i] === 0) === (ledger.repeatCount[i] === 0), r.day).toBe(true);
    });
    // The departments' revenue adds up to the business's (sales are Distribution's).
    const departmental = new Map<string, number>();
    for (const r of journey.rows) if (r.departmentId !== null) departmental.set(r.day, (departmental.get(r.day) ?? 0) + r.revenueMinor);
    for (const r of days) expect(departmental.get(r.day), r.day).toBe(r.revenueMinor);
  });

  it("bears out its revenue milestones: each line is crossed for the first time on its card's day", () => {
    const lines = business.milestones.flatMap((m) => {
      const line = revenueLine(m.key);
      return line ? [{ ...line, label: m.label, day: dayOf(m.achievedAt) }] : [];
    });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const series = line.kind === "mrr" ? ledger.mrrMinor! : days.map((r) => thirtyDays(r.day));
      expect(days[series.findIndex((v) => v >= line.minor)]?.day, line.label).toBe(line.day);
      // MRR is what the month's revenue shows: thirty days of payments within a fifth of it.
      if (line.kind === "mrr") expect(Math.abs(thirtyDays(line.day) - series[index.get(line.day)!]!) / line.minor, line.label).toBeLessThan(0.2);
    }
  });

  it("charges its own prices: payments, renewals and reorders at a plan's price or a basket's, from the customers it has", () => {
    const largeNames = new Set(named.filter((p) => p.amountMinor >= LARGE_ORDER_MINOR || (billing.kind === "subscription" && p.amountMinor !== billing.monthlyMinor[0])).map((p) => p.name));
    // Repeat charges in every 30 days are each a price the business charges (on average, between the cheapest and dearest).
    const windows = days.map((_, i) => i).filter((i) => i >= 29 && (i - 29) % 30 === 0);
    if (billing.kind === "subscription") {
      const monthly = (amount: number) => (amount === billing.yearlyMinor ? amount / 12 : amount);
      const prices = [...billing.monthlyMinor, ...(billing.yearlyMinor ? [billing.yearlyMinor] : []), ...named.map((p) => p.amountMinor)];
      for (const p of payments) expect(prices, `${p.entityName} ${exampleMoney(business, p.amountMinor)}`).toContain(p.amountMinor);
      for (const i of windows) {
        const count = ledger.repeatCount.slice(i - 29, i + 1).reduce((s, v) => s + v, 0);
        const minor = ledger.repeatMinor.slice(i - 29, i + 1).reduce((s, v) => s + v, 0);
        if (count) expect(minor / count, days[i]!.day).toBeGreaterThanOrEqual(Math.min(...prices));
        if (count) expect(minor / count, days[i]!.day).toBeLessThanOrEqual(Math.max(...prices));
      }
      // MRR is at most every customer so far on their plan, and cancellations take a modest share of it.
      let most = 0;
      let p = 0;
      days.forEach((r, i) => {
        while (p < payments.length && dayOf(payments[p]!.occurredAt) <= r.day) most += monthly(payments[p++]!.amountMinor);
        expect(ledger.mrrMinor![i], r.day).toBeLessThanOrEqual(Math.round(most) + 1);
      });
      expect(ledger.mrrMinor!.at(-1)! / most).toBeGreaterThan(0.6);
    } else {
      const firsts = billing.firstOrders.map((b) => b.minor);
      const reorders = billing.reorders.baskets.map((b) => b.minor);
      for (const p of payments) {
        if (largeNames.has(p.entityName ?? "")) expect(p.amountMinor, p.entityName ?? "").toBeGreaterThanOrEqual(LARGE_ORDER_MINOR);
        else expect(firsts, `${p.entityName} ${exampleMoney(business, p.amountMinor)}`).toContain(p.amountMinor);
      }
      for (const i of windows) {
        const sum = (a: number[]) => a.slice(i - 29, i + 1).reduce((s, v) => s + v, 0);
        const shopperCount = sum(ledger.repeatCount) - sum(ledger.storeCount);
        const shopperMinor = sum(ledger.repeatMinor) - sum(ledger.storeMinor);
        if (shopperCount) expect(shopperMinor / shopperCount, days[i]!.day).toBeGreaterThanOrEqual(Math.min(...reorders));
        if (shopperCount) expect(shopperMinor / shopperCount, days[i]!.day).toBeLessThanOrEqual(Math.max(...reorders));
        // A store reorders at most twice in 30 days, at most half its opening order each time.
        const opened = payments.filter((p) => largeNames.has(p.entityName ?? "") && dayOf(p.occurredAt) <= days[i]!.day).reduce((s, p) => s + p.amountMinor, 0);
        expect(sum(ledger.storeMinor), days[i]!.day).toBeLessThanOrEqual(2 * billing.storeReorders.share[1] * opened);
      }
      // About one order in two is a shopper coming back, and the month's sales are what the orders add up to.
      const lastMonth = days.length - 30;
      const orders = days.slice(lastMonth).reduce((s, r) => s + r.payments, 0) + ledger.repeatCount.slice(lastMonth).reduce((s, v) => s + v, 0);
      const average = days.slice(lastMonth).reduce((s, r) => s + r.revenueMinor, 0) / orders;
      expect(average).toBeGreaterThan(Math.min(...firsts));
      expect(average).toBeLessThan(15_000);
    }
  });

  it("names the Customer Update's customer on its own payment only: the day its first touch and its days to convert give, at its value", () => {
    const u = datedCustomerUpdate(business, STORY_DAY);
    expect(updatePayment.name).toBe(u.customer.name);
    const theirs = journey.conversions.filter((c) => c.entityName === u.customer.name);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ kind: "payment", amountMinor: updatePayment.amountMinor });
    // "First seen Sep 24" plus the update's days lands on the payment's day.
    const firstSeen = u.customer.facts.find((f) => f.label === "First seen")!.value;
    const seen = new Date(`${firstSeen}, 2026 12:00`);
    const paid = new Date(seen.getFullYear(), seen.getMonth(), seen.getDate() + u.stats.days, 12);
    expect(dayOf(theirs[0]!.occurredAt)).toBe(`${paid.getFullYear()}-${String(paid.getMonth() + 1).padStart(2, "0")}-${String(paid.getDate()).padStart(2, "0")}`);
    // The last payment of its day, and the value the update states when it states one.
    expect(payments.filter((p) => dayOf(p.occurredAt) === updatePayment.day).at(-1)?.entityName).toBe(u.customer.name);
    const story = [u.plan, ...u.commentary.map((c) => c.text)].join(" ");
    if (/\$\d/.test(story)) expect(story).toContain(exampleMoney(business, updatePayment.amountMinor).replace(".00", ""));
  });

  it("gives every named customer one payment and nothing else: no card's customer signs up or pays again later", () => {
    for (const p of named) {
      const theirs = journey.conversions.filter((c) => c.entityName === p.name);
      expect(theirs, p.name).toHaveLength(1);
      expect(theirs[0], p.name).toMatchObject({ kind: "payment", amountMinor: p.amountMinor });
      expect(dayOf(theirs[0]!.occurredAt), p.name).toBe(p.day);
    }
  });

  it("forecasts from what it earns now: the cone starts at the last 30 days' revenue per day", () => {
    const perDay = days.slice(-30).reduce((s, r) => s + r.revenueMinor, 0) / 30;
    expect(journey.forecast[0]!.baseMinor / perDay).toBeGreaterThan(0.99);
    expect(journey.forecast[0]!.baseMinor / perDay).toBeLessThan(1.01);
  });
});

describe("Tutorlane", () => {
  it("sells Pro at $29 a tutor a month, and an agency's ten tutors at $290", () => {
    expect(TUTORLANE.journey.customers.billing).toMatchObject({ kind: "subscription", monthlyMinor: [2900] });
    expect(TUTORLANE.milestones.find((m) => m.key === "first_agency")).toMatchObject({ customerName: "Rivera Languages", amountMinor: 29_000 });
    for (const agency of TUTORLANE.journey.customers.large) expect(agency.amountMinor).toBe(29_000);
  });
});

describe("Glitchwick", () => {
  it("reads whole in the narrowest places: chapter titles on the Ribbon's day card and the round of work 1 plan's rows", () => {
    // The day card puts the chapter title beside a date such as "Wed 24 Sep 2025" (measured in Chromium at 1280 px).
    for (const title of GLITCHWICK.journey.chapterTitles) expect(title.length, title).toBeLessThanOrEqual(17);
    for (const p of GLITCHWICK.howItWorks.firstCyclePlan) expect(p.task.length, p.task).toBeLessThanOrEqual(27);
  });

  it("tells one story about pricing: Indie at $29, Team at $149, and a year of Team up front at $1,490", () => {
    expect(GLITCHWICK.journey.customers.billing).toMatchObject({ kind: "subscription", monthlyMinor: [2900], yearlyMinor: 149_000 });
    const win = GLITCHWICK.deck.outcomes.find((o) => o.kind === "win");
    expect(win?.kind === "win" && win.plan).toBe(GLITCHWICK.customerUpdate.plan);
    expect(GLITCHWICK.customerUpdate.plan).toContain("$29 a month");
    expect(GLITCHWICK.milestones.find((m) => m.key === "first_team_plan")?.amountMinor).toBe(149_000);
  });
});

describe("Northwind Skincare", () => {
  const journey = exampleJourney(NORTHWIND);
  const days = journey.rows.filter((r) => r.departmentId === null);

  it("sells from the day the first batch lands: its first month has paying customers and only their first orders", () => {
    const firstMonth = days.slice(0, 31);
    expect(days[0]!.payments).toBeGreaterThan(0);
    expect(firstMonth.reduce((s, r) => s + r.payments, 0)).toBeGreaterThan(40);
    const firstOrders = journey.conversions.filter((c) => c.kind === "payment" && c.occurredAt < `${firstMonth.at(-1)!.day}T23:59`).reduce((s, c) => s + c.amountMinor, 0);
    expect(firstMonth.reduce((s, r) => s + r.revenueMinor, 0)).toBe(firstOrders);
  });

  it("has its first reorder on the day of the First reorder card, and grows to hundreds of new customers a month", () => {
    const card = NORTHWIND.milestones.find((m) => m.key === "first_reorder")!;
    expect(journey.ledger.firstRepeatDay).toBe(dayOf(card.achievedAt));
    // Two years on, dozens of new customers a week (the Ribbon once showed about three).
    const lastMonth = days.slice(-30).reduce((s, r) => s + r.payments, 0);
    expect(lastMonth).toBeGreaterThan(150);
    expect(journey.ledger.customers.at(-1)).toBe(NORTHWIND.journey.customers.counts["2026-10-07"]);
  });
});
