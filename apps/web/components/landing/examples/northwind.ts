/**
 * Northwind Skincare, the consumer-brand example: a skincare routine for reactive skin, made with contract labs and sold
 * online and through retail partners. It is the founder's own demo business in the product (packages/db/src/seed/
 * northwind.ts, in pounds sterling); here it is a US version, in US dollars with US suppliers and retailers (invented
 * names). Its departments show what custom labels look like: "Formulation Lab" over the development module's
 * Specialists screen and "Retail Partnerships" over distribution; physical products bring suppliers, stock, cash and a
 * retail deal.
 *
 * The identity (name, logo, the account's brand colours, vertical, description) is final. Everything below it is
 * placeholder copy that renders correctly; each block is marked "PLACEHOLDER: written in the content round". Loaded on
 * demand (its own chunk), never in the page's main bundle.
 */
import { STOREFRONT_SESSION_SCRIPT } from "@foundmill/dugout";
import { conceptAttributes as attributes, leadSkill as skill } from "./helpers";
import { EXAMPLE_IDENTITIES } from "./identity";
import { TUTORLANE } from "./tutorlane";
import type { ExampleBusiness } from "./types";

const IDENTITY = EXAMPLE_IDENTITIES.northwind;
const CURRENCY = "USD";
const usd = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });

export const NORTHWIND: ExampleBusiness = {
  identity: IDENTITY,
  currency: CURRENCY,
  locale: "en-US",

  // PLACEHOLDER: written in the content round.
  chief: { name: "Maren", seed: "maren", dept: "dept-1" },

  // PLACEHOLDER: written in the content round. The two custom labels are the founder's, from the product's Northwind.
  departments: [
    { id: "product", module: "product", label: "Product", dept: "dept-1", workers: [{ name: "Ivy", seed: "ivy" }, { name: "June", seed: "june" }] },
    { id: "formulation-lab", module: "development", label: "Formulation Lab", dept: "dept-7", icon: "lab", screens: ["specialists", "plan"], workers: [{ name: "Aloe", seed: "aloe" }, { name: "Reed", seed: "reed" }] },
    { id: "retail-partnerships", module: "distribution", label: "Retail Partnerships", dept: "dept-3", icon: "retail", workers: [{ name: "Marlo", seed: "marlo" }, { name: "Dex", seed: "dex" }] },
    { id: "finance", module: "finance", label: "Finance", dept: "dept-6", workers: [{ name: "Tess", seed: "tess" }] },
    { id: "legal", module: "legal", label: "Legal", dept: "dept-5", workers: [{ name: "Clove", seed: "clove" }] },
    { id: "team", module: "team", label: "Team", dept: "dept-8", workers: [{ name: "Bryn", seed: "bryn" }, { name: "Rowan", seed: "rowan" }] },
  ],

  // PLACEHOLDER: written in the content round.
  leads: [
    {
      department: "product",
      name: "Sage",
      seed: "sage",
      role: "Product lead",
      model: "Opus",
      stars: { current: 3.5, potential: 4.5 },
      remit: "A vision, a living specification and a roadmap shaped by what people with reactive skin actually report.",
      now: "Turning eight reactive-skin interviews into two roadmap changes",
      training: "Version 3 promoted: interview synthesis",
      skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Specification writing", "craft", 14, 1, 17), skill("prioritise", "Prioritisation", "judgement", 16, 1, 18), skill("no", "Saying no", "judgement", 14, 2, 17), skill("pace", "Pace", "execution", 14, 0, 16), skill("reliability", "Reliability", "execution", 15, 1, 17)],
      traits: [
        { id: "verbatim", label: "Quotes customers word for word", tone: "good" },
        { id: "cuts", label: "Cuts scope before adding it", tone: "good" },
        { id: "evidence", label: "Asks for batch numbers" },
      ],
    },
    {
      department: "formulation-lab",
      name: "Fern",
      seed: "fern",
      role: "Formulation lead",
      model: "Opus",
      stars: { current: 3.5, potential: 4.5 },
      remit: "Formulas, suppliers, stability tests and stock: specialists prepare every purchase order, and you place it.",
      now: "Comparing three quotes for batch 003",
      training: "Version 3 promoted: supplier quote comparison",
      skills: [skill("formulas", "Formulation review", "craft", 16, 2, 18), skill("sourcing", "Sourcing", "craft", 15, 1, 17), skill("quality", "Quality judgement", "judgement", 17, 1, 18), skill("stock", "Stock planning", "judgement", 14, 2, 17), skill("lead_times", "Lead-time tracking", "execution", 15, 1, 17), skill("records", "Batch records", "execution", 17, 0, 18)],
      traits: [
        { id: "quotes", label: "Cites a quote for every cost", tone: "good" },
        { id: "never_orders", label: "Prepares orders, never places them", tone: "good" },
        { id: "cautious", label: "Waits for stability data", tone: "warn" },
      ],
    },
    {
      department: "retail-partnerships",
      name: "Hollis",
      seed: "hollis",
      role: "Distribution Strategist",
      model: "Sonnet",
      stars: { current: 3, potential: 4.5 },
      remit: "Fifteen channels scored for fit; creators, paid social and refill stores start first, inside your caps.",
      now: "Putting the Lumen Pharmacy pilot in front of you",
      training: "Version 2 promoted: wholesale terms",
      skills: [skill("fit", "Channel fit", "craft", 16, 1, 18), skill("copy", "Copywriting", "craft", 14, 2, 17), skill("experiments", "Experiment design", "judgement", 15, 1, 17), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Attribution", "execution", 13, 1, 16), skill("partners", "Partner follow-up", "execution", 16, 2, 18)],
      traits: [
        { id: "small_tests", label: "Tests small before scaling", tone: "good" },
        { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
        { id: "stores", label: "Prefers independent stores" },
      ],
    },
    {
      department: "finance",
      name: "Cove",
      seed: "cove",
      role: "Finance lead",
      model: "Opus",
      stars: { current: 4, potential: 4.5 },
      remit: "Cash, stock, landed cost per unit, runway and a reconciled ledger. Anything that is not a real figure is labeled Forecast or Estimate.",
      now: "Reconciling this week's Shopify payouts, 212 of 212 matched",
      training: "Version 4 promoted: landed cost per unit",
      skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 15, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("unit", "Unit economics", "judgement", 15, 1, 17), skill("reporting", "Reporting clarity", "execution", 15, 1, 17), skill("audit", "Audit trail", "execution", 17, 0, 19)],
      traits: [
        { id: "labels", label: "Labels every estimate", tone: "good" },
        { id: "runway", label: "Flags runway under nine months", tone: "good" },
        { id: "conservative", label: "Conservative forecasts" },
      ],
    },
    {
      department: "legal",
      name: "Arden",
      seed: "arden",
      role: "Legal lead",
      model: "Opus",
      stars: { current: 3.5, potential: 4 },
      remit: "Incorporation, labels, product registrations and wholesale terms, prepared in full. You review and sign.",
      now: "Checking the new labels against FDA cosmetics rules",
      training: "Version 3 promoted: cosmetics labeling checklist",
      skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("regulatory", "Regulatory research", "craft", 16, 2, 18), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 14, 2, 17), skill("filing", "Filing preparation", "execution", 15, 1, 17)],
      traits: [
        { id: "explains", label: "Explains every clause it flags", tone: "good" },
        { id: "prepares", label: "Prepares, never signs", tone: "good" },
        { id: "dates", label: "Cites the date it checked" },
      ],
    },
    {
      department: "team",
      name: "Haven",
      seed: "haven",
      role: "Head of team",
      model: "Sonnet",
      stars: { current: 3, potential: 4 },
      remit: "Hire agents from templates, train them against real tests, and watch their skills grow.",
      now: "Training Reed on supplier lead times",
      training: "Version 2 promoted: training against supplier records",
      skills: [skill("hiring", "Hiring decisions", "craft", 15, 1, 17), skill("training", "Training design", "craft", 15, 2, 17), skill("roles", "Role design", "judgement", 14, 1, 16), skill("feedback", "Feedback", "judgement", 15, 1, 17), skill("cost", "Cost awareness", "execution", 14, 1, 16), skill("coverage", "Coverage planning", "execution", 14, 0, 16)],
      traits: [
        { id: "real_tests", label: "Trains against real tests", tone: "good" },
        { id: "templates", label: "Hires from templates first" },
        { id: "cost", label: "Watches cost per task", tone: "good" },
      ],
    },
  ],

  // PLACEHOLDER: written in the content round.
  deck: {
    startCycle: 188,
    chapter: "Chapter 8",
    runwayMonths: 11,
    costPerTaskMinor: 52,
    earlierDecision: { title: "You approved the pouch supplier", detail: "Formulation Lab ordered 2,000 pouches.", from: { name: "Fern", seed: "fern", dept: "dept-7" } },
    outcomes: [
      {
        kind: "decision",
        id: "batch",
        from: { name: "Fern", seed: "fern", dept: "dept-7", role: "Formulation lead" },
        department: "Formulation Lab",
        subject: "Place the order for batch 003?",
        body: "The purchase order pack is ready: three products, 2,000 units each, from Cedar Ridge Labs with glass from Bluewater Packaging. Landed cost is $12.40 a unit against a $54 routine.",
        stake: "$37,200 deposit · Estimate",
        options: [
          { id: "order", label: "Place the order", recommended: true, done: "Batch 003 ordered", outcome: "Stock lands in six weeks, in time for the retail launch." },
          { id: "wait", label: "Wait for stability data", done: "Batch 003 waits for stability data", outcome: "Fern comes back in two weeks with the serum's results." },
        ],
      },
      {
        kind: "win",
        id: "maple",
        customer: "Maple Refill Co.",
        plan: "Wholesale · 3 products in 12 stores",
        firstTouch: "Met Hollis's sample box at a refill-store trade show",
        standout: { name: "Hollis", seed: "hollis", dept: "dept-3" },
        involved: [
          { name: "Hollis", seed: "hollis", dept: "dept-3" },
          { name: "Marlo", seed: "marlo", dept: "dept-3" },
          { name: "Fern", seed: "fern", dept: "dept-7" },
        ],
      },
      {
        kind: "decision",
        id: "cover",
        from: { name: "Cove", seed: "cove", dept: "dept-6", role: "Finance lead" },
        department: "Finance",
        subject: "Keep six weeks of cleanser in stock?",
        body: "Retail orders doubled cleanser sales. Six weeks of cover ties up $18,600 more in stock, and the runway holds at 11 months.",
        stake: "+$18,600 in stock · Estimate",
        options: [
          { id: "six", label: "Keep six weeks", recommended: true, done: "Cleanser cover raised to six weeks", outcome: "Cove checks stock against orders every Monday." },
          { id: "four", label: "Stay at four weeks", done: "Cleanser cover kept at four weeks", outcome: "Fern reorders sooner and in smaller lots." },
        ],
      },
      {
        kind: "decision",
        id: "wholesale",
        from: { name: "Arden", seed: "arden", dept: "dept-5", role: "Legal lead" },
        department: "Legal",
        subject: "Sign Lumen Pharmacy's wholesale terms?",
        body: "Arden reviewed the terms and agreed fixes to two clauses: returns within 30 days, payment in 45 days rather than 90. Signing is yours alone.",
        stake: "12-month term · 40 stores",
        options: [
          { id: "sign", label: "Review and sign", recommended: true, done: "Lumen wholesale terms signed", outcome: "Arden files the copy and sets the renewal reminder." },
          { id: "ask", label: "Ask Arden a question", done: "Question sent to Arden", outcome: "Arden answers in your Inbox before anything moves." },
        ],
      },
    ],
  },

  // PLACEHOLDER: written in the content round.
  activity: [
    { who: "Fern", dept: "dept-7", text: "logged week 12 of the serum's stability test, no drift" },
    { who: "Hollis", dept: "dept-3", text: "put the Lumen Pharmacy pilot in front of you" },
    { who: "Cove", dept: "dept-6", text: "reconciled this week's Shopify payouts, 212 of 212 matched" },
    { who: "Arden", dept: "dept-5", text: "checked the new labels against FDA cosmetics rules" },
    { who: "Sage", dept: "dept-1", text: "turned eight reactive-skin interviews into two roadmap changes" },
    { who: "Aloe", dept: "dept-7", text: "compared three quotes for refill pouches" },
    { who: "Haven", dept: "dept-8", text: "trained Reed on supplier lead times" },
    { who: "Marlo", dept: "dept-3", text: "sent the wholesale price list to Maple Refill Co." },
    { who: "Tess", dept: "dept-6", text: "updated the landed cost estimate to $12.40 a unit" },
    { who: "Ivy", dept: "dept-1", text: "wrote the spec for the reaction diary" },
    { who: "Clove", dept: "dept-5", text: "drafted the retail partner agreement" },
    { who: "Reed", dept: "dept-7", text: "booked the warehouse slot for batch 003" },
  ],

  // PLACEHOLDER: written in the content round.
  howItWorks: {
    concepts: [
      {
        id: "concept-northwind",
        name: "Northwind Skincare",
        pitch: "A short skincare routine for reactive skin, with every batch's test results published.",
        logoSrc: IDENTITY.logo,
        monogram: IDENTITY.monogram,
        kit: IDENTITY.kit,
        currentStars: 3.5,
        potentialStars: 4,
        attributes: attributes([15, 15, 9, 13, 9, 13, 16, 12, 9, 14]),
        verdict: "People with reactive skin already read ingredient lists. Stock ties up cash, so the landed cost is the risk to plan for.",
        archetypeLabel: "Physical product",
        version: 1,
      },
      {
        ...TUTORLANE.howItWorks.concepts[1]!,
        id: "concept-refillery",
        name: "Refillery",
        pitch: "Refill stations for independent stores, stocked with house-brand basics.",
        verdict: "Stores like it, but each station is a capital outlay.",
        archetypeLabel: "Physical product",
      },
    ],
    brandOptions: [{ logo: IDENTITY.logo, kit: IDENTITY.kit }, ...TUTORLANE.howItWorks.brandOptions.slice(1)],
    firstCyclePlan: [
      { department: "product", task: "Interview twelve people with reactive skin", tasks: 2, done: 70 },
      { department: "formulation-lab", task: "Shortlist three US contract labs", tasks: 4, done: 42 },
      { department: "retail-partnerships", task: "Test creators and refill stores", tasks: 3, done: 80 },
      { department: "finance", task: "Build the landed cost model", tasks: 1, done: 35 },
      { department: "legal", task: "Prepare incorporation and the label review", tasks: 1, done: 55 },
    ],
  },

  // PLACEHOLDER: written in the content round. The storefront script is the product's own Northwind work.
  sessions: {
    ...STOREFRONT_SESSION_SCRIPT,
    tasks: [
      "Add a bundle picker to the product page",
      "Reaction diary in the account",
      "Batch results page per product",
      "Subscription pause and skip",
      "Wholesale price list for retail partners",
      "Shopify order webhooks into the Journey",
      "Landed cost per product",
      "Refill reminder emails",
    ],
    failure: "Error: price mismatch, expected $42.00 received $4,200.00",
    currency: CURRENCY,
  },

  // PLACEHOLDER: written in the content round.
  channels: {
    seed: "northwind",
    fits: { influencer: 17, paid_ads: 16, social: 15, email_automation: 14, content: 12, seo: 11, affiliate: 10, pr: 9, events: 8, direct_mail: 7, print: 6, geo: 5, outdoor: 5, broadcast: 4, lead_generation: 3 },
    recommended: ["influencer", "paid_ads", "social", "email_automation"],
    why: "{channel} fits a skincare brand people choose after reading the ingredients. Time to first signal is short and the cost per customer sits inside the runway budget.",
  },

  // PLACEHOLDER: written in the content round.
  journey: {
    ribbonDepartments: [
      { id: "d-product", name: "Product", dept: "dept-1" },
      { id: "d-development", name: "Formulation Lab", dept: "dept-7" },
      { id: "d-distribution", name: "Retail Partnerships", dept: "dept-3" },
      { id: "d-finance", name: "Finance", dept: "dept-6" },
      { id: "d-team", name: "Team", dept: "dept-8" },
      { id: "d-operations", name: "Legal", dept: "dept-5" },
    ],
    milestoneLabels: {
      "Northwind Skincare AB incorporated": "Northwind Skincare Inc. incorporated",
      "Retinol serum v1": "Calming serum v1",
      "Bundle builder": "Routine bundles",
      "Subscription plans": "Refill subscriptions",
      "Retail pack": "Retail pack",
      "Chose DTC over wholesale": "Chose online first, stores second",
      "Moved production to Meridian Labs": "Moved production to Cedar Ridge Labs",
      "First enterprise contract": "First retail partner",
    },
    chapterTitles: ["Finding the formula", "First customers", "The bundle chapter", "Scaling the lab", "Retail on the horizon", "Steady state", "Second summer", "Into stores", "Fall restock"],
    customerNames: ["Maple Refill Co.", "Dana Whitfield", "Lumen Pharmacy", "Priya Raman", "Summit Health Stores", "Marcus Bell", "Juniper & Oak", "Elena Ortiz", "Clearwater Apothecary", "Sam Okoye"],
    roadmap: ["Reaction diary", "Body care range", "Pharmacy pop-ups"],
  },

  // PLACEHOLDER: written in the content round.
  customerUpdate: {
    level: "Featured update",
    customer: {
      name: "Maple Refill Co.",
      entityId: "3e7a9c1d-5b2f-4d8e-a6c0-9f1b2d3c4e5a",
      facts: [
        { label: "Stores", value: "12" },
        { label: "Terms", value: "Net 45" },
        { label: "First seen", value: "Aug 12" },
      ],
    },
    plan: "Wholesale · 3 products in 12 stores",
    stats: { touches: 8, channels: 3, days: 34, acquisitionCostMinor: 21000 },
    commentary: [
      { text: "Hollis's sample box reaches Maple Refill's buyer at a refill-store trade show.", highlight: true },
      { text: "Two weeks later she reads the batch results page for the cleanser." },
      { text: "Marlo sends the wholesale price list the same afternoon, with landed costs Fern checked.", highlight: true },
      { text: "Fern answers the buyer's questions on the serum's stability data." },
      { text: "The buyer orders for all twelve stores. [[ent:3e7a9c1d-5b2f-4d8e-a6c0-9f1b2d3c4e5a|Maple Refill Co.]] becomes a retail partner.", highlight: true },
    ],
    agents: [
      { name: "Hollis", seed: "hollis", dept: "dept-3", role: "Retail partnerships", rating: 10, standout: true },
      { name: "Marlo", seed: "marlo", dept: "dept-3", role: "Wholesale follow-up", rating: 8, standout: false },
      { name: "Fern", seed: "fern", dept: "dept-7", role: "Formulation Lab", rating: 7, standout: false },
    ],
  },

  // PLACEHOLDER: written in the content round.
  milestones: [
    { key: "customer_1", label: "First customer", description: "The first routine sold.", achievedAt: "2024-11-02T12:00:00", customerName: "Dana Whitfield", ...usd(5400), shareable: true },
    { key: "customer_10", label: "10th customer", description: "Ten paying customers.", achievedAt: "2024-11-21T12:00:00", shareable: true },
    { key: "customer_100", label: "100th customer", description: "One hundred paying customers.", achievedAt: "2025-03-14T12:00:00", shareable: true },
    { key: "mrr_1k", label: "$1K MRR", description: "Monthly recurring revenue crosses $1,000.", achievedAt: "2025-01-30T12:00:00", shareable: true },
    { key: "mrr_10k", label: "$10K MRR", description: "Monthly recurring revenue crosses $10,000.", achievedAt: "2026-02-11T12:00:00", shareable: true },
    { key: "first_retail_partner", label: "First retail partner", description: "Twelve stores stock the routine.", achievedAt: "2026-09-16T12:00:00", customerName: "Maple Refill Co.", ...usd(1_860_000), shareable: true },
  ],

  // PLACEHOLDER: written in the content round.
  inboxNote: {
    from: { name: "Hollis", seed: "hollis", dept: "dept-3", role: "Distribution Strategist" },
    department: "Retail Partnerships",
    subject: "Send sample boxes to 40 independent pharmacies?",
    sentOn: "Wed, Oct 7",
    paragraphs: [
      "Refill stores are Northwind's strongest retail channel: Maple Refill Co. reordered within a month. Forty independent pharmacies that already stock fragrance-free brands are ready for a sample box, with the letter written.",
      "It costs $720, above the $250 cap you set for new spend, so it waits for you. The runway stays at 11 months either way.",
    ],
    costMinor: 72_000,
    fit: "15 of 20",
    runwayAfter: "11 months",
    options: [
      { id: "approve", label: "Approve", recommended: true, consequence: "Hollis sends the boxes and follows up with each pharmacy in two weeks.", costMinor: 72_000, reversible: false },
      { id: "smaller", label: "Try ten pharmacies first", consequence: "Hollis sends ten boxes inside your cap and reports back.", costMinor: null, reversible: true },
      { id: "later", label: "Not this chapter", consequence: "Pharmacies stay off the board until the next chapter.", costMinor: null, reversible: true },
    ],
  },
};
