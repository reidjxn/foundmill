/**
 * Glitchwick, the developer-tools example: AI playtesters that play every build of an indie game in a sandbox, file each
 * bug to GitHub with a replay of the run that found it, and run as a check on every pull request. Indie studios of 2 to
 * 10 people pay from $29 a month. Development is the hero department: sandboxes, a play loop, and a 120-bug eval that took
 * recall from 58% to 81% and the cost per run from $0.18 to $0.11.
 *
 * The identity (name, logo, brand colours, vertical, description) is final. Everything below it is placeholder copy that
 * renders correctly, so the picker, the tests and the screenshots work today; each block is marked
 * "PLACEHOLDER: written in the content round". Loaded on demand (its own chunk), never in the page's main bundle.
 */
import { STOREFRONT_SESSION_SCRIPT } from "@foundmill/dugout";
import { conceptAttributes as attributes, leadSkill as skill } from "./helpers";
import { EXAMPLE_IDENTITIES } from "./identity";
import { TUTORLANE } from "./tutorlane";
import type { ExampleBusiness } from "./types";

const IDENTITY = EXAMPLE_IDENTITIES.glitchwick;
const CURRENCY = "USD";
const usd = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });

export const GLITCHWICK: ExampleBusiness = {
  identity: IDENTITY,
  currency: CURRENCY,
  locale: "en-US",

  // PLACEHOLDER: written in the content round.
  chief: { name: "Sable", seed: "sable", dept: "dept-1" },

  // PLACEHOLDER: written in the content round.
  departments: [
    { id: "product", module: "product", label: "Product", dept: "dept-1", workers: [{ name: "Quinn", seed: "quinn" }, { name: "Ash", seed: "ash" }] },
    { id: "development", module: "development", label: "Development", dept: "dept-2", icon: "playtest", workers: [{ name: "Rune", seed: "rune" }, { name: "Vex", seed: "vex" }] },
    { id: "distribution", module: "distribution", label: "Distribution", dept: "dept-3", workers: [{ name: "Pip", seed: "pip" }, { name: "Moss", seed: "moss" }] },
    { id: "finance", module: "finance", label: "Finance", dept: "dept-6", workers: [{ name: "Dime", seed: "dime" }] },
    { id: "legal", module: "legal", label: "Legal", dept: "dept-5", workers: [{ name: "Seal", seed: "seal" }] },
    { id: "team", module: "team", label: "Team", dept: "dept-8", workers: [{ name: "Lumen", seed: "lumen" }, { name: "Tern", seed: "tern" }] },
  ],

  // PLACEHOLDER: written in the content round.
  leads: [
    {
      department: "product",
      name: "Echo",
      seed: "echo",
      role: "Product lead",
      model: "Opus",
      stars: { current: 3.5, potential: 4.5 },
      remit: "A vision, a living specification and a roadmap shaped by how small studios actually ship and test.",
      now: "Turning nine studio interviews into two roadmap changes",
      training: "Version 3 promoted: interview synthesis",
      skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Specification writing", "craft", 15, 1, 17), skill("prioritise", "Prioritisation", "judgement", 16, 1, 18), skill("no", "Saying no", "judgement", 15, 2, 17), skill("pace", "Pace", "execution", 14, 1, 16), skill("reliability", "Reliability", "execution", 15, 0, 17)],
      traits: [
        { id: "verbatim", label: "Quotes developers word for word", tone: "good" },
        { id: "cuts", label: "Cuts scope before adding it", tone: "good" },
        { id: "evidence", label: "Asks for a replay" },
      ],
    },
    {
      department: "development",
      name: "Bolt",
      seed: "bolt",
      role: "Lead developer",
      model: "Sonnet",
      stars: { current: 4, potential: 5 },
      remit: "Agents build the playtester itself: sandboxes, the play loop, replays and the eval every change must pass.",
      now: "Opening a pull request for the replay recorder",
      training: "Version 5 promoted: eval before every play-loop change",
      skills: [skill("sandboxes", "Sandbox orchestration", "craft", 17, 2, 19), skill("testing", "Testing", "craft", 17, 4, 19), skill("planning", "Planning", "judgement", 14, 1, 16), skill("scope", "Scope control", "judgement", 13, 2, 16), skill("reliability", "Reliability", "execution", 15, 1, 17), skill("cost", "Cost efficiency", "execution", 15, 3, 17)],
      traits: [
        { id: "evals_first", label: "Writes the eval first", tone: "good" },
        { id: "small_prs", label: "Small pull requests", tone: "good" },
        { id: "gpu_hungry", label: "Reaches for bigger GPUs", tone: "warn" },
      ],
    },
    {
      department: "distribution",
      name: "Flare",
      seed: "flare",
      role: "Distribution Strategist",
      model: "Sonnet",
      stars: { current: 3, potential: 4.5 },
      remit: "Fifteen channels scored for fit; devlogs, developer communities and game jams start first, inside your caps.",
      now: "Putting content on the board at a fit of 18",
      training: "Version 2 promoted: test small before scaling",
      skills: [skill("fit", "Channel fit", "craft", 17, 1, 19), skill("copy", "Copywriting", "craft", 15, 2, 17), skill("experiments", "Experiment design", "judgement", 15, 1, 18), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Attribution", "execution", 13, 2, 16), skill("speed", "Speed to test", "execution", 16, 1, 17)],
      traits: [
        { id: "small_tests", label: "Tests small before scaling", tone: "good" },
        { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
        { id: "devlogs", label: "Prefers devlogs to ads" },
      ],
    },
    {
      department: "finance",
      name: "Mint",
      seed: "mint",
      role: "Finance lead",
      model: "Opus",
      stars: { current: 4, potential: 4.5 },
      remit: "Cash, burn, runway, cost per playtest run and a reconciled ledger. Anything that is not a real figure is labeled Forecast or Estimate.",
      now: "Reconciling this week's Stripe payouts, 41 of 41 matched",
      training: "Version 4 promoted: cost per run",
      skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 14, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("unit", "Unit economics", "judgement", 15, 2, 17), skill("reporting", "Reporting clarity", "execution", 15, 1, 17), skill("audit", "Audit trail", "execution", 17, 0, 19)],
      traits: [
        { id: "labels", label: "Labels every estimate", tone: "good" },
        { id: "runway", label: "Flags runway under nine months", tone: "good" },
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
      remit: "Incorporation, terms, and the confidentiality of studios' unreleased builds, prepared in full. You review and sign.",
      now: "Drafting the build confidentiality terms for your review",
      training: "Version 2 promoted: data processing checklist",
      skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("regulatory", "Regulatory research", "craft", 14, 2, 17), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 15, 2, 17), skill("filing", "Filing preparation", "execution", 14, 1, 16)],
      traits: [
        { id: "explains", label: "Explains every clause it flags", tone: "good" },
        { id: "prepares", label: "Prepares, never signs", tone: "good" },
        { id: "dates", label: "Cites the date it checked" },
      ],
    },
    {
      department: "team",
      name: "Harbor",
      seed: "harbor",
      role: "Head of team",
      model: "Sonnet",
      stars: { current: 3, potential: 4 },
      remit: "Hire agents from templates, train them against real tests, and watch their skills grow.",
      now: "Training Vex on Unity and Godot crash logs",
      training: "Version 2 promoted: training against crash logs",
      skills: [skill("hiring", "Hiring decisions", "craft", 15, 1, 17), skill("training", "Training design", "craft", 16, 2, 18), skill("roles", "Role design", "judgement", 14, 1, 16), skill("feedback", "Feedback", "judgement", 15, 1, 17), skill("cost", "Cost awareness", "execution", 14, 1, 16), skill("coverage", "Coverage planning", "execution", 13, 0, 16)],
      traits: [
        { id: "real_tests", label: "Trains against real tests", tone: "good" },
        { id: "templates", label: "Hires from templates first" },
        { id: "cost", label: "Watches cost per task", tone: "good" },
      ],
    },
  ],

  // PLACEHOLDER: written in the content round.
  deck: {
    startCycle: 162,
    chapter: "Chapter 7",
    runwayMonths: 16,
    costPerTaskMinor: 38,
    earlierDecision: { title: "You approved spot GPUs", detail: "Development moved the nightly playtests to them.", from: { name: "Bolt", seed: "bolt", dept: "dept-2" } },
    outcomes: [
      {
        kind: "decision",
        id: "merge",
        from: { name: "Bolt", seed: "bolt", dept: "dept-2", role: "Lead developer" },
        department: "Development",
        subject: "Merge the replay recorder to production?",
        body: "Every bug report now carries the 20 seconds of play that found it. On the 120-bug eval, recall rose from 58% to 81% and the cost per run fell from $0.18 to $0.11. Every check is green.",
        stake: "Pull request #212 · all checks passing",
        options: [
          { id: "merge", label: "Merge", recommended: true, done: "Replay recorder merged", outcome: "Every studio gets replays on the next release." },
          { id: "hold", label: "Test on 40 more builds", done: "Merge held for more testing", outcome: "Bolt adds 40 more builds to the eval and comes back to you." },
        ],
      },
      {
        kind: "win",
        id: "lanternfly",
        customer: "Lanternfly Games",
        plan: "Studio · checks on every pull request for 6 developers",
        firstTouch: "Read 'How we caught a save-file bug in 9 minutes'",
        standout: { name: "Rune", seed: "rune", dept: "dept-2" },
        involved: [
          { name: "Rune", seed: "rune", dept: "dept-2" },
          { name: "Moss", seed: "moss", dept: "dept-3" },
          { name: "Pip", seed: "pip", dept: "dept-3" },
        ],
      },
      {
        kind: "decision",
        id: "gpus",
        from: { name: "Mint", seed: "mint", dept: "dept-6", role: "Finance lead" },
        department: "Finance",
        subject: "Raise the GPU budget to $900 a month?",
        body: "Playtest runs doubled once the pull request check went live. A run costs $0.11 against the $29 a studio pays each month, and the runway still holds at 16 months.",
        stake: "+$300 a month · Estimate",
        options: [
          { id: "raise", label: "Raise to $900", recommended: true, done: "GPU budget raised to $900", outcome: "Mint watches the cost per run every day." },
          { id: "keep", label: "Keep $600", done: "GPU budget kept at $600", outcome: "Bolt plays fewer frames per second on routine runs to stay inside it." },
        ],
      },
      {
        kind: "decision",
        id: "dpa",
        from: { name: "Verity", seed: "verity", dept: "dept-5", role: "Legal lead" },
        department: "Legal",
        subject: "Sign the GPU provider's data agreement?",
        body: "Studios send unreleased builds. Verity reviewed the provider's data agreement and agreed fixes to two clauses: no training on customer builds, deletion within 30 days. Signing is yours alone.",
        stake: "12-month term · US data only",
        options: [
          { id: "sign", label: "Review and sign", recommended: true, done: "GPU data agreement signed", outcome: "Verity files the copy and sets the renewal reminder." },
          { id: "ask", label: "Ask Verity a question", done: "Question sent to Verity", outcome: "Verity answers in your Inbox before anything moves." },
        ],
      },
    ],
  },

  // PLACEHOLDER: written in the content round.
  activity: [
    { who: "Bolt", dept: "dept-2", text: "opened a pull request for the replay recorder" },
    { who: "Flare", dept: "dept-3", text: "put content on the board at a fit of 18" },
    { who: "Mint", dept: "dept-6", text: "reconciled this week's Stripe payouts, 41 of 41 matched" },
    { who: "Verity", dept: "dept-5", text: "drafted the build confidentiality terms for your review" },
    { who: "Echo", dept: "dept-1", text: "turned nine studio interviews into two roadmap changes" },
    { who: "Rune", dept: "dept-2", text: "raised bug recall from 58% to 81% on the 120-bug eval" },
    { who: "Harbor", dept: "dept-8", text: "trained Vex on Unity and Godot crash logs" },
    { who: "Pip", dept: "dept-3", text: "published 'How we caught a save-file bug in 9 minutes'" },
    { who: "Dime", dept: "dept-6", text: "updated the cost per playtest run estimate to $0.11" },
    { who: "Quinn", dept: "dept-1", text: "wrote the spec for multiplayer playtests" },
    { who: "Seal", dept: "dept-5", text: "checked the GitHub App's permissions against your house rules" },
    { who: "Vex", dept: "dept-2", text: "shipped the pull request check to staging" },
  ],

  // PLACEHOLDER: written in the content round.
  howItWorks: {
    concepts: [
      {
        id: "concept-glitchwick",
        name: "Glitchwick",
        pitch: "AI playtesters for indie games: every build played, every bug filed to GitHub with a replay.",
        logoSrc: IDENTITY.logo,
        monogram: IDENTITY.monogram,
        kit: IDENTITY.kit,
        currentStars: 3.5,
        potentialStars: 4.5,
        attributes: attributes([16, 12, 11, 16, 14, 18, 16, 13, 16, 15]),
        verdict: "Studios ship every week and nobody has time to play every build. GPU cost per run is the number to watch.",
        archetypeLabel: "B2B SaaS",
        version: 1,
      },
      {
        ...TUTORLANE.howItWorks.concepts[1]!,
        id: "concept-shaderwell",
        name: "Shaderwell",
        pitch: "Frame-time reports for every commit of a game, so a slow shader never reaches players.",
        verdict: "Clear pain for 3D studios, but a narrower market than playtesting.",
        archetypeLabel: "Developer tools",
      },
    ],
    brandOptions: [{ logo: IDENTITY.logo, kit: IDENTITY.kit }, ...TUTORLANE.howItWorks.brandOptions.slice(1)],
    firstCyclePlan: [
      { department: "product", task: "Interview ten indie studios about their QA week", tasks: 2, done: 70 },
      { department: "development", task: "Build the sandbox play loop", tasks: 4, done: 48 },
      { department: "distribution", task: "Test devlogs and developer communities", tasks: 3, done: 85 },
      { department: "finance", task: "Set up Stripe and the cost-per-run model", tasks: 1, done: 35 },
      { department: "legal", task: "Prepare incorporation and build confidentiality", tasks: 1, done: 55 },
    ],
  },

  // PLACEHOLDER: written in the content round.
  sessions: {
    ...STOREFRONT_SESSION_SCRIPT,
    tasks: [
      "Replay clip on every finding",
      "Play loop: one run per build in a sandbox",
      "GitHub check on every pull request",
      "Eval: 120 known bugs across 14 games",
      "Crash log parser for Unity and Godot",
      "Merge duplicate bugs across runs",
      "Stripe billing for studio plans",
      "Godot export in the sandbox",
    ],
    stdout: [
      "$ pnpm install --frozen-lockfile",
      "Lockfile is up to date, resolution step is skipped",
      "Progress: resolved 402, reused 402, downloaded 0, added 0",
      "$ pnpm vitest run src/playtest/play-loop.test.ts",
      " RUN  v5.0.3 /workspace/glitchwick",
      " ✓ src/playtest/play-loop.test.ts (5 tests) 318ms",
      " Test Files  1 passed (1)",
      "      Tests  5 passed (5)",
      "$ pnpm evals run bugs --cases 120",
      "Running 120 cases (known bugs in 14 indie games)",
      "  ✓  recall 97/120 (81.0%)",
      "  ✘  cost per run $0.14, above the $0.12 budget",
      "  1 threshold missed (cost per run ≤ $0.12)",
      '$ git add -A && git commit -m "feat(playtest): replay clip on every finding"',
      "[agent/task-1 3a9d0c4] feat(playtest): replay clip on every finding",
      " 5 files changed, 196 insertions(+), 22 deletions(-)",
      "$ pnpm tsc --noEmit",
      "$ pnpm eslint src",
      "$ pnpm evals run bugs --cases 120",
      "  all thresholds met (recall 81.0%, cost per run $0.11)",
      "$ gh pr create --fill --base main",
      "https://github.com/foundmill-demo/glitchwick/pull/212",
    ],
    readPath: "src/playtest/runner.ts",
    file: {
      path: "src/playtest/play-loop.ts",
      diff: [
        "diff --git a/src/playtest/play-loop.ts b/src/playtest/play-loop.ts",
        "--- a/src/playtest/play-loop.ts",
        "+++ b/src/playtest/play-loop.ts",
        "@@ -1,6 +1,15 @@",
        ' import { sandbox } from "@/lib/sandbox";',
        '+import { recordReplay } from "@/playtest/replay";',
        " ",
        "-export async function playBuild(build: Build) {",
        "-  return sandbox.run(build.path);",
        "+export type Finding = { title: string; severity: 1 | 2 | 3; replayUrl: string };",
        "+",
        "+export async function playBuild(build: Build, budget: RunBudget): Promise<Finding[]> {",
        '+  const run = await sandbox.run(build.path, { gpu: "spot", timeoutSec: budget.seconds });',
        "+  // Every finding carries the 20 seconds of play that led to it.",
        "+  const replay = recordReplay(run, { windowSec: 20 });",
        "+  const findings = await detectBugs(run.frames, run.logs);",
        "+  return findings.map((f) => ({ ...f, replayUrl: replay.clip(f.at) }));",
        " }",
      ].join("\n"),
      additions: 11,
      deletions: 2,
    },
    styleFile: {
      path: "src/report/bug-card.css",
      diff: ["--- a/src/report/bug-card.css", "+++ b/src/report/bug-card.css", "@@ -2,5 +2,9 @@", " .bug-card {", "-  padding: 13px;", "+  padding: var(--space-3);", " }", "+", "+.bug-card__replay {", "+  border-radius: var(--radius-md);", "+}"].join("\n"),
    },
    notes: [
      "Reading the 120-bug eval before touching the play loop.",
      "Runs move to spot GPUs; a run that is interrupted resumes from its last save.",
      "Each finding carries the 20 seconds of play before it.",
      "Cost per run missed its budget; sampling 10 frames a second instead of 30.",
      "Review: one finding about a studio's build address in the log, redacted.",
    ],
    unitCommand: "pnpm vitest run",
    unitPassed: 5,
    acceptanceCommand: "pnpm evals run bugs",
    failingCheck: "cost per run under $0.12",
    failure: "Error: recall 52.5%, below the 75% threshold",
    currency: CURRENCY,
  },

  // PLACEHOLDER: written in the content round.
  channels: {
    seed: "glitchwick",
    fits: { content: 18, social: 16, influencer: 15, events: 14, seo: 13, email_automation: 12, pr: 10, affiliate: 9, paid_ads: 8, geo: 7, lead_generation: 6, direct_mail: 2, print: 2, broadcast: 2, outdoor: 1 },
    recommended: ["content", "social", "influencer", "events"],
    why: "{channel} reaches indie developers where they already share devlogs and ask each other about bugs. The first signal comes within a cycle and the cost per studio sits inside the runway budget.",
  },

  // PLACEHOLDER: written in the content round.
  journey: {
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
      "Retinol serum v1": "Play loop v1",
      "Bundle builder": "Replay recorder",
      "Subscription plans": "Pull request check",
      "Retail pack": "Godot support",
      "Chose DTC over wholesale": "Chose studios over publishers",
      "Moved production to Meridian Labs": "Moved runs to spot GPUs",
      "First enterprise contract": "First publisher contract",
    },
    chapterTitles: ["Finding the wedge", "First studios", "The replay chapter", "Checks on every pull request", "Godot joins Unity", "Steady state", "Launch crunch", "Publishers", "Fall releases"],
    customerNames: ["Lanternfly Games", "Owlbear Interactive", "Tin Moth Studio", "Northpaw Games", "Little Comet", "Brightwater Games", "Quarry Lane Studio", "Moonsoup", "Hollow Pine Games", "Sparkline Arcade"],
    roadmap: ["Multiplayer playtests", "Console builds", "Publisher dashboard"],
  },

  // PLACEHOLDER: written in the content round.
  customerUpdate: {
    level: "Featured update",
    customer: {
      name: "Lanternfly Games",
      entityId: "8b1f4e2a-3c5d-4e6f-9a7b-1c2d3e4f5a6b",
      facts: [
        { label: "Studio", value: "6 devs" },
        { label: "Plan", value: "Studio" },
        { label: "First seen", value: "Sep 24" },
      ],
    },
    plan: "Studio · checks on every pull request for 6 developers",
    stats: { touches: 6, channels: 3, days: 9, acquisitionCostMinor: 3100 },
    commentary: [
      { text: "Pip's devlog 'How we caught a save-file bug in 9 minutes' brings Dana Reyes to the site on a Sunday evening.", highlight: true },
      { text: "On Tuesday she connects her repository and runs a free playtest on the latest build." },
      { text: "Rune's report lands within the hour: three bugs, each filed to GitHub with a replay of the run that found it.", highlight: true },
      { text: "Moss's follow-up shows her how the check runs on every pull request." },
      { text: "The whole team turns the check on by Friday. [[ent:8b1f4e2a-3c5d-4e6f-9a7b-1c2d3e4f5a6b|Lanternfly Games]] moves to Studio.", highlight: true },
    ],
    agents: [
      { name: "Rune", seed: "rune", dept: "dept-2", role: "Replay recorder", rating: 10, standout: true },
      { name: "Moss", seed: "moss", dept: "dept-3", role: "Email automation", rating: 8, standout: false },
      { name: "Pip", seed: "pip", dept: "dept-3", role: "Devlogs and content", rating: 6, standout: false },
    ],
  },

  // PLACEHOLDER: written in the content round.
  milestones: [
    { key: "customer_1", label: "First customer", description: "The first paying studio.", achievedAt: "2025-01-14T12:00:00", customerName: "Tin Moth Studio", ...usd(2900), shareable: true },
    { key: "customer_10", label: "10th customer", description: "Ten paying studios.", achievedAt: "2025-03-02T12:00:00", shareable: true },
    { key: "customer_100", label: "100th customer", description: "One hundred paying studios.", achievedAt: "2025-11-18T12:00:00", shareable: true },
    { key: "mrr_1k", label: "$1K MRR", description: "Monthly recurring revenue crosses $1,000.", achievedAt: "2025-04-09T12:00:00", shareable: true },
    { key: "mrr_10k", label: "$10K MRR", description: "Monthly recurring revenue crosses $10,000.", achievedAt: "2026-05-21T12:00:00", shareable: true },
    { key: "first_publisher", label: "First publisher contract", description: "A publisher puts all 12 of its studios on Glitchwick.", achievedAt: "2026-09-29T12:00:00", customerName: "Hollow Pine Games", ...usd(420000), shareable: true },
  ],

  // PLACEHOLDER: written in the content round.
  inboxNote: {
    from: { name: "Flare", seed: "flare", dept: "dept-3", role: "Distribution Strategist" },
    department: "Distribution",
    subject: "Sponsor a game jam with 4,000 entrants?",
    sentOn: "Wed, Oct 7",
    paragraphs: [
      "Game jams are Glitchwick's strongest channel after devlogs: three of the last ten studios that upgraded found us at one. A sponsorship of a large online jam this fall is ready to book, with the prize post written.",
      "It costs $600, above the $250 cap you set for new spend, so it waits for you. The runway stays at 16 months either way.",
    ],
    costMinor: 60_000,
    fit: "17 of 20",
    runwayAfter: "16 months",
    options: [
      { id: "approve", label: "Approve", recommended: true, consequence: "Flare books the sponsorship and the prize post runs next week.", costMinor: 60_000, reversible: false },
      { id: "smaller", label: "Try a smaller jam first", consequence: "Flare finds a smaller jam to test the post on, inside your cap.", costMinor: null, reversible: true },
      { id: "later", label: "Not this chapter", consequence: "Events stay off the board until the next chapter.", costMinor: null, reversible: true },
    ],
  },
};
