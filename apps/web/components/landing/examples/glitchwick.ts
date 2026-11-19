/**
 * Glitchwick, the developer-tools example: AI playtesters that play every build of an indie game in a sandbox, file
 * each bug to GitHub with a replay of the run that found it, and run as a check on every pull request. Its customers
 * are US indie studios of 2 to 10 people making turn-based, card, puzzle, roguelike and management games with web or
 * desktop builds (Godot, Unity WebGL, HTML5) for Steam, itch.io and the web. The Indie plan is $29 a month (nightly
 * playtests of one game); the Team plan is $149 a month (a check on every pull request, more games and seats).
 *
 * Development is the hero department and leads the tabs. The story the page tells: Finance's 70% gross-margin floor
 * flagged a month at 57%, Development answered by routing routine levels (menus, maps, shops, levels already cleared) to
 * a smaller model and spending the savings on save-and-reload probes, and the 120-bug eval took recall from 58% to 81%
 * while the cost per run fell from $0.18 to $0.11. The deck's win is Kettlebird Games, a three-person studio whose
 * nightly playtest caught a save-file crash two weeks before its Steam Next Fest demo.
 *
 * Dates agree with the Journey: the Ribbon is the design system's two-year fixture (today 2026-10-07, Chapter 9), and
 * every milestone card is dated on the day its pin sits. The page moves the whole story to the visitor's today
 * (`STORY_DAY` in ./helpers), so these are dates on the story's own calendar. Names of studios and people are invented; GitHub, Steam,
 * itch.io, Discord, Reddit and Stripe appear only as the tools and channels the business uses. Nothing is presented as
 * real traction, and every money figure that is not a measurement is labeled Estimate where it appears
 * (the fixture's euro MRR pins print in dollars without a mapping here, so no euro sign is in this data). Loaded on
 * demand (its own chunk), never in the page's main bundle.
 */
import type { ChannelKey } from "@foundmill/shared/constants";
import { conceptAttributes as attributes, leadSkill as skill } from "./helpers";
import { EXAMPLE_IDENTITIES } from "./identity";
import { GLITCHWICK_SESSIONS } from "./sessions/glitchwick";
// Only for the brand picker's five shared marks (each drawn in its own brand colours) and the runner-up concept's mark.
import { TUTORLANE } from "./tutorlane";
import type { ActivityLine, CycleOutcome, ExampleBusiness, ExampleCustomerUpdate, ExampleCyclePlanItem, ExampleDepartment, ExampleInboxNote, ExampleJourney, ExampleLead } from "./types";

const IDENTITY = EXAMPLE_IDENTITIES.glitchwick;
const CURRENCY = "USD";
const usd = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });

/** Kettlebird Games, the studio the deck's win and the Customer Update are about. */
const KETTLEBIRD = { name: "Kettlebird Games", entityId: "3f7c9a12-6b4e-4d8a-b1c5-9e2f7a0d4c63" } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Departments (labels over the six modules) and the team orbit's agents
// ---------------------------------------------------------------------------------------------------------------------

/** Development first: for a developer-tools business it is where the product is made, so the team tour opens on it. */
const DEPARTMENTS: readonly ExampleDepartment[] = [
  { id: "development", module: "development", label: "Development", dept: "dept-2", icon: "playtest", workers: [{ name: "Rune", seed: "rune" }, { name: "Vex", seed: "vex" }, { name: "Sprite", seed: "sprite" }] },
  { id: "product", module: "product", label: "Product", dept: "dept-1", workers: [{ name: "Quinn", seed: "quinn" }, { name: "Ash", seed: "ash" }] },
  { id: "distribution", module: "distribution", label: "Distribution", dept: "dept-3", workers: [{ name: "Pip", seed: "pip" }, { name: "Moss", seed: "moss" }] },
  { id: "finance", module: "finance", label: "Finance", dept: "dept-6", workers: [{ name: "Dime", seed: "dime" }] },
  { id: "legal", module: "legal", label: "Legal", dept: "dept-5", workers: [{ name: "Seal", seed: "seal" }] },
  { id: "team", module: "team", label: "Team", dept: "dept-8", workers: [{ name: "Lumen", seed: "lumen" }, { name: "Tern", seed: "tern" }] },
];

// ---------------------------------------------------------------------------------------------------------------------
// Ideas and brand (How it works)
// ---------------------------------------------------------------------------------------------------------------------

/** The landing page's shared marks, each with the brand colours it is drawn in. */
const SHARED_MARKS = TUTORLANE.howItWorks.brandOptions;

/** The Ideation Studio's two example concepts: Glitchwick in front, the runner-up behind it. */
const CONCEPTS: ExampleBusiness["howItWorks"]["concepts"] = [
  {
    id: "concept-glitchwick",
    name: "Glitchwick",
    pitch: "AI playtesters for indie games: every build played overnight, every bug filed to GitHub with a replay.",
    logoSrc: IDENTITY.logo,
    monogram: IDENTITY.monogram,
    kit: IDENTITY.kit,
    currentStars: 3.5,
    potentialStars: 4.5,
    attributes: attributes([16, 11, 12, 16, 13, 18, 16, 13, 17, 15]),
    verdict: "Small studios ship every week and nobody has time to play every build. Cost per run against a $29 plan is the number to watch.",
    archetypeLabel: "B2B SaaS",
    version: 1,
  },
  {
    id: "concept-shaderwell",
    name: "Shaderwell",
    pitch: "Frame-time reports on every commit of a 3D game, so a slow shader never reaches players.",
    logoSrc: SHARED_MARKS[1]!.logo,
    kit: SHARED_MARKS[1]!.kit,
    currentStars: 3,
    potentialStars: 4,
    attributes: attributes([13, 9, 12, 13, 10, 16, 15, 12, 17, 11]),
    verdict: "Real pain for 3D studios, but most indies ship 2D web builds, and GPU minutes make every report costly.",
    archetypeLabel: "B2B SaaS",
    version: 1,
  },
];

/** The brand picker's six options: Glitchwick's own mark first, then the five shared marks in their own colours. */
const BRAND_OPTIONS: ExampleBusiness["howItWorks"]["brandOptions"] = [{ logo: IDENTITY.logo, kit: IDENTITY.kit }, ...SHARED_MARKS.slice(1)];

/** The Chief of Staff's plan for cycle 1, two years ago: get one game playing in a sandbox and find the first studios. */
const FIRST_CYCLE_PLAN: readonly ExampleCyclePlanItem[] = [
  { department: "development", task: "Play a Godot build headless", tasks: 4, done: 48 },
  { department: "product", task: "Interview ten indie studios", tasks: 2, done: 70 },
  { department: "distribution", task: "Test devlogs and Discord", tasks: 3, done: 85 },
  { department: "finance", task: "Set up Stripe and run costs", tasks: 1, done: 35 },
  { department: "legal", task: "Incorporate and draft NDAs", tasks: 1, done: 55 },
];

// ---------------------------------------------------------------------------------------------------------------------
// The live activity: the hero feed and the ticker
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The deck's feed opens on the first four lines (newest at the top), so the page opens on departments feeding each
 * other: Finance flags the margin, Development answers it, the eval proves it and Finance updates the estimate.
 */
const ACTIVITY: readonly ActivityLine[] = [
  { who: "Mint", dept: "dept-6", text: "flagged gross margin at 57%, under your 70% floor" },
  { who: "Bolt", dept: "dept-2", text: "picked up Mint's flag: routine levels move to a smaller model" },
  { who: "Rune", dept: "dept-2", text: "raised recall on the 120-bug eval from 58% to 81%" },
  { who: "Dime", dept: "dept-6", text: "updated the cost per run estimate to $0.11, from $0.18" },
  { who: "Pip", dept: "dept-3", text: "published the devlog 'What broke in 1,000 AI-played runs'" },
  { who: "Verity", dept: "dept-5", text: "trimmed the GitHub app to read code and write issues and checks" },
  { who: "Harbor", dept: "dept-8", text: "hired Sprite, a card-game playtester, from a template" },
  { who: "Flare", dept: "dept-3", text: "put events on the board, scored 16 of 20" },
  { who: "Vex", dept: "dept-2", text: "reproduced a Unity WebGL crash 3 times out of 3, replay attached" },
  { who: "Echo", dept: "dept-1", text: "turned nine studio interviews into the Windows builds spec" },
  { who: "Moss", dept: "dept-3", text: "answered 14 playtesting questions across four Discord servers" },
  { who: "Tern", dept: "dept-8", text: "trained Vex on 60 Unity WebGL crash logs: 52 sorted correctly" },
  { who: "Seal", dept: "dept-5", text: "drafted confidentiality terms for unreleased builds" },
  { who: "Flare", dept: "dept-3", text: "priced a booth at Copperline Indie Fest in Denver, Nov 14–15" },
  { who: "Quinn", dept: "dept-1", text: "wrote the tests that say when the localization playtest is done" },
  { who: "Bolt", dept: "dept-2", text: "opened pull request #318 with every eval threshold green" },
];

// ---------------------------------------------------------------------------------------------------------------------
// The cycle in the hero deck: what each press of Continue brings back
// ---------------------------------------------------------------------------------------------------------------------

/** In order: the first press brings a customer (it ends in a win, WP-14 T10), then Development's decision and the others. */
const CYCLE_OUTCOMES: readonly CycleOutcome[] = [
  // The same studio as the Customer Update the gold card opens.
  {
    kind: "win",
    id: "kettlebird",
    customer: KETTLEBIRD.name,
    plan: "Indie · nightly playtests, $29 a month",
    firstTouch: "Read 'What broke in 1,000 AI-played runs'",
    standout: { name: "Rune", seed: "rune", dept: "dept-2" },
    involved: [
      { name: "Rune", seed: "rune", dept: "dept-2" },
      { name: "Pip", seed: "pip", dept: "dept-3" },
      { name: "Moss", seed: "moss", dept: "dept-3" },
    ],
  },
  {
    kind: "decision",
    id: "routing",
    from: { name: "Bolt", seed: "bolt", dept: "dept-2", role: "Lead developer" },
    department: "Development",
    subject: "Ship model routing to every studio?",
    body: "After Mint's margin flag, menus and cleared levels run on a smaller model and the savings pay for save-and-reload probes. On the 120-bug eval, recall rose from 58% to 81% and cost per run fell from $0.18 to $0.11.",
    stake: "Pull request #318 · all checks passing",
    options: [
      { id: "merge", label: "Merge", recommended: true, done: "Model routing merged", outcome: "Every run uses it from tonight; Mint rechecks the margin." },
      { id: "shadow", label: "Shadow-run a week", done: "Routing on a shadow run", outcome: "Bolt runs both versions on 50 studios' builds and reports back." },
    ],
  },
  {
    kind: "decision",
    id: "spot",
    from: { name: "Mint", seed: "mint", dept: "dept-6", role: "Finance lead" },
    department: "Finance",
    subject: "Move nightly playtests to spot GPUs?",
    body: "Nightly runs cost $1,240 last month on on-demand GPUs; spot GPUs would bring that to about $520. About 1 run in 30 is interrupted and resumes from its last save, so some reports land up to 40 minutes later.",
    stake: "Saves about $720 a month · Estimate",
    options: [
      // The Inbox line is one line in a 21rem column: short enough to read whole.
      { id: "move", label: "Move nightly runs", recommended: true, done: "Nightly runs on spot GPUs", outcome: "Bolt switches tonight's runs. Pull request checks stay on demand." },
      { id: "keep", label: "Keep on demand", done: "GPUs stay on demand", outcome: "Reports keep landing by 6 a.m. and the GPU bill stays where it is." },
    ],
  },
  {
    kind: "decision",
    id: "dpa",
    from: { name: "Verity", seed: "verity", dept: "dept-5", role: "Legal lead" },
    department: "Legal",
    subject: "Sign the data processing addendum?",
    body: "Team plan studios send unreleased builds and ask for one first. Verity's draft: builds deleted 30 days after a run, never used to train models, processed in the US only. Signing is yours alone.",
    stake: "One addendum for every Team plan",
    options: [
      { id: "sign", label: "Review and sign", recommended: true, done: "Data addendum signed", outcome: "Verity adds it to the Team plan page and files your signed copy." },
      { id: "ask", label: "Ask Verity a question", done: "Question sent to Verity", outcome: "Verity answers in your Inbox before anything moves." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Distribution: how channels fit Glitchwick
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Studios find tools where they show their work: devlogs (content), Discord servers and r/gamedev (social), jams and the
 * festival booth (events), and search, which includes the GitHub Marketplace listing (SEO). The offline channels sit low.
 */
const FITS: Record<ChannelKey, number> = { content: 18, social: 17, events: 16, seo: 14, influencer: 13, email_automation: 12, geo: 11, pr: 9, affiliate: 8, lead_generation: 7, paid_ads: 6, print: 4, direct_mail: 2, outdoor: 2, broadcast: 1 };

const CHANNELS: ExampleBusiness["channels"] = {
  seed: "glitchwick",
  fits: FITS,
  recommended: ["content", "social", "events", "seo"],
  why: "{channel} is scored for a tool small studios find in devlogs, Discord servers and game jams, then recommend to other studios. The first signal comes within one round of work, and the cost per studio stays inside the budget.",
};

// ---------------------------------------------------------------------------------------------------------------------
// The journey: two years on the Ribbon, one Customer Update and the milestones
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Two years of Glitchwick, relabeled from the design system's fixture. The fixture places its pins on fixed days
 * (launch 2024-10-08, incorporation Oct 20, first customer Nov 8, first large contract Dec 26, 10th customer Dec 31,
 * releases 2025-02-16, 2025-08-03, 2026-01-10 and 2026-06-27, decisions 2025-05-15 and 2026-04-01, funding 2025-10-22,
 * $1K MRR 2025-03-20, 100th customer 2025-09-25, $10K MRR 2026-09-18); the labels below say what happened on each.
 * The studios and their money are Glitchwick's own (`customers`): the first, the 10th and the 100th paying studio pay
 * on their pins' days, the studios the milestone cards name pay there at the cards' values, and Kettlebird Games, the
 * Customer Update's studio, is named only on its own payment (Oct 5: first seen Sep 24, eleven days to convert). Every
 * payment is a plan's price ($29 a month for Indie, $1,490 for a year of Team up front), revenue is every payment on
 * its day, and there is none before the first paying studio.
 */
const JOURNEY: ExampleJourney = {
  ribbonDepartments: [
    { id: "d-product", name: "Product", dept: "dept-1" },
    { id: "d-development", name: "Development", dept: "dept-2" },
    { id: "d-distribution", name: "Distribution", dept: "dept-3" },
    { id: "d-finance", name: "Finance", dept: "dept-6" },
    { id: "d-team", name: "Team", dept: "dept-8" },
    { id: "d-operations", name: "Legal", dept: "dept-5" },
  ],
  milestoneLabels: {
    "Northwind Skincare AB incorporated": "Glitchwick Inc. incorporated",
    "First customer": "First paying studio",
    "First enterprise contract": "First Team plan",
    "10th customer": "10 studios",
    "Retinol serum v1": "Replays on every bug",
    "Chose DTC over wholesale": "Studios over publishers",
    "Bundle builder": "Pull request check",
    "100th customer": "100 studios",
    "Subscription plans": "On GitHub Marketplace",
    "Moved production to Meridian Labs": "14-day trial, no free plan",
    "Retail pack": "Unity WebGL builds",
  },
  // One per past chapter (quarter), oldest first; the ninth is the current chapter, still untitled on the Ribbon.
  chapterTitles: ["First playthrough", "First studios", "Studios first", "Pull requests", "The pre-seed", "The Marketplace", "Unity joins Godot", "Five figures", "Demo deadlines"],
  customerNames: ["Brineling Studio", "Lampwick Interactive", "Hollow Pine Games", "Oddacre Games", "Puddlejump Studio", "Saltgrass Games", "Gravelmoth Games", "Mossgate Games", "Thistlewing Studio", "Quarry Lane Studio"],
  roadmap: ["Windows desktop builds", "Publisher dashboard", "Localization playtests"],
  updatePayment: { name: KETTLEBIRD.name, day: "2026-10-05", amountMinor: 2900 },
  customers: {
    // With the cards' first and 100th studios: 10 studios on Dec 31, 2024 (its pin), and MRR passes $1,000 on
    // Mar 20, 2025 and $10,000 on Sep 18, 2026.
    counts: { "2024-12-31": 10, "2025-03-20": 33, "2026-01-10": 185, "2026-09-18": 433, "2026-10-07": 449 },
    // Studios start the 14-day trial about two weeks before they pay; about one in four goes on to pay.
    funnel: { signups: 4.2, activations: 2.4, leadDays: 14 },
    // Studios that pay for a year of Team up front (the first is on its milestone card).
    large: [
      { day: "2025-10-14", name: "Cobble & Crow", amountMinor: 149_000 },
      { day: "2026-04-21", name: "Brambleforge", amountMinor: 149_000 },
      { day: "2026-07-07", name: "Kiln & Comet Games", amountMinor: 149_000 },
    ],
    // Indie is $29 a month; about 3.5 in 100 studios cancel each month (a game ships), and most Team years renew.
    billing: { kind: "subscription", monthlyMinor: [2900], yearlyMinor: 149_000, monthlyChurn: 0.035, yearlyRenewal: 0.8 },
  },
};

/** The Customer Update the deck's gold card opens: how Kettlebird Games became a paying studio. */
const CUSTOMER_UPDATE: ExampleCustomerUpdate = {
  level: "Featured update",
  customer: {
    ...KETTLEBIRD,
    // The mention's card shows three facts side by side in about 75 px each: values short enough to read whole.
    facts: [
      { label: "Engine", value: "Godot" },
      { label: "Plan", value: "Indie" },
      { label: "First seen", value: "{date:2026-09-24}" },
    ],
  },
  plan: "Indie · nightly playtests, $29 a month",
  stats: { touches: 6, channels: 2, days: 11, acquisitionCostMinor: 3400 },
  commentary: [
    { text: "Pip's devlog 'What broke in 1,000 AI-played runs' brings Rosa Delgado in from r/gamedev on a {weekday:2026-09-24} night.", highlight: true },
    { text: "She asks in Glitchwick's Discord whether Godot web exports work. Moss replies with a sample replay ten minutes later." },
    { text: "On {weekday:2026-09-26} she installs the GitHub app on Tidewright's code and starts the 14-day trial." },
    { text: "On the third night, Rune's nightly playtest finds a crash: loading a save made just after a relic triggers. It lands in GitHub with a replay of the 20 seconds before it.", highlight: true },
    { text: `Rosa ships the fix the next morning. A week later, with the Steam Next Fest demo locked, [[ent:${KETTLEBIRD.entityId}|${KETTLEBIRD.name}]] moves to the Indie plan.`, highlight: true },
  ],
  agents: [
    { name: "Rune", seed: "rune", dept: "dept-2", role: "Play loop and nightly runs", rating: 10, standout: true },
    { name: "Moss", seed: "moss", dept: "dept-3", role: "Discord communities", rating: 8, standout: false },
    { name: "Pip", seed: "pip", dept: "dept-3", role: "Devlogs and content", rating: 7, standout: false },
  ],
};

/** The milestones, in the order they happened, each on the day its Ribbon pin sits (local noon, time-zone safe). */
const MILESTONES: ExampleBusiness["milestones"] = [
  { key: "customer_1", label: "First paying studio", description: "The first studio pays for nightly playtests.", achievedAt: "2024-11-08T12:00:00", customerName: "Gravelmoth Games", ...usd(2900), shareable: true },
  { key: "first_team_plan", label: "First Team plan", description: "A studio pays a year of the Team plan up front, for all three of its games.", achievedAt: "2024-12-26T12:00:00", customerName: "Hollow Pine Games", ...usd(149_000), shareable: true },
  // plain-allow: MRR is spelled out in the description on the same line.
  { key: "mrr_1k", label: "$1K MRR", description: "Monthly recurring revenue crosses $1,000.", achievedAt: "2025-03-20T12:00:00", shareable: true },
  { key: "customer_100", label: "100 studios", description: "One hundred studios pay for Glitchwick.", achievedAt: "2025-09-25T12:00:00", shareable: true },
  { key: "github_marketplace", label: "On GitHub Marketplace", description: "Studios install Glitchwick from GitHub Marketplace.", achievedAt: "2026-01-10T12:00:00", shareable: true },
  // plain-allow: MRR is spelled out in the description on the same line.
  { key: "mrr_10k", label: "$10K MRR", description: "Monthly recurring revenue crosses $10,000.", achievedAt: "2026-09-18T12:00:00", shareable: true },
];

/** The Inbox note in "You decide": a jam sponsorship above the founder's cap for new spend. */
const INBOX_NOTE: ExampleInboxNote = {
  from: { name: "Flare", seed: "flare", dept: "dept-3", role: "Distribution Strategist" },
  department: "Distribution",
  subject: "Sponsor the Slow Turns Jam on itch.io?",
  /** When the note arrived: today on the example business. */
  paragraphs: [
    "Jams are where Glitchwick meets studios early: 4 of the last 12 Team plans first saw us at one. The Slow Turns Jam (Nov 6–9, turn-based and puzzle games) offers us its tools sponsor slot: our name on the jam page and a free nightly playtest for every entry.",
    "The slot is $1,200, above the $500 cap you set for new spend, so it waits for you. Playtests for about 600 entries add $260 in runs (Estimate). Either way, the cash lasts 16 months.",
  ],
  costMinor: 120_000,
  fit: "16 of 20",
  runwayAfter: "16 months",
  options: [
    { id: "approve", label: "Sponsor", recommended: true, consequence: "Flare confirms the slot; Pip writes the post. You pay the $1,200 invoice.", costMinor: 120_000, reversible: false },
    { id: "playtests", label: "Free playtests only", consequence: "Moss offers playtests in the jam's Discord: $260 in runs (Estimate), no slot.", costMinor: 26_000, reversible: true },
    { id: "later", label: "Not now", consequence: "No sponsorship for now; Flare asks about the next jam.", costMinor: null, reversible: true },
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// The team: six department leads with their ratings
// ---------------------------------------------------------------------------------------------------------------------

const LEADS: readonly ExampleLead[] = [
  {
    department: "development",
    name: "Bolt",
    seed: "bolt",
    role: "Lead developer",
    model: "Sonnet",
    stars: { current: 4, potential: 5 },
    remit: "Agents build the playtester itself: safe test machines for web and desktop builds, the play loop, replays and the 120-bug eval every change must pass. A pull request is a studio's proposed code change; Glitchwick plays each one before it merges.",
    now: "Posting replays on pull request reviews",
    training: "Version 6 promoted: the eval runs before every merge",
    skills: [skill("sandboxes", "Test machine setup", "craft", 17, 1, 19), skill("evals", "Eval design", "craft", 17, 3, 19), skill("planning", "Planning", "judgement", 14, 1, 16), skill("routing", "Model routing", "judgement", 15, 4, 18), skill("reliability", "Reliability", "execution", 15, 1, 17), skill("cost", "Cost efficiency", "execution", 16, 5, 18)],
    traits: [
      { id: "evals_first", label: "Runs the eval before every merge", tone: "good" },
      { id: "small_prs", label: "Small, easy-to-review changes", tone: "good" },
      { id: "large_model", label: "Reaches for the large model", tone: "warn" },
    ],
  },
  {
    department: "product",
    name: "Echo",
    seed: "echo",
    role: "Product lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4.5 },
    remit: "A vision, a living description of the product and a roadmap shaped by how small studios build, test and ship their games.",
    now: "Reviewing the Windows builds spec with Bolt",
    training: "Version 3 promoted: studio interview synthesis",
    skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Product writing", "craft", 15, 1, 17), skill("prioritize", "Prioritization", "judgement", 16, 1, 18), skill("no", "Saying no", "judgement", 15, 2, 17), skill("pace", "Pace", "execution", 14, 0, 16), skill("reliability", "Reliability", "execution", 15, 1, 17)],
    traits: [
      { id: "verbatim", label: "Quotes developers word for word", tone: "good" },
      { id: "cuts", label: "Cuts scope before adding it", tone: "good" },
      { id: "replay", label: "Asks for the replay" },
    ],
  },
  {
    department: "distribution",
    name: "Flare",
    seed: "flare",
    role: "Distribution Strategist",
    model: "Sonnet",
    stars: { current: 3, potential: 4.5 },
    remit: "Fifteen channels scored for how well they suit Glitchwick. Devlogs, Discord communities, r/gamedev, itch.io jams and the GitHub Marketplace listing come first, inside the caps you set.",
    now: "Testing copy for the GitHub Marketplace listing",
    training: "Version 3 promoted: devlogs that lead with a replay",
    skills: [skill("fit", "Channel scoring", "craft", 17, 1, 19), skill("copy", "Copywriting", "craft", 15, 2, 17), skill("experiments", "Experiment design", "judgement", 15, 1, 18), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Source tracking", "execution", 13, 2, 16), skill("speed", "Speed to test", "execution", 16, 1, 17)],
    traits: [
      { id: "real_bugs", label: "Leads with a real bug, not a claim", tone: "good" },
      { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
      { id: "communities", label: "Prefers communities to ads" },
    ],
  },
  {
    department: "finance",
    name: "Mint",
    seed: "mint",
    role: "Finance lead",
    model: "Opus",
    stars: { current: 4, potential: 4.5 },
    remit: "Cash, months of cash left and cost per playtest run, with the books reconciled. Gross margin is the share of each plan left after GPU costs. A figure that is not measured carries a label: Estimate means worked out, Forecast means projected.",
    now: "Checking margin with routing on: 73%, Estimate",
    training: "Version 5 promoted: gross margin per plan",
    skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 14, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("unit", "Profit per sale", "judgement", 16, 3, 18), skill("reporting", "Reporting clarity", "execution", 15, 1, 17), skill("audit", "Audit trail", "execution", 18, 0, 19)],
    traits: [
      { id: "labels", label: "Labels every estimate", tone: "good" },
      { id: "margin", label: "Flags margin under the floor", tone: "good" },
      { id: "conservative", label: "Conservative forecasts" },
    ],
  },
  {
    department: "legal",
    name: "Verity",
    seed: "verity",
    role: "Legal lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4 },
    remit: "Incorporation, terms, confidentiality for unreleased builds, the data processing addendum and the GitHub app's permissions, prepared in full. You review and sign.",
    now: "Preparing the data processing addendum for you",
    training: "Version 3 promoted: data processing checklist",
    skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("privacy", "Data protection", "craft", 16, 2, 18), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 15, 2, 17), skill("permissions", "Permission reviews", "execution", 14, 3, 17)],
    traits: [
      { id: "explains", label: "Explains every clause it flags", tone: "good" },
      { id: "prepares", label: "Prepares, never signs", tone: "good" },
      { id: "least", label: "Asks for the least access" },
    ],
  },
  {
    department: "team",
    name: "Harbor",
    seed: "harbor",
    role: "Head of team",
    model: "Sonnet",
    stars: { current: 3, potential: 4 },
    remit: "Hires playtester agents from templates, trains each one on real bugs studios have filed (never the 120-bug eval's), and moves ratings only with evidence.",
    now: "Training Sprite on 40 known card-game bugs",
    training: "Version 3 promoted: one training set per genre",
    skills: [skill("hiring", "Hiring decisions", "craft", 15, 1, 17), skill("training", "Training design", "craft", 16, 2, 18), skill("roles", "Role design", "judgement", 14, 1, 16), skill("feedback", "Feedback", "judgement", 15, 1, 17), skill("cost", "Cost awareness", "execution", 14, 1, 16), skill("coverage", "Genre coverage", "execution", 13, 2, 16)],
    traits: [
      { id: "real_bugs", label: "Trains on real bugs", tone: "good" },
      { id: "templates", label: "Hires from templates first" },
      { id: "cost", label: "Watches cost per task", tone: "good" },
    ],
  },
];

export const GLITCHWICK: ExampleBusiness = {
  identity: IDENTITY,
  currency: CURRENCY,
  locale: "en-US",
  chief: { name: "Sable", seed: "sable", dept: "dept-1" },
  departments: DEPARTMENTS,
  leads: LEADS,
  deck: {
    // Two years in (the Journey's today), in its ninth chapter (the deck computes the chapter from today).
    startCycle: 196,
    runwayMonths: 16,
    costPerTaskMinor: 41,
    // The rule that started this chapter's routing work: Finance flags a month under the floor, Development fixes it.
    earlierDecision: { title: "You set a 70% margin floor", detail: "Mint flags any month under it, and Development picks up the fix.", from: { name: "Mint", seed: "mint", dept: "dept-6" } },
    outcomes: CYCLE_OUTCOMES,
  },
  activity: ACTIVITY,
  howItWorks: { concepts: CONCEPTS, brandOptions: BRAND_OPTIONS, firstCyclePlan: FIRST_CYCLE_PLAN },
  sessions: GLITCHWICK_SESSIONS,
  channels: CHANNELS,
  journey: JOURNEY,
  customerUpdate: CUSTOMER_UPDATE,
  milestones: MILESTONES,
  inboxNote: INBOX_NOTE,
};
