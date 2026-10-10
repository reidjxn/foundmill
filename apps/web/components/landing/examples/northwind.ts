/**
 * Northwind Skincare, the consumer-brand example: a fragrance-free, three-step routine for reactive skin (a calming
 * serum, a gentle cleanser and a barrier moisturizer) sold on its Shopify store, with refill subscriptions, and through
 * retail partners. A contract manufacturer in New Jersey (Cranbury Contract Labs) fills every batch; pumps, tubes, jars
 * and cartons come from a supplier in Ohio (Maumee Valley Packaging). Every name here is invented.
 *
 * It is the founder's own demo business in the product (packages/db/src/seed/northwind.ts, in pounds sterling); here it
 * is a US brand, in US dollars and US English. What makes it different from the software examples is physical: the
 * Formulation Lab runs stability tests and prepares batch purchase orders with deposits and landed cost per unit, stock
 * ties up cash, Retail Partnerships negotiates with store buyers, and Legal works through MoCRA listings, labels and
 * claims. Its six departments keep the founder's own labels ("Formulation Lab" over the development module's
 * Specialists, Live sessions and Plan screens, "Retail Partnerships" over distribution) beside Development, which runs
 * the Shopify store. The Chief of Staff leads the team itself, as in the product, so Team is not one of the six.
 *
 * The story: the first batch lands on Oct 8, 2024; refills, batch results pages and bigger batches follow; on the day the
 * page opens (Oct 7, 2026) a 36-store natural grocery chain, Larkfield Market, places its first opening order, and the
 * batch 007 purchase order waits for the founder. Nothing is presented as real traction: every example is labelled
 * Example and every money figure that is not a measurement is labelled Estimate where it appears. Loaded on demand (its
 * own chunk), never in the page's main bundle.
 */
import type { MockSessionScript } from "@foundmill/dugout";
import { conceptAttributes as attributes, leadSkill as skill } from "./helpers";
import { EXAMPLE_IDENTITIES } from "./identity";
import { TUTORLANE } from "./tutorlane";
import type { ActivityLine, CycleOutcome, ExampleBusiness, ExampleCustomerUpdate, ExampleCyclePlanItem, ExampleDepartment, ExampleInboxNote, ExampleJourney, ExampleLead } from "./types";

const IDENTITY = EXAMPLE_IDENTITIES.northwind;
const CURRENCY = "USD";
const usd = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });

// ---------------------------------------------------------------------------------------------------------------------
// Departments (labels over the six modules) and the team orbit's agents
// ---------------------------------------------------------------------------------------------------------------------

const DEPARTMENTS: readonly ExampleDepartment[] = [
  { id: "product", module: "product", label: "Product", dept: "dept-1", workers: [{ name: "Ivy", seed: "ivy" }, { name: "June", seed: "june" }] },
  // The founder's label over the development module's specialist screens (the product's Operations department).
  { id: "formulation-lab", module: "development", label: "Formulation Lab", dept: "dept-7", icon: "lab", screens: ["specialists", "training-ground", "plan"], workers: [{ name: "Aloe", seed: "aloe" }, { name: "Reed", seed: "reed" }, { name: "Sorrel", seed: "sorrel" }] },
  // The Shopify store: code, pull requests and environments, on the same module.
  { id: "development", module: "development", label: "Development", dept: "dept-2", screens: ["training-ground", "pull-requests", "code", "environments"], workers: [{ name: "Moss", seed: "moss" }, { name: "Rue", seed: "rue" }] },
  { id: "retail-partnerships", module: "distribution", label: "Retail Partnerships", dept: "dept-3", icon: "retail", workers: [{ name: "Poppy", seed: "poppy" }, { name: "Marlo", seed: "marlo" }] },
  { id: "finance", module: "finance", label: "Finance", dept: "dept-6", workers: [{ name: "Tess", seed: "tess" }] },
  { id: "legal", module: "legal", label: "Legal", dept: "dept-5", workers: [{ name: "Clove", seed: "clove" }] },
];

// ---------------------------------------------------------------------------------------------------------------------
// Ideas and brand (How it works)
// ---------------------------------------------------------------------------------------------------------------------

/** A runner-up's mark in its own brand colours (one of the brand picker's generated logos). */
const RUNNER_UP_BRAND = TUTORLANE.howItWorks.brandOptions[4] ?? { logo: IDENTITY.logo, kit: IDENTITY.kit };

/** The Ideation Studio's two concepts: Northwind in front, a runner-up the regulatory rating held back. */
const CONCEPTS: ExampleBusiness["howItWorks"]["concepts"] = [
  {
    id: "concept-northwind",
    name: "Northwind Skincare",
    pitch: "A fragrance-free, three-step routine for reactive skin, with every batch's test results published.",
    logoSrc: IDENTITY.logo,
    monogram: IDENTITY.monogram,
    kit: IDENTITY.kit,
    currentStars: 3.5,
    potentialStars: 4.5,
    attributes: attributes([15, 16, 8, 12, 8, 12, 16, 11, 11, 14]),
    verdict: "People with reactive skin read every label and stay once a routine works. Each batch ties up cash before it sells, so landed cost is the number to watch.",
    archetypeLabel: "DTC physical product",
    version: 1,
  },
  {
    id: "concept-daybreak",
    name: "Daybreak SPF",
    pitch: "A mineral sunscreen for reactive skin that leaves no white cast.",
    logoSrc: RUNNER_UP_BRAND.logo,
    kit: RUNNER_UP_BRAND.kit,
    currentStars: 3,
    potentialStars: 4,
    attributes: attributes([16, 15, 9, 6, 7, 11, 13, 12, 4, 13]),
    verdict: "Strong pull, but sunscreen is an over-the-counter drug in the US: SPF testing pushes the first sale out by a year.",
    archetypeLabel: "DTC physical product",
    version: 1,
  },
];

/** The brand picker's six options: Northwind's own mark first, then the generated marks in their own brand colours. */
const BRAND_OPTIONS: ExampleBusiness["howItWorks"]["brandOptions"] = [{ logo: IDENTITY.logo, kit: IDENTITY.kit }, ...TUTORLANE.howItWorks.brandOptions.slice(1)];

/**
 * The Chief of Staff's plan for cycle 1, the week the first batch landed (five rows fit the card with its total). Each
 * task reads whole on one line of the card at 1280 px (about 26 characters).
 */
const FIRST_CYCLE_PLAN: readonly ExampleCyclePlanItem[] = [
  { department: "formulation-lab", task: "Check and release batch 001", tasks: 3, done: 55 },
  { department: "development", task: "Set up the Shopify store", tasks: 4, done: 40 },
  { department: "retail-partnerships", task: "Seed twenty creators", tasks: 3, done: 85 },
  { department: "finance", task: "Model landed cost per unit", tasks: 1, done: 30 },
  { department: "legal", task: "Incorporate in Delaware", tasks: 1, done: 60 },
];

// ---------------------------------------------------------------------------------------------------------------------
// The live activity: the hero feed and the ticker
// ---------------------------------------------------------------------------------------------------------------------

const ACTIVITY: readonly ActivityLine[] = [
  { who: "Fern", dept: "dept-7", text: "logged week 12 of the serum's stability test, pH and viscosity in spec" },
  { who: "Hollis", dept: "dept-3", text: "sent three chain buyers the line sheet and batch results" },
  { who: "Cove", dept: "dept-6", text: "reconciled this week's Shopify payouts, 214 of 214 matched" },
  { who: "Arden", dept: "dept-5", text: "confirmed Cranbury's FDA facility registration is current" },
  { who: "Reed", dept: "dept-7", text: "compared three quotes for 30 ml airless pumps" },
  { who: "Linden", dept: "dept-2", text: "opened a pull request for skip-a-refill" },
  { who: "Poppy", dept: "dept-3", text: "shipped 30 creator kits with tracked discount codes" },
  { who: "Sage", dept: "dept-1", text: "turned 46 subscriber reviews into one spec change" },
  { who: "Tess", dept: "dept-6", text: "updated the landed cost estimate to $11.78 a routine" },
  { who: "Clove", dept: "dept-5", text: "struck 'clinically proven' from the serum page" },
  { who: "Marlo", dept: "dept-3", text: "timed refill reminders to ten days before a bottle runs out" },
  { who: "Maren", dept: "dept-1", text: "trained Reed on supplier lead times" },
  { who: "Moss", dept: "dept-2", text: "added batch numbers to order confirmation emails" },
];

// ---------------------------------------------------------------------------------------------------------------------
// The cycle in the hero deck: what each press of Continue brings back
// ---------------------------------------------------------------------------------------------------------------------

/** In order: the chain's terms, the chain's opening order (the Customer Update), then stock cover and an FDA listing. */
const CYCLE_OUTCOMES: readonly CycleOutcome[] = [
  {
    kind: "decision",
    id: "larkfield-terms",
    from: { name: "Hollis", seed: "hollis", dept: "dept-3", role: "Distribution Strategist" },
    department: "Retail Partnerships",
    subject: "Accept Larkfield Market's opening terms?",
    body: "The buyer wants all three products in 36 stores and asked for a free fill; Hollis offered a four-week launch promo instead and got Net 30. Northwind keeps 56% after landed cost and the promo.",
    stake: "$2,160 promo · Estimate",
    options: [
      { id: "accept", label: "Accept terms", recommended: true, done: "Larkfield terms accepted", outcome: "Hollis sends your signed vendor forms and books the first delivery." },
      { id: "counter", label: "Ask for Net 15", done: "Counteroffer sent to Larkfield", outcome: "Hollis asks once more and brings back the buyer's answer." },
    ],
  },
  // The same customer as the Customer Update the gold card opens.
  {
    kind: "win",
    id: "larkfield",
    customer: "Larkfield Market",
    plan: "Opening order · 3 products in 36 stores",
    firstTouch: "Saw a creator's fragrance-free routine video",
    standout: { name: "Hollis", seed: "hollis", dept: "dept-3" },
    involved: [
      { name: "Hollis", seed: "hollis", dept: "dept-3" },
      { name: "Poppy", seed: "poppy", dept: "dept-3" },
      { name: "Fern", seed: "fern", dept: "dept-7" },
    ],
  },
  {
    kind: "decision",
    id: "cover",
    from: { name: "Cove", seed: "cove", dept: "dept-6", role: "Finance lead" },
    department: "Finance",
    subject: "Hold eight weeks of stock instead of six?",
    body: "Chain orders arrive in lumps: Larkfield will reorder every two weeks. Two more weeks of cover ties up $4,700 more in stock at landed cost, and the runway holds at 13 months.",
    stake: "+$4,700 in stock · Estimate",
    options: [
      // The Inbox line is one line in a 21rem column: short enough to read whole.
      { id: "eight", label: "Hold eight weeks", recommended: true, done: "Stock cover now eight weeks", outcome: "Cove checks cover against orders every Monday." },
      { id: "six", label: "Stay at six weeks", done: "Stock cover kept at six weeks", outcome: "Fern reorders sooner, in smaller batches." },
    ],
  },
  {
    kind: "decision",
    id: "listing",
    from: { name: "Arden", seed: "arden", dept: "dept-5", role: "Legal lead" },
    department: "Legal",
    subject: "Submit the body lotion's FDA product listing?",
    body: "MoCRA requires a listing for every cosmetic product sold in the US. Arden filled in the ingredients, the label and Cranbury's facility registration. Submitting is yours alone, under your own login.",
    stake: "Due 120 days after launch",
    options: [
      { id: "submit", label: "Review and submit", recommended: true, done: "Body lotion listing submitted", outcome: "Arden files the confirmation and sets a reminder for the annual update." },
      { id: "ask", label: "Ask Arden a question", done: "Question sent to Arden", outcome: "Arden answers in your Inbox before anything moves." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// The live sessions: four Formulation Lab specialists on batch 007
// ---------------------------------------------------------------------------------------------------------------------

/** The purchase order pack the lab prepares for the founder: every line cites a quote. */
const PO_PACK_DIFF = [
  "diff --git a/lab/batches/batch-007/po-pack.md b/lab/batches/batch-007/po-pack.md",
  "--- /dev/null",
  "+++ b/lab/batches/batch-007/po-pack.md",
  "@@ -0,0 +1,16 @@",
  "+# Batch 007 purchase order pack, for your approval",
  "+",
  "+| # | Item | Supplier | Quote | Units | Unit | Total |",
  "+| - | --- | --- | --- | ---: | ---: | ---: |",
  "+| 1 | Calming serum, 30 ml, filled | Cranbury Contract Labs | CCL-4471 | 5,000 | $3.40 | $17,000 |",
  "+| 2 | Gentle cleanser, 150 ml, filled | Cranbury Contract Labs | CCL-4472 | 5,000 | $2.10 | $10,500 |",
  "+| 3 | Barrier moisturizer, 50 ml, filled | Cranbury Contract Labs | CCL-4473 | 5,000 | $2.90 | $14,500 |",
  "+| 4 | Airless pump, 30 ml | Maumee Valley Packaging | MVP-2290 | 5,000 | $0.92 | $4,600 |",
  "+| 5 | Squeeze tube, 150 ml | Maumee Valley Packaging | MVP-2291 | 5,000 | $0.48 | $2,400 |",
  "+| 6 | Airless jar, 50 ml | Maumee Valley Packaging | MVP-2292 | 5,000 | $0.84 | $4,200 |",
  "+| 7 | Cartons, three sizes | Maumee Valley Packaging | MVP-2293 | 15,000 | $0.21 | $3,150 |",
  "+| 8 | Freight to the warehouse | Keystone Freight | KF-118 | 1 | $1,650 | $1,650 |",
  "+| 9 | Release testing, three lots | Clearwell Testing Labs | CTL-532 | 3 | $300 | $900 |",
  "+",
  "+Deposit with the order: 50% of Cranbury's $42,000 = $21,000, paid by you.",
  "+Landed cost per routine: $11.78 (Estimate)",
].join("\n");

/** After the founder's nudge: the 3,000-unit tier beside the 5,000-unit one. */
const LANDED_COST_DIFF = [
  "--- a/lab/batches/batch-007/landed-cost.md",
  "+++ b/lab/batches/batch-007/landed-cost.md",
  "@@ -1,6 +1,6 @@",
  "-| Per routine | 5,000 units |",
  "-| --- | ---: |",
  "-| Fill, formula and QC | $8.40 |",
  "-| Components and cartons | $2.87 |",
  "-| Freight and release testing | $0.51 |",
  "-| Landed (Estimate) | $11.78 |",
  "+| Per routine | 5,000 units | 3,000 units |",
  "+| --- | ---: | ---: |",
  "+| Fill, formula and QC | $8.40 | $9.30 |",
  "+| Components and cartons | $2.87 | $3.03 |",
  "+| Freight and release testing | $0.51 | $0.77 |",
  "+| Landed (Estimate) | $11.78 | $13.10 |",
].join("\n");

/**
 * Four lab specialists working toward the batch 007 order: the serum's week-12 stability readout, an RFQ for pumps,
 * the last batch's certificates of analysis and the purchase order pack itself, which waits for the founder's approval.
 * The sandbox holds the lab's batch records; its checks are the pack's acceptance tests.
 */
const SESSION_SCRIPT: MockSessionScript = {
  names: ["Aloe", "Reed", "Sorrel", "Fern"],
  agents: [
    { name: "Aloe", seed: "aloe", role: "Formulation chemist", dept: "dept-7", model: "opus", kind: "specialist" },
    { name: "Reed", seed: "reed", role: "Sourcing and manufacturing", dept: "dept-7", model: "sonnet", kind: "specialist" },
    { name: "Sorrel", seed: "sorrel", role: "Quality and release", dept: "dept-7", model: "sonnet", kind: "specialist" },
    { name: "Fern", seed: "fern", role: "Formulation lead", dept: "dept-7", model: "opus", kind: "specialist" },
  ],
  tasks: [
    "Week-12 stability readout: calming serum",
    "RFQ: 30 ml airless pumps, three suppliers",
    "Certificates of analysis for batch 006",
    "Purchase order pack for batch 007",
    "Preservative efficacy test: body lotion",
    "Carton proof: net contents and lot code",
    "Freight quotes: New Jersey to the warehouse",
    "Landed cost at 3,000 and 5,000 units",
  ],
  plans: [
    ["Pull the week-12 readings from Cranbury's report", "Compare pH, viscosity, color and odor with the spec", "Check the 40°C and freeze-thaw samples", "Flag any drift with its values", "Write the readout", "Attach it to the batch 007 pack"],
    ["Send the RFQ to three pump suppliers", "Log each quote with its minimum order and lead time", "Request samples from the two closest", "Compare landed cost per unit", "Write the recommendation"],
    ["Read batch 006's certificates of analysis", "Check every result against the release spec", "Match lot numbers to the batch record", "Flag anything out of spec", "File the release note"],
    ["Collect the current quotes", "Write the order lines with quote numbers", "Work out landed cost at 3,000 and 5,000 units", "Attach the stability readout", "Check the deposit against Cranbury's terms", "Send the pack to you for approval"],
  ],
  stdout: [
    "$ uv sync --frozen",
    "Resolved 42 packages in 9ms",
    "Installed 42 packages in 188ms",
    "$ uv run pytest tests/test_landed_cost.py -q",
    "...... [100%]",
    "6 passed in 0.38s",
    "$ uv run lab stability calming-serum --week 12",
    "pH 5.3 (spec 5.0–5.8) · viscosity −3% · 40°C ✓ · freeze-thaw ✓",
    "$ uv run lab check po-pack batch-007",
    "  ✓  every line cites a quote (9 of 9)",
    "  ✓  landed cost at 3,000 and 5,000 units",
    "  ✘  stability readout for every product (serum missing)",
    "  2 passed, 1 failed",
    "$ git add -A && git commit -m \"batch-007: serum week 12\"",
    "[agent/task-4 5e81c0a] batch-007: serum week 12",
    " 3 files changed, 64 insertions(+), 2 deletions(-)",
    "$ uv run ruff check lab",
    "All checks passed!",
    "$ uv run lab check po-pack batch-007",
    "  3 passed (9 lines, deposit $21,000)",
    "$ uv run lab pack export batch-007 --to drive",
    "Saved: Drive › Lab › Batch 007 › PO pack, for your approval",
  ],
  readPath: "lab/batches/batch-006/batch-record.md",
  file: { path: "lab/batches/batch-007/po-pack.md", diff: PO_PACK_DIFF, additions: 16, deletions: 0 },
  styleFile: { path: "lab/batches/batch-007/landed-cost.md", diff: LANDED_COST_DIFF },
  notes: [
    "Reading Cranbury's quotes and the last batch record before writing a line.",
    "Every order line carries its quote number, so each cost can be traced.",
    "The serum's 40°C samples read in spec at week 12.",
    "The pack is missing the serum's week-12 readout; pulling it from the lab report.",
    "Review: Cranbury's serum quote had expired; Reed had it reissued at the same price.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 6,
  acceptanceCommand: "uv run lab check po-pack",
  failingCheck: "stability readout for every product",
  failure: "Error: quote CCL-4471 expired on Oct 2; ask Cranbury to reissue it",
  nudge: { text: "Show the 3,000-unit price too", reply: "Adding the 3,000-unit tier beside each line." },
  gate: {
    connectorKey: "gmail",
    tool: "send_email",
    argsSummary: "Purchase order for batch 007 to Cranbury Contract Labs",
    note: "Waiting for your decision: the batch 007 order and its $21,000 deposit.",
  },
  currency: CURRENCY,
};

// ---------------------------------------------------------------------------------------------------------------------
// Distribution: how channels fit Northwind (the founder's Retail Partnerships department runs all fifteen)
// ---------------------------------------------------------------------------------------------------------------------

/** Creators and paid social find customers, email brings them back for refills, and buyer outreach finds the stores. */
const CHANNELS: ExampleBusiness["channels"] = {
  seed: "northwind",
  fits: { influencer: 17, paid_ads: 16, email_automation: 15, lead_generation: 14, social: 13, content: 12, seo: 11, affiliate: 10, events: 9, pr: 8, direct_mail: 7, print: 5, geo: 5, outdoor: 3, broadcast: 2 },
  recommended: ["influencer", "paid_ads", "email_automation", "lead_generation"],
  why: "{channel} fits a fragrance-free routine that people choose after reading the label, and that store buyers stock once shoppers ask for it. The first signal comes within a cycle and the cost per customer stays inside the runway budget.",
};

// ---------------------------------------------------------------------------------------------------------------------
// The journey: two years on the Ribbon, one Customer Update and the milestones
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Two years of Northwind, relabelled from the design system's fixture. Pin dates are the fixture's (Oct 8, 2024 to
 * Sep 18, 2026); the milestone cards below use the same dates, and the revenue scale makes the $10K and $50K months true
 * on the Ribbon: the 30 days to Mar 20, 2025 pass $10,000 and the 30 days to Sep 18, 2026 pass $50,000. First payments
 * keep the fixture's order sizes: a shopper's first order is $29 to $149, and the large ones are stores' opening orders
 * (`largeOrderNames`), the first of them Oak Hill Pharmacy's, the first retail partner. Pin labels stay within the
 * Ribbon's 28 characters and chapter titles within 17, so neither is cut off on the Ribbon or its day card.
 */
const JOURNEY: ExampleJourney = {
  /** The Ribbon's departments (ids match the fixture's generator; names and colours are Northwind's). */
  ribbonDepartments: [
    { id: "d-product", name: "Product", dept: "dept-1" },
    { id: "d-development", name: "Formulation Lab", dept: "dept-7" },
    { id: "d-distribution", name: "Retail Partnerships", dept: "dept-3" },
    { id: "d-finance", name: "Finance", dept: "dept-6" },
    { id: "d-team", name: "Development", dept: "dept-2" },
    { id: "d-operations", name: "Legal", dept: "dept-5" },
  ],
  milestoneLabels: {
    "Launch day": "First batch",
    "Northwind Skincare AB incorporated": "Incorporated in Delaware",
    "First customer": "First reorder",
    "First enterprise contract": "First retail partner",
    "10th customer": "Serum sold out",
    "Retinol serum v1": "Refill subscriptions",
    "$1K MRR": "$10K month",
    "Chose DTC over wholesale": "Stayed fragrance-free",
    "Bundle builder": "Batch results pages",
    "100th customer": "1,000th customer",
    "Pre-seed closed": "Angel round closed",
    "Subscription plans": "Routine quiz",
    "Moved production to Meridian Labs": "Moved to 5,000-unit batches",
    "Retail pack": "Retail-ready cartons",
    "$10K MRR": "$50K month",
  },
  chapterTitles: ["First batch", "Refills begin", "Fragrance-free", "Results in public", "The angel round", "Cash in stock", "Bigger batches", "Ready for retail", "Into the chains"],
  // Shoppers sign up and place first orders; stores place the large opening orders.
  customerNames: ["Priya Raman", "Marcus Bell", "Elena Ortiz", "Sam Okoye", "Grace Whitfield", "Tom Alvarez", "Nadia Brooks", "Jenna Park", "Luis Moreno", "Hannah Cole"],
  // Names read whole on the Ribbon's day card beside an order's value (17 characters at most).
  largeOrderNames: ["Oak Hill Pharmacy", "Bayside Naturals", "Juniper Pharmacy", "Greenleaf Co-op", "Harbor Pharmacy", "Cedar Row Market", "Maple Apothecary", "Willow Naturals", "Brookside Grocers", "Old Mill Pharmacy", "Sandpiper Health", "Ridgeway Market"],
  roadmap: ["In 36 Larkfield stores", "Batch 007 lands", "Body lotion launch"],
  revenueScale: { start: 1.11, end: 7.02, keepOrderSizes: true },
};

const LARKFIELD_ID = "18ab2feb-5195-460b-a91f-7a90914065ea";

/** The Customer Update the deck's gold card opens: how a 36-store natural grocery chain placed its first order. */
const CUSTOMER_UPDATE: ExampleCustomerUpdate = {
  level: "Featured update",
  customer: {
    name: "Larkfield Market",
    entityId: LARKFIELD_ID,
    facts: [
      // The mention's card shows three facts side by side in about 75 px each: values short enough to read whole.
      { label: "Stores", value: "36" },
      { label: "Terms", value: "Net 30" },
      { label: "First seen", value: "Aug 27" },
    ],
  },
  plan: "Opening order · 3 products in 36 stores",
  stats: { touches: 9, channels: 3, days: 41, acquisitionCostMinor: 64_000 },
  commentary: [
    { text: "Larkfield Market's body care buyer sees a creator from Poppy's seeding round use the routine, then reads the serum's batch results page.", highlight: true },
    { text: "Hollis sends a sample kit, the line sheet and a shelf card the next morning." },
    { text: "Fern answers the buyer's questions with twelve weeks of stability data and a patch test on 52 people with sensitive skin. Arden checks every claim on the shelf card.", highlight: true },
    { text: "The buyer asks for a free fill in every store. Hollis offers a four-week launch promo instead and gets Net 30 rather than Net 60." },
    { text: "You accept the terms, and the buyer places a $16,632 opening order for all 36 stores. [[ent:18ab2feb-5195-460b-a91f-7a90914065ea|Larkfield Market]] is Northwind's first regional chain.", highlight: true },
  ],
  agents: [
    { name: "Hollis", seed: "hollis", dept: "dept-3", role: "Buyer negotiation", rating: 10, standout: true },
    { name: "Fern", seed: "fern", dept: "dept-7", role: "Stability data", rating: 8, standout: false },
    { name: "Poppy", seed: "poppy", dept: "dept-3", role: "Creator seeding", rating: 7, standout: false },
  ],
};

/** The milestones, on the same dates as their Ribbon pins (time-zone-safe: local noon). */
const MILESTONES: ExampleBusiness["milestones"] = [
  { key: "first_batch", label: "First batch", description: "500 of each product from Cranbury Contract Labs.", achievedAt: "2024-10-08T12:00:00", shareable: true },
  { key: "first_reorder", label: "First reorder", description: "A customer comes back for a second serum.", achievedAt: "2024-11-08T12:00:00", shareable: true },
  { key: "first_retail_partner", label: "First retail partner", description: "Oak Hill Pharmacy stocks the routine in its five New Jersey stores.", achievedAt: "2024-12-26T12:00:00", customerName: "Oak Hill Pharmacy", ...usd(378_260), shareable: true },
  { key: "month_10k", label: "$10K month", description: "Thirty days of sales pass $10,000.", achievedAt: "2025-03-20T12:00:00", shareable: true },
  { key: "customer_1000", label: "1,000th customer", description: "One thousand people have bought the routine.", achievedAt: "2025-09-25T12:00:00", shareable: true },
  { key: "month_50k", label: "$50K month", description: "Thirty days of sales pass $50,000.", achievedAt: "2026-09-18T12:00:00", shareable: true },
];

/** The Inbox note in "You decide": the batch 007 purchase order. */
const INBOX_NOTE: ExampleInboxNote = {
  from: { name: "Fern", seed: "fern", dept: "dept-7", role: "Formulation lead" },
  department: "Formulation Lab",
  subject: "Place the purchase order for batch 007?",
  /** When the note arrived: today on the example business. */
  sentOn: "Wed, Oct 7",
  paragraphs: [
    "Larkfield's opening order ships from stock this month and leaves the serum with about nine weeks of cover, into early December. The batch 007 pack is ready: 5,000 of each product from Cranbury Contract Labs in New Jersey, with components from Maumee Valley Packaging in Ohio. Every line cites a quote; the serum's week-12 stability readout is attached.",
    "Cranbury wants a 50% deposit of $21,000 with the order and $21,000 more when the batch passes release testing; Maumee invoices $14,350 on delivery. Placing an order is yours alone. The runway goes from 13 to 12 months (Estimate).",
  ],
  costMinor: 2_100_000,
  costLabel: "Deposit",
  metric: { label: "Landed cost per routine", value: "$11.78", estimate: true },
  runwayAfter: "12 months",
  options: [
    { id: "order", label: "Order 5,000 of each", recommended: true, consequence: "Fern sends the order; you pay the deposit. Stock lands around Dec 4, with cover through March.", costMinor: 2_100_000, reversible: false },
    { id: "smaller", label: "Order 3,000 of each", consequence: "The deposit drops to $13,950, but each routine costs $1.32 more to land (Estimate).", costMinor: 1_395_000, reversible: false },
    { id: "wait", label: "Wait for store data", consequence: "No deposit now. The serum may run out for about two weeks in December (Estimate).", costMinor: null, reversible: true },
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// The team: six department leads with their ratings
// ---------------------------------------------------------------------------------------------------------------------

const LEADS: readonly ExampleLead[] = [
  {
    department: "product",
    name: "Sage",
    seed: "sage",
    role: "Product lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4.5 },
    remit: "A vision, a living specification and a roadmap built from what people with reactive skin report, batch by batch.",
    now: "Writing the body lotion spec from 46 subscriber reviews",
    training: "Version 3 promoted: review and reaction synthesis",
    skills: [skill("research", "Research synthesis", "craft", 16, 2, 18), skill("spec", "Specification writing", "craft", 15, 1, 17), skill("prioritize", "Prioritization", "judgement", 16, 1, 18), skill("no", "Saying no", "judgement", 15, 2, 17), skill("pace", "Pace", "execution", 14, 0, 16), skill("reliability", "Reliability", "execution", 15, 1, 17)],
    traits: [
      { id: "verbatim", label: "Quotes customers word for word", tone: "good" },
      { id: "batches", label: "Ties every report to a batch number", tone: "good" },
      { id: "evidence", label: "Asks for evidence" },
    ],
  },
  {
    department: "formulation-lab",
    name: "Fern",
    seed: "fern",
    role: "Formulation lead",
    model: "Opus",
    stars: { current: 3.5, potential: 4.5 },
    remit: "Formulas, stability tests, the contract manufacturer and packaging. Specialists prepare every quote and purchase order; you place it.",
    now: "Attaching the serum's week-12 readout to the batch 007 order",
    training: "Version 4 promoted: stability readouts against spec",
    skills: [skill("formulas", "Formulation review", "craft", 16, 2, 18), skill("stability", "Stability testing", "craft", 17, 1, 18), skill("suppliers", "Supplier selection", "judgement", 15, 2, 18), skill("stock", "Stock planning", "judgement", 14, 2, 17), skill("lead_times", "Lead-time tracking", "execution", 15, 1, 17), skill("records", "Batch records", "execution", 17, 0, 18)],
    traits: [
      { id: "quotes", label: "Cites a quote for every cost", tone: "good" },
      { id: "never_orders", label: "Prepares orders, never places them", tone: "good" },
      { id: "cautious", label: "Slow to commit without week-12 data", tone: "warn" },
    ],
  },
  {
    department: "development",
    name: "Linden",
    seed: "linden",
    role: "Lead developer",
    model: "Sonnet",
    stars: { current: 3, potential: 4 },
    remit: "The Shopify store and what runs on it: refill subscriptions, batch results pages and order webhooks, merged only when the tests pass.",
    now: "Adding skip-a-refill to the subscription page",
    training: "Version 3 promoted: testing against a test store",
    skills: [skill("storefront", "Storefront code", "craft", 15, 1, 17), skill("testing", "Testing", "craft", 15, 2, 17), skill("planning", "Planning", "judgement", 13, 1, 16), skill("scope", "Scope control", "judgement", 14, 2, 16), skill("reliability", "Reliability", "execution", 15, 1, 17), skill("cost", "Cost efficiency", "execution", 14, 0, 16)],
    traits: [
      { id: "small_prs", label: "Small pull requests", tone: "good" },
      { id: "test_store", label: "Tries every change on a test store first", tone: "good" },
      { id: "theme", label: "Slower on theme-wide changes", tone: "warn" },
    ],
  },
  {
    department: "retail-partnerships",
    name: "Hollis",
    seed: "hollis",
    role: "Distribution Strategist",
    model: "Sonnet",
    stars: { current: 3.5, potential: 4.5 },
    remit: "Fifteen channels scored for fit, and the store buyers. Creators, paid social and refill reminders run inside your caps; every wholesale term comes to you.",
    now: "Answering Larkfield Market's buyer on opening terms",
    training: "Version 3 promoted: wholesale terms and trade spend",
    skills: [skill("fit", "Channel fit", "craft", 16, 1, 18), skill("copy", "Copywriting", "craft", 14, 1, 16), skill("negotiation", "Buyer negotiation", "judgement", 16, 3, 18), skill("budget", "Budget discipline", "judgement", 16, 0, 17), skill("attribution", "Attribution", "execution", 13, 1, 16), skill("follow_up", "Buyer follow-up", "execution", 16, 2, 18)],
    traits: [
      { id: "terms", label: "Trades discounts for better terms", tone: "good" },
      { id: "caps", label: "Never exceeds a spend cap", tone: "good" },
      { id: "fragrance_free", label: "Picks stores that sell fragrance-free" },
    ],
  },
  {
    department: "finance",
    name: "Cove",
    seed: "cove",
    role: "Finance lead",
    model: "Opus",
    stars: { current: 4, potential: 4.5 },
    remit: "Cash, stock on hand, landed cost per unit and runway, with a reconciled ledger. Anything that is not a real figure is labeled Forecast or Estimate.",
    now: "Reconciling this week's Shopify payouts, 214 of 214 matched",
    training: "Version 5 promoted: cash tied up in stock",
    skills: [skill("reconcile", "Reconciliation", "craft", 18, 1, 19), skill("forecast", "Forecasting", "craft", 15, 2, 17), skill("cash", "Cash discipline", "judgement", 17, 0, 18), skill("unit", "Unit economics", "judgement", 16, 1, 18), skill("inventory", "Inventory costing", "execution", 15, 2, 17), skill("audit", "Audit trail", "execution", 17, 0, 19)],
    traits: [
      { id: "labels", label: "Labels every estimate", tone: "good" },
      { id: "stock_cash", label: "Counts stock as cash", tone: "good" },
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
    remit: "MoCRA listings, labels, claims and wholesale terms, prepared in full against the rules on the day. You review, sign and submit.",
    now: "Preparing the body lotion's FDA product listing",
    training: "Version 3 promoted: claims substantiation checklist",
    skills: [skill("drafting", "Contract drafting", "craft", 15, 1, 17), skill("regulatory", "Regulatory research", "craft", 16, 2, 18), skill("risk", "Risk spotting", "judgement", 17, 1, 18), skill("ask", "Knowing when to ask", "judgement", 18, 0, 19), skill("plain", "Plain English", "execution", 15, 2, 17), skill("filing", "Filing preparation", "execution", 15, 1, 17)],
    traits: [
      { id: "claims", label: "Asks for the test behind every claim", tone: "good" },
      { id: "prepares", label: "Prepares, never signs or submits", tone: "good" },
      { id: "dates", label: "Cites the date it checked" },
    ],
  },
];

export const NORTHWIND: ExampleBusiness = {
  identity: IDENTITY,
  currency: CURRENCY,
  locale: "en-US",
  // The Chief of Staff also leads the team (hiring and training), as in the product.
  chief: { name: "Maren", seed: "maren", dept: "dept-1" },
  departments: DEPARTMENTS,
  leads: LEADS,
  deck: {
    // Where the business is when the page opens: two years in (the Journey), in its ninth chapter.
    startCycle: 191,
    chapter: "Chapter 9",
    runwayMonths: 13,
    costPerTaskMinor: 52,
    earlierDecision: { title: "You approved creator kits", detail: "Retail Partnerships shipped 30 kits with tracked codes.", from: { name: "Poppy", seed: "poppy", dept: "dept-3" } },
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
