/**
 * Pure helpers over an example business: money in its own currency and locale, the shared "today", department lookups,
 * the team orbit, the channel roster and the two-year Journey. Each takes the business as an argument, so the sections,
 * the cycle reducer and the tests all read the same data the same way.
 */
import { formatMoney, mockChannels, type ChannelTokenData, type Concept, type MockChannelProfile, type SkillRow, type TeamOrbitDepartment, type TrophyCard } from "@foundmill/dugout";
import { FIXTURE_TODAY, generateJourneyFixture } from "@foundmill/dugout/components/journey/fixtures";
import { MODULE_TABS } from "@foundmill/shared/constants";
import { buildLedger, type Ledger } from "./ledger";
import type { ExampleBusiness, ExampleCustomerUpdate, ExampleDepartment, ExampleLead } from "./types";

/** A money figure of the example business, from minor units: "$42.00" (en-US, never en-GB's "US$42.00"). */
export function exampleMoney(business: ExampleBusiness, amountMinor: number): string {
  return formatMoney({ amountMinor, currency: business.currency }, { locale: business.locale });
}

/**
 * Today on every example business, as local noon on the given calendar day ("2026-10-12"). The page is server-rendered
 * in UTC and hydrated in the visitor's time zone, and every date it prints must read the same in both: a date-only ISO
 * string parses as UTC midnight and prints as the day before west of UTC, so the date is built in local time.
 */
export function exampleToday(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

/** The calendar day of `now` ("2026-10-12"): in UTC, as the server renders it, or in the visitor's own time zone. */
export function calendarDay(now: Date, zone: "utc" | "local"): string {
  const [y, m, d] = zone === "utc" ? [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()] : [now.getFullYear(), now.getMonth(), now.getDate()];
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The day every example's story is written for. The page shows each story moved to today: every date in it (the Journey,
 * the milestone cards, the Customer Update) moves by the same number of days, so they keep agreeing with each other.
 */
export const STORY_DAY = FIXTURE_TODAY;
/** The Journey's length in days, kick-off to today. */
export const JOURNEY_DAYS = 730;

/** Days from the story's day to `today` (both YYYY-MM-DD): how far the page moves the story. */
export function storyOffset(today: string): number {
  return Math.round((utcDay(today) - utcDay(STORY_DAY)) / 86_400_000);
}

/** An ISO day or instant moved by whole days; the time of day, if any, stays as written. */
export function shiftDay(iso: string, days: number): string {
  if (days === 0) return iso;
  return `${new Date(utcDay(iso) + days * 86_400_000).toISOString().slice(0, 10)}${iso.slice(10)}`;
}

function utcDay(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

const STORY_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const STORY_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * Example prose with its dates moved by `days`. Prose names a day as a token on the story's calendar:
 * "{date:2026-09-20}" prints "Sep 20" and "{weekday:2026-09-20}" prints "Sunday", each after the move, so a weekday stays
 * true to its date. The same text prints the same in every time zone.
 */
export function storyText(text: string, days: number): string {
  return text.replace(/\{(date|weekday):(\d{4}-\d{2}-\d{2})\}/g, (_, kind: string, iso: string) => {
    const at = new Date(utcDay(shiftDay(iso, days)));
    return (kind === "date" ? STORY_DATE : STORY_WEEKDAY).format(at);
  });
}

/** The milestone cards, dated on the story moved to `today`. */
export function datedMilestones(business: ExampleBusiness, today: string): TrophyCard[] {
  const days = storyOffset(today);
  return business.milestones.map((m) => (m.achievedAt ? { ...m, achievedAt: shiftDay(m.achievedAt, days) } : m));
}

/** The Customer Update, its dates and weekdays on the story moved to `today`. */
export function datedCustomerUpdate(business: ExampleBusiness, today: string): ExampleCustomerUpdate {
  const days = storyOffset(today);
  const u = business.customerUpdate;
  return {
    ...u,
    customer: { ...u.customer, facts: u.customer.facts.map((f) => ({ ...f, value: storyText(f.value, days) })) },
    commentary: u.commentary.map((c) => ({ ...c, text: storyText(c.text, days) })),
  };
}

type ExampleChapter = ReturnType<typeof generateJourneyFixture>["chapters"][number];

/**
 * The chapters (calendar quarters) of a Journey ending on `today`: from the quarter of kick-off to the quarter six
 * months after today, numbered from 1. Past chapters take their titles in turn.
 */
export function exampleChapters(today: string, titles: readonly (string | null)[] = []): ExampleChapter[] {
  const kickoff = shiftDay(today, -(JOURNEY_DAYS - 1));
  const horizon = shiftDay(today, 183);
  const pad = (n: number) => String(n).padStart(2, "0");
  const chapters: ExampleChapter[] = [];
  let year = Number(kickoff.slice(0, 4));
  let quarter = Math.floor((Number(kickoff.slice(5, 7)) - 1) / 3) + 1;
  for (let index = 0; ; index++) {
    const startsOn = `${year}-${pad(quarter * 3 - 2)}-01`;
    if (startsOn > horizon) break;
    const endsOn = `${year}-${pad(quarter * 3)}-${pad(new Date(Date.UTC(year, quarter * 3, 0)).getUTCDate())}`;
    const status: ExampleChapter["status"] = endsOn < today ? "past" : startsOn > today ? "future" : "current";
    chapters.push({ id: `${year}-Q${quarter}`, index, year, quarter, startsOn, endsOn, status, title: status === "past" ? (titles[index] ?? null) : null, provisionalTitle: `Chapter ${index + 1}` });
    if (quarter === 4) [year, quarter] = [year + 1, 1];
    else quarter += 1;
  }
  return chapters;
}

/** The chapter today is in, as the deck's top bar names it: "Chapter 9". */
export function currentChapter(today: string): string {
  return exampleChapters(today).find((c) => c.status === "current")!.provisionalTitle;
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
export function exampleJourney(business: ExampleBusiness, today: string = STORY_DAY): ExampleJourneyData {
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
  const milestones = d.milestones.map((m) => {
    const dollars = m.label.replace(/€/g, "$");
    const label = j.milestoneLabels[m.label] ?? j.milestoneLabels[dollars] ?? dollars;
    if (!m.ref) return { ...m, label };
    const paid = paymentFor(label, m.achievedAt.slice(0, 10));
    return { ...m, label, ref: paid ? { conversionId: paid.id } : null };
  });
  // The story is built on its own calendar (the fixture's and the cards' dates agree there), then moved to `today`.
  const days = storyOffset(today);
  const fixtureTitles = new Map(d.chapters.map((c) => [c.index, c.title]));
  const titles = d.chapters.map((c) => j.chapterTitles[c.index] ?? fixtureTitles.get(c.index) ?? null);
  const moved = <T extends { occurredAt: string }>(c: T): T => ({ ...c, occurredAt: shiftDay(c.occurredAt, days) });
  const conversions = days === 0 ? ledger.conversions : ledger.conversions.map(moved);
  const byId = new Map(conversions.map((c) => [c.id, c]));
  return {
    ...d,
    rows: days === 0 ? rows : rows.map((r) => ({ ...r, day: shiftDay(r.day, days) })),
    forecast: forecast.map((f) => ({ ...f, day: shiftDay(f.day, days) })),
    conversions,
    milestones: milestones.map((m) => ({ ...m, achievedAt: shiftDay(m.achievedAt, days) })),
    chapters: exampleChapters(shiftDay(d.today, days), titles),
    roadmap: d.roadmap.map((r, i) => ({ ...r, label: j.roadmap[i] ?? r.label, plannedOn: shiftDay(r.plannedOn, days) })),
    kickoff: shiftDay(d.kickoff, days),
    today: shiftDay(d.today, days),
    ledger: days === 0 ? ledger : { ...ledger, conversions, payments: ledger.payments.map((p) => byId.get(p.id) ?? moved(p)), firstRepeatDay: ledger.firstRepeatDay && shiftDay(ledger.firstRepeatDay, days) },
  };
}
