/**
 * Tutorlane, an AI teaching assistant for independent tutors (the landing page's default example). After each lesson it
 * turns the recording into notes, a practice set in the tutor's own method and a progress note for the parent; between
 * lessons a practice companion works with the student and grades handwritten work from photos. Every step the page
 * shows maps to a connector the product has (Google Calendar and Drive, Stripe, SendGrid, Gmail, Anthropic, Voyage,
 * GitHub, sandboxes, Dropbox Sign, Cloudflare DNS, OpenCorporates). It is a US business: prices are in US dollars and its
 * copy is in US English (the product's own vocabulary, such as "Brand colours", stays as the product spells it).
 *
 * Brand colours and the two-year Journey come from the design system's fixtures (relabelled here); nothing is presented
 * as real traction: every example is labelled Example and every money figure that is not a measurement is labelled
 * Estimate where it appears. This module is in the landing page's main bundle; the other examples load on demand.
 */
import { STOREFRONT_SESSION_SCRIPT, type MockSessionScript } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared/constants";
import { conceptFixtures } from "@foundmill/dugout/components/journey/fixtures";
import { LANDING_LOGOS } from "../logos";
import { conceptAttributes as attributes, leadSkill as skill } from "./helpers";
import { EXAMPLE_IDENTITIES } from "./identity";
import type { ActivityLine, CycleOutcome, ExampleBusiness, ExampleCustomerUpdate, ExampleCyclePlanItem, ExampleDepartment, ExampleInboxNote, ExampleJourney, ExampleLead } from "./types";

const IDENTITY = EXAMPLE_IDENTITIES.tutorlane;
const CURRENCY = "USD";

// ---------------------------------------------------------------------------------------------------------------------
// Departments (labels over the six modules) and the team orbit's agents
// ---------------------------------------------------------------------------------------------------------------------

const DEPARTMENTS: readonly ExampleDepartment[] = [
  { id: "product", module: "product", label: "Product", dept: "dept-1", workers: [{ name: "Mira", seed: "mira" }, { name: "Quill", seed: "quill" }] },
  { id: "development", module: "development", label: "Development", dept: "dept-2", workers: [{ name: "Juno", seed: "juno" }, { name: "Wren", seed: "wren" }] },
  { id: "distribution", module: "distribution", label: "Distribution", dept: "dept-3", workers: [{ name: "Pike", seed: "pike" }, { name: "Nell", seed: "nell" }] },
  { id: "finance", module: "finance", label: "Finance", dept: "dept-6", workers: [{ name: "Tally", seed: "tally" }] },
  { id: "legal", module: "legal", label: "Legal", dept: "dept-5", workers: [{ name: "Clause", seed: "clause" }] },
  { id: "team", module: "team", label: "Team", dept: "dept-8", workers: [{ name: "Beacon", seed: "beacon" }, { name: "Sol", seed: "sol" }] },
];

// ---------------------------------------------------------------------------------------------------------------------
// Ideas and brand (How it works)
// ---------------------------------------------------------------------------------------------------------------------

const OTHER_CONCEPTS = conceptFixtures();

/** The Ideation Studio's two example concepts: Tutorlane in front, a runner-up behind it. */
const CONCEPTS: ExampleBusiness["howItWorks"]["concepts"] = [
  {
    id: "concept-tutorlane",
    name: "Tutorlane",
    pitch: "An AI teaching assistant for independent tutors: lesson notes, practice sets and progress notes after every lesson.",
    logoSrc: LANDING_LOGOS[0]!.src,
    monogram: IDENTITY.monogram,
    kit: IDENTITY.kit,
    currentStars: 3.5,
    potentialStars: 4.5,
    attributes: attributes([16, 13, 10, 15, 16, 17, 15, 12, 10, 15]),
    verdict: "Tutors feel the pain every week and each one brings their families. Children's data is the risk to plan for.",
    archetypeLabel: "B2B2C software",
    version: 1,
  },
  {
    id: "concept-probelark",
    name: "Probelark",
    pitch: "Voice practice exams for language learners, built from their own course materials.",
    logoSrc: LANDING_LOGOS[3]!.src,
    kit: OTHER_CONCEPTS[3]?.kit ?? IDENTITY.kit,
    currentStars: 3,
    potentialStars: 4,
    attributes: attributes([13, 12, 12, 14, 15, 16, 13, 10, 14, 12]),
    verdict: "Strong pull at exam time, quiet the rest of the year.",
    archetypeLabel: "Consumer software",
    version: 1,
  },
];

/** Brand colours offered in the logo picker: Tutorlane's first, then the design system's other example kits. */
const KITS = [IDENTITY.kit, ...OTHER_CONCEPTS.map((c) => c.kit).filter((k) => k.primary !== IDENTITY.kit.primary)];
/** The brand picker's six options: the six generated marks, each in its own brand colours. */
const BRAND_OPTIONS: ExampleBusiness["howItWorks"]["brandOptions"] = LANDING_LOGOS.map((l, i) => ({ logo: l.src, kit: KITS[i % KITS.length]! }));

/** The Chief of Staff's plan for cycle 1. */
const FIRST_CYCLE_PLAN: readonly ExampleCyclePlanItem[] = [
  { department: "product", task: "Interview twelve tutors", tasks: 2, done: 72 },
  { department: "development", task: "Build the lesson recap pipeline", tasks: 4, done: 45 },
  { department: "distribution", task: "Test SEO and tutor communities", tasks: 3, done: 88 },
  { department: "finance", task: "Set up Stripe and the AI cost model", tasks: 1, done: 30 },
  { department: "legal", task: "Incorporation and consent", tasks: 1, done: 60 },
];

// ---------------------------------------------------------------------------------------------------------------------
// The live activity: the hero feed and the ticker
// ---------------------------------------------------------------------------------------------------------------------

const ACTIVITY: readonly ActivityLine[] = [
  { who: "Forge", dept: "dept-2", text: "opened a pull request for photo grading" },
  { who: "Scout", dept: "dept-3", text: "put SEO on the board at a fit of 17" },
  { who: "Ledger", dept: "dept-6", text: "reconciled this week's Stripe payouts, 64 of 64 matched" },
  { who: "Lex", dept: "dept-5", text: "drafted the parental consent flow for your review" },
  { who: "Iris", dept: "dept-1", text: "turned twelve tutor interviews into three roadmap changes" },
  { who: "Juno", dept: "dept-2", text: "raised grading accuracy from 74% to 93% on the test set" },
  { who: "Atlas", dept: "dept-8", text: "trained Mira on AP scoring rubrics" },
  { who: "Pike", dept: "dept-3", text: "published 'SAT quadratics: 40 practice questions'" },
  { who: "Tally", dept: "dept-6", text: "updated the AI cost per student estimate to $1.90" },
  { who: "Quill", dept: "dept-1", text: "wrote the spec for Lesson Recap v2" },
  { who: "Clause", dept: "dept-5", text: "checked the companion against COPPA" },
  { who: "Wren", dept: "dept-2", text: "shipped parent progress notes to staging" },
];

// ---------------------------------------------------------------------------------------------------------------------
// The cycle in the hero deck: what each press of Continue brings back
// ---------------------------------------------------------------------------------------------------------------------

/** In order: the first press brings a decision, the second a customer, then they alternate with more decisions. */
const CYCLE_OUTCOMES: readonly CycleOutcome[] = [
  {
    kind: "decision",
    id: "merge",
    from: { name: "Forge", seed: "forge", dept: "dept-2", role: "Lead developer" },
    department: "Development",
    subject: "Merge photo grading to production?",
    body: "The companion now grades handwritten work from photos. Agreement with tutors' own grades rose from 74% to 93% on 200 past answers, and every check is green.",
    stake: "Pull request #148 · all checks passing",
    options: [
      { id: "merge", label: "Merge", recommended: true, done: "Photo grading merged", outcome: "Every tutor gets it on the next release." },
      { id: "hold", label: "Test on 100 more", done: "Merge held for more testing", outcome: "Forge adds 100 more answers to the test set and comes back to you." },
    ],
  },
  // The same customer as the Customer Update the gold card opens.
  {
    kind: "win",
    id: "okafor",
    customer: "Okafor Math Tutoring",
    plan: "Pro · practice companion for 18 students",
    firstTouch: "Read 'SAT quadratics: 40 practice questions'",
    standout: { name: "Juno", seed: "juno", dept: "dept-2" },
    involved: [
      { name: "Juno", seed: "juno", dept: "dept-2" },
      { name: "Nell", seed: "nell", dept: "dept-3" },
      { name: "Pike", seed: "pike", dept: "dept-3" },
    ],
  },
  {
    kind: "decision",
    id: "models",
    from: { name: "Ledger", seed: "ledger", dept: "dept-6", role: "Finance lead" },
    department: "Finance",
    subject: "Raise the AI budget to $600 a month?",
    body: "Photo grading doubled model use. The cost per student is $1.90 against the $8 tutors pay for the companion, and the runway still holds at 14 months.",
    stake: "+$250 a month · Estimate",
    options: [
      // The Inbox line is one line in a 21rem column: short enough that the dollar figure is never cut off.
      { id: "raise", label: "Raise to $600", recommended: true, done: "AI budget raised to $600", outcome: "Ledger watches the cost per student every day." },
      { id: "keep", label: "Keep $350", done: "AI budget kept at $350", outcome: "Forge routes routine grading to a smaller model to stay inside it." },
    ],
  },
  {
    kind: "decision",
    id: "consent",
    from: { name: "Lex", seed: "lex", dept: "dept-5", role: "Legal lead" },
    department: "Legal",
    subject: "Sign the consent provider's data agreement?",
    body: "Parents give consent before a child uses the companion. Lex reviewed the provider's data agreement and agreed fixes to two clauses. Signing is yours alone.",
    stake: "12-month term · US data only",
    options: [
      { id: "sign", label: "Review and sign", recommended: true, done: "Consent agreement signed", outcome: "Lex files the copy and sets the renewal reminder." },
      { id: "ask", label: "Ask Lex a question", done: "Question sent to Lex", outcome: "Lex answers in your Inbox before anything moves." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// The live sessions: what the replayed agents are building
// ---------------------------------------------------------------------------------------------------------------------

const PRACTICE_SET_DIFF = [
  "diff --git a/src/recap/practice.ts b/src/recap/practice.ts",
  "--- a/src/recap/practice.ts",
  "+++ b/src/recap/practice.ts",
  "@@ -1,6 +1,20 @@",
  ' import { models } from "@/lib/models";',
  '+import { tutorMethod } from "@/recap/method";',
  " ",
  "-export async function practiceSet(transcript: string) {",
  "-  return models.generate({ prompt: transcript });",
  "+export type Question = { prompt: string; skill: string; difficulty: 1 | 2 | 3 };",
  "+",
  "+export async function practiceSet(lesson: LessonRecap, student: StudentProfile): Promise<Question[]> {",
  "+  const method = await tutorMethod(lesson.tutorId);",
  "+  // Only what this lesson taught, weighted to the mistakes this student keeps making.",
  "+  const gaps = student.mistakes.filter((m) => lesson.skills.includes(m.skill));",
  "+  return models.generateJson<Question[]>({",
  "+    system: method.instructions,",
  "+    prompt: renderPracticePrompt(lesson, gaps),",
  "+    schema: QUESTION_SCHEMA,",
  "+  });",
  " }",
].join("\n");

const PROGRESS_NOTE_CSS = [
  "--- a/src/emails/progress-note.css",
  "+++ b/src/emails/progress-note.css",
  "@@ -2,5 +2,10 @@",
  " .note {",
  "-  padding: 13px;",
  "+  padding: var(--space-3);",
  " }",
  "+",
  "+.note__skill {",
  "+  display: flex;",
  "+  gap: var(--space-2);",
  "+}",
].join("\n");

/** Four engineers on Tutorlane's AI product: the recap pipeline, photo grading, progress notes and the test set. */
const SESSION_SCRIPT: MockSessionScript = {
  ...STOREFRONT_SESSION_SCRIPT,
  tasks: [
    "Practice sets in the tutor's own method",
    "Grade handwritten work from photos",
    "Parent progress note after each lesson",
    "Test set: 200 graded homework answers",
    "Voice companion: latency under 800 ms",
    "Lesson recap from Drive recordings",
    "Curriculum search over state standards",
    "Stripe billing for the companion add-on",
  ],
  stdout: [
    "$ pnpm install --frozen-lockfile",
    "Lockfile is up to date, resolution step is skipped",
    "Progress: resolved 388, reused 388, downloaded 0, added 0",
    "$ pnpm vitest run src/recap/practice.test.ts",
    " RUN  v5.0.3 /workspace/tutorlane",
    " ✓ src/recap/practice.test.ts (6 tests) 241ms",
    " Test Files  1 passed (1)",
    "      Tests  6 passed (6)",
    "$ pnpm evals run grading --cases 200",
    "Running 200 cases (graded SAT math homework)",
    "  ✓  agreement with tutors' grades 186/200 (93.0%)",
    "  ✘  partial credit on two-step problems 7/12 (58%)",
    "  1 threshold missed (partial credit ≥ 75%)",
    "$ git add -A && git commit -m \"feat(recap): practice sets follow the tutor's method\"",
    "[agent/task-1 7c1e2b9] feat(recap): practice sets follow the tutor's method",
    " 4 files changed, 212 insertions(+), 18 deletions(-)",
    "$ pnpm tsc --noEmit",
    "$ pnpm eslint src",
    "$ pnpm evals run grading --cases 200",
    "  all thresholds met (agreement 93.0%, partial credit 83%)",
    "$ gh pr create --fill --base main",
    "https://github.com/foundmill-demo/tutorlane/pull/148",
  ],
  readPath: "src/recap/pipeline.ts",
  file: { path: "src/recap/practice.ts", diff: PRACTICE_SET_DIFF, additions: 16, deletions: 2 },
  styleFile: { path: "src/emails/progress-note.css", diff: PROGRESS_NOTE_CSS },
  notes: [
    "Reading the test set before touching the prompt.",
    "Practice questions now come only from the skills this lesson covered.",
    "Partial credit follows the tutor's rubric; the model only explains it.",
    "Partial credit on two-step problems missed its threshold; adding worked examples to the prompt.",
    "Review: one finding about a student's name in the prompt log, redacted.",
  ],
  unitCommand: "pnpm vitest run",
  unitPassed: 6,
  acceptanceCommand: "pnpm evals run grading",
  failingCheck: "partial credit on two-step problems",
  failure: "Error: grading agreement 61.0%, below the 90% threshold",
  currency: CURRENCY,
};

// ---------------------------------------------------------------------------------------------------------------------
// Distribution: how channels fit Tutorlane
// ---------------------------------------------------------------------------------------------------------------------

const FITS: Record<ChannelKey, number> = { seo: 17, content: 16, email_automation: 15, affiliate: 14, social: 12, geo: 11, events: 10, influencer: 9, paid_ads: 8, pr: 7, lead_generation: 6, direct_mail: 4, print: 3, broadcast: 2, outdoor: 2 };

/** Tutors search for practice material and trust other tutors: search, content, email and referrals first. */
const CHANNELS: ExampleBusiness["channels"] = {
  seed: "tutorlane",
  fits: FITS,
  recommended: ["seo", "content", "email_automation", "affiliate"],
  why: "{channel} fits a tool tutors find while looking for practice material and recommend to other tutors. The first signal comes within a cycle and the cost per tutor sits inside the runway budget.",
};

// ---------------------------------------------------------------------------------------------------------------------
// The journey: two years on the Ribbon, one Customer Update and the milestones
// ---------------------------------------------------------------------------------------------------------------------

/** Two years of the example's history, relabelled from the design system's fixture for Tutorlane. */
const JOURNEY: ExampleJourney = {
  /** The Ribbon's departments (ids match the fixture's generator; names and colours are Tutorlane's). */
  ribbonDepartments: [
    { id: "d-product", name: "Product", dept: "dept-1" },
    { id: "d-development", name: "Development", dept: "dept-2" },
    { id: "d-distribution", name: "Distribution", dept: "dept-3" },
    { id: "d-finance", name: "Finance", dept: "dept-6" },
    { id: "d-team", name: "Team", dept: "dept-8" },
    { id: "d-operations", name: "Legal", dept: "dept-5" },
  ],
  milestoneLabels: {
    "Northwind Skincare AB incorporated": "Tutorlane Inc. incorporated",
    "Retinol serum v1": "Lesson recap v1",
    "Bundle builder": "Practice companion",
    "Subscription plans": "Parent progress notes",
    "Retail pack": "Photo grading",
    "Chose DTC over wholesale": "Chose tutors over schools",
    "Moved production to Meridian Labs": "Smaller model for grading",
    "First enterprise contract": "First tutoring agency",
  },
  chapterTitles: ["First lessons", "First tutors", "Recaps catch on", "Parents join in", "The companion", "Steady state", "Exam season", "Agencies", "Fall semester"],
  customerNames: ["Bright Path Tutoring", "Hale Science Tutoring", "Rivera Languages", "Brook Lane Tutors", "Amari Chemistry", "Second Look English", "Patel Physics", "Linden Music Theory", "North Harbor Tutoring", "Ellis Test Prep"],
  roadmap: ["Voice companion", "Agency dashboard", "Adult learners"],
  // Revenue per day near MRR / 30 at each MRR pin: about $37 at $1K MRR (Mar 2025), $330 at $10K (Sep 2026).
  revenueScale: { start: 0.1, end: 1.35 },
  // Pro is $29 a month; the fixture's rare large payment is an agency paying a year up front for its 10 tutors.
  planPrices: { pricesMinor: [2900], largeMinor: 348_000 },
  // Okafor Math Tutoring pays on Friday, Oct 2 (first seen Sunday, Sep 20: twelve days), and on no other day.
  updatePayment: { name: "Okafor Math Tutoring", day: "2026-10-02" },
};

/** The Customer Update the deck's gold card opens: how Okafor Math Tutoring became a paying customer. */
const CUSTOMER_UPDATE: ExampleCustomerUpdate = {
  level: "Featured update",
  customer: { name: "Okafor Math Tutoring", entityId: "5d0c6a3e-8f1b-4c2a-9e47-2b6f1d8c3a90", facts: [
    // The mention's card shows three facts side by side in about 75 px each: values short enough to read whole.
    { label: "Segment", value: "SAT math" },
    { label: "Plan", value: "Pro" },
    { label: "First seen", value: "Sep 20" },
  ] },
  plan: "Pro · practice companion for 18 students",
  stats: { touches: 7, channels: 3, days: 12, acquisitionCostMinor: 4200 },
  commentary: [
    { text: "Pike's guide 'SAT quadratics: 40 practice questions' brings Adaeze Okafor to the site on a Sunday evening.", highlight: true },
    { text: "On Tuesday she records a lesson and tries the free recap." },
    { text: "Juno's recap lands within the hour: lesson notes, a practice set in her own method and a progress note for the parent.", highlight: true },
    { text: "Nell's follow-up shows her how parents can add the practice companion." },
    { text: "Three parents ask for the companion by Friday. [[ent:5d0c6a3e-8f1b-4c2a-9e47-2b6f1d8c3a90|Okafor Math Tutoring]] moves to Pro.", highlight: true },
  ],
  agents: [
    { name: "Juno", seed: "juno", dept: "dept-2", role: "Lesson recap pipeline", rating: 10, standout: true },
    { name: "Nell", seed: "nell", dept: "dept-3", role: "Email automation", rating: 8, standout: false },
    { name: "Pike", seed: "pike", dept: "dept-3", role: "SEO and content", rating: 6, standout: false },
  ],
};

const usd = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });
/**
 * The milestones the example business has reached, in order, each on the day its Ribbon pin sits (local noon, time-zone
 * safe), naming the tutor or agency whose payment the Ribbon records that day, at the same value.
 */
const MILESTONES: ExampleBusiness["milestones"] = [
  { key: "customer_1", label: "First customer", description: "The first paying tutor.", achievedAt: "2024-11-08T12:00:00", customerName: "Patel Physics", ...usd(2900), shareable: true },
  { key: "first_agency", label: "First tutoring agency", description: "An agency pays a year up front for its 10 tutors.", achievedAt: "2024-12-26T12:00:00", customerName: "Rivera Languages", ...usd(348000), shareable: true },
  { key: "customer_10", label: "10th customer", description: "Ten paying tutors.", achievedAt: "2024-12-31T12:00:00", shareable: true },
  { key: "mrr_1k", label: "$1K MRR", description: "Monthly recurring revenue crosses $1,000.", achievedAt: "2025-03-20T12:00:00", shareable: true },
  { key: "customer_100", label: "100th customer", description: "One hundred paying tutors.", achievedAt: "2025-09-25T12:00:00", shareable: true },
  { key: "mrr_10k", label: "$10K MRR", description: "Monthly recurring revenue crosses $10,000.", achievedAt: "2026-09-18T12:00:00", shareable: true },
];

/** The Inbox note in "You decide". */
const INBOX_NOTE: ExampleInboxNote = {
  from: { name: "Scout", seed: "scout", dept: "dept-3", role: "Distribution Strategist" },
  department: "Distribution",
  subject: "Sponsor a newsletter read by 9,000 tutors?",
  /** When the note arrived: today on the example business. */
  sentOn: "Wed, Oct 7",
  paragraphs: [
    "Tutor communities are Tutorlane's strongest channel after search: four of the last ten tutors who upgraded came from one. A one-month sponsorship of the largest tutors' newsletter in the US is ready to book, with the copy written.",
    "It costs $480, above the $250 cap you set for new spend, so it waits for you. The runway stays at 14 months either way.",
  ],
  costMinor: 48_000,
  fit: "16 of 20",
  runwayAfter: "14 months",
  options: [
    { id: "approve", label: "Approve", recommended: true, consequence: "Scout books the sponsorship and the copy runs next week.", costMinor: 48_000, reversible: false },
    { id: "smaller", label: "Try a smaller list first", consequence: "Scout finds a smaller tutors' list to test the copy on, inside your cap.", costMinor: null, reversible: true },
    { id: "later", label: "Not this chapter", consequence: "Communities stay at search and referrals until the next chapter.", costMinor: null, reversible: true },
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// The team: six department leads with their ratings
// ---------------------------------------------------------------------------------------------------------------------

const LEADS: readonly ExampleLead[] = [
  {
    department: "product",
    name: "Iris",
    seed: "iris",
    role: "Product lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4.5 },
    remit: "A vision, a living specification and a roadmap shaped by what tutors, parents and students actually do.",
    now: "Turning twelve tutor interviews into three roadmap changes",
    training: "Version 3 promoted: interview synthesis",
    skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Specification writing", "craft", 15, 1, 17), skill("prioritize", "Prioritization", "judgement", 17, 1, 18), skill("no", "Saying no", "judgement", 14, 3, 17), skill("pace", "Pace", "execution", 13, 0, 15), skill("reliability", "Reliability", "execution", 15, 1, 17)],
    traits: [
      { id: "verbatim", label: "Quotes tutors word for word", tone: "good" },
      { id: "cuts", label: "Cuts scope before adding it", tone: "good" },
      { id: "evidence", label: "Asks for evidence" },
    ],
  },
  {
    department: "development",
    name: "Forge",
    seed: "forge",
    role: "Lead developer",
    model: "Sonnet",
    stars: { current: 3.5, potential: 5 },
    remit: "Agents build the AI product itself: the recap pipeline, the practice companion and the tests every prompt change must pass.",
    now: "Opening a pull request for photo grading",
    training: "Version 4 promoted: tests before every prompt change",
    skills: [skill("prompts", "Prompt design", "craft", 16, 3, 18), skill("testing", "Testing", "craft", 16, 6, 18), skill("planning", "Planning", "judgement", 13, 1, 16), skill("scope", "Scope control", "judgement", 12, 3, 16), skill("reliability", "Reliability", "execution", 14, 1, 17), skill("cost", "Cost efficiency", "execution", 12, -2, 16)],
    traits: [
      { id: "tests_first", label: "Writes the test set first", tone: "good" },
      { id: "small_prs", label: "Small pull requests", tone: "good" },
      { id: "slow_evals", label: "Slower on long test runs", tone: "warn" },
    ],
  },
  {
    department: "distribution",
    name: "Scout",
    seed: "scout",
    role: "Distribution Strategist",
    model: "Sonnet",
    stars: { current: 3, potential: 4.5 },
    remit: "Fifteen channels scored for fit; search, content and tutor referrals start first, inside the budget caps you set.",
    now: "Putting SEO on the board at a fit of 17",
    training: "Version 2 promoted: test small before scaling",
    skills: [skill("fit", "Channel fit", "craft", 17, 1, 19), skill("copy", "Copywriting", "craft", 14, 2, 17), skill("experiments", "Experiment design", "judgement", 15, 2, 18), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Attribution", "execution", 13, 1, 16), skill("speed", "Speed to test", "execution", 15, 1, 17)],
    traits: [
      { id: "small_tests", label: "Tests small before scaling", tone: "good" },
      { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
      { id: "owned", label: "Prefers owned channels" },
    ],
  },
  {
    department: "finance",
    name: "Ledger",
    seed: "ledger",
    role: "Finance lead",
    model: "Opus",
    stars: { current: 4, potential: 4.5 },
    remit: "Cash, burn, runway, AI cost per student and a reconciled ledger. Anything that is not a real figure is labeled Forecast or Estimate.",
    now: "Reconciling this week's Stripe payouts, 64 of 64 matched",
    training: "Version 5 promoted: AI cost per student",
    skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 14, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("unit", "Unit economics", "judgement", 14, 2, 17), skill("reporting", "Reporting clarity", "execution", 15, 1, 17), skill("audit", "Audit trail", "execution", 18, 0, 19)],
    traits: [
      { id: "labels", label: "Labels every estimate", tone: "good" },
      { id: "runway", label: "Flags runway under nine months", tone: "good" },
      { id: "conservative", label: "Conservative forecasts" },
    ],
  },
  {
    department: "legal",
    name: "Lex",
    seed: "lex",
    role: "Legal lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4 },
    remit: "Incorporation, terms, children's data and parental consent, prepared in full. You review and sign.",
    now: "Drafting the parental consent flow for your review",
    training: "Version 3 promoted: children's data checklist",
    skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("regulatory", "Regulatory research", "craft", 16, 2, 18), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 14, 3, 17), skill("filing", "Filing preparation", "execution", 15, 1, 17)],
    traits: [
      { id: "explains", label: "Explains every clause it flags", tone: "good" },
      { id: "prepares", label: "Prepares, never signs", tone: "good" },
      { id: "dates", label: "Cites the date it checked" },
    ],
  },
  {
    department: "team",
    name: "Atlas",
    seed: "atlas",
    role: "Head of team",
    model: "Sonnet",
    stars: { current: 3, potential: 4 },
    remit: "Hire agents from templates, train them against real tests, and watch their skills grow.",
    now: "Training Mira on AP scoring rubrics",
    training: "Version 2 promoted: training against scoring rubrics",
    skills: [skill("hiring", "Hiring decisions", "craft", 15, 1, 17), skill("training", "Training design", "craft", 16, 2, 18), skill("roles", "Role design", "judgement", 14, 1, 16), skill("feedback", "Feedback", "judgement", 15, 2, 17), skill("cost", "Cost awareness", "execution", 13, 1, 16), skill("coverage", "Coverage planning", "execution", 14, 0, 16)],
    traits: [
      { id: "real_tests", label: "Trains against real tests", tone: "good" },
      { id: "templates", label: "Hires from templates first" },
      { id: "cost", label: "Watches cost per task", tone: "good" },
    ],
  },
];

export const TUTORLANE: ExampleBusiness = {
  identity: IDENTITY,
  currency: CURRENCY,
  locale: "en-US",
  chief: { name: "Orla", seed: "orla", dept: "dept-1" },
  departments: DEPARTMENTS,
  leads: LEADS,
  deck: {
    // Where the business is when the page opens: two years in (the Journey), in its ninth chapter.
    startCycle: 214,
    chapter: "Chapter 9",
    runwayMonths: 14,
    costPerTaskMinor: 46,
    earlierDecision: { title: "Domain renewal approved", detail: "Development renewed it for two years.", from: { name: "Forge", seed: "forge", dept: "dept-2" } },
    outcomes: CYCLE_OUTCOMES,
  },
  activity: ACTIVITY,
  howItWorks: { concepts: CONCEPTS, brandOptions: BRAND_OPTIONS, firstCyclePlan: FIRST_CYCLE_PLAN },
  sessions: SESSION_SCRIPT,
  channels: CHANNELS,
  journey: JOURNEY,
  customerUpdate: CUSTOMER_UPDATE,
  milestones: MILESTONES,
  inboxNote: INBOX_NOTE,
};
