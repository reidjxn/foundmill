/**
 * Archetype seeds (BUILD §11.1 "Take charge → seed departments/agents from archetype → first businessCycle"; §6.1
 * departments map 1:1 to modules; §11.5 default spec outline by archetype; §11.7 recommended starter channels).
 *
 * The first days are about the product (founder, 2026-10-18): the first cycle starts groundwork only (the open
 * questions of the drafted specification, finance, legal, specialists); the Planner's first build (`firstBuild`) waits
 * for the founder's sign-off of the specification and the roadmap; the channel-scoring task (`CHANNEL_SCORING_TASK`)
 * and the Board's question (`boardDecision`) arrive when the founder starts distribution.
 *
 * Everything here is data validated against `ArchetypeSeed` at module load. Department names are display defaults the
 * founder can rename (AC-11.13.1); code routes by `slug`, `moduleKeys` and template keys, never by name.
 */
import { LIMITS } from "@foundmill/config";
import { ARCHETYPES, type Archetype, ARCHETYPE_LABELS, type ChannelKey, type DeptColourToken, MODULE_TABS, type ModuleKey, type OptionAction, type TaskKind } from "@foundmill/shared";
import { ArchetypeSeed, type BoardDecision, type DepartmentSeed, type FirstBuild, type FirstCycleTask } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Department defaults (1:1 with modules; icon = Lucide name; colour = Dugout department token)
// ---------------------------------------------------------------------------------------------------------------------

interface DepartmentDefault {
  slug: string;
  name: string;
  icon: string;
  colourToken: DeptColourToken;
  moduleKeys: ModuleKey[];
  /** A subset of the modules' tabs, in order (see `DepartmentSeed.tabSlugs`); absent: every tab. */
  tabSlugs?: string[];
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

/**
 * Physical-product archetypes get an Operations department (specialists lead) over the development module's Specialists
 * and Plan tabs only: Live sessions, Pull requests, Code and Environments are Development's (DB-11).
 */
const OPERATIONS_DEPARTMENT: DepartmentDefault = {
  slug: "operations",
  name: "Operations",
  icon: "factory",
  colourToken: "dept-7",
  moduleKeys: ["development"],
  tabSlugs: ["specialists", "plan"],
  leadTemplateKey: "operations_lead",
};

/**
 * The module tabs a department shows, in order: every tab of each of its modules, or the department's own subset
 * (`tabSlugs`, a slug no module of the department has is skipped). Seeds and Commit build screens from this.
 */
export function departmentTabs(dept: Pick<DepartmentSeed, "moduleKeys" | "tabSlugs">): { moduleKey: ModuleKey; slug: string; title: string }[] {
  const all = dept.moduleKeys.flatMap((moduleKey) => (MODULE_TABS[moduleKey] ?? []).map((tab) => ({ moduleKey, slug: tab.slug, title: tab.title })));
  if (!dept.tabSlugs) return all;
  return dept.tabSlugs.flatMap((slug) => all.filter((t) => t.slug === slug).slice(0, 1));
}

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
    ...(s.base.tabSlugs ? { tabSlugs: s.base.tabSlugs } : {}),
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

/**
 * The first cycle's product groundwork (founder, 2026-10-18): the specification itself is drafted on the first open
 * (services/foundations.ts), so the Product lead answers its open questions, through proposals, never by overwriting a
 * pinned block, and starts nothing on distribution.
 */
const OPEN_QUESTIONS_TASK = task({
  kind: "research",
  title: "Answer the specification's open questions",
  goal: "Take the open questions recorded with the drafted specification (Product › Vision) and answer each with cited evidence or mark it for the founder. Propose changes through proposals; never overwrite a pinned block.",
  acceptance: ["Every open question has an answer with a source id or is marked for the founder", "Changes reach the specification as proposals, not edits", "No distribution work is started"],
  assigneeTemplateKey: "product_lead",
  departmentSlug: "product",
});

/**
 * Created when the founder starts distribution (apps/api `startDistribution`), not at commit: scoring the channels is
 * the first distribution work, and distribution waits for a product to show.
 */
export const CHANNEL_SCORING_TASK = task({
  kind: "channel",
  title: "Score the 15 channels and pick 3 to 6 to start with",
  goal: "Score every channel 1-20 on fit for this business and propose the starting channels for the Channel Board with cost-per-customer ranges labeled Estimate.",
  acceptance: ["All 15 channels scored with a reason", "3 to 6 channels to start with, each with fit, potential, a cost-per-customer range and a three-sentence why", "Budget split proposed within the monthly distribution budget"],
  assigneeTemplateKey: "distribution_strategist",
  departmentSlug: "distribution",
});

const FINANCE_TASK = task({
  kind: "finance",
  title: "Set up the first runway forecast",
  goal: "Build the first cash forecast from the founder's budget and the typical costs for this kind of business, labeled Forecast; runway is how many months that cash lasts at today's spending.",
  acceptance: ["Base, upside and downside scenarios", "Every driver labeled Forecast or Estimate", "Runway warning thresholds configured"],
  assigneeTemplateKey: "finance_lead",
  departmentSlug: "finance",
});

const LEGAL_TASK = (goal: string, acceptance: string[]): FirstCycleTask =>
  task({ kind: "legal", title: "Where to incorporate, and the rules that apply", goal, acceptance, assigneeTemplateKey: "legal_lead", departmentSlug: "legal" });

/**
 * The tasks commit seeds for this founder (WP-04 T3; founder, 2026-11-16 D1): without a budget there is no money to
 * forecast and nothing to incorporate yet, so the finance and legal tasks are left out; with one, the seed's own list.
 */
export function firstCycleTasksFor(seed: Pick<ArchetypeSeed, "firstCycleTasks">, founder: { hasBudget: boolean }): FirstCycleTask[] {
  if (founder.hasBudget) return seed.firstCycleTasks;
  return seed.firstCycleTasks.filter((t) => t.kind !== "finance" && t.kind !== "legal");
}

/** The Planner's fallback goal once the founder has signed off and Now is empty (`ArchetypeSeed.firstBuild`). */
const FIRST_BUILD = (title: string, goal: string, acceptance: string[]): FirstBuild => ({ title, goal, acceptance });

const SPECIALIST_TASK = (title: string, goal: string, acceptance: string[], assignee: string): FirstCycleTask =>
  task({ kind: "specialist", title, goal, acceptance, assigneeTemplateKey: assignee, departmentSlug: "operations" });

function board(archetype: Archetype, subject: string, body: string[], options: BoardDecision["options"]): BoardDecision {
  return {
    subject,
    bodyMd: [`Welcome to your new ${ARCHETYPE_LABELS[archetype]} business.`, "", ...body].join("\n"),
    options,
  };
}

const THRESHOLD = LIMITS.approvalThresholdMinorDefault;

// What each Board option runs (audit IAE-20, AC-01, FR-10): typed actions, so a click never parses the option's prose.
// A channel's work goes to the agent running the channel; other work names its template. Budgets are monthly and capped,
// in minor units of the business's currency; an option's budgets and approved spends add up to its cost.
const enable = (channel: ChannelKey): OptionAction => ({ type: "enable_channel", params: { channel } });
const pause = (channel: ChannelKey): OptionAction => ({ type: "disable_channel", params: { channel } });
const budget = (channel: ChannelKey, amountMinor: number): OptionAction => ({ type: "set_budget", params: { channel, amount_minor: amountMinor, period: "monthly", cap: true } });
const approve = (amountMinor: number, what: string, assignee: string): OptionAction => ({ type: "approve_spend", params: { amount_minor: amountMinor, what }, assignee });
const channelWork = (channel: ChannelKey, title: string, goal: string): OptionAction => ({ type: "create_task", params: { kind: "channel", channel, title, goal } });
const work = (assignee: string, kind: TaskKind, title: string, goal: string): OptionAction => ({ type: "create_task", params: { kind, title, goal }, assignee });

// ---------------------------------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------------------------------

const b2bSaas = ArchetypeSeed.parse({
  archetype: "b2b_saas",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "data_engineer", "infra_engineer", "docs_writer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["lead_generation", "email_automation", "seo", "content", "pr"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["lead_generation", "email_automation", "seo", "content"],
  specOutline: BASE_OUTLINE,
  firstCycleTasks: [
    OPEN_QUESTIONS_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Recommend where to incorporate and list the first compliance obligations for a software business selling to businesses.", [
      "Three places to incorporate compared, with dated sources",
      "Data-protection obligations for the target markets listed",
      "Recommendation labeled as a screen, not legal advice",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan the first build: signup, first value, payment", "Build the task graph for a signup → first value → payment slice, with tests per task that show when it is done.", [
    "Task graph has goals, what counts as done, and file scopes",
    "No two tasks share a file scope concurrently",
    "Every task under four hours",
  ]),
  boardDecision: board(
    "b2b_saas",
    "Where should the first customer come from?",
    [
      "Distribution has started: the Distribution strategist is scoring the channels while the engineers build the first roadmap items.",
      "I need one decision from you before any budget is spent: which route to the first paying customer comes first for the next three months?",
    ],
    [
      {
        id: "outbound",
        label: "Reach the one kind of customer we target first",
        recommended: true,
        consequence: "Lead generation and email automation start first; the engineers build the demo path those emails point to.",
        because: "Recommended because it is the fastest way to find out whether anyone will pay, and you can pause it any time.",
        costMinor: THRESHOLD * 2,
        reversible: true,
        actions: [
          enable("lead_generation"),
          budget("lead_generation", THRESHOLD * 2),
          channelWork("lead_generation", "Build the first prospect list", "Source the first prospect list for the one kind of customer we target first (the ideal customer profile: one segment, one buyer role), with the reason each account fits."),
          enable("email_automation"),
          channelWork("email_automation", "Write the first outbound sequence", "Write the first outbound email sequence for that prospect list; every send is checked against the founder's limits and the suppression list."),
          work("planner", "code", "Build the demo path outbound needs", "Plan and build the shortest demo path the outbound sequence sends prospects to, with tests that prove it works."),
        ],
      },
      {
        id: "inbound",
        label: "Inbound first (SEO and content)",
        recommended: false,
        consequence: "Slower signal (8-12 weeks) but compounding; outbound waits until the content base exists.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          enable("seo"),
          channelWork("seo", "Keyword map for the first articles", "Map the keywords the first customers search for and pick the first articles to write, with the expected traffic labeled Estimate."),
          enable("content"),
          budget("content", THRESHOLD),
          channelWork("content", "Write the first articles from the keyword map", "Write and publish the first articles from the keyword map; outbound waits until the content base exists."),
        ],
      },
      {
        id: "design_partners",
        label: "Three design partners from the founder's network",
        recommended: false,
        consequence: "Fastest feedback, no channel spend; depends on the founder's time this month.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("chief_of_staff", "ops", "Shortlist three design partners", "Draft a shortlist of design-partner candidates from the founder's network and an outreach note for each; the founder sends the notes."),
          work("product_lead", "research", "Design-partner interview guide", "Write the interview guide and the feedback template the three design partners use, so their feedback lands in the specification."),
        ],
      },
    ],
  ),
});

const consumerApp = ArchetypeSeed.parse({
  archetype: "consumer_app",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "design_to_code", "data_engineer", "infra_engineer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["paid_ads", "social", "influencer", "seo", "email_automation"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["paid_ads", "social", "influencer", "seo"],
  specOutline: [...BASE_OUTLINE.slice(0, 4), "Onboarding and activation", "Retention loops", ...BASE_OUTLINE.slice(4)],
  firstCycleTasks: [
    OPEN_QUESTIONS_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List consumer-law, privacy and app-store obligations for the target markets and recommend where to incorporate.", [
      "Privacy policy and consent requirements per market",
      "App store policy items listed",
      "Recommendation on where to incorporate, with dated sources",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan onboarding to first habit", "Build the task graph for install → onboarding → first activation event with analytics events defined up front.", [
    "Activation event defined and instrumented",
    "Onboarding flow has tests that prove it works",
    "Store listing requirements captured as tasks",
  ]),
  boardDecision: board(
    "consumer_app",
    "Paid acquisition or organic first?",
    [
      "Distribution has started and the Channel Board is ready; the engineers are building onboarding.",
      "Consumer apps live or die on cost per activated user. I need you to decide how the first budget is spent.",
    ],
    [
      {
        id: "paid_test",
        label: "Small paid test with a cost-per-customer limit",
        recommended: true,
        consequence: "You get a read within two weeks; any campaign that costs more per customer than the limit pauses itself for 48 hours.",
        because: "Recommended because a small, capped test tells you what a customer costs before you spend more.",
        costMinor: THRESHOLD * 2,
        reversible: true,
        actions: [
          enable("paid_ads"),
          budget("paid_ads", THRESHOLD * 2),
          channelWork("paid_ads", "Small paid test with a cost-per-customer limit", "Run a small paid acquisition test with a hard limit on the cost to win a customer; pause any campaign over the limit for 48 hours and report the signal within two weeks."),
        ],
      },
      {
        id: "creator_seeding",
        label: "Seed 10 creators with codes",
        recommended: false,
        consequence: "Cheaper per install if the creators suit the product; disclosure checked before any payout.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          enable("influencer"),
          budget("influencer", THRESHOLD),
          channelWork("influencer", "Seed 10 creators with codes", "Shortlist 10 creators who fit and give each a tracked code; check every disclosure before a creator is paid. Payouts are the founder's to make."),
        ],
      },
      {
        id: "organic_only",
        label: "Organic only until retention is proven",
        recommended: false,
        consequence: "No spend, slow signal; the team focuses on retention loops first.",
        costMinor: 0,
        reversible: true,
        actions: [
          pause("paid_ads"),
          work("product_lead", "research", "Retention loops first", "Map the first retention loops and the events that prove retention; paid acquisition waits until retention is proven."),
          channelWork("social", "Organic posting schedule", "Plan an organic posting schedule that supports the retention loops, with no paid spend."),
        ],
      },
    ],
  ),
});

const marketplace = ArchetypeSeed.parse({
  archetype: "marketplace",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"] },
    { base: DEPARTMENT_DEFAULTS.development, members: [...CODING_CORE, "data_engineer", "infra_engineer"] },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["seo", "lead_generation", "content", "social", "affiliate", "email_automation"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["seo", "lead_generation", "content", "social"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Supply side", "Demand side", "Matching and trust", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    OPEN_QUESTIONS_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Map platform obligations: payments licensing, consumer law, VAT on commissions and terms for both sides.", [
      "Payments and licensing position stated with sources",
      "Terms for supply and demand sides listed",
      "VAT treatment of commissions noted per market",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan supply onboarding and the first transaction", "Build the task graph for listing creation, search and a first paid transaction through connected payouts.", [
    "Payout flow uses the payments connector; no money moves without a founder-approved go-live",
    "Listing and search have tests that prove they work",
    "Trust and dispute flow captured as later tasks",
  ]),
  boardDecision: board(
    "marketplace",
    "Which side do we seed first?",
    [
      "A marketplace needs both sides, but the first round of work can only chase one. I need you to decide which side to seed first and how.",
    ],
    [
      {
        id: "supply_first",
        label: "Recruit supply by hand, then open demand",
        recommended: true,
        consequence: "Lead generation sources 50 suppliers; demand channels start when 20 listings are live.",
        because: "Recommended because buyers leave an empty marketplace, so the listings have to come first.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          enable("lead_generation"),
          budget("lead_generation", THRESHOLD),
          channelWork("lead_generation", "Source 50 suppliers by hand", "Find and qualify 50 suppliers for the first category or city and record each as a CRM entity; demand channels start when 20 listings are live."),
        ],
      },
      {
        id: "demand_first",
        label: "Build demand with SEO and content first",
        recommended: false,
        consequence: "Slower, but suppliers come to a market with buyers; risk of empty results early.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          enable("seo"),
          channelWork("seo", "Keyword map for buyers", "Map what buyers search for in the first category or city, with the expected traffic labeled Estimate."),
          enable("content"),
          budget("content", THRESHOLD),
          channelWork("content", "Buyer guides from the keyword map", "Write the first buyer guides from the keyword map so suppliers arrive to a market that already has buyers."),
        ],
      },
      {
        id: "both",
        label: "Both sides at once in one city",
        recommended: false,
        consequence: "Faster liquidity in one geography; doubles the first budget.",
        costMinor: THRESHOLD * 2,
        reversible: true,
        actions: [
          enable("lead_generation"),
          budget("lead_generation", THRESHOLD),
          channelWork("lead_generation", "Source suppliers in one city", "Find and qualify the first suppliers in one city and record each as a CRM entity."),
          enable("content"),
          budget("content", THRESHOLD),
          channelWork("content", "Bring buyers in the same city", "Write the first buyer guides for the same city so both sides meet in one geography."),
        ],
      },
    ],
  ),
});

const dtcPhysical = ArchetypeSeed.parse({
  archetype: "dtc_physical",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"] },
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
    OPEN_QUESTIONS_TASK,
    SPECIALIST_TASK(
      "Supplier long list and RFQ pack",
      "Build a qualified long list of contract manufacturers and send an identical RFQ pack so quotes are comparable; every quote is read through the quarantined reader.",
      ["At least 10 suppliers recorded in Customers, each with the page it was found on", "RFQ pack complete and identical for every supplier", "No purchase order or deposit; the founder decides"],
      "sourcing_manufacturing",
    ),
    SPECIALIST_TASK(
      "Landed cost model v1",
      "Model per-unit landed cost from the first quotes and freight estimates at three volumes, labeled Estimate.",
      ["Every line cites a quote id or is marked Estimate", "Three volume tiers", "Margin per channel at the planned price"],
      "costing",
    ),
    FINANCE_TASK,
    LEGAL_TASK("List product compliance, labeling and consumer obligations for the target markets and recommend where to incorporate.", [
      "Product regulation named per market with dates",
      "Labeling requirements listed",
      "Recommendation on where to incorporate, with dated sources",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan the storefront and order flow", "Build the task graph for the storefront, checkout through the commerce connector, and order notifications from the store into the journey model.", [
    "Checkout uses the commerce connector in mock mode",
    "Order events reach the journey model with the channel that brought each customer",
    "No payment settings changed without a founder action",
  ]),
  boardDecision: board(
    "dtc_physical",
    "Sample before storefront, or both at once?",
    [
      "Operations is ready to send RFQs and Development can start the storefront. Cash is finite and samples take weeks.",
      "I need you to decide how to order the first three months.",
    ],
    [
      {
        id: "samples_first",
        label: "Samples and costing first, storefront in parallel at low priority",
        recommended: true,
        consequence: "The first money goes to samples; the storefront is ready when the formula is.",
        because: "Recommended because samples take weeks and a storefront takes days, so the slow part starts first.",
        costMinor: THRESHOLD * 4,
        reversible: true,
        actions: [
          approve(THRESHOLD * 4, "Samples and costing", "sourcing_manufacturing"),
          work("sourcing_manufacturing", "specialist", "Order the first samples", "Request samples from the shortlisted suppliers and compare them against the specification; no purchase order or deposit without the founder."),
          work("costing", "specialist", "Landed cost from the samples", "Update the landed cost model from the sample quotes, labeled Estimate."),
          work("planner", "code", "Storefront at low priority", "Plan the storefront in parallel at low priority so it is ready when the formula is."),
        ],
      },
      {
        id: "storefront_first",
        label: "Pre-orders on the storefront before samples",
        recommended: false,
        consequence: "Earlier demand signal, but promises are made before the product exists; claims must stay provisional.",
        costMinor: THRESHOLD,
        reversible: false,
        actions: [
          work("planner", "code", "Pre-order storefront", "Build the pre-order storefront; every product claim stays provisional until samples exist, and taking payments waits for the founder's go-live."),
          enable("paid_ads"),
          budget("paid_ads", THRESHOLD),
          channelWork("paid_ads", "Pre-order launch campaign", "Drive the first visitors to the pre-order page within the budget; claims stay provisional."),
        ],
      },
      {
        id: "both_full",
        label: "Both at full pace",
        recommended: false,
        consequence: "Fastest if cash allows; doubles the first month's spend.",
        costMinor: THRESHOLD * 6,
        reversible: true,
        actions: [
          approve(THRESHOLD * 4, "Samples and costing", "sourcing_manufacturing"),
          work("sourcing_manufacturing", "specialist", "Order the first samples", "Request samples from the shortlisted suppliers and compare them against the specification; no purchase order or deposit without the founder."),
          work("planner", "code", "Storefront at full pace", "Build the storefront at full pace alongside the samples; claims stay provisional until the formula is final."),
          enable("paid_ads"),
          budget("paid_ads", THRESHOLD * 2),
          channelWork("paid_ads", "Launch campaign for the storefront", "Drive the first visitors to the storefront within the budget."),
        ],
      },
    ],
  ),
});

const hardware = ArchetypeSeed.parse({
  archetype: "hardware",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"] },
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
    OPEN_QUESTIONS_TASK,
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
    FINANCE_TASK,
    LEGAL_TASK("List product safety, radio, battery and e-waste obligations for the target markets and recommend where to incorporate.", [
      "Obligations named per market with dates",
      "Importer and responsible-person duties noted",
      "Recommendation on where to incorporate, with dated sources",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan firmware, app and the pre-order site", "Build the task graph for the firmware build steps, the companion app's first screen and a pre-order page that records which channel brought each buyer.", [
    "Firmware builds and passes its tests automatically on every change",
    "Pre-order page tracks source codes",
    "No OTA or release signing without a founder action",
  ]),
  boardDecision: board(
    "hardware",
    "Pre-orders before certification?",
    [
      "Hardware carries the longest lead times of any business: certification, tooling and components. I need you to decide whether to take pre-orders before certification is in hand.",
    ],
    [
      {
        id: "waitlist",
        label: "Waitlist now, pre-orders after certification plan is costed",
        recommended: true,
        consequence: "No money taken before the risk is known; demand is measured through the waitlist.",
        because: "Recommended because taking money before the certification is costed could mean refunds you cannot afford.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          work("planner", "code", "Waitlist page with source codes", "Build the waitlist page with source codes so demand is measured; no money is taken."),
          work("certification", "specialist", "Cost the certification plan", "Cost the certification plan per target market, labeled Estimate, so pre-orders open once the risk is known."),
          enable("content"),
          budget("content", THRESHOLD),
          channelWork("content", "Waitlist launch story", "Publish the waitlist launch story and track sign-ups by source code."),
        ],
      },
      {
        id: "preorders_now",
        label: "Paid pre-orders now",
        recommended: false,
        consequence: "Cash earlier, but refunds and consumer-law exposure if certification slips.",
        costMinor: THRESHOLD,
        reversible: false,
        actions: [
          work("planner", "code", "Paid pre-order page", "Build the pre-order page with clear delivery terms; taking payments waits for the founder's go-live."),
          work("legal_lead", "legal", "Pre-order terms and refund policy", "Draft the pre-order terms and the refund policy for a certification slip, for the founder to review."),
          enable("paid_ads"),
          budget("paid_ads", THRESHOLD),
          channelWork("paid_ads", "Pre-order launch campaign", "Drive the first visitors to the pre-order page within the budget."),
        ],
      },
      {
        id: "pilot_batch",
        label: "Fund a 50-unit pilot batch first",
        recommended: false,
        consequence: "Real units for testers and press; the largest first commitment.",
        costMinor: THRESHOLD * 20,
        reversible: false,
        actions: [
          approve(THRESHOLD * 20, "A 50-unit pilot batch", "sourcing_manufacturing"),
          work("sourcing_manufacturing", "specialist", "Quote a 50-unit pilot batch", "Get comparable quotes for a 50-unit pilot batch with lead times; the founder places any order and pays any deposit."),
          channelWork("pr", "Arrange testers and press for the pilot units", "Shortlist testers and press for the pilot units and prepare the briefing they receive."),
        ],
      },
    ],
  ),
});

const services = ArchetypeSeed.parse({
  archetype: "services",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"], name: "Service design" },
    { base: DEPARTMENT_DEFAULTS.development, members: ["planner", "frontend_engineer", "backend_engineer", "qa_engineer", "review_agent", "integration_agent", "docs_writer"], budgetMinor: 30_000 },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["lead_generation", "events", "email_automation", "seo", "pr"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["lead_generation", "events", "email_automation", "seo"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Service delivery process", "Engagement model and SLAs", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    OPEN_QUESTIONS_TASK,
    FINANCE_TASK,
    LEGAL_TASK("Draft the standard engagement terms and list professional, tax and insurance obligations for the target market.", [
      "Engagement terms clauses listed with defaults",
      "Professional and insurance obligations noted with sources",
      "Recommendation on where to incorporate, with dated sources",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan the client portal and intake", "Build the task graph for intake form, client portal and the delivery checklist that agents and staff share.", [
    "Intake records why we may hold each client's data, and where it came from",
    "Portal keeps each business's data separate, with tests that prove it",
    "Delivery checklist drives task status",
  ]),
  boardDecision: board(
    "services",
    "Productized package or bespoke engagements first?",
    [
      "A services business scales through repeatable delivery. I need you to decide whether the first clients buy a fixed package or bespoke work.",
    ],
    [
      {
        id: "package",
        label: "One fixed-price package",
        recommended: true,
        consequence: "Simpler sales and delivery checklists; agents can run most of the process.",
        because: "Recommended because one package costs nothing to set up and the team can sell and deliver it without you.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("product_lead", "research", "Define the fixed-price package", "Write the package scope, price and the delivery checklist agents can run, labeled Estimate where costs are assumed."),
          work("planner", "code", "Delivery checklist in the client portal", "Plan the client portal so the package's delivery checklist drives task status."),
        ],
      },
      {
        id: "bespoke",
        label: "Bespoke engagements for the first five clients",
        recommended: false,
        consequence: "Higher revenue per client and better learning; founder time is the bottleneck.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("product_lead", "research", "How we run the first five client engagements", "Write the discovery questions and the engagement steps for the first five bespoke clients, noting where the founder's time is needed."),
          work("legal_lead", "legal", "Engagement terms for bespoke work", "Draft engagement terms for bespoke work, for the founder to review."),
        ],
      },
      {
        id: "retainer",
        label: "Monthly retainer from day one",
        recommended: false,
        consequence: "Predictable revenue; harder first sale without references.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("product_lead", "research", "Design the monthly retainer", "Define what a monthly retainer includes, the hours it covers and the first offer to make."),
          work("finance_lead", "finance", "Retainer pricing and cash forecast", "Price the retainer and add it to the cash forecast, labeled Forecast."),
        ],
      },
    ],
  ),
});

const contentMedia = ArchetypeSeed.parse({
  archetype: "content_media",
  assistantTemplateKey: "chief_of_staff",
  departments: departments([
    { base: DEPARTMENT_DEFAULTS.product, members: ["researcher", "product_researcher"], name: "Editorial" },
    { base: DEPARTMENT_DEFAULTS.development, members: ["planner", "frontend_engineer", "backend_engineer", "qa_engineer", "review_agent", "integration_agent"], budgetMinor: 30_000 },
    { base: DEPARTMENT_DEFAULTS.distribution, members: channelMembers(["content", "social", "email_automation", "seo", "geo", "affiliate"]) },
    { base: DEPARTMENT_DEFAULTS.finance, members: [] },
    { base: DEPARTMENT_DEFAULTS.team, members: [...UTILITY_TEMPLATE_KEYS] },
    { base: DEPARTMENT_DEFAULTS.legal, members: [] },
  ]),
  defaultChannels: ["content", "social", "email_automation", "seo", "geo"],
  specOutline: [...BASE_OUTLINE.slice(0, 3), "Editorial formats and cadence", "Audience and membership", "Sponsorship and monetization", ...BASE_OUTLINE.slice(3)],
  firstCycleTasks: [
    OPEN_QUESTIONS_TASK,
    FINANCE_TASK,
    LEGAL_TASK("List publishing, sponsorship disclosure, email marketing and copyright obligations for the target market and recommend where to incorporate.", [
      "Sponsorship disclosure rules cited",
      "Email marketing law per market listed",
      "Recommendation on where to incorporate, with dated sources",
    ]),
  ],
  firstBuild: FIRST_BUILD("Plan the publication site and membership", "Build the task graph for the site, newsletter signup with consent, paid membership through the billing connector and sponsorship tracking links.", [
    "Signup records consent and source",
    "Membership uses the billing connector in mock mode",
    "Sponsor links attributed",
  ]),
  boardDecision: board(
    "content_media",
    "Free first or paid from issue one?",
    [
      "Audience compounds; revenue needs an audience. I need you to decide whether the first three months build reach or charge from the start.",
    ],
    [
      {
        id: "free_then_paid",
        label: "Free for the first three months, paid tier at 1,000 subscribers",
        recommended: true,
        consequence: "Faster audience growth; sponsorship starts when reach justifies it.",
        because: "Recommended because a paywall on issue one keeps out the readers who would tell others about you.",
        costMinor: THRESHOLD,
        reversible: true,
        actions: [
          enable("content"),
          budget("content", THRESHOLD),
          channelWork("content", "Grow the free audience to 1,000 subscribers", "Publish free issues on a steady cadence for the first three months and grow the list toward 1,000 subscribers; sponsorship waits until reach justifies it."),
          enable("email_automation"),
          channelWork("email_automation", "Welcome sequence for free subscribers", "Write the welcome sequence every new free subscriber receives."),
          work("planner", "code", "Paid tier ready at 1,000 subscribers", "Build the paid membership tier behind a switch so it opens at 1,000 subscribers; taking payments waits for the founder's go-live."),
        ],
      },
      {
        id: "paid_now",
        label: "Paid membership from issue one",
        recommended: false,
        consequence: "Revenue immediately from a smaller base; slower growth.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("planner", "code", "Paid membership from issue one", "Build paid membership through the billing connector so issue one can be sold; taking payments waits for the founder's go-live."),
          enable("email_automation"),
          channelWork("email_automation", "Launch sequence for paid members", "Write the launch sequence that turns early readers into paid members."),
        ],
      },
      {
        id: "sponsor_first",
        label: "Sponsor-funded, always free",
        recommended: false,
        consequence: "Depends on landing sponsors early; every sponsor contract is a founder signature.",
        costMinor: 0,
        reversible: true,
        actions: [
          work("chief_of_staff", "ops", "Sponsor prospect list and media kit", "Build a list of sponsor prospects and a media kit with the audience figures labeled Estimate; every sponsor contract is the founder's to sign."),
          enable("content"),
          channelWork("content", "Audience proof for sponsors", "Publish the first issues on a steady cadence so sponsors can see the audience."),
        ],
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
