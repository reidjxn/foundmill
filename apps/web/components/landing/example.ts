/**
 * Example data for the signed-out landing page. It is the Northwind Skincare example business the design system's
 * stories already use (`@foundmill/dugout` journey fixtures: brand colours, concepts, the Journey, milestones and a
 * Customer Update), plus the six department leads of the TeamOrbit. The page carries no colour literals and no
 * invented metrics: every number shown here is labelled Example or Estimate where it appears.
 */
import type { Concept, SkillRow, TrophyCard, Trait } from "@foundmill/dugout";
import type { DeptColourToken, ModuleKey } from "@foundmill/shared";
import { conceptFixtures, trophyFixtures } from "@foundmill/dugout/components/journey/fixtures";

export { NORTHWIND_KIT, RIBBON_DEPARTMENTS, generateJourneyFixture, matchDayFixture } from "@foundmill/dugout/components/journey/fixtures";

export const EXAMPLE_BUSINESS = { name: "Northwind Skincare", monogram: "NS", seed: "Northwind Skincare" } as const;
/** Where the example business is when the page opens: two years in (the Journey fixture), in its ninth chapter. */
export const EXAMPLE_START_CYCLE = 214;
export const EXAMPLE_CHAPTER = "Chapter 9";
export const EXAMPLE_RUNWAY_MONTHS = 14;
/**
 * Today on the example business, as local noon. The page is server-rendered in UTC and hydrated in the visitor's
 * time zone, and every date it prints must read the same in both: a date-only ISO string ("2026-10-07") parses as
 * UTC midnight and prints as 6 Oct west of UTC, so dates here are built in local time.
 */
export function exampleToday(): Date {
  return new Date(2026, 9, 7, 12);
}

/** An ISO instant moved to local noon on the same calendar day, so it prints the same day in every time zone. */
export function localNoon(iso: string): string {
  return `${iso.slice(0, 10)}T12:00:00`;
}

/** The milestones the example business has reached (no "not yet" cards), with time-zone-safe dates. */
export function exampleMilestones(): TrophyCard[] {
  return trophyFixtures()
    .filter((t) => t.achievedAt)
    .slice(0, 6)
    .map((t) => ({ ...t, achievedAt: t.achievedAt ? localNoon(t.achievedAt) : null }));
}

/** The Ideation Studio's example concepts without their evidence: the stories' evidence quotes real sources for invented facts. */
export function exampleConcepts(): Concept[] {
  return conceptFixtures().map((c) => ({ ...c, citations: undefined, attributes: c.attributes.map((a) => ({ key: a.key, value: a.value })) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The live activity: the hero feed and the ticker
// ---------------------------------------------------------------------------------------------------------------------

export interface ActivityLine {
  who: string;
  dept: DeptColourToken;
  text: string;
}

export const ACTIVITY: readonly ActivityLine[] = [
  { who: "Forge", dept: "dept-2", text: "opened a pull request for the bundle picker" },
  { who: "Scout", dept: "dept-3", text: "put SEO on the board at a fit of 16" },
  { who: "Ledger", dept: "dept-6", text: "reconciled this week's payments, 41 of 41 matched" },
  { who: "Lex", dept: "dept-5", text: "drafted the privacy policy for your review" },
  { who: "Iris", dept: "dept-1", text: "turned twelve customer interviews into three roadmap changes" },
  { who: "Juno", dept: "dept-2", text: "fixed the failing checkout test" },
  { who: "Atlas", dept: "dept-8", text: "trained Juno on testing, 10 to 16" },
  { who: "Pike", dept: "dept-3", text: "wrote four subject lines for the launch email" },
  { who: "Tally", dept: "dept-6", text: "updated the runway estimate to 14 months" },
  { who: "Quill", dept: "dept-1", text: "published 'Why retinol needs a slow start'" },
  { who: "Clause", dept: "dept-5", text: "flagged two clauses in the supplier agreement" },
  { who: "Wren", dept: "dept-2", text: "shipped the refill subscription to staging" },
];

// ---------------------------------------------------------------------------------------------------------------------
// The cycle in the hero deck: what each press of Continue brings back
// ---------------------------------------------------------------------------------------------------------------------

export interface ExampleDecision {
  kind: "decision";
  id: string;
  from: { name: string; seed: string; dept: DeptColourToken; role: string };
  department: string;
  subject: string;
  body: string;
  /** What the choice commits, already labelled. */
  stake: string;
  /** Each option: the button label, the Inbox line once chosen (`done`) and what happens next (`outcome`). */
  options: ReadonlyArray<{ id: string; label: string; recommended?: boolean; done: string; outcome: string }>;
}

export interface ExampleWin {
  kind: "win";
  id: string;
  customer: string;
  plan: string;
  firstTouch: string;
  standout: { name: string; seed: string; dept: DeptColourToken };
  involved: ReadonlyArray<{ name: string; seed: string; dept: DeptColourToken }>;
}

export type CycleOutcome = ExampleDecision | ExampleWin;

/** In order: the first press brings a decision, the second a customer, then they alternate with more decisions. */
export const CYCLE_OUTCOMES: readonly CycleOutcome[] = [
  {
    kind: "decision",
    id: "print",
    from: { name: "Scout", seed: "scout", dept: "dept-3", role: "Distribution Strategist" },
    department: "Distribution",
    subject: "Approve the first print booking?",
    body: "Artwork and the booking pack for 2,000 flyers in Oslo are ready. Booking commits budget, so it waits for you.",
    stake: "€480 · Estimate",
    options: [
      { id: "approve", label: "Approve", recommended: true, done: "Print booking approved", outcome: "You approved the print booking. Scout books it next cycle." },
      { id: "quote", label: "Get a quote first", done: "Quotes requested first", outcome: "Scout asks two printers for quotes and comes back to you." },
    ],
  },
  // The same customer as the Customer Update the gold card opens (the Journey fixture's featured update).
  {
    kind: "win",
    id: "nordic",
    customer: "Nordic Beauty AB",
    plan: "Wholesale starter · €1,860 a year",
    firstTouch: "Clicked the retinol serum ad",
    standout: { name: "Scout", seed: "scout", dept: "dept-3" },
    involved: [
      { name: "Scout", seed: "scout", dept: "dept-3" },
      { name: "Lifecycle", seed: "lifecycle", dept: "dept-3" },
      { name: "Quill", seed: "content", dept: "dept-1" },
    ],
  },
  {
    kind: "decision",
    id: "ads",
    from: { name: "Ledger", seed: "ledger", dept: "dept-6", role: "Finance lead" },
    department: "Finance",
    subject: "Raise the paid ads cap to €40 a day?",
    body: "Paid advertising is bringing customers in at €11 each. With a higher cap the runway still holds above 13 months.",
    stake: "+€450 a month · Estimate",
    options: [
      { id: "raise", label: "Raise to €40", recommended: true, done: "Ads cap raised to €40 a day", outcome: "You raised the cap. Ledger watches the cost per customer daily." },
      { id: "keep", label: "Keep €25", done: "Ads cap kept at €25 a day", outcome: "The cap stays at €25. Scout keeps testing new creative inside it." },
    ],
  },
  {
    kind: "decision",
    id: "contract",
    from: { name: "Lex", seed: "lex", dept: "dept-5", role: "Legal lead" },
    department: "Legal",
    subject: "Sign the supplier agreement?",
    body: "Lex drafted it, flagged two clauses and agreed fixes with the supplier. Signing is yours alone.",
    stake: "12-month term · no minimum order",
    options: [
      { id: "sign", label: "Review and sign", recommended: true, done: "Supplier agreement signed", outcome: "Signed by you. Lex files the copy and sets the renewal reminder." },
      { id: "ask", label: "Ask Lex a question", done: "Question sent to Lex", outcome: "Lex answers in your Inbox before anything moves." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// The team: six department leads with their ratings
// ---------------------------------------------------------------------------------------------------------------------

export interface ExampleLead {
  key: ModuleKey;
  department: string;
  dept: DeptColourToken;
  name: string;
  seed: string;
  role: string;
  model: "Opus" | "Sonnet";
  stars: { current: number; potential: number };
  /** What the department does, in one sentence. */
  remit: string;
  now: string;
  training: string;
  skills: readonly SkillRow[];
  traits: readonly Trait[];
}

const skill = (id: string, name: string, group: SkillRow["group"], value: number, delta: number, potential: number): SkillRow => ({ id, name, group, value, delta, potential, tested: 12, proven: Math.max(1, value - 2), tasks: 18 + value });

export const LEADS: readonly ExampleLead[] = [
  {
    key: "product",
    department: "Product",
    dept: "dept-1",
    name: "Iris",
    seed: "iris",
    role: "Product lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4.5 },
    remit: "A vision, a living specification and a roadmap that moves as customers teach you something.",
    now: "Turning twelve customer interviews into three roadmap changes",
    training: "Version 3 promoted: interview synthesis",
    skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Specification writing", "craft", 15, 1, 17), skill("prioritise", "Prioritisation", "judgement", 17, 1, 18), skill("no", "Saying no", "judgement", 14, 3, 17), skill("pace", "Pace", "execution", 13, 0, 15), skill("reliability", "Reliability", "execution", 15, 1, 17)],
    traits: [
      { id: "verbatim", label: "Quotes customers word for word", tone: "good" },
      { id: "cuts", label: "Cuts scope before adding it", tone: "good" },
      { id: "evidence", label: "Asks for evidence" },
    ],
  },
  {
    key: "development",
    department: "Development",
    dept: "dept-2",
    name: "Forge",
    seed: "forge",
    role: "Lead developer",
    model: "Sonnet",
    stars: { current: 3.5, potential: 5 },
    remit: "Agents plan the tasks, write and test code in sandboxes, and open pull requests for review.",
    now: "Opening a pull request for the bundle picker",
    training: "Version 4 promoted: tests first, smaller pull requests",
    skills: [skill("components", "Component craft", "craft", 15, 2, 18), skill("testing", "Testing", "craft", 16, 6, 18), skill("planning", "Planning", "judgement", 13, 1, 16), skill("scope", "Scope control", "judgement", 12, 3, 16), skill("reliability", "Reliability", "execution", 14, 1, 17), skill("speed", "Speed", "execution", 11, -3, 15)],
    traits: [
      { id: "tests_first", label: "Writes tests first", tone: "good" },
      { id: "small_prs", label: "Small pull requests", tone: "good" },
      { id: "slow_e2e", label: "Slower on end-to-end tests", tone: "warn" },
    ],
  },
  {
    key: "distribution",
    department: "Distribution",
    dept: "dept-3",
    name: "Scout",
    seed: "scout",
    role: "Distribution Strategist",
    model: "Sonnet",
    stars: { current: 3, potential: 4.5 },
    remit: "Fifteen channels scored for fit; the strongest start first, inside the budget caps you set.",
    now: "Putting SEO on the board at a fit of 16",
    training: "Version 2 promoted: test small before scaling",
    skills: [skill("fit", "Channel fit", "craft", 17, 1, 19), skill("copy", "Copywriting", "craft", 14, 2, 17), skill("experiments", "Experiment design", "judgement", 15, 2, 18), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Attribution", "execution", 13, 1, 16), skill("speed", "Speed to test", "execution", 15, 1, 17)],
    traits: [
      { id: "small_tests", label: "Tests small before scaling", tone: "good" },
      { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
      { id: "owned", label: "Prefers owned channels" },
    ],
  },
  {
    key: "finance",
    department: "Finance",
    dept: "dept-6",
    name: "Ledger",
    seed: "ledger",
    role: "Finance lead",
    model: "Opus",
    stars: { current: 4, potential: 4.5 },
    remit: "Cash, burn, runway and a reconciled ledger. Anything that is not a real figure is labelled Forecast or Estimate.",
    now: "Reconciling this week's payments, 41 of 41 matched",
    training: "Version 5 promoted: cash-basis reporting",
    skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 14, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("pricing", "Pricing analysis", "judgement", 13, 2, 16), skill("reporting", "Reporting clarity", "execution", 15, 1, 17), skill("audit", "Audit trail", "execution", 18, 0, 19)],
    traits: [
      { id: "labels", label: "Labels every estimate", tone: "good" },
      { id: "runway", label: "Flags runway under nine months", tone: "good" },
      { id: "conservative", label: "Conservative forecasts" },
    ],
  },
  {
    key: "legal",
    department: "Legal",
    dept: "dept-5",
    name: "Lex",
    seed: "lex",
    role: "Legal lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4 },
    remit: "Incorporation, contracts, IP and regulatory checklists, prepared in full. You review and sign.",
    now: "Drafting the privacy policy for your review",
    training: "Version 3 promoted: plain-English summaries",
    skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("regulatory", "Regulatory research", "craft", 16, 2, 18), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 14, 3, 17), skill("filing", "Filing preparation", "execution", 15, 1, 17)],
    traits: [
      { id: "explains", label: "Explains every clause it flags", tone: "good" },
      { id: "prepares", label: "Prepares, never signs", tone: "good" },
      { id: "dates", label: "Cites the date it checked" },
    ],
  },
  {
    key: "team",
    department: "Team",
    dept: "dept-8",
    name: "Atlas",
    seed: "atlas",
    role: "Head of team",
    model: "Sonnet",
    stars: { current: 3, potential: 4 },
    remit: "Hire agents from templates, train them against real tests, and watch their skills grow.",
    now: "Training Juno on testing, 10 to 16",
    training: "Version 2 promoted: focus sessions",
    skills: [skill("hiring", "Hiring judgement", "craft", 15, 1, 17), skill("training", "Training design", "craft", 16, 2, 18), skill("roles", "Role design", "judgement", 14, 1, 16), skill("feedback", "Feedback", "judgement", 15, 2, 17), skill("cost", "Cost awareness", "execution", 13, 1, 16), skill("coverage", "Coverage planning", "execution", 14, 0, 16)],
    traits: [
      { id: "real_tests", label: "Trains against real tests", tone: "good" },
      { id: "templates", label: "Hires from templates first" },
      { id: "cost", label: "Watches cost per task", tone: "good" },
    ],
  },
];
