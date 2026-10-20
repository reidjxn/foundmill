/**
 * Seeded demo data for the journey group's stories and tests (Northwind Skincare, BUILD §17.2).
 * Deterministic (lib/seed), no network, shaped like `@foundmill/journey`'s synthetic generator:
 * ramp-up, growth, weekly rhythm, launches, one dip, trophies in order. Not exported from the package barrel.
 */
import { addDays, format, parseISO, startOfQuarter, endOfQuarter, differenceInCalendarDays } from "date-fns";
import type { AgentStatus, ConversionKind } from "@foundmill/shared";
import { createRng, seededUuid, type Rng } from "../../lib/seed";
import type {
  Chapter,
  CommentaryLine,
  Concept,
  ConceptAttribute,
  Conversion,
  CustomerFacts,
  DepartmentCardData,
  ForecastPoint,
  Journey,
  JourneyDailyRow,
  Kit,
  Milestone,
  RibbonDepartment,
  RoadmapFlag,
  SquadPulseCell,
  StageAgentMeta,
  Touch,
  TrophyCard,
  XcPoint,
} from "./types";
import { CONCEPT_ATTRIBUTE_KEYS } from "./types";

export const NORTHWIND_KIT: Kit = { primary: "#2B6CB0", secondary: "#FFFFFF" };
export const LEDGERLY_KIT: Kit = { primary: "#1F6F5F", secondary: "#E8C56B" };
export const FIXTURE_TODAY = "2026-10-07";

export const RIBBON_DEPARTMENTS: RibbonDepartment[] = [
  { id: "d-product", name: "Product", dept: "dept-1" },
  { id: "d-development", name: "Formulation Lab", dept: "dept-2" },
  { id: "d-distribution", name: "Distribution", dept: "dept-3" },
  { id: "d-finance", name: "Finance", dept: "dept-4" },
  { id: "d-team", name: "Team", dept: "dept-5" },
  { id: "d-operations", name: "Operations", dept: "dept-7" },
];

const day = (d: Date) => format(d, "yyyy-MM-dd");

function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (rng.next() + rng.next() + rng.next() - 1.5) * 1.6));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

export interface GeneratedJourneyData {
  rows: JourneyDailyRow[];
  conversions: Conversion[];
  milestones: Milestone[];
  chapters: Chapter[];
  forecast: ForecastPoint[];
  roadmap: RoadmapFlag[];
  kickoff: string;
  today: string;
}

/**
 * `days` of daily rows per department (plus a business-wide row), conversions, milestones and chapters, ending at
 * `today`. 730 days × 6 departments is the Ribbon's performance fixture (AC-11.2.1).
 */
export function generateJourneyFixture(opts: { days?: number; today?: string; seed?: string; departments?: RibbonDepartment[] } = {}): GeneratedJourneyData {
  const days = opts.days ?? 730;
  const today = opts.today ?? FIXTURE_TODAY;
  const departments = opts.departments ?? RIBBON_DEPARTMENTS;
  const rng = createRng(opts.seed ?? "journey-fixture");
  const todayDate = parseISO(today);
  const kickoffDate = addDays(todayDate, -(days - 1));
  const rows: JourneyDailyRow[] = [];
  const conversions: Conversion[] = [];
  const milestones: Milestone[] = [];
  const launches = [0.18, 0.41, 0.63, 0.86].map((f) => Math.floor(days * f));
  const dipStart = Math.floor(days * 0.57);
  const dipEnd = Math.floor(days * 0.615);
  const deptWeight: Record<string, number> = { "d-product": 0.9, "d-development": 1.4, "d-distribution": 1.2, "d-finance": 0.45, "d-team": 0.35, "d-operations": 0.8 };
  let customers = 0;
  let mrrMinor = 0;
  const trophyFired = new Set<string>();
  const customerNames = ["Nordic Beauty AB", "Sara Lindqvist", "Meridian Labs", "Alma Botanics", "Oslo Apothecary", "Linnea Haug", "Birch & Fern", "Kaj Petersen", "Glow Collective", "Helsinki Derm"];

  for (let i = 0; i < days; i++) {
    const d = addDays(kickoffDate, i);
    const key = day(d);
    const ramp = 0.3 + 0.7 * (1 - Math.exp(-i / 45));
    const growth = 1 + 0.6 * (i / days);
    // The weekday of the local calendar day `d` stands for (parseISO and format are local too): getUTCDay() read the
    // day before east of UTC, so the example business showed different figures in different time zones.
    const dow = d.getDay();
    const weekly = dow === 0 || dow === 6 ? 0.55 : 1;
    const season = 1 + 0.12 * Math.sin((2 * Math.PI * (i + 40)) / 365);
    let launchBoost = 1;
    for (const l of launches) if (i >= l && i < l + 21) launchBoost *= 1.35;
    const dip = i >= dipStart && i < dipEnd ? 0.55 : 1;
    const base = ramp * growth * weekly * season * launchBoost * dip;
    let totalHours = 0;
    let totalTasks = 0;
    let totalSpend = 0;
    let totalRevenue = 0;
    let totalDecisions = 0;
    for (const dept of departments) {
      const w = deptWeight[dept.id] ?? 0.6;
      const hours = Math.max(0, base * w * 6 * (0.75 + rng.next() * 0.5));
      const tasks = poisson(rng, base * w * 1.8);
      const spend = Math.round(base * w * 4200 * (0.8 + rng.next() * 0.4));
      const rev = dept.id === "d-distribution" ? Math.round(base * 18000 * (0.7 + rng.next() * 0.6)) : 0;
      const decisions = poisson(rng, base * w * 0.25);
      rows.push({ day: key, departmentId: dept.id, agentHours: Math.round(hours * 100) / 100, tasksDone: tasks, spendMinor: spend, revenueMinor: rev, signups: 0, activations: 0, payments: 0, decisions });
      totalHours += hours;
      totalTasks += tasks;
      totalSpend += spend;
      totalRevenue += rev;
      totalDecisions += decisions;
    }
    const signups = poisson(rng, base * 2.4);
    const activations = Math.min(signups, poisson(rng, base * 1.3));
    const payments = Math.min(activations, poisson(rng, base * 0.7));
    rows.push({ day: key, departmentId: null, agentHours: Math.round(totalHours * 100) / 100, tasksDone: totalTasks, spendMinor: totalSpend, revenueMinor: totalRevenue, signups, activations, payments, decisions: totalDecisions });
    const kinds: Array<[ConversionKind, number]> = [
      ["signup", signups],
      ["activation", activations],
      ["payment", payments],
    ];
    for (const [kind, n] of kinds) {
      for (let k = 0; k < n; k++) {
        const hour = 7 + rng.int(0, 13);
        const amount = kind === "payment" ? (rng.bool(0.08) ? rng.int(120000, 480000) : rng.int(2900, 14900)) : 0;
        const c: Conversion = {
          id: seededUuid(rng),
          entityId: seededUuid(rng),
          entityName: rng.pick(customerNames),
          kind,
          amountMinor: amount,
          currency: "EUR",
          occurredAt: `${key}T${String(hour).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00.000Z`,
          firstPayment: true,
        };
        conversions.push(c);
        if (kind === "payment") {
          customers += 1;
          mrrMinor += Math.round(amount / 12);
          const trophy = (keyName: string, label: string) => {
            if (trophyFired.has(keyName)) return;
            trophyFired.add(keyName);
            milestones.push({ id: seededUuid(rng), kind: keyName.startsWith("mrr") ? "revenue" : "customer", label, achievedAt: c.occurredAt, trophyKey: keyName, ref: { conversionId: c.id } });
          };
          if (customers === 1) trophy("customer_1", "First customer");
          if (customers === 10) trophy("customer_10", "10th customer");
          if (customers === 100) trophy("customer_100", "100th customer");
          if (customers === 1000) trophy("customer_1000", "1,000th customer");
          if (mrrMinor >= 100000) trophy("mrr_1k", "€1K MRR");
          if (mrrMinor >= 1000000) trophy("mrr_10k", "€10K MRR");
          if (mrrMinor >= 10000000) trophy("mrr_100k", "€100K MRR");
          if (amount >= 120000) trophy("first_enterprise_contract", "First enterprise contract");
        }
      }
    }
  }

  // Releases, decisions, banners.
  const banner = (offset: number, kind: Milestone["kind"], label: string) => {
    if (offset < 0 || offset >= days) return;
    milestones.push({ id: seededUuid(rng), kind, label, achievedAt: `${day(addDays(kickoffDate, offset))}T10:00:00.000Z` });
  };
  banner(0, "launch", "Launch day");
  banner(Math.min(12, days - 1), "incorporation", "Northwind Skincare AB incorporated");
  launches.forEach((l, i) => banner(l, "release", ["Retinol serum v1", "Bundle builder", "Subscription plans", "Retail pack"][i] ?? "Release"));
  banner(Math.floor(days * 0.3), "decision", "Chose DTC over wholesale");
  banner(Math.floor(days * 0.52), "funding", "Pre-seed closed");
  banner(Math.floor(days * 0.74), "decision", "Moved production to Meridian Labs");
  milestones.sort((a, b) => a.achievedAt.localeCompare(b.achievedAt));

  // Chapters: one per quarter from kick-off to today, plus the horizon quarter.
  const chapters: Chapter[] = [];
  const horizon = addDays(todayDate, 183);
  let cursor = startOfQuarter(kickoffDate);
  let index = 0;
  const titles = ["Finding the formula", "First customers", "The bundle chapter", "Scaling the lab", "Retail on the horizon", "Steady state", "Second summer", "Northern expansion", "Fall push"];
  while (cursor <= horizon) {
    const start = cursor;
    const end = endOfQuarter(cursor);
    const q = Math.floor(start.getMonth() / 3) + 1;
    const status: Chapter["status"] = end < todayDate ? "past" : start > todayDate ? "future" : "current";
    chapters.push({
      id: `${start.getFullYear()}-Q${q}`,
      index,
      year: start.getFullYear(),
      quarter: q,
      startsOn: day(start),
      endsOn: day(end),
      status,
      title: status === "past" ? (titles[index] ?? null) : null,
      provisionalTitle: `Chapter ${index + 1}`,
    });
    cursor = addDays(end, 1);
    index += 1;
  }

  // Forecast cone: trailing-30 revenue mean projected 6 months with widening bounds.
  const last30 = rows.filter((r) => r.departmentId === null).slice(-30);
  const dailyMean = last30.reduce((s, r) => s + r.revenueMinor, 0) / Math.max(1, last30.length);
  const forecast: ForecastPoint[] = [];
  for (let i = 1; i <= 183; i++) {
    const t = i / 183;
    const base = dailyMean * (1 + 0.35 * t);
    forecast.push({ day: day(addDays(todayDate, i)), baseMinor: Math.round(base), upsideMinor: Math.round(base * (1 + 0.45 * t)), downsideMinor: Math.round(base * (1 - 0.4 * t)) });
  }
  const roadmap: RoadmapFlag[] = [
    { id: "r1", label: "Night cream launch", plannedOn: day(addDays(todayDate, 24)) },
    { id: "r2", label: "Nordic Beauty listing", plannedOn: day(addDays(todayDate, 58)) },
    { id: "r3", label: "Refill program", plannedOn: day(addDays(todayDate, 121)) },
  ];
  return { rows, conversions, milestones, chapters, forecast, roadmap, kickoff: day(kickoffDate), today };
}

export function fixtureDaysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}

/* ---------- Customer Update fixture ---------- */

export const STAGE_AGENTS: StageAgentMeta[] = [
  { agentId: "a-scout", seed: "scout", dept: "dept-3", status: "healthy", model: "sonnet" },
  { agentId: "a-lifecycle", seed: "lifecycle", dept: "dept-3", status: "healthy", model: "haiku" },
  { agentId: "a-content", seed: "content", dept: "dept-1", status: "idle", model: "sonnet" },
];

export interface MatchDayFixture {
  journey: Journey;
  touches: Touch[];
  customer: CustomerFacts;
  agents: StageAgentMeta[];
}

/** A featured update: Nordic Beauty AB's first payment after nine touches across four channels. */
export function matchDayFixture(seed = "matchday"): MatchDayFixture {
  const rng = createRng(seed);
  const entityId = seededUuid(rng);
  const conversionId = seededUuid(rng);
  const start = new Date("2026-09-14T08:12:00.000Z").getTime();
  const spec: Array<{ h: number; channel: Touch["channelKey"]; kind: Touch["kind"]; label: string; agent: string | null; w: number }> = [
    { h: 0, channel: "paid_ads", kind: "ad_click", label: "Clicked the retinol serum ad", agent: "a-scout", w: 0.4 },
    { h: 0.05, channel: "paid_ads", kind: "visit", label: "Landed on /serum", agent: null, w: 0.02 },
    { h: 52, channel: "content", kind: "visit", label: "Read 'Why retinol needs a slow start'", agent: "a-content", w: 0.04 },
    { h: 120, channel: "email_automation", kind: "email_delivered", label: "Received 'Welcome to Northwind'", agent: "a-lifecycle", w: 0.03 },
    { h: 122, channel: "email_automation", kind: "email_open", label: "Opened 'Welcome to Northwind'", agent: "a-lifecycle", w: 0.03 },
    { h: 123, channel: "email_automation", kind: "email_click", label: "Clicked through to the bundle builder", agent: "a-lifecycle", w: 0.05 },
    { h: 200, channel: "social", kind: "social_engagement", label: "Saved the before/after post", agent: "a-content", w: 0.03 },
    { h: 310, channel: "lead_generation", kind: "call", label: `Call with [[ent:${entityId}|Nordic Beauty AB]] buying team`, agent: "a-scout", w: 0.1 },
    { h: 402, channel: "email_automation", kind: "email_reply", label: "Replied: 'Send the wholesale sheet'", agent: "a-lifecycle", w: 0.3 },
  ];
  const touches: Touch[] = spec.map((s) => ({
    id: seededUuid(rng),
    entityId,
    occurredAt: new Date(start + s.h * 3600_000).toISOString(),
    channelKey: s.channel,
    kind: s.kind,
    firstParty: true,
    source: { label: s.label, agentId: s.agent },
  }));
  const weights: Record<string, number> = {};
  touches.forEach((t, i) => (weights[t.id] = spec[i]?.w ?? 0));
  const convertedAt = new Date(start + 420 * 3600_000).toISOString();
  let cumulative = 0;
  const xcSeries: XcPoint[] = touches.map((t, i) => {
    const p = [0.08, 0.02, 0.06, 0.05, 0.05, 0.12, 0.04, 0.3, 0.45][i] ?? 0.05;
    cumulative = 1 - (1 - cumulative) * (1 - p);
    return { index: i, touchId: t.id, at: t.occurredAt, p, cumulative: Math.round(cumulative * 1000) / 1000 };
  });
  xcSeries.push({ index: touches.length, touchId: null, at: convertedAt, p: 0, cumulative: 1 });
  const agentTouches = (id: string) => touches.filter((_, i) => spec[i]?.agent === id).map((t) => t.id);
  const contribution = (ids: string[]) => ids.reduce((s, id) => s + (weights[id] ?? 0), 0);
  const scout = contribution(agentTouches("a-scout"));
  const lifecycle = contribution(agentTouches("a-lifecycle"));
  const content = contribution(agentTouches("a-content"));
  const best = Math.max(scout, lifecycle, content);
  const rating = (c: number) => Math.max(1, Math.min(10, Math.round((c / best) * 9 + 1)));
  const channelWeights = new Map<string, { w: number; n: number }>();
  touches.forEach((t) => {
    const k = t.channelKey ?? "direct";
    const cur = channelWeights.get(k) ?? { w: 0, n: 0 };
    channelWeights.set(k, { w: cur.w + (weights[t.id] ?? 0), n: cur.n + 1 });
  });
  const captainTouch = touches.reduce((a, b) => ((weights[b.id] ?? 0) >= (weights[a.id] ?? 0) ? b : a));
  const commentary: CommentaryLine[] = [
    { touchId: touches[0]?.id, text: `A sharp opening: [[ent:a-scout-0000-4000-8000-000000000001|Scout]]'s retinol ad finds the buyer on a Monday morning.`, highlight: true },
    { touchId: touches[2]?.id, text: "Two days of silence, then the slow-start article does the patient work." },
    { touchId: touches[5]?.id, text: "The welcome sequence lands and the bundle builder gets its first look.", highlight: true },
    { touchId: touches[7]?.id, text: `Scout on the phone with the buying team at [[ent:${entityId}|Nordic Beauty AB]]. The pitch holds.`, highlight: true },
    { touchId: touches[8]?.id, text: "'Send the wholesale sheet.' The closer. Lifecycle delivers it within the hour.", highlight: true },
  ];
  const journey: Journey = {
    id: seededUuid(rng),
    conversionId,
    entityId,
    kind: "payment",
    touchIds: touches.map((t) => t.id),
    weights,
    xcSeries,
    commentary,
    agents: [
      { agentId: "a-scout", name: "Scout", role: "Distribution lead", departmentId: "d-distribution", contribution: scout, touchIds: agentTouches("a-scout"), rating: rating(scout) },
      { agentId: "a-lifecycle", name: "Lifecycle", role: "Email automation", departmentId: "d-distribution", contribution: lifecycle, touchIds: agentTouches("a-lifecycle"), rating: rating(lifecycle) },
      { agentId: "a-content", name: "Quill", role: "Content", departmentId: "d-product", contribution: content, touchIds: agentTouches("a-content"), rating: rating(content) },
    ],
    matchdayLevel: "cup",
    channels: Array.from(channelWeights, ([k, v]) => ({ channelKey: k === "direct" ? null : (k as Touch["channelKey"]), weight: Math.round(v.w * 1000) / 1000, touchCount: v.n })).sort((a, b) => b.weight - a.weight),
    captain: { touchId: captainTouch.id, channelKey: captainTouch.channelKey, agentId: captainTouch.source?.agentId ?? null, weight: weights[captainTouch.id] ?? 0 },
    playerOfTheMatch: scout >= lifecycle ? "a-scout" : "a-lifecycle",
    attributionModel: "position_based_40_20_40",
    xcModelSource: "archetype_prior",
    consent: "granted",
    partialJourney: false,
    nthOfKind: 37,
    fullMatchDay: true,
    stats: { touchCount: touches.length, firstTouchAt: touches[0]?.occurredAt ?? null, lastTouchAt: touches[touches.length - 1]?.occurredAt ?? null, timeToConvertHours: 420, acquisitionCostMinor: 18640, currency: "EUR" },
    convertedAt,
    amountMinor: 186000,
    currency: "EUR",
  };
  const customer: CustomerFacts = {
    name: "Nordic Beauty AB",
    kind: "organisation",
    entityId,
    facts: [
      { label: "Segment", value: "Retail · Stockholm" },
      { label: "Plan", value: "Wholesale starter · €1,860 / yr" },
      { label: "First seen", value: "Sep 14, 2026" },
      { label: "Contact", value: "Sara Lindqvist, Head of buying" },
      { label: "Consent", value: "Granted" },
    ],
  };
  return { journey, touches, customer, agents: STAGE_AGENTS };
}

/* ---------- Concept cards ---------- */

const CONCEPT_SPECS: Array<{ name: string; pitch: string; kit: Kit; values: number[]; current: number; potential: number; verdict: string }> = [
  {
    name: "Northwind Skincare",
    pitch: "Clinical-grade retinol routines for Nordic skin, sold direct with a refill subscription.",
    kit: { primary: "#2B6CB0", secondary: "#FFFFFF" },
    values: [15, 12, 9, 13, 8, 14, 16, 11, 9, 14],
    current: 3,
    potential: 4.5,
    verdict: "Clear pull and a founder who knows the category. Capital intensity is the risk: stock before revenue.",
  },
  {
    name: "Ledgerly",
    pitch: "Usage-based bookkeeping for one-person SaaS companies, reconciled nightly by agents.",
    kit: { primary: "#1F6F5F", secondary: "#E8C56B" },
    values: [13, 15, 7, 16, 17, 18, 12, 10, 8, 15],
    current: 3.5,
    potential: 4.5,
    verdict: "The most agent-executable concept on the board; competition is dense but slow.",
  },
  {
    name: "Fjord Freight",
    pitch: "A marketplace matching small exporters with half-empty trucks on Scandinavian routes.",
    kit: { primary: "#B23A48", secondary: "#F5E6C8" },
    values: [11, 17, 10, 7, 9, 10, 8, 14, 7, 9],
    current: 2,
    potential: 4,
    verdict: "Big market, two-sided chicken-and-egg. Slow to a first customer.",
  },
  {
    name: "Studio Allan",
    pitch: "Weekly short-form explainers for regional banks, produced by a content team.",
    kit: { primary: "#5A4FCF", secondary: "#FFFFFF" },
    values: [9, 8, 12, 17, 18, 16, 13, 6, 16, 12],
    current: 2.5,
    potential: 3,
    verdict: "Fast to revenue and cheap to run; little defensibility beyond taste.",
  },
];

export function conceptFixtures(): Concept[] {
  return CONCEPT_SPECS.map((s, i) => {
    const rng = createRng(`concept:${s.name}`);
    const attributes: ConceptAttribute[] = CONCEPT_ATTRIBUTE_KEYS.map((key, k) => ({
      key,
      value: s.values[k] ?? 10,
      evidence: [
        { text: rng.pick(["Three comparable products priced €38–€64 per month.", "Search volume up 22% year on year in the Nordics.", "Two funded competitors; neither ships weekly.", "Founder has eight years in the category.", "Regulated under EU cosmetics rules; no pre-approval."]), source: rng.pick(["Research agent", "Statista", "Crunchbase", "Founder profile"]) },
        { text: rng.pick(["Pricing comparables cluster around an annual plan.", "First-customer path is a warm intro, then a pilot.", "Agents can run 70% of the weekly work in a sandbox."]), source: "Research agent" },
      ],
    }));
    return { id: `concept-${i + 1}`, name: s.name, pitch: s.pitch, kit: s.kit, currentStars: s.current, potentialStars: s.potential, attributes, verdict: s.verdict, citations: 2 + rng.int(0, 4), archetypeLabel: ["DTC physical product", "B2B SaaS", "Marketplace", "Content / media"][i], version: 1 };
  });
}

/* ---------- Department cards, squad pulse, trophies ---------- */

const squad = (dept: DepartmentCardData["dept"], names: Array<[string, string, string, AgentStatus, string | null]>) =>
  names.map(([name, role, model, status, task], i) => ({ id: `${dept}-${i}`, name, seed: name.toLowerCase(), status, role, model, task }));

export function departmentCardFixtures(): DepartmentCardData[] {
  const rng = createRng("dept-cards");
  const series = (base: number, drift: number) => Array.from({ length: 14 }, (_, i) => Math.max(0, base + drift * i + rng.range(-base * 0.15, base * 0.15)));
  return [
    {
      id: "d-distribution",
      name: "Distribution",
      dept: "dept-3",
      lead: { name: "Scout", seed: "scout", status: "healthy" },
      health: "good",
      healthWord: "Healthy",
      squad: squad("dept-3", [
        ["Scout", "Distribution lead", "sonnet", "healthy", "Weekly channel review"],
        ["Lifecycle", "Email automation", "haiku", "healthy", "Welcome sequence v3"],
        ["Beacon", "Paid ads", "sonnet", "degraded", "Waiting: budget above threshold"],
        ["Quill", "Content", "sonnet", "idle", null],
      ]),
      now: ["Lifecycle sent 240 welcome emails; 38 opened", "Scout is drafting the wholesale sheet for [[ent:0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c|Nordic Beauty AB]]", "Beacon paused the retinol campaign pending approval"],
      metric: { label: "Cost to win a customer", value: "€41.20", series: series(52, -0.8), delta: "▼ 9.4%", deltaTone: "good", provenance: "estimate" },
      nextUp: "Retail listing proposal for Nordic Beauty (Thu)",
    },
    {
      id: "d-development",
      name: "Formulation Lab",
      dept: "dept-2",
      lead: { name: "Forge", seed: "forge", status: "degraded" },
      health: "warn",
      healthWord: "Waiting",
      squad: squad("dept-2", [
        ["Forge", "Backend", "opus", "degraded", "Waiting: schema change approval"],
        ["Pixel", "Frontend", "sonnet", "healthy", "Bundle picker UI"],
        ["Probe", "QA", "haiku", "healthy", "Playwright suite for checkout"],
        ["Atlas", "Research", "sonnet", "paused", null],
        ["Mortar", "Infra", "sonnet", "idle", null],
      ]),
      now: ["Pixel merged the bundle picker; 14 tests green", "Forge is blocked on the subscriptions table change", "Probe found a flaky checkout test and quarantined it"],
      metric: { label: "Tasks finished this week", value: "11", series: series(8, 0.3), delta: "▲ 3", deltaTone: "good" },
      nextUp: "Subscription plans release (needs your approval)",
    },
    {
      id: "d-finance",
      name: "Finance",
      dept: "dept-4",
      lead: { name: "Ledger", seed: "ledger", status: "failing" },
      health: "bad",
      healthWord: "Failing",
      squad: squad("dept-4", [
        ["Ledger", "Finance lead", "opus", "failing", "Bank sync failed 3× (Tink consent expired)"],
        ["Tally", "Bookkeeping", "haiku", "injured", "Loop detected; stopped"],
      ]),
      now: ["Bank sync has failed three times since 6:10 AM", "Tink consent expired; a reconnect is waiting in your Inbox"],
      metric: { label: "Months of cash left", value: "7.5 mo", series: series(9, -0.12), delta: "▼ 0.4 mo", deltaTone: "bad", provenance: "estimate" },
      nextUp: "Reconnect the bank (2 min) so the P&L closes",
    },
    {
      id: "d-product",
      name: "Product",
      dept: "dept-1",
      lead: { name: "Compass", seed: "compass", status: "idle" },
      health: "good",
      healthWord: "Quiet",
      squad: squad("dept-1", [
        ["Compass", "Product lead", "sonnet", "idle", null],
        ["Quill", "Content", "sonnet", "idle", null],
      ]),
      now: [],
      metric: { label: "Roadmap items on track", value: "6 of 7", series: series(5, 0.1) },
      nextUp: "Quarterly review draft on Friday",
    },
  ];
}

export function squadPulseFixture(seed = "pulse"): { cells: SquadPulseCell[]; days: string[] } {
  const rng = createRng(seed);
  const cells: SquadPulseCell[] = [];
  const days = Array.from({ length: 7 }, (_, i) => day(addDays(parseISO(FIXTURE_TODAY), i - 6)));
  for (let d = 0; d < 7; d++) {
    const weekend = d === 0 || d === 6;
    for (let h = 0; h < 24; h++) {
      const daytime = h >= 6 && h <= 20 ? 1 : 0.25;
      for (const dept of RIBBON_DEPARTMENTS) {
        const w: Record<string, number> = { "d-product": 0.5, "d-development": 1.3, "d-distribution": 1.0, "d-finance": h < 9 ? 0.9 : 0.2, "d-team": 0.2, "d-operations": 0.6 };
        const hours = Math.max(0, (w[dept.id] ?? 0.4) * daytime * (weekend ? 0.4 : 1) * rng.range(0.2, 1.1) - 0.15);
        if (hours > 0.02) cells.push({ departmentId: dept.id, dayIndex: d, hour: h, agentHours: Math.round(hours * 100) / 100 });
      }
    }
  }
  return { cells, days };
}

export function trophyFixtures(): TrophyCard[] {
  return [
    { key: "customer_1", label: "First customer", description: "The first paying customer.", achievedAt: "2024-11-19T14:02:00.000Z", customerName: "Alma Botanics", amountMinor: 5900, currency: "EUR", shareable: true },
    { key: "customer_10", label: "10th customer", description: "Ten paying customers.", achievedAt: "2025-01-08T09:41:00.000Z", customerName: null, shareable: true },
    { key: "customer_100", label: "100th customer", description: "One hundred paying customers.", achievedAt: "2025-09-22T16:20:00.000Z", customerName: null, shareable: true },
    { key: "customer_1000", label: "1,000th customer", description: "One thousand paying customers.", achievedAt: null },
    { key: "mrr_1k", label: "€1K MRR", description: "Monthly recurring revenue crosses €1,000.", achievedAt: "2025-02-14T11:00:00.000Z", shareable: true },
    { key: "mrr_10k", label: "€10K MRR", description: "Monthly recurring revenue crosses €10,000.", achievedAt: "2026-03-03T08:15:00.000Z", shareable: true },
    { key: "mrr_100k", label: "€100K MRR", description: "Monthly recurring revenue crosses €100,000.", achievedAt: null },
    { key: "first_enterprise_contract", label: "First enterprise contract", description: "A contract above the enterprise threshold.", achievedAt: "2026-10-01T15:30:00.000Z", customerName: "Nordic Beauty AB", amountMinor: 186000, currency: "EUR", shareable: true },
  ];
}
