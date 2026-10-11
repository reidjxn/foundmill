/**
 * Pure helpers over an example business: money in its own currency and locale, the shared "today", department lookups,
 * the team orbit, the channel roster and the two-year Journey. Each takes the business as an argument, so the sections,
 * the cycle reducer and the tests all read the same data the same way.
 */
import { formatMoney, mockChannels, type ChannelTokenData, type Concept, type MockChannelProfile, type SkillRow, type TeamOrbitDepartment } from "@foundmill/dugout";
import { generateJourneyFixture } from "@foundmill/dugout/components/journey/fixtures";
import { MODULE_TABS } from "@foundmill/shared/constants";
import { buildLedger, type Ledger } from "./ledger";
import type { ExampleBusiness, ExampleDepartment, ExampleLead } from "./types";

/** A money figure of the example business, from minor units: "$42.00" (en-US, never en-GB's "US$42.00"). */
export function exampleMoney(business: ExampleBusiness, amountMinor: number): string {
  return formatMoney({ amountMinor, currency: business.currency }, { locale: business.locale });
}

/**
 * Today on every example business, as local noon. The page is server-rendered in UTC and hydrated in the visitor's time
 * zone, and every date it prints must read the same in both: a date-only ISO string ("2026-10-07") parses as UTC
 * midnight and prints as 6 Oct west of UTC, so dates here are built in local time.
 */
export function exampleToday(): Date {
  return new Date(2026, 9, 7, 12);
}

/** An ISO instant moved to local noon on the same calendar day, so it prints the same day in every time zone. */
export function localNoon(iso: string): string {
  return `${iso.slice(0, 10)}T12:00:00`;
}

/** A concept card's ten attribute ratings (1–20), in the Ideation Studio's order. */
export function conceptAttributes(values: readonly number[]): Concept["attributes"] {
  return (["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"] as const).map((key, i) => ({ key, value: values[i] ?? 10 }));
}

/** One attribute rating row for a lead: tested 12 times, proven two below the value, a task count that grows with it. */
export function leadSkill(id: string, name: string, group: SkillRow["group"], value: number, delta: number, potential: number): SkillRow {
  return { id, name, group, value, delta, potential, tested: 12, proven: Math.max(1, value - 2), tasks: 18 + value };
}

export function departmentOf(business: ExampleBusiness, id: string): ExampleDepartment {
  const found = business.departments.find((d) => d.id === id);
  if (!found) throw new Error(`${business.identity.name} has no department "${id}"`);
  return found;
}

export function leadOf(business: ExampleBusiness, departmentId: string): ExampleLead {
  const found = business.leads.find((l) => l.department === departmentId);
  if (!found) throw new Error(`${business.identity.name} has no lead for "${departmentId}"`);
  return found;
}

/** The department's real screens: its module's tabs, or the ones it names, in its order. */
export function departmentScreens(department: ExampleDepartment): ReadonlyArray<{ slug: string; title: string }> {
  const tabs = MODULE_TABS[department.module];
  if (!department.screens) return tabs;
  return department.screens.flatMap((slug) => tabs.filter((t) => t.slug === slug));
}

/** The team orbit: each department with its lead on the inner ring and its workers on the outer one. */
export function orbitDepartments(business: ExampleBusiness): TeamOrbitDepartment[] {
  return business.departments.map((d) => {
    const lead = leadOf(business, d.id);
    return { name: d.label, dept: d.dept, lead: { name: lead.name, seed: lead.seed }, workers: d.workers.map((w) => ({ name: w.name, seed: w.seed })) };
  });
}

/** The Channel Board's profile: fits, the four recommended channels and why, in the business's currency. */
export function channelProfile(business: ExampleBusiness): MockChannelProfile {
  const c = business.channels;
  return { fits: c.fits, recommended: c.recommended, why: (label) => c.why.replaceAll("{channel}", label), currency: business.currency };
}

/** The fifteen channels on the board, the recommended four on it. */
export function exampleChannels(business: ExampleBusiness): ChannelTokenData[] {
  return mockChannels(business.channels.seed, { profile: channelProfile(business) });
}

export type ExampleJourneyData = ReturnType<typeof generateJourneyFixture> & {
  /** The business's customers and money, day by day (`./ledger`): what the rows, conversions and forecast come from. */
  ledger: Ledger;
};

/** A large first payment starts here: a store's opening order, not a shopper's basket. */
export const LARGE_ORDER_MINOR = 120_000;

/** The running count of paying customers a milestone card names by its key ("customer_1000" → 1000), or null. */
export function customerCountOf(key: string): number | null {
  const m = /^customer_(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * Two years of the business's history. The design system's Journey fixture gives the days, the team's agent hours,
 * the pins, chapters and roadmap (relabeled for the business); the business's own ledger gives its customers and money:
 * the paying customers through every `customer_N` milestone card and `customers.counts`, the payments the milestone
 * cards and the Customer Update name, and revenue as every charge on its day.
 */
export function exampleJourney(business: ExampleBusiness): ExampleJourneyData {
  const j = business.journey;
  const d = generateJourneyFixture({ days: 730, departments: [...j.ribbonDepartments] });
  const daily = d.rows.filter((r) => r.departmentId === null);
  const cardDay = (m: { achievedAt: string | null }) => (m.achievedAt ?? "").slice(0, 10);
  const counts = new Map<string, number>();
  for (const m of business.milestones) {
    const n = customerCountOf(m.key);
    if (n !== null && m.achievedAt) counts.set(cardDay(m), n);
  }
  for (const [day, n] of Object.entries(j.customers.counts)) counts.set(day, n);
  // Named first payments: the Customer Update's and the large ones, then the milestone cards' (a `customer_N` card's
  // customer is the last to pay on its day, so the Nth).
  const billing = j.customers.billing;
  // A large payment is billed as one: a year up front renews yearly, a store's opening order brings store reorders.
  const isLarge = (amountMinor: number) => (billing.kind === "subscription" ? amountMinor === billing.yearlyMinor : amountMinor >= LARGE_ORDER_MINOR);
  const cards = business.milestones.filter((m) => m.customerName && m.amountMinor != null && m.achievedAt);
  const byCount = (m: (typeof cards)[number]) => (customerCountOf(m.key) === null ? 0 : 1);
  const named = [j.updatePayment, ...j.customers.large, ...[...cards].sort((a, b) => byCount(a) - byCount(b)).map((m) => ({ day: cardDay(m), name: m.customerName!, amountMinor: m.amountMinor! }))].map((p) => ({ ...p, large: isLarge(p.amountMinor) }));
  const reserved = new Set(named.map((p) => p.name));
  const ledger = buildLedger({
    seed: `journey:${business.identity.id}`,
    currency: business.currency,
    days: daily.map((r) => r.day),
    activity: daily.map((r) => r.agentHours),
    anchors: [...counts].map(([day, count]) => ({ day, count })),
    named,
    names: j.customerNames.filter((n) => !reserved.has(n)),
    funnel: j.customers.funnel,
    billing,
    firstReorderOn: business.milestones.find((m) => m.key === "first_reorder")?.achievedAt?.slice(0, 10),
  });
  const at = new Map(daily.map((r, i) => [r.day, i]));
  const rows = d.rows.map((r) => {
    const i = at.get(r.day)!;
    if (r.departmentId === null) return { ...r, revenueMinor: ledger.revenueMinor[i]!, signups: ledger.signups[i]!, activations: ledger.activations[i]!, payments: ledger.newCustomers[i]! };
    // Sales are Distribution's work, as in the fixture; the departments' revenue adds up to the business's.
    return { ...r, revenueMinor: r.departmentId === "d-distribution" ? ledger.revenueMinor[i]! : 0 };
  });
  // The forecast: the last 30 days' revenue per day, growing a third over six months, inside a widening cone.
  const dailyMean = ledger.revenueMinor.slice(-30).reduce((s, v) => s + v, 0) / 30;
  const forecast = d.forecast.map((f, k) => {
    const t = (k + 1) / d.forecast.length;
    const base = dailyMean * (1 + 0.35 * t);
    return { ...f, baseMinor: Math.round(base), upsideMinor: Math.round(base * (1 + 0.45 * t)), downsideMinor: Math.round(base * (1 - 0.4 * t)) };
  });
  // A pin points at the payment its milestone card names: the card's customer, or the Nth customer of a `customer_N` card.
  const paymentFor = (label: string, day: string) => {
    const card = business.milestones.find((c) => c.label === label);
    if (!card) return undefined;
    const n = customerCountOf(card.key);
    if (card.customerName) return ledger.payments.find((p) => p.entityName === card.customerName && p.occurredAt.startsWith(day));
    return n !== null ? ledger.payments[n - 1] : undefined;
  };
  return {
    ...d,
    rows,
    forecast,
    conversions: ledger.conversions,
    milestones: d.milestones.map((m) => {
      const dollars = m.label.replace(/€/g, "$");
      const label = j.milestoneLabels[m.label] ?? j.milestoneLabels[dollars] ?? dollars;
      if (!m.ref) return { ...m, label };
      const paid = paymentFor(label, m.achievedAt.slice(0, 10));
      return { ...m, label, ref: paid ? { conversionId: paid.id } : null };
    }),
    chapters: d.chapters.map((c) => ({ ...c, title: c.title ? (j.chapterTitles[c.index] ?? c.title) : null })),
    roadmap: d.roadmap.map((r, i) => ({ ...r, label: j.roadmap[i] ?? r.label })),
    ledger,
  };
}
