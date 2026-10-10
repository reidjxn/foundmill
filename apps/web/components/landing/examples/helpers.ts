/**
 * Pure helpers over an example business: money in its own currency and locale, the shared "today", department lookups,
 * the team orbit, the channel roster and the two-year Journey. Each takes the business as an argument, so the sections,
 * the cycle reducer and the tests all read the same data the same way.
 */
import { formatMoney, mockChannels, type ChannelTokenData, type Concept, type MockChannelProfile, type SkillRow, type TeamOrbitDepartment } from "@foundmill/dugout";
import { generateJourneyFixture } from "@foundmill/dugout/components/journey/fixtures";
import { MODULE_TABS } from "@foundmill/shared/constants";
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

export type ExampleJourneyData = ReturnType<typeof generateJourneyFixture>;

/** The fixture's large first payments start here (its enterprise threshold): wholesale-sized orders. */
export const LARGE_ORDER_MINOR = 120_000;

/** Two years of the business's history: the design system's Journey fixture, relabelled and in its currency. */
export function exampleJourney(business: ExampleBusiness): ExampleJourneyData {
  const j = business.journey;
  const days = 730;
  const d = generateJourneyFixture({ days, departments: [...j.ribbonDepartments] });
  // The business's revenue scale (dates are UTC calendar days, so the index is the same in every time zone).
  const scale = j.revenueScale;
  const kickoff = Date.parse(d.kickoff);
  const factor = (day: string) => (scale ? scale.start * Math.pow(scale.end / scale.start, Math.min(1, Math.max(0, (Date.parse(day.slice(0, 10)) - kickoff) / 86_400_000 / (days - 1)))) : 1);
  const scaled = (amountMinor: number, day: string) => (scale ? Math.round(amountMinor * factor(day)) : amountMinor);
  const orderSize = (amountMinor: number, day: string) => (scale?.keepOrderSizes ? amountMinor : scaled(amountMinor, day));
  const large = j.largeOrderNames?.length ? j.largeOrderNames : null;
  let nextLarge = 0;
  // The Customer Update's customer owns one payment, the last on its day (`customerNames` leaves them out).
  const update = j.updatePayment;
  let updateIndex = -1;
  if (update) d.conversions.forEach((c, i) => (updateIndex = c.kind === "payment" && c.occurredAt.startsWith(update.day) ? i : updateIndex));
  const nameOf = (c: ExampleJourneyData["conversions"][number], i: number) => (i === updateIndex ? update!.name : large && c.kind === "payment" && c.amountMinor >= LARGE_ORDER_MINOR ? large[nextLarge++ % large.length]! : j.customerNames[i % j.customerNames.length]!);
  // A business sold on plans: a payment is a plan's price (the large ones a year up front), and no revenue comes before the first.
  const plan = j.planPrices?.pricesMinor.length ? j.planPrices : null;
  let nextPrice = 0;
  const amountOf = (c: ExampleJourneyData["conversions"][number]) => (plan && c.kind === "payment" ? (c.amountMinor >= LARGE_ORDER_MINOR ? plan.largeMinor : plan.pricesMinor[nextPrice++ % plan.pricesMinor.length]!) : orderSize(c.amountMinor, c.occurredAt));
  const firstPaid = plan ? d.conversions.find((c) => c.kind === "payment")?.occurredAt.slice(0, 10) : undefined;
  const revenueOf = (r: ExampleJourneyData["rows"][number]) => (firstPaid && r.day < firstPaid ? 0 : scaled(r.revenueMinor, r.day));
  return {
    ...d,
    rows: scale || firstPaid ? d.rows.map((r) => ({ ...r, revenueMinor: revenueOf(r) })) : d.rows,
    forecast: scale ? d.forecast.map((f) => ({ ...f, baseMinor: Math.round(f.baseMinor * scale.end), upsideMinor: Math.round(f.upsideMinor * scale.end), downsideMinor: Math.round(f.downsideMinor * scale.end) })) : d.forecast,
    conversions: d.conversions.map((c, i) => ({ ...c, amountMinor: amountOf(c), currency: business.currency, entityName: nameOf(c, i) })),
    milestones: d.milestones.map((m) => {
      const dollars = m.label.replace(/€/g, "$");
      return { ...m, label: j.milestoneLabels[m.label] ?? j.milestoneLabels[dollars] ?? dollars };
    }),
    chapters: d.chapters.map((c) => ({ ...c, title: c.title ? (j.chapterTitles[c.index] ?? c.title) : null })),
    roadmap: d.roadmap.map((r, i) => ({ ...r, label: j.roadmap[i] ?? r.label })),
  };
}
