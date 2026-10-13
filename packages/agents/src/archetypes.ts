/**
 * Archetype seeds (BUILD §11.1 "Take charge → seed departments/agents from archetype → first businessCycle → first inbox
 * item from The Board"; §6.1 departments map 1:1 to modules; §11.5 default spec outline by archetype; §11.7 recommended
 * starter channels).
 *
 * Everything here is data validated against `ArchetypeSeed` at module load. Department names are display defaults the
 * founder can rename (AC-11.13.1); code routes by `slug`, `moduleKeys` and template keys, never by name.
 */
import { LIMITS } from "@foundmill/config";
import { ARCHETYPES, type Archetype, ARCHETYPE_LABELS, type ChannelKey, type DeptColourToken, type ModuleKey } from "@foundmill/shared";
import { ArchetypeSeed, type BoardDecision, type DepartmentSeed, type FirstCycleTask } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Department defaults (1:1 with modules; icon = Lucide name; colour = Dugout department token)
// ---------------------------------------------------------------------------------------------------------------------

interface DepartmentDefault {
  slug: string;
  name: string;
  icon: string;
  colourToken: DeptColourToken;
  moduleKeys: ModuleKey[];
  leadTemplateKey: string;
}

export const DEPARTMENT_DEFAULTS: Readonly<Record<ModuleKey, DepartmentDefault>> = Object.freeze({
  product: { slug: "product", name: "Product", icon: "lightbulb", colourToken: "dept-1", moduleKeys: ["product"], leadTemplateKey: "product_lead" },
  development: { slug: "development", name: "Development", icon: "code-2", colourToken: "dept-2", moduleKeys: ["development"], leadTemplateKey: "engineering_lead" },
  distribution: { slug: "distribution", name: "Distribution", icon: "megaphone", colourToken: "dept-3", moduleKeys: ["distribution"], leadTemplateKey: "distribution_strategist" },
  finance: { slug: "finance", name: "Finance", icon: "landmark", colourToken: "dept-4", moduleKeys: ["finance"], leadTemplateKey: "finance_lead" },
  team: { slug: "team", name: "Team", icon: "users", colourToken: "dept-5", moduleKeys: ["team"], leadTemplateKey: "chief_of_staff" },
  legal: { slug: "legal", name: "Legal", icon: "scale", colourToken: "dept-6", moduleKeys: ["legal"], leadTemplateKey: "legal_lead" },
});

/** Physical-product archetypes get an Operations department (specialists lead) over the development module's Specialists tab. */
const OPERATIONS_DEPARTMENT: DepartmentDefault = {
  slug: "operations",
  name: "Operations",
  icon: "factory",
  colourToken: "dept-7",
  moduleKeys: ["development"],
  leadTemplateKey: "operations_lead",
};

/** Utilities every business runs; they are hired into Team so the squad table shows them, but they belong to no department screen. */
export const UTILITY_TEMPLATE_KEYS: readonly string[] = Object.freeze(["entity_linker", "classifier", "categoriser", "triage", "moderation"]);

const CODING_CORE = ["planner", "backend_engineer", "frontend_engineer", "qa_engineer", "review_agent", "integration_agent"];

interface DeptSpec {
  base: DepartmentDefault;
  members: string[];
  /** Monthly department budget in minor units (EUR cents). Defaults per module below. */
  budgetMinor?: number;
  /** Optional display-name override for the archetype (still a default the founder can rename). */
  name?: string;
}

const DEFAULT_BUDGET_MINOR: Record<string, number> = {
  product: 20_000,
  development: 80_000,
  distribution: 150_000,
  finance: 10_000,
  team: 5_000,
  legal: 10_000,
  operations: 60_000,
};

function departments(specs: DeptSpec[]): DepartmentSeed[] {
  return specs.map((s, i) => ({
    slug: s.base.slug,
    name: s.name ?? s.base.name,
    icon: s.base.icon,
    colourToken: s.base.colourToken,
    position: i,
    moduleKeys: s.base.moduleKeys,
    leadTemplateKey: s.base.leadTemplateKey,
    memberTemplateKeys: s.members,
    budgetMinor: s.budgetMinor ?? DEFAULT_BUDGET_MINOR[s.base.slug] ?? 10_000,
  }));
}

const channelMembers = (channels: ChannelKey[]): string[] => channels.map((c) => `channel_${c}`);

// ---------------------------------------------------------------------------------------------------------------------
// Spec outlines (BUILD §11.5 default outline by archetype)
// ---------------------------------------------------------------------------------------------------------------------

const BASE_OUTLINE = ["Problem", "Customers", "Value proposition", "Features", "Non-functional requirements", "Data", "Integrations", "Pricing", "Metrics", "Risks"];
const PHYSICAL_OUTLINE = [...BASE_OUTLINE.slice(0, 4), "Formulation / BOM", "Manufacturing", "Packaging", "Compliance", "Fulfillment", ...BASE_OUTLINE.slice(4)];

// ---------------------------------------------------------------------------------------------------------------------
// First-cycle tasks and Board decisions
// ---------------------------------------------------------------------------------------------------------------------

const task = (t: FirstCycleTask): FirstCycleTask => t;

const SPEC_TASK = (assignee = "product_lead"): FirstCycleTask =>
  task({
    kind: "research",
    title: "Draft the specification from the concept card",
    goal: "Turn the committed concept card into the first specification version: one block per outline section with sources cited.",
    acceptance: ["Every outline section has a block", "Every factual claim cites a source or is marked unverified", "Open questions are listed as research tasks"],
    assigneeTemplateKey: assignee,
    departmentSlug: "product",
  });

const CHANNEL_TASK = task({
  kind: "channel",
  title: "Score the 15 channels and propose 3-6 starters",
  goal: "Score every channel 1-20 on fit for this business and propose the starting formation with cost-per-customer ranges labeled Estimate.",
  acceptance: ["All 15 channels scored with a reason", "3-6 starters with fit, potential, CPA range and a three-sentence why", "Budget split proposed within the monthly distribution budget"],
  assigneeTemplateKey: "distribution_strategist",
  departmentSlug: "distribution",
});

const FINANCE_TASK = task({
  kind: "finance",
  title: "Set up the first runway forecast",
  goal: "Build the first cash and runway forecast from the founder's budget and the archetype's cost priors, labeled Forecast.",
  acceptance: ["Base, upside and downside scenarios", "Every driver labeled Forecast or Estimate", "Runway warning thresholds configured"],
  assigneeTemplateKey: "finance_lead",
  departmentSlug: "finance",
});

const LEGAL_TASK = (goal: string, acceptance: string[]): FirstCycleTask =>
  task({ kind: "legal", title: "Jurisdiction and compliance scan", goal, acceptance, assigneeTemplateKey: "legal_lead", departmentSlug: "legal" });

const CODE_TASK = (title: string, goal: string, acceptance: string[]): FirstCycleTask =>
  task({ kind: "code", title, goal, acceptance, assigneeTemplateKey: "planner", departmentSlug: "development" });

const SPECIALIST_TASK = (title: string, goal: string, acceptance: string[], assignee: string): FirstCycleTask =>
  task({ kind: "specialist", title, goal, acceptance, assigneeTemplateKey: assignee, departmentSlug: "operations" });

function board(archetype: Archetype, subject: string, body: string[], options: BoardDecision["options"]): BoardDecision {
  return {
    subject,
    bodyMd: [`**The Board** welcomes the new ${ARCHETYPE_LABELS[archetype]} business.`, "", ...body].join("\n"),
    options,
  };
}

const THRESHOLD = LIMITS.approvalThresholdMinorDefault;

// ---------------------------------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------------------------------

const b2bSaas = ArchetypeSeed.parse({
  archetype: "b2b_saas",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "data_engineer", "infra_engineer", "docs_writer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["lead_generation", "email_automation", "seo", "content", "pr"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["lead_generation", "email_automation", "seo", "content"],
  specOutline: BASE_OUTLINE,
  firstCycleTasks: [
    SPEC_TASK(),
    CODE_TASK("Plan the first vertical slice", "Build the task graph for a signup → first value → payment slice with acceptance tests per task.", [
      "Task graph has goals, acceptance criteria and file scopes",
      "No two tasks share a file scope concurrently",
      "Every task under four hours",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Recommend an incorporation jurisdiction and list the first compliance obligations for a software business selling to businesses.", [
      "Three jurisdictions compared with dated sources",
      "Data-protection obligations for the target markets listed",
      "Recommendation labeled as a screen, not legal advice",
    ]),
  ],
  boardDecision: board(
    "b2b_saas",
    "Where should the first customer come from?",
    [
      "The team is hired and the first cycle has started. Development is planning the first vertical slice; Distribution has scored the channels.",
      "The Board asks for one decision before committing any budget: which route to the first paying customer should take priority this chapter?",
    ],
    [
      {
        id: "outbound",
        label: "Outbound to a narrow ICP",
        recommended: true,
        consequence: "Lead generation and email automation start first; Development builds the demo path they need.",
        costMinor: THRESHOLD * 2,
        reversible: true,
      },
      {
        id: "inbound",
        label: "Inbound first (SEO and content)",
        recommended: false,
        consequence: "Slower signal (8-12 weeks) but compounding; outbound waits until the content base exists.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "design_partners",
        label: "Three design partners from the founder's network",
        recommended: false,
        consequence: "Fastest feedback, no channel spend; depends on the founder's time this month.",
        costMinor: 0,
        reversible: true,
      },
    ],
  ),
});

const consumerApp = ArchetypeSeed.parse({
  archetype: "consumer_app",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "design_to_code", "data_engineer", "infra_engineer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["paid_ads", "social", "influencer", "seo", "email_automation"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["paid_ads", "social", "influencer", "seo"],
  specOutline: [...BASE_OUTLINE.slice(0, 4), "Onboarding and activation", "Retention loops", ...BASE_OUTLINE.slice(4)],
  firstCycleTasks: [
    SPEC_TASK(),
    CODE_TASK("Plan onboarding to first habit", "Build the task graph for install → onboarding → first activation event with analytics events defined up front.", [
      "Activation event defined and instrumented",
      "Onboarding flow has acceptance tests",
      "Store listing requirements captured as tasks",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List consumer-law, privacy and app-store obligations for the target markets and recommend a jurisdiction.", [
      "Privacy policy and consent requirements per market",
      "App store policy items listed",
      "Jurisdiction recommendation with dated sources",
    ]),
  ],
  boardDecision: board(
    "consumer_app",
    "Paid acquisition or organic first?",
    [
      "The team is in place. Distribution has a formation ready; Development is planning onboarding.",
      "Consumer apps live or die on cost per activated user. The Board asks how the first budget should be spent.",
    ],
    [
      {
        id: "paid_test",
        label: "Small paid test with a hard CPA cap",
        recommended: true,
        consequence: "Signal within two weeks; the engine pauses any campaign over cap for 48 hours.",
        costMinor: THRESHOLD * 2,
        reversible: true,
      },
      {
        id: "creator_seeding",
        label: "Seed 10 creators with codes",
        recommended: false,
        consequence: "Cheaper per install if creators fit; disclosure checked before any payout.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "organic_only",
        label: "Organic only until retention is proven",
        recommended: false,
        consequence: "No spend, slow signal; the team focuses on retention loops first.",
        costMinor: 0,
        reversible: true,
      },
    ],
  ),
});

const marketplace = ArchetypeSeed.parse({
  archetype: "marketplace",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "data_engineer", "infra_engineer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["seo", "lead_generation", "content", "social", "affiliate", "email_automation"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["seo", "lead_generation", "content", "social"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Supply side", "Demand side", "Matching and trust", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    SPEC_TASK(),
    CODE_TASK("Plan supply onboarding and the first transaction", "Build the task graph for listing creation, search and a first paid transaction through connected payouts.", [
      "Payout flow uses the payments connector; no money moves without a founder-approved go-live",
      "Listing and search have acceptance tests",
      "Trust and dispute flow captured as later tasks",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Map platform obligations: payments licensing, consumer law, VAT on commissions and terms for both sides.", [
      "Payments and licensing position stated with sources",
      "Terms for supply and demand sides listed",
      "VAT treatment of commissions noted per market",
    ]),
  ],
  boardDecision: board(
    "marketplace",
    "Which side do we seed first?",
    [
      "A marketplace needs both sides, but the first cycle can only chase one. The Board asks which side to seed first and how.",
    ],
    [
      {
        id: "supply_first",
        label: "Recruit supply by hand, then open demand",
        recommended: true,
        consequence: "Lead generation sources 50 suppliers; demand channels start when 20 listings are live.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "demand_first",
        label: "Build demand with SEO and content first",
        recommended: false,
        consequence: "Slower, but suppliers come to a market with buyers; risk of empty results early.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "both",
        label: "Both sides at once in one city",
        recommended: false,
        consequence: "Faster liquidity in one geography; doubles the first budget.",
        costMinor: THRESHOLD * 2,
        reversible: true,
      },
    ],
  ),
});

const dtcPhysical = ArchetypeSeed.parse({
  archetype: "dtc_physical",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: ["planner", "frontend_engineer", "backend_engineer", "qa_engineer", "review_agent", "integration_agent", "design_to_code"] },
    {
      base: OPERATIONS_DEPARTMENT,
      members: ["sourcing_manufacturing", "formulation_chemist", "pharmacology_regulatory", "certification", "packaging_design", "quality", "logistics", "costing"],
    },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["influencer", "paid_ads", "social", "email_automation", "content", "pr"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["influencer", "paid_ads", "social", "email_automation"],
  specOutline: PHYSICAL_OUTLINE,
  firstCycleTasks: [
    SPEC_TASK(),
    SPECIALIST_TASK(
      "Supplier long list and RFQ pack",
      "Build a qualified long list of contract manufacturers and send an identical RFQ pack so quotes are comparable; every quote is read through the quarantined reader.",
      ["At least 20 suppliers recorded as CRM entities", "RFQ pack complete and identical for every supplier", "No purchase order or deposit; the founder decides"],
      "sourcing_manufacturing",
    ),
    SPECIALIST_TASK(
      "Landed cost model v1",
      "Model per-unit landed cost from the first quotes and freight estimates at three volumes, labeled Estimate.",
      ["Every line cites a quote id or is marked Estimate", "Three volume tiers", "Margin per channel at the planned price"],
      "costing",
    ),
    CODE_TASK("Plan the storefront and order pipeline", "Build the task graph for the storefront, checkout through the commerce connector, and order webhooks into the journey model.", [
      "Checkout uses the commerce connector in mock mode",
      "Order events reach the journey model with attribution",
      "No payment settings changed without a founder action",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List product compliance, labeling and consumer obligations for the target markets and recommend a jurisdiction.", [
      "Product regulation named per market with dates",
      "Labeling requirements listed",
      "Jurisdiction recommendation with dated sources",
    ]),
  ],
  boardDecision: board(
    "dtc_physical",
    "Sample before storefront, or both at once?",
    [
      "Operations is ready to send RFQs and Development can start the storefront. Cash is finite and samples take weeks.",
      "The Board asks how to sequence the first chapter.",
    ],
    [
      {
        id: "samples_first",
        label: "Samples and costing first, storefront in parallel at low priority",
        recommended: true,
        consequence: "The first money goes to samples; the storefront is ready when the formula is.",
        costMinor: THRESHOLD * 4,
        reversible: true,
      },
      {
        id: "storefront_first",
        label: "Pre-orders on the storefront before samples",
        recommended: false,
        consequence: "Earlier demand signal, but promises are made before the product exists; claims must stay provisional.",
        costMinor: THRESHOLD,
        reversible: false,
      },
      {
        id: "both_full",
        label: "Both at full pace",
        recommended: false,
        consequence: "Fastest if cash allows; doubles the first month's spend.",
        costMinor: THRESHOLD * 6,
        reversible: true,
      },
    ],
  ),
});

const hardware = ArchetypeSeed.parse({
  archetype: "hardware",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "infra_engineer", "docs_writer"] },
    { base: OPERATIONS_DEPARTMENT, members: ["sourcing_manufacturing", "certification", "packaging_design", "quality", "logistics", "costing"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["content", "pr", "paid_ads", "events", "email_automation"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["content", "pr", "paid_ads", "events"],
  specOutline: [...PHYSICAL_OUTLINE.slice(0, 4), "Firmware and app", ...PHYSICAL_OUTLINE.slice(4)],
  firstCycleTasks: [
    SPEC_TASK(),
    SPECIALIST_TASK(
      "Certification map",
      "Identify the directives, standards and conformity routes for the target markets and the tests a lab must run, with lead times and costs labeled Estimate.",
      ["Every directive and standard cited with date", "Test plan with sample counts", "No lab booked; the founder approves bookings"],
      "certification",
    ),
    SPECIALIST_TASK(
      "Component sourcing and BOM cost",
      "Build the BOM with quote ids per component at three volumes and flag long-lead parts.",
      ["Every component has a quote id or is marked Estimate", "Long-lead parts flagged with lead time", "No purchase order placed"],
      "sourcing_manufacturing",
    ),
    CODE_TASK("Plan firmware, app and the pre-order site", "Build the task graph for the firmware build pipeline, the companion app's first screen and a pre-order page with attribution.", [
      "Firmware CI builds and tests in the sandbox",
      "Pre-order page tracks source codes",
      "No OTA or release signing without a founder action",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List product safety, radio, battery and e-waste obligations for the target markets and recommend a jurisdiction.", [
      "Obligations named per market with dates",
      "Importer and responsible-person duties noted",
      "Jurisdiction recommendation with dated sources",
    ]),
  ],
  boardDecision: board(
    "hardware",
    "Pre-orders before certification?",
    [
      "Hardware carries the longest lead times in the game: certification, tooling and components. The Board asks whether to take pre-orders before certification is in hand.",
    ],
    [
      {
        id: "waitlist",
        label: "Waitlist now, pre-orders after certification plan is costed",
        recommended: true,
        consequence: "No money taken before the risk is known; demand is measured through the waitlist.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "preorders_now",
        label: "Paid pre-orders now",
        recommended: false,
        consequence: "Cash earlier, but refunds and consumer-law exposure if certification slips.",
        costMinor: THRESHOLD,
        reversible: false,
      },
      {
        id: "pilot_batch",
        label: "Fund a 50-unit pilot batch first",
        recommended: false,
        consequence: "Real units for testers and press; the largest first commitment.",
        costMinor: THRESHOLD * 20,
        reversible: false,
      },
    ],
  ),
});

const services = ArchetypeSeed.parse({
  archetype: "services",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"], name: "Service design" },
    { base: DEPARTMENT_DEFAULTS.development, members: ["planner", "frontend_engineer", "backend_engineer", "qa_engineer", "review_agent", "integration_agent", "docs_writer"], budgetMinor: 30_000 },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["lead_generation", "events", "email_automation", "seo", "pr"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["lead_generation", "events", "email_automation", "seo"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Service delivery process", "Engagement model and SLAs", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    SPEC_TASK(),
    CODE_TASK("Plan the client portal and intake", "Build the task graph for intake form, client portal and the delivery checklist that agents and staff share.", [
      "Intake captures lawful basis and source",
      "Portal is business-scoped with RLS tests",
      "Delivery checklist drives task status",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Draft the engagement terms playbook and list professional, tax and insurance obligations for the target market.", [
      "Engagement terms clauses listed with defaults",
      "Professional and insurance obligations noted with sources",
      "Jurisdiction recommendation with dated sources",
    ]),
  ],
  boardDecision: board(
    "services",
    "Productized package or bespoke engagements first?",
    [
      "A services business scales through repeatable delivery. The Board asks whether the first clients buy a fixed package or bespoke work.",
    ],
    [
      {
        id: "package",
        label: "One fixed-price package",
        recommended: true,
        consequence: "Simpler sales and delivery checklists; agents can run most of the process.",
        costMinor: 0,
        reversible: true,
      },
      {
        id: "bespoke",
        label: "Bespoke engagements for the first five clients",
        recommended: false,
        consequence: "Higher revenue per client and better learning; founder time is the bottleneck.",
        costMinor: 0,
        reversible: true,
      },
      {
        id: "retainer",
        label: "Monthly retainer from day one",
        recommended: false,
        consequence: "Predictable revenue; harder first sale without references.",
        costMinor: 0,
        reversible: true,
      },
    ],
  ),
});

const contentMedia = ArchetypeSeed.parse({
  archetype: "content_media",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher"], name: "Editorial" },
    { base: DEPARTMENT_DEFAULTS.development, members: ["planner", "frontend_engineer", "backend_engineer", "qa_engineer", "review_agent", "integration_agent"], budgetMinor: 30_000 },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["content", "social", "email_automation", "seo", "geo", "affiliate"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["content", "social", "email_automation", "seo", "geo"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Editorial formats and cadence", "Audience and membership", "Sponsorship and monetization", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    SPEC_TASK(),
    CODE_TASK("Plan the publication site and membership", "Build the task graph for the site, newsletter signup with consent, paid membership through the billing connector and sponsorship tracking links.", [
      "Signup records consent and source",
      "Membership uses the billing connector in mock mode",
      "Sponsor links attributed",
    ]),
    CHANNEL_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List publishing, sponsorship disclosure, email marketing and copyright obligations for the target market and recommend a jurisdiction.", [
      "Sponsorship disclosure rules cited",
      "Email marketing law per market listed",
      "Jurisdiction recommendation with dated sources",
    ]),
  ],
  boardDecision: board(
    "content_media",
    "Free first or paid from issue one?",
    [
      "Audience compounds; revenue needs an audience. The Board asks whether the first chapter builds reach or charges from the start.",
    ],
    [
      {
        id: "free_then_paid",
        label: "Free for the first chapter, paid tier at 1,000 subscribers",
        recommended: true,
        consequence: "Faster audience growth; sponsorship starts when reach justifies it.",
        costMinor: THRESHOLD,
        reversible: true,
      },
      {
        id: "paid_now",
        label: "Paid membership from issue one",
        recommended: false,
        consequence: "Revenue immediately from a smaller base; slower growth.",
        costMinor: 0,
        reversible: true,
      },
      {
        id: "sponsor_first",
        label: "Sponsor-funded, always free",
        recommended: false,
        consequence: "Depends on landing sponsors early; every sponsor contract is a founder signature.",
        costMinor: 0,
        reversible: true,
      },
    ],
  ),
});

export const ARCHETYPE_SEEDS: Readonly<Record<Archetype, ArchetypeSeed>> = Object.freeze({
  b2b_saas: b2bSaas,
  consumer_app: consumerApp,
  marketplace,
  dtc_physical: dtcPhysical,
  hardware,
  services,
  content_media: contentMedia,
});

export const ARCHETYPE_SEED_LIST: readonly ArchetypeSeed[] = Object.freeze(ARCHETYPES.map((a) => ARCHETYPE_SEEDS[a]));

export function getArchetypeSeed(archetype: Archetype): ArchetypeSeed {
  return ARCHETYPE_SEEDS[archetype];
}

/** Every template key a seed hires (assistant, leads, members), de-duplicated, in hire order. */
export function templateKeysForArchetype(archetype: Archetype): string[] {
  const seed = ARCHETYPE_SEEDS[archetype];
  const out: string[] = [seed.assistantTemplateKey];
  for (const d of seed.departments) {
    for (const k of [d.leadTemplateKey, ...d.memberTemplateKeys]) if (!out.includes(k)) out.push(k);
  }
  return out;
}
