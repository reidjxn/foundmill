/**
 * Skill definitions (BUILD §11.10): Judgement and Execution for every agent, Craft per agent type.
 * `agentTypes` for craft skills is derived from the templates that carry the skill, so the catalogue and the templates
 * can never disagree (a test asserts every template skill exists here and every craft skill is used).
 */
import { usSpelling, type SkillGroup } from "@foundmill/shared";
import { SkillDefinition } from "../types";
import { ALL_TEMPLATES } from "../templates";

interface CatalogueEntry {
  name: string;
  description: string;
}

export const JUDGEMENT_SKILLS: Record<string, CatalogueEntry> = {
  planning: { name: "Planning", description: "Breaks a goal into ordered, checkable steps before acting; keeps the plan current as facts change." },
  scope_control: { name: "Scope control", description: "Delivers what the task asks and nothing else; surfaces scope creep instead of absorbing it." },
  prioritisation: { name: "Prioritization", description: "Chooses the work with the highest customer impact per unit of cost and time, and can say why." },
  risk_awareness: { name: "Risk awareness", description: "Spots hard gates, security, legal, data and reputational risks early and routes them correctly." },
  knowing_when_to_ask: { name: "Knowing when to ask", description: "Asks the lead or founder exactly when the task is ambiguous or outside authority, and not otherwise." },
};

export const EXECUTION_SKILLS: Record<string, CatalogueEntry> = {
  speed: { name: "Speed", description: "Finishes tasks quickly without skipping the steps that protect quality." },
  reliability: { name: "Reliability", description: "Produces the same quality every time; completes what it starts; leaves no half-done state." },
  tool_use: { name: "Tool use", description: "Picks the right tool, calls it with correct arguments, reads the result and recovers from errors." },
  cost_efficiency: { name: "Cost efficiency", description: "Uses the cheapest model, fewest calls and smallest context that still meet the acceptance criteria." },
  communication: { name: "Communication", description: "Reports facts first, then why they matter, then the ask; cites record ids; no filler." },
};

export const CRAFT_SKILLS: Record<string, CatalogueEntry> = {
  // Chief of Staff
  cycle_planning: { name: "Cycle planning", description: "Plans a business cycle within concurrency, budget and rate-limit capacity, preferring work that unblocks customers." },
  delegation: { name: "Delegation", description: "Assigns tasks to the right lead or agent with clear goals, acceptance criteria and time boxes." },
  plan_compilation: { name: "Plan compilation", description: "Turns founder free text into typed Plan actions, routing hard gates to request_human_action." },
  decision_framing: { name: "Decision framing", description: "Presents 2-4 options with one recommended, each with consequence, cost and reversibility." },
  // Product lead
  spec_writing: { name: "Spec writing", description: "Writes specification blocks with testable acceptance criteria and clear non-functional requirements." },
  roadmap_prioritisation: { name: "Roadmap prioritization", description: "Orders Now/Next/Later from customer evidence, dependencies and measured delivery pace." },
  evidence_synthesis: { name: "Evidence synthesis", description: "Combines interviews, issues and data into claims that cite their sources and state confidence." },
  change_management: { name: "Change management", description: "Produces minimal, versioned, three-way-merged change proposals with rationale, evidence and impact." },
  // Engineering lead
  architecture: { name: "Architecture", description: "Chooses boundaries, data flow and contracts that keep the system typed, tenant-safe and testable." },
  code_review: { name: "Code review", description: "Finds correctness, security, tenancy and test gaps in a diff with file and line, and proposes the smallest fix." },
  delivery_management: { name: "Delivery management", description: "Staffs, schedules and unblocks tasks so reviewed, tested work merges every cycle." },
  security_awareness: { name: "Security awareness", description: "Recognizes secrets exposure, injection, missing authorization and RLS gaps before they ship." },
  // Distribution strategist
  channel_fit_scoring: { name: "Channel fit scoring", description: "Scores channels 1-20 from archetype, price, customer, geography, budget, time to signal and founder strengths." },
  budget_allocation: { name: "Budget allocation", description: "Splits and reallocates budget on measured cost per customer within caps." },
  positioning: { name: "Positioning", description: "States who the product is for, the alternative it replaces and why it wins, in the customer's words." },
  experiment_design: { name: "Experiment design", description: "Designs tests with a hypothesis, metric, sample, duration and stop rule before spending." },
  // Finance lead
  financial_modelling: { name: "Financial modeling", description: "Builds driver-based models whose outputs reconcile to source records and are labeled by basis." },
  runway_forecasting: { name: "Runway forecasting", description: "Forecasts cash and runway in Base/Upside/Downside scenarios with drivers and threshold warnings." },
  anomaly_detection: { name: "Anomaly detection", description: "Flags duplicate, unexpected or out-of-pattern transactions with evidence and a suggested action." },
  investor_reporting: { name: "Investor reporting", description: "Drafts updates with real numbers, clear labels and the asks, without hype." },
  // Legal lead
  jurisdiction_analysis: { name: "Jurisdiction analysis", description: "Compares jurisdictions on cost, time, banking, investor familiarity and founder-specific tax notes with dated sources." },
  contract_review: { name: "Contract review", description: "Finds deviations from the playbook clause by clause and proposes the change with the reason." },
  compliance_tracking: { name: "Compliance tracking", description: "Keeps a complete calendar of filings and obligations with owners and dates." },
  ip_screening: { name: "IP screening", description: "Runs trademark and domain quick screens and reports them as screens, not legal clearance." },
  // Operations lead
  process_design: { name: "Process design", description: "Sequences specialist work into a critical path with gates, owners and dates." },
  vendor_coordination: { name: "Vendor coordination", description: "Keeps suppliers, labs and carriers aligned on spec, dates and documents through recorded interactions." },
  quality_oversight: { name: "Quality oversight", description: "Ensures QC criteria, inspections and corrective actions exist before production and shipping." },
  capacity_planning: { name: "Capacity planning", description: "Matches production, inventory and fulfillment capacity to the forecast with labeled estimates." },
  // Engineers
  api_design: { name: "API design", description: "Designs typed, versionable endpoints and procedures with validated input and explicit errors." },
  data_modelling: { name: "Data modeling", description: "Models tables and relations with tenancy, constraints and indexes that match access patterns." },
  testing: { name: "Testing", description: "Writes tests that assert behavior, cover edge cases and fail before the change." },
  debugging: { name: "Debugging", description: "Reproduces, isolates and fixes defects from evidence rather than guesses." },
  performance: { name: "Performance", description: "Measures before and after, finds the real bottleneck and fixes it within budget." },
  component_craft: { name: "Component craft", description: "Builds reusable, accessible components from the design system with clear props and states." },
  design_fidelity: { name: "Design fidelity", description: "Matches the design reference within tolerance using tokens and existing components." },
  accessibility: { name: "Accessibility", description: "Delivers keyboard, focus, contrast and screen-reader support on every interaction." },
  state_management: { name: "State management", description: "Keeps one source of truth per piece of state and predictable updates." },
  layout_precision: { name: "Layout precision", description: "Gets spacing, alignment and type scale right at 1440 px and 1280 px." },
  data_pipelines: { name: "Data pipelines", description: "Builds idempotent, replay-safe pipelines that handle duplicates and late events." },
  data_quality: { name: "Data quality", description: "Adds checks and fixtures that catch wrong, missing or duplicate data before it is shown." },
  sql_analytics: { name: "SQL analytics", description: "Writes correct, business-scoped, read-only analytical queries with documented definitions." },
  infrastructure_as_code: { name: "Infrastructure as code", description: "Declares environments, pipelines and alerts as reviewable, tested code." },
  ci_cd: { name: "CI/CD", description: "Keeps pipelines green, fast and complete: typecheck, lint, tests, RLS and preview deployments." },
  observability: { name: "Observability", description: "Adds structured logs, metrics and alerts that explain failures without leaking secrets." },
  secrets_hygiene: { name: "Secrets hygiene", description: "Keeps secrets out of code, logs, sandboxes and bundles; references names, never values." },
  test_design: { name: "Test design", description: "Maps acceptance criteria to tests, including negative and boundary cases." },
  exploratory_testing: { name: "Exploratory testing", description: "Finds unplanned failures in bounded sessions and reports them with steps and severity." },
  test_automation: { name: "Test automation", description: "Writes deterministic, independent automated tests with no sleeps and clear names." },
  technical_writing: { name: "Technical writing", description: "Explains behavior accurately in plain, short sentences with verified examples." },
  information_architecture: { name: "Information architecture", description: "Organizes documentation so each topic has one home and readers find it in two clicks." },
  example_quality: { name: "Example quality", description: "Provides runnable, minimal, correct examples with no secrets or internal URLs." },
  source_evaluation: { name: "Source evaluation", description: "Prefers primary sources, notes dates and bias, and marks secondary sources as such." },
  synthesis: { name: "Synthesis", description: "Turns many sources into a few well-supported findings with stated confidence." },
  citation_discipline: { name: "Citation discipline", description: "Attaches a real, fetched citation to every number and claim; quotes under 25 words." },
  market_sizing: { name: "Market sizing", description: "Estimates market size with a stated method and labels the result Estimate." },
  change_risk_assessment: { name: "Change risk assessment", description: "Judges the blast radius of a diff (schema, auth, payments, tenancy) and sets the verdict accordingly." },
  conflict_resolution: { name: "Conflict resolution", description: "Resolves trivial merge conflicts correctly and returns semantic ones to the author." },
  release_hygiene: { name: "Release hygiene", description: "Keeps main green, PRs complete and merges traceable to tasks, tests and reviews." },
  task_decomposition: { name: "Task decomposition", description: "Splits work into tasks under 4 hours with clear goals and file scopes." },
  acceptance_criteria: { name: "Acceptance criteria", description: "Writes criteria a test can check, one per behavior, with the test named." },
  dependency_mapping: { name: "Dependency mapping", description: "Finds ordering and shared-file-scope dependencies and keeps the graph acyclic." },
  estimation: { name: "Estimation", description: "Estimates from the business's history or archetype priors and labels the basis." },
  // Channels
  icp_definition: { name: "ICP definition", description: "Defines the ideal customer profile with firmographics, roles and trigger signals that can be sourced." },
  lead_sourcing: { name: "Lead sourcing", description: "Finds and enriches contacts matching the ICP with a lawful basis per country." },
  lead_scoring: { name: "Lead scoring", description: "Scores leads 1-20 with explicit reasons that predict reply and conversion." },
  marketing_compliance: { name: "Compliance", description: "Applies suppression, consent, unsubscribe, sender identity and per-country marketing law before every contact." },
  copywriting: { name: "Copywriting", description: "Writes specific, truthful copy in the brand voice that leads with the reader's problem." },
  personalisation: { name: "Personalization", description: "Uses real CRM fields to make each message relevant without inventing details." },
  segmentation: { name: "Segmentation", description: "Defines segments by behavior and consent that make messages relevant and lawful." },
  deliverability: { name: "Deliverability", description: "Protects sending reputation: authentication, warm-up, list hygiene, spam-rate monitoring." },
  reply_handling: { name: "Reply handling", description: "Classifies replies and drafts accurate, approved responses; escalates what needs a human." },
  keyword_research: { name: "Keyword research", description: "Clusters queries by intent and business fit with volume and difficulty labeled Estimate." },
  technical_seo: { name: "Technical SEO", description: "Finds and fixes crawl, index, canonical, speed and structured-data issues through PRs." },
  content_briefs: { name: "Content briefs", description: "Writes briefs with query, intent, outline, internal links and schema that a writer can execute." },
  internal_linking: { name: "Internal linking", description: "Plans links that pass relevance to the pages that convert." },
  structured_data: { name: "Structured data", description: "Adds schema.org markup that describes only what is true on the page." },
  entity_consistency: { name: "Entity consistency", description: "Keeps name, description, founders and pricing identical across owned surfaces and directories." },
  answer_share_analysis: { name: "Answer share analysis", description: "Measures how often assistants mention the business for a question set and labels it approximate." },
  citation_earning: { name: "Citation earning", description: "Briefs content that assistants and publications cite, without fake reviews or seeded posts." },
  editorial_planning: { name: "Editorial planning", description: "Builds a calendar from keywords, customer questions and the roadmap within the budget." },
  brand_voice: { name: "Brand voice", description: "Writes consistently in the business's voice and glossary across formats." },
  asset_production: { name: "Asset production", description: "Produces guides, newsletters, audio and video from approved scripts with required labeling." },
  community_management: { name: "Community management", description: "Replies factually, triages DMs and escalates requests for money, data or commitments." },
  platform_fluency: { name: "Platform fluency", description: "Uses each platform's formats, limits and automation terms correctly." },
  audience_targeting: { name: "Audience targeting", description: "Builds audiences that match the customer profile without special categories or suppressed contacts." },
  creative_testing: { name: "Creative testing", description: "Runs 2-4 variants per audience with sourced claims and a clear winner rule." },
  bid_pacing: { name: "Bid pacing", description: "Keeps spend within daily and lifetime caps and shifts budget to lower CPA." },
  conversion_tracking: { name: "Conversion tracking", description: "Sets up server-side conversions and verifies events arrive end to end." },
  ad_policy_compliance: { name: "Ad policy compliance", description: "Pre-checks creatives and audiences against platform policy and special-category rules." },
  creator_vetting: { name: "Creator vetting", description: "Checks audience authenticity, brand safety and disclosure history before outreach." },
  outreach: { name: "Outreach", description: "Writes individual, truthful outreach that discloses the business and respects consent." },
  brief_writing: { name: "Brief writing", description: "Writes creator and production briefs with goals, do/don't lists and disclosure requirements." },
  disclosure_compliance: { name: "Disclosure compliance", description: "Verifies paid-partnership disclosure on live content before any payout is approved." },
  programme_design: { name: "Program design", description: "Sets commission structures and caps from the margin model with clear terms." },
  partner_recruitment: { name: "Partner recruitment", description: "Finds and invites partners whose audience fits, with reasons recorded." },
  fraud_detection: { name: "Fraud detection", description: "Holds self-referrals, coupon leaks, refunded orders and click-stuffing with evidence." },
  commission_modelling: { name: "Commission modeling", description: "Models payouts against refund-adjusted revenue and margin." },
  print_production: { name: "Print production", description: "Produces print-ready files to supplier specs with correct color, bleed and codes." },
  address_hygiene: { name: "Address hygiene", description: "Verifies addresses and removes suppressed or do-not-mail records before print." },
  media_research: { name: "Media research", description: "Finds titles, stations and sites whose audience matches, with sourced rate cards and circulation." },
  negotiation: { name: "Negotiation", description: "Negotiates price and terms within target and walk-away limits, recording every exchange." },
  kit_preparation: { name: "Kit preparation", description: "Prepares complete founder kits (materials, drafts, deadlines, contacts) for anything that cannot be automated." },
  scriptwriting: { name: "Scriptwriting", description: "Writes 15/30-second scripts with sourced claims and a clear call to action." },
  lift_measurement: { name: "Lift measurement", description: "Designs holdouts and vanity URLs to measure lift and labels results Estimate." },
  creative_sizing: { name: "Creative sizing", description: "Adapts creative to each format's exact dimensions and safe areas." },
  media_relations: { name: "Media relations", description: "Builds beat-matched media lists and relationships with lawful basis recorded." },
  press_release_writing: { name: "Press release writing", description: "Writes releases from real milestones with sourced facts and approved quotes only." },
  pitch_writing: { name: "Pitch writing", description: "Writes individual pitches that fit the journalist's beat and disclose the business." },
  media_monitoring: { name: "Media monitoring", description: "Tracks coverage, mentions and reviews and reports referral impact." },
  event_sourcing: { name: "Event sourcing", description: "Finds events where the customer attends and estimates pipeline needed to break even." },
  lead_capture: { name: "Lead capture", description: "Captures leads with lawful basis and source so follow-up is compliant." },
  follow_up: { name: "Follow-up", description: "Converts captured leads through approved sequences on time." },
  // Specialists
  supplier_discovery: { name: "Supplier discovery", description: "Builds qualified supplier long lists from directories, shows and referrals." },
  rfq_writing: { name: "RFQ writing", description: "Writes complete, identical RFQ packs that yield comparable quotes." },
  quote_analysis: { name: "Quote analysis", description: "Extracts and normalizes quotes into comparable typed fields and scores them." },
  supplier_vetting: { name: "Supplier vetting", description: "Verifies legitimacy, capability and references before samples or orders." },
  ingredient_knowledge: { name: "Ingredient knowledge", description: "Knows functions, typical concentrations and interactions of ingredients." },
  regulatory_knowledge: { name: "Regulatory knowledge", description: "Applies cosmetic and product regulations with article and date citations." },
  stability_planning: { name: "Stability planning", description: "Designs stability and compatibility tests with pass criteria before testing." },
  documentation: { name: "Documentation", description: "Assembles complete, structured technical files and packs for sign-off." },
  regulatory_pathways: { name: "Regulatory pathways", description: "Classifies products and maps authority, route, timeline and cost per market." },
  claims_review: { name: "Claims review", description: "Maps claims to allowed, conditional or prohibited with the rule cited." },
  evidence_appraisal: { name: "Evidence appraisal", description: "Judges study relevance and strength for each claim." },
  standards_mapping: { name: "Standards mapping", description: "Identifies applicable directives, standards and conformity routes per market." },
  test_plan_design: { name: "Test plan design", description: "Writes test plans with clauses, samples, sequence and pass criteria." },
  lab_coordination: { name: "Lab coordination", description: "Compares accredited labs on scope, price and lead time and tracks testing." },
  structural_design: { name: "Structural design", description: "Specifies pack structures, closures and dielines that protect and fit the product." },
  artwork_specification: { name: "Artwork specification", description: "Specifies artwork with mandatory label content checked per market." },
  material_selection: { name: "Material selection", description: "Chooses materials on compatibility, recyclability and cost with reasons." },
  qc_specification: { name: "QC specification", description: "Writes measurable acceptance criteria for critical, major and minor defects." },
  aql_sampling: { name: "AQL sampling", description: "Sets ISO 2859-1 sampling plans and applies accept/reject correctly." },
  inspection_planning: { name: "Inspection planning", description: "Plans in-process and pre-shipment inspections with checklists." },
  root_cause_analysis: { name: "Root cause analysis", description: "Traces defects to causes with evidence and assigns corrective actions." },
  freight_quoting: { name: "Freight quoting", description: "Compares modes and incoterms on cost, transit and risk with typed quotes." },
  hs_classification: { name: "HS classification", description: "Classifies goods with tariff references and estimates duties and VAT with sources." },
  inventory_planning: { name: "Inventory planning", description: "Sets safety stock and reorder points from forecast and lead times." },
  carrier_selection: { name: "Carrier selection", description: "Chooses carriers and 3PLs on fit, SLAs, integrations and fees." },
  landed_cost_modelling: { name: "Landed cost modeling", description: "Models per-unit cost from sourced lines, labeled Estimate until invoiced." },
  bom_costing: { name: "BOM costing", description: "Costs every component with quote ids, volume tiers and currency." },
  margin_analysis: { name: "Margin analysis", description: "Computes margins per channel after fees and returns at each price point." },
  scenario_modelling: { name: "Scenario modeling", description: "Shows the effect of volume, FX and freight changes on unit cost and runway." },
  // Utilities
  entity_resolution: { name: "Entity resolution", description: "Resolves spans to manifest entities exact → alias → fuzzy at the right confidence." },
  alias_matching: { name: "Alias matching", description: "Recognizes aliases and spelling variants without over-linking." },
  disambiguation: { name: "Disambiguation", description: "Surfaces ambiguous spans with candidates instead of guessing." },
  classification_accuracy: { name: "Classification accuracy", description: "Picks the right label from the set according to its definition." },
  confidence_calibration: { name: "Confidence calibration", description: "Reports confidence that matches actual accuracy." },
  label_consistency: { name: "Label consistency", description: "Gives the same label to the same or near-identical input." },
  chart_of_accounts: { name: "Chart of accounts", description: "Knows the standard accounts and what belongs in each." },
  transaction_categorisation: { name: "Transaction categorization", description: "Categorizes transactions correctly and flags financing and transfers." },
  rule_induction: { name: "Rule induction", description: "Turns founder recategorizations into general rules and applies them forward." },
  priority_assessment: { name: "Priority assessment", description: "Assigns low, normal or critical priority from impact and urgency." },
  routing: { name: "Routing", description: "Routes items by module key and tags to the right owner, never by department name." },
  deduplication: { name: "Deduplication", description: "Detects repeats within the window and links them." },
  policy_application: { name: "Policy application", description: "Applies content policy clauses accurately with the clause cited." },
  harm_detection: { name: "Harm detection", description: "Detects harassment, fraud, fabricated claims and personal data exposure." },
  false_positive_control: { name: "False positive control", description: "Allows sourced criticism and disagreement; flags borderline content for humans." },
};

function toDefinitions(group: SkillGroup, catalogue: Record<string, CatalogueEntry>, agentTypesFor: (key: string) => string[]): SkillDefinition[] {
  return Object.entries(catalogue).map(([key, entry]) =>
    SkillDefinition.parse({ key, name: entry.name, description: entry.description, group, agentTypes: agentTypesFor(key), custom: false }),
  );
}

const craftUsers = new Map<string, string[]>();
for (const t of ALL_TEMPLATES) {
  for (const s of t.skills) {
    if (s in CRAFT_SKILLS) {
      const list = craftUsers.get(s) ?? [];
      if (!list.includes(t.agentType)) list.push(t.agentType);
      craftUsers.set(s, list);
    }
  }
}

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = Object.freeze([
  ...toDefinitions("judgement", JUDGEMENT_SKILLS, () => ["*"]),
  ...toDefinitions("execution", EXECUTION_SKILLS, () => ["*"]),
  ...toDefinitions("craft", CRAFT_SKILLS, (key) => craftUsers.get(key) ?? []),
]);

export const SKILL_DEFINITIONS_BY_KEY: Readonly<Record<string, SkillDefinition>> = Object.freeze(Object.fromEntries(SKILL_DEFINITIONS.map((d) => [d.key, d])));

export function getSkillDefinition(key: string): SkillDefinition | undefined {
  // Own keys only: a custom skill keyed "constructor" must not find Object.prototype.constructor.
  return Object.hasOwn(SKILL_DEFINITIONS_BY_KEY, key) ? SKILL_DEFINITIONS_BY_KEY[key] : undefined;
}

/**
 * What a person reads for a skill key: the catalogue name ("prioritisation" → "Prioritization", "test_automation" →
 * "Test automation"), else the key in plain US English words. Keys are identifiers and keep their spelling; prose that
 * names a skill (coach summaries, Inbox notes) uses this, never the key.
 */
export function skillDisplayName(key: string): string {
  const def = getSkillDefinition(key);
  if (def) return def.name;
  const words = usSpelling(key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Skill keys an agent type carries: craft skills for the type plus every judgement and execution skill. */
export function skillKeysForAgentType(agentType: string): string[] {
  return SKILL_DEFINITIONS.filter((d) => d.agentTypes.includes("*") || d.agentTypes.includes(agentType)).map((d) => d.key);
}

/** Craft skill table from BUILD §11.10 for the named agent types, used by tests to assert the spec sets are present. */
export const SPEC_CRAFT_SETS: Record<string, string[]> = {
  backend_engineer: ["api_design", "data_modelling", "testing", "debugging", "security_awareness", "performance"],
  frontend_engineer: ["component_craft", "design_fidelity", "accessibility", "state_management", "testing"],
  channel_email_automation: ["copywriting", "personalisation", "segmentation", "deliverability", "reply_handling", "marketing_compliance"],
  channel_seo: ["keyword_research", "technical_seo", "content_briefs", "internal_linking"],
  sourcing_manufacturing: ["supplier_discovery", "rfq_writing", "quote_analysis", "negotiation", "supplier_vetting"],
  formulation_chemist: ["ingredient_knowledge", "regulatory_knowledge", "stability_planning", "documentation"],
};
