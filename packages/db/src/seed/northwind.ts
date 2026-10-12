/**
 * Northwind Skincare (BUILD §17.2): a DTC physical-product club, Personal game mode, Assisted business mode.
 * Departments renamed by the founder ("Formulation Lab" over the operations module, "Retail Partnerships" over
 * distribution), sourcing and formulation specialists in the lab, two years of synthetic journey data, Shopify-style
 * orders as payments, suppliers and retail partners in the CRM, a UK Ltd with its compliance calendar.
 */
import { getArchetypeSeed } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { eq } from "drizzle-orm";
import { repos } from "../repos";
import { entities as entitiesTable, type Entity } from "../schema";
import { agentMention, seedAgentEntities, seedChannels, seedDashboards, seedHistoricalTasks, seedInbox, seedIntegrations, seedRoadmap, seedSpec, seedTasks, seededRelevance, type InboxSpec, type RoadmapSpec, type TaskSpec } from "./content";
import { DEMO_OWNER_DISPLAY_NAME, NORTHWIND_BUSINESS_ID, NORTHWIND_NAME, NORTHWIND_SLUG } from "./constants";
import { addDays, atHour, mention, money, pct, proseDoc, type SeedCtx } from "./context";
import { seedFinance } from "./finance";
import { seedJourney } from "./journey";
import { seedLegal } from "./legal";
import { applyAgentStatuses, seedSquad } from "./squad";
import type { SeededBusiness } from "./types";

const CURRENCY = "GBP";

const SPEC_TEXT: Record<string, string[]> = {
  Problem: ["People with reactive skin cannot tell which products are safe for them: ingredient lists are opaque and marketing claims are unverifiable.", "Northwind sells a short routine (cleanser, serum, moisturizer) formulated without the twelve most common irritants, with every batch's test results published."],
  Customers: ["Adults 25-45 in the UK and Ireland with sensitive or reactive skin, buying online, who already read ingredient lists.", "Secondary: independent pharmacies and refill stores as retail partners."],
  "Value proposition": ["Fewer reactions, proven: published patch-test and stability results per batch; a 60-day reaction-free promise."],
  Features: ["Three-step routine in refillable glass; subscription with pause; batch results page per product; ingredient explainer per SKU."],
  "Formulation / BOM": ["Base formulas from the formulation chemist with INCI lists; preservative system reviewed for Annex V; fragrance-free.", "Bill of materials per SKU with quote ids from the contract manufacturer (Estimate until the first purchase order)."],
  Manufacturing: ["Contract manufacturing in the UK; MOQ 2,000 units per SKU; 6-week lead time (Estimate)."],
  Packaging: ["Refillable glass with aluminum caps; FSC outer cartons; UKCA-compliant labeling with batch and PAO marks."],
  Compliance: ["UK Cosmetics Regulation: CPSR per product, SCPN notification, responsible person named; EU CPNP for Ireland."],
  Fulfillment: ["Third-party logistics in the Midlands; 48-hour dispatch; subscription refills shipped monthly."],
  "Non-functional requirements": ["Storefront loads under two seconds; checkout through the commerce connector; order webhooks reach the journey model within a minute."],
  Data: ["Orders, customers, refunds from Shopify; batch results from the lab; consent recorded at signup."],
  Integrations: ["Shopify, SendGrid, open banking (Tink), Google Drive for lab documents."],
  Pricing: ["Routine £54, refills £38 per quarter (Estimate until the landed-cost model confirms margin)."],
  Metrics: ["Blended cost per customer, repeat rate at 90 days, reaction reports per 1,000 units, gross margin per SKU."],
  Risks: ["Supplier lead times; regulatory changes to allowed preservatives; reviews from reactive customers."],
};

/** The three hunks of the seeded interview proposal: section → the text the proposal would put in its place. */
const PROPOSAL_HUNKS: ReadonlyArray<{ section: string; proposed: string[] }> = [
  { section: "Pricing", proposed: ["Routine £54, refills £34 per quarter with a two-routine bundle at £62 (Estimate until the landed-cost model confirms margin; interview panel put the refill ceiling near £35)."] },
  { section: "Features", proposed: ["Three-step routine in refillable glass; subscription with pause; batch results page per product; ingredient explainer per SKU.", "Reaction diary in the account: customers log a reaction against a batch number; the lab sees aggregated counts per batch (Estimate: two weeks of development)."] },
  { section: "Customers", proposed: ["Adults 25-45 in the UK and Ireland with sensitive or reactive skin, buying online, who already read ingredient lists.", "Secondary: independent pharmacies and refill stores as retail partners; online dermatology clinics as a referral channel (two of six panel participants arrived that way)."] },
];

const ROADMAP: RoadmapSpec[] = [
  { title: "Second production batch (3 SKUs)", horizon: "now", status: "in_progress", confidence: 4, startOffsetDays: -14, durationDays: 42, section: "Manufacturing", ownerDepartmentSlug: "operations" },
  { title: "Subscription refills v2 (pause and skip)", horizon: "now", status: "in_progress", confidence: 4, startOffsetDays: -7, durationDays: 28, section: "Features", ownerDepartmentSlug: "development" },
  { title: "Batch results page per product", horizon: "next", status: "planned", confidence: 3, startOffsetDays: 14, durationDays: 21, section: "Features", ownerDepartmentSlug: "development" },
  { title: "Retail partner wholesale price list", horizon: "next", status: "planned", confidence: 3, startOffsetDays: 21, durationDays: 14, section: "Pricing", ownerDepartmentSlug: "distribution" },
  { title: "Ireland launch (CPNP notification)", horizon: "next", status: "planned", confidence: 2, startOffsetDays: 45, durationDays: 60, section: "Compliance", ownerDepartmentSlug: "legal" },
  { title: "Fragrance-free body range", horizon: "later", status: "planned", confidence: 2, startOffsetDays: 120, durationDays: 90, section: "Formulation / BOM", ownerDepartmentSlug: "operations" },
  { title: "Pharmacy pop-up program", horizon: "later", status: "planned", confidence: 2, startOffsetDays: 150, durationDays: 60, ownerDepartmentSlug: "distribution" },
  { title: "Refill-at-home concentrate", horizon: "later", status: "idea", confidence: 1, startOffsetDays: 240, durationDays: 120, section: "Packaging", ownerDepartmentSlug: "operations" },
];

const HISTORY_TITLES = [
  { kind: "specialist" as const, departmentSlug: "operations", assigneeTemplateKey: "sourcing_manufacturing", title: "Supplier quote comparison" },
  { kind: "specialist" as const, departmentSlug: "operations", assigneeTemplateKey: "formulation_chemist", title: "Stability check on serum batch" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "frontend_engineer", title: "Storefront fix" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "backend_engineer", title: "Order webhook hardening" },
  { kind: "channel" as const, departmentSlug: "distribution", assigneeTemplateKey: "channel_email_automation", title: "Refill reminder sequence tweak" },
  { kind: "channel" as const, departmentSlug: "distribution", assigneeTemplateKey: "channel_influencer", title: "Creator seeding round" },
  { kind: "research" as const, departmentSlug: "product", assigneeTemplateKey: "researcher", title: "Customer interview synthesis" },
  { kind: "finance" as const, departmentSlug: "finance", assigneeTemplateKey: "finance_lead", title: "Monthly management accounts" },
  { kind: "legal" as const, departmentSlug: "legal", assigneeTemplateKey: "legal_lead", title: "Labeling review" },
  { kind: "specialist" as const, departmentSlug: "operations", assigneeTemplateKey: "logistics", title: "3PL dispatch audit" },
];

export async function seedNorthwind(ctx: SeedCtx): Promise<SeededBusiness> {
  const { db } = ctx;
  const businessId = NORTHWIND_BUSINESS_ID;
  const archetype = getArchetypeSeed("dtc_physical");
  const log = (m: string) => ctx.log(`[${NORTHWIND_SLUG}] ${m}`);

  await repos.businesses.create(db, {
    id: businessId,
    name: NORTHWIND_NAME,
    slug: NORTHWIND_SLUG,
    gameMode: "personal",
    businessMode: "assisted",
    archetype: "dtc_physical",
    kitPrimary: "#2f6f5e",
    kitSecondary: "#f2c94c",
    region: "eu",
    planTier: "pro",
    modelBilling: "credits",
    glossary: { customer: "customer", squad: "lab team" },
    createdBy: ctx.owner.userId,
  });
  for (const owner of ctx.owners) await repos.memberships.add(db, businessId, { userId: owner.userId, role: "owner" });
  await repos.businesses.commit(db, businessId, { archetype: "dtc_physical", committedAt: ctx.startDate });

  const squad = await seedSquad(ctx, businessId, archetype, { currency: CURRENCY, renames: { operations: "Formulation Lab", distribution: "Retail Partnerships" } });
  await applyAgentStatuses(ctx, businessId, squad, {
    fallback: "healthy",
    byTemplate: { channel_print: "idle", channel_broadcast: "idle", channel_outdoor: "idle", channel_direct_mail: "idle", channel_affiliate: "idle", channel_pr: "paused", packaging_design: "idle", certification: "degraded", moderation: "idle" },
  });
  log(`team: ${squad.agents.length} agents in ${squad.departments.length} departments`);

  const channels = await seedChannels(ctx, businessId, squad, CURRENCY, {
    enabled: ["influencer", "paid_ads", "social", "email_automation"],
    recommended: ["influencer", "paid_ads", "social", "email_automation", "content"],
    fit: { influencer: 17, paid_ads: 16, social: 15, email_automation: 14, content: 12, seo: 11, affiliate: 10, pr: 9, direct_mail: 7, print: 6, outdoor: 5, broadcast: 4, events: 6, geo: 5, lead_generation: 3 },
    budgetMinor: { influencer: 60_000, paid_ads: 90_000, social: 20_000, email_automation: 10_000 },
    why: { influencer: "Reactive-skin creators already review ingredient lists for their audiences; seeding with codes gives attributable orders within two weeks (Estimate)." },
  });

  const agentEntities = await seedAgentEntities(ctx, businessId, squad, DEMO_OWNER_DISPLAY_NAME);

  const journey = await seedJourney(ctx, {
    businessId,
    slug: NORTHWIND_SLUG,
    archetype: "dtc_physical",
    currency: CURRENCY,
    siteHost: "northwindskincare.example",
    squad,
    departments: squad.departments,
    channels,
    customerSource: "shopify",
    visibility: "private",
  });

  // --- CRM: suppliers, contacts, retail partners --------------------------------------------------------------------
  const supplierSpecs = [
    { name: "Pennine Contract Cosmetics", stage: "contracted", domain: "penninecosmetics.example", contact: "Hana Brandt", title: "Account manager" },
    { name: "Glassworks Packaging Co", stage: "contracted", domain: "glassworkspack.example", contact: "Ivo Castel", title: "Sales lead" },
    { name: "Harbor Botanicals", stage: "quoted", domain: "harborbotanicals.example", contact: "Noor Faber", title: "Supply manager" },
    { name: "Meridian Labs Testing", stage: "contracted", domain: "meridianlabs.example", contact: "Quin Holm", title: "Lab coordinator" },
    { name: "Cobalt Print and Carton", stage: "qualified", domain: "cobaltcarton.example", contact: "Tove Lund", title: "Estimator" },
    { name: "Fjord Logistics 3PL", stage: "contracted", domain: "fjordlogistics.example", contact: "Rafa Marin", title: "Operations" },
  ];
  const suppliers: Entity[] = [];
  const supplierContacts: Entity[] = [];
  const sourcing = squad.byTemplate.get("sourcing_manufacturing");
  for (const s of supplierSpecs) {
    const org = await repos.entities.create(db, businessId, { kind: "organisation", displayName: s.name, identifiers: { domain: s.domain }, lawfulBasis: "legitimate_interest", source: "sourcing", visibility: "private" });
    await repos.entities.addRole(db, businessId, org.id, { role: "supplier", stage: s.stage, ownerRef: sourcing ? { kind: "agent", id: sourcing.agent.id } : null, startedAt: addDays(ctx.today, -ctx.rng.int(60, 600)) });
    const person = await repos.entities.create(db, businessId, { kind: "person", displayName: s.contact, aliases: [s.contact.split(" ")[0]!], identifiers: { email: `${s.contact.toLowerCase().replace(/ /g, ".")}@${s.domain}` }, lawfulBasis: "legitimate_interest", source: "sourcing", visibility: "private" });
    await repos.entities.addRole(db, businessId, person.id, { role: "supplier_contact", stage: s.title });
    await repos.entities.upsertRelationship(db, businessId, { fromEntity: person.id, toEntity: org.id, type: "works_at", strength: 0.9 });
    await repos.entities.createInteraction(db, businessId, {
      kind: "email",
      occurredAt: addDays(ctx.today, -ctx.rng.int(2, 40)),
      entityIds: [org.id, person.id],
      agentId: sourcing?.agent.id ?? null,
      summary: `${s.contact} confirmed ${s.stage === "contracted" ? "the next delivery window" : "the quote is valid for 30 days"} (read through the quarantined reader).`,
      direction: "inbound",
    });
    suppliers.push(org);
    supplierContacts.push(person);
  }
  const retailSpecs = [
    { name: "Lumen Pharmacy Group", stage: "active", domain: "lumenpharmacy.example" },
    { name: "Maple Refill Store", stage: "pilot", domain: "maplerefill.example" },
    { name: "Summit Health Stores", stage: "prospect", domain: "summithealth.example" },
  ];
  const retailPartners: Entity[] = [];
  for (const r of retailSpecs) {
    const org = await repos.entities.create(db, businessId, { kind: "organisation", displayName: r.name, identifiers: { domain: r.domain }, lawfulBasis: "legitimate_interest", source: "partnerships", visibility: "private" });
    await repos.entities.addRole(db, businessId, org.id, { role: "retail_partner", stage: r.stage, ownerRef: { kind: "department", id: squad.departmentBySlug.get("distribution")!.id } });
    retailPartners.push(org);
  }
  await repos.entities.upsertRelationship(db, businessId, { fromEntity: retailPartners[1]!.id, toEntity: supplierContacts[1]!.id, type: "introduced_by", strength: 0.4 });
  await repos.entities.upsertRelationship(db, businessId, { fromEntity: suppliers[0]!.id, toEntity: suppliers[3]!.id, type: "tests_with", strength: 0.6 });
  // A retail partner is also a paying customer: link it to the newest organisation customer when there is one.
  const orgCustomer = [...journey.customersByEntityId.values()].reverse().find((c) => c.kind === "organisation");
  if (orgCustomer) await repos.entities.upsertRelationship(db, businessId, { fromEntity: retailPartners[0]!.id, toEntity: orgCustomer.entityId, type: "same_group", strength: 0.3 });

  // --- product ---------------------------------------------------------------------------------------------------------
  const productLead = squad.byTemplate.get("product_lead");
  const specIds = await seedSpec(ctx, businessId, archetype.specOutline, SPEC_TEXT, productLead?.agent.id ?? null);
  const roadmapIds = await seedRoadmap(ctx, businessId, ROADMAP, specIds, squad);
  await repos.product.createSource(db, businessId, {
    kind: "doc",
    uri: "drive://northwind/lab/batch-002-cpsr.pdf",
    title: "Batch 002 CPSR (Meridian Labs)",
    relevance: seededRelevance(specIds, { summary: "The safety assessment for batch 002 passes all three SKUs; the serum needs a revised warning line before relabeling.", sections: [["Compliance", 0.92], ["Packaging", 0.64]], topics: ["safety assessment", "labeling", "batch 002"], checkedAt: addDays(ctx.today, -9) }),
    fetchedAt: addDays(ctx.today, -9),
  });
  await repos.product.createSource(db, businessId, {
    kind: "feedback",
    uri: null,
    title: "Reaction reports Q3 (12 tickets)",
    relevance: seededRelevance(specIds, { summary: "Twelve reaction tickets this quarter; nine name the serum and most within two weeks of a new batch.", sections: [["Formulation / BOM", 0.81], ["Customers", 0.52]], topics: ["reactions", "serum", "batch quality"], checkedAt: addDays(ctx.today, -3) }),
    fetchedAt: addDays(ctx.today, -3),
  });

  // One open spec change proposal (BUILD §11.5, AC-11.5.2): a customer interview the Source Watcher read touches three
  // sections; each hunk carries the current block as base/ours and the proposed text as theirs so Product › Changes
  // shows a three-way diff and accepting two of three hunks yields a partially accepted proposal.
  const interview = await repos.product.createSource(db, businessId, {
    kind: "transcript",
    uri: "drive://northwind/research/interview-2026-10-04-reactive-skin-panel.md",
    title: "Customer interview: reactive-skin panel (6 participants)",
    relevance: seededRelevance(specIds, {
      summary: "Six panel participants on refills, reactions and referrals: a quarterly refill under £35 would win four of them, five keep a private reaction note, two came through an online clinic.",
      sections: [["Pricing", 0.88], ["Features", 0.79], ["Customers", 0.74]],
      topics: ["refill pricing", "reaction diary", "clinic referrals"],
      checkedAt: addDays(ctx.today, -3),
    }),
    fetchedAt: addDays(ctx.today, -3),
  });
  const researcher = squad.byTemplate.get("researcher");
  const proposal = await repos.product.createProposal(db, businessId, {
    title: "Interview panel: refill pricing, a reaction diary and clinic referrals",
    rationaleMd: [
      `${researcher ? agentMention(agentEntities, researcher) : "The researcher"} synthesized the reactive-skin panel (six participants, read through the quarantined reader). Three claims touch the specification:`,
      "- Four of six would switch to a quarterly refill under £35; two called £38 \"a stretch\" (Estimate of price sensitivity, n=6).",
      "- Five of six keep a private note of which products caused a reaction; none of them trust the brand's own claims without it.",
      "- Two participants were referred by an online dermatology clinic, a channel the spec does not name.",
    ].join("\n"),
    evidence: [interview.id],
    impact: { summary: "Pricing change plus one new feature; no manufacturing impact (Estimate).", dates: { shiftDays: 7 }, tasks: { count: 2, titles: ["Reaction diary in the account", "Refill price test"] }, costMinor: 180_000, currency: CURRENCY },
    severity: "normal",
    proposedByAgentId: researcher?.agent.id ?? null,
    hunks: PROPOSAL_HUNKS.map((h, position) => {
      const current = proseDoc(...(SPEC_TEXT[h.section] ?? []));
      return { specBlockId: specIds.get(h.section)!, base: current, ours: current, theirs: proseDoc(...h.proposed), position };
    }),
  });
  log(`proposal: ${proposal.hunks.length} hunks from source ${interview.id}`);

  // --- tasks in mixed states ------------------------------------------------------------------------------------------
  const taskSpecs: TaskSpec[] = [
    { kind: "specialist", title: "Second batch purchase order pack", goal: "Assemble the PO pack for batch 002 across three SKUs with quote ids and the landed-cost model; the founder signs.", acceptance: ["Every line cites a quote id", "Landed cost per unit at 2,000 and 5,000 units", "No PO sent"], status: "running", departmentSlug: "operations", assigneeTemplateKey: "sourcing_manufacturing", roadmapTitle: "Second production batch (3 SKUs)", startedDaysAgo: 0, durationHours: 3, progress: 0.55, phase: "implementing" },
    { kind: "specialist", title: "Stability data for serum reformulation", goal: "Collate 12-week stability results for serum v3 and flag any drift beyond spec.", acceptance: ["All three storage conditions reported", "Drift flagged with values", "Recommendation labeled Estimate"], status: "review", departmentSlug: "operations", assigneeTemplateKey: "formulation_chemist", roadmapTitle: "Second production batch (3 SKUs)", startedDaysAgo: 1, durationHours: 2.5, phase: "review" },
    { kind: "code", title: "Subscription pause and skip", goal: "Add pause and skip to the refill subscription through the commerce connector, against the test store.", acceptance: ["Pause and skip through the Shopify connector (test store)", "Webhook events reach the journey model", "Playwright test for the account page"], status: "running", departmentSlug: "development", assigneeTemplateKey: "backend_engineer", roadmapTitle: "Subscription refills v2 (pause and skip)", startedDaysAgo: 0, durationHours: 4, progress: 0.35, phase: "implementing", fileScope: ["apps/storefront/account/**"] },
    { kind: "code", title: "Account page: refill schedule UI", goal: "Show the next refill date with pause/skip controls.", acceptance: ["Matches the design", "Accessible controls", "Storybook story"], status: "ready", departmentSlug: "development", assigneeTemplateKey: "frontend_engineer", roadmapTitle: "Subscription refills v2 (pause and skip)", dependsOn: ["Subscription pause and skip"] },
    { kind: "code", title: "Batch results page", goal: "Render published batch results per product from the lab documents.", acceptance: ["One page per SKU", "Results cite the lab report"], status: "planned", departmentSlug: "development", assigneeTemplateKey: "planner", roadmapTitle: "Batch results page per product" },
    { kind: "channel", title: "Creator seeding wave 4", goal: "Brief and seed ten creators with codes; disclosure checked before any payout.", acceptance: ["Ten briefs sent", "Codes registered for attribution", "No payout without disclosure check"], status: "blocked", departmentSlug: "distribution", assigneeTemplateKey: "channel_influencer", startedDaysAgo: 2, durationHours: 1.5, phase: "implementing" },
    { kind: "channel", title: "Winter paid test (hard CPA cap)", goal: "Run a two-week paid test with a hard cost-per-customer cap; pause if over cap for 48 hours.", acceptance: ["Daily and lifetime caps set", "Kill switch tested", "Report to the Inbox"], status: "running", departmentSlug: "distribution", assigneeTemplateKey: "channel_paid_ads", startedDaysAgo: 0, durationHours: 1, progress: 0.2 },
    { kind: "research", title: "Reaction report synthesis Q3", goal: "Synthesize the twelve reaction reports into claims with sources and confidence.", acceptance: ["Every claim cites a ticket", "Confidence stated"], status: "done", departmentSlug: "product", assigneeTemplateKey: "researcher", startedDaysAgo: 3, durationHours: 2 },
    { kind: "finance", title: "Landed cost model v2", goal: "Update the landed-cost model from batch 002 quotes at three volumes, labeled Estimate.", acceptance: ["Three volume tiers", "Margin per channel"], status: "done", departmentSlug: "finance", assigneeTemplateKey: "finance_lead", startedDaysAgo: 4, durationHours: 1.5 },
    { kind: "legal", title: "CPNP notification plan for Ireland", goal: "List the steps, responsible person and costs to notify three SKUs on CPNP, labeled Estimate.", acceptance: ["Steps with dated sources", "Costs labeled Estimate"], status: "planned", departmentSlug: "legal", assigneeTemplateKey: "legal_lead", roadmapTitle: "Ireland launch (CPNP notification)" },
    { kind: "ops", title: "3PL dispatch SLA review", goal: "Review last month's dispatch times against the 48-hour SLA.", acceptance: ["Breaches listed with order ids"], status: "failed", departmentSlug: "operations", assigneeTemplateKey: "logistics", startedDaysAgo: 6, durationHours: 1 },
    { kind: "specialist", title: "Carton artwork proof round 2", goal: "Review the second proof for the refill carton against the labeling checklist.", acceptance: ["PAO and batch marks present", "Barcode verified"], status: "paused", departmentSlug: "operations", assigneeTemplateKey: "packaging_design", startedDaysAgo: 5, durationHours: 0.5 },
  ];
  const tasks = await seedTasks(ctx, businessId, taskSpecs, squad, roadmapIds, CURRENCY);
  const historical = await seedHistoricalTasks(ctx, businessId, squad, HISTORY_TITLES, 90, CURRENCY);
  log(`tasks: ${tasks.size} current + ${historical} historical`);

  // --- integrations, finance, legal ---------------------------------------------------------------------------------
  const integrationIds = await seedIntegrations(ctx, businessId, [
    { connectorKey: "shopify", authKind: "oauth", accountLabel: "northwind-skincare.myshopify.example", scopes: ["read_orders", "read_customers", "read_products"], settings: { shop: "northwind-skincare" } },
    { connectorKey: "sendgrid", authKind: "api_key", accountLabel: "mail.northwindskincare.example", scopes: ["mail.send", "marketing.campaigns"], settings: { sendingDomain: "mail.northwindskincare.example", dmarc: "p=quarantine" } },
    { connectorKey: "tink", authKind: "oauth", accountLabel: "Northwind Business Current", scopes: ["accounts:read", "transactions:read"] },
    { connectorKey: "google_drive", authKind: "oauth", accountLabel: "lab@northwindskincare.example", scopes: ["drive.readonly"] },
  ]);
  const finance = await seedFinance(ctx, {
    businessId,
    slug: NORTHWIND_SLUG,
    currency: CURRENCY,
    provider: "tink",
    accountName: "Northwind Business Current",
    integrationId: integrationIds.get("tink") ?? null,
    consentExpiresAt: addDays(ctx.today, 64),
    payoutCounterparty: "Shopify Payments",
    payoutCategory: "revenue",
    revenueByMonth: journey.revenueByMonth,
    agentSpendByMonth: journey.agentSpendByMonth,
    adSpendByMonth: journey.adSpendByMonth,
    cogsRate: 0.38,
    supplierNames: suppliers.map((s) => s.displayName),
    supplierEntityIds: suppliers.map((s) => s.id),
    fixedCosts: [
      { counterparty: "Shopify", category: "software", amountMinor: 7_900, cadence: "monthly", description: "Shopify plan" },
      { counterparty: "Fjord Logistics 3PL", category: "fulfilment", amountMinor: 120_000, cadence: "monthly", description: "Storage and pick-pack", day: 5 },
      { counterparty: "Hiscox", category: "insurance", amountMinor: 90_000, cadence: "yearly", description: "Product liability insurance", day: 12 },
      { counterparty: "Quist Accountants", category: "professional_fees", amountMinor: 45_000, cadence: "quarterly", description: "Quarterly accounts and VAT", day: 20 },
      { counterparty: "Cloudflare", category: "software", amountMinor: 2_000, cadence: "monthly", description: "Domain and DNS" },
    ],
    financing: [{ at: atHour(addDays(ctx.startDate, 1), 10), counterparty: `${DEMO_OWNER_DISPLAY_NAME} (director loan)`, amountMinor: 6_000_000, description: "Director loan to fund the first batch", category: "financing", counterpartyEntityId: agentEntities.founder.id }],
    financeLeadAgentId: squad.byTemplate.get("finance_lead")?.agent.id ?? null,
    recentSessions: journey.recentSessions,
    mrrMinorNow: journey.mrrMinorNow,
  });
  const legal = await seedLegal(ctx, businessId, {
    legalName: "Northwind Skincare Ltd",
    jurisdiction: "GB",
    entityType: "private_limited_company",
    regNo: "15432198",
    registeredAddress: { line1: "14 Quill Street", city: "Manchester", postcode: "M4 5JW", country: "GB" },
    officers: [{ name: DEMO_OWNER_DISPLAY_NAME, role: "Director", appointedAt: addDays(ctx.startDate, 5).toISOString().slice(0, 10) }],
    shareCapitalMinor: 10_000,
    currency: CURRENCY,
    formedDaysAgo: ctx.days - 5,
    incorporationRoute: "companies_house_web",
    filings: [
      { kind: "confirmation_statement", title: "Confirmation statement (CS01)", dueInDays: 41, status: "upcoming" },
      { kind: "annual_accounts", title: "Annual accounts (micro-entity)", dueInDays: 118, status: "upcoming" },
      { kind: "vat_return", title: "VAT return Q3", dueInDays: 9, status: "due", ref: "VAT-Q3" },
      { kind: "vat_return", title: "VAT return Q2", dueInDays: -83, status: "filed", ref: "VAT-Q2" },
    ],
    compliance: [
      { kind: "cpsr_review", title: "CPSR review for serum v3", dueInDays: 24 },
      { kind: "scpn_notification", title: "SCPN notification for batch 002 SKUs", dueInDays: 12 },
      { kind: "ico_fee", title: "ICO data protection fee renewal", dueInDays: 200, recurrence: "yearly" },
      { kind: "insurance_renewal", title: "Product liability insurance renewal", dueInDays: 95, recurrence: "yearly" },
    ],
    contracts: [
      { kind: "supply", title: "Manufacturing agreement - Pennine Contract Cosmetics", status: "active", counterpartyEntityId: suppliers[0]!.id, valueMinor: 4_800_000, signedDaysAgo: 400, obligations: ["MOQ 2,000 units per SKU", "6-week lead time"] },
      { kind: "supply", title: "Packaging supply - Glassworks Packaging Co", status: "active", counterpartyEntityId: suppliers[1]!.id, valueMinor: 1_200_000, signedDaysAgo: 380 },
      { kind: "services", title: "Fulfillment agreement - Fjord Logistics 3PL", status: "active", counterpartyEntityId: suppliers[5]!.id, valueMinor: 1_440_000, signedDaysAgo: 300, obligations: ["48-hour dispatch SLA"] },
      { kind: "wholesale", title: "Wholesale terms - Lumen Pharmacy Group", status: "awaiting_signature", counterpartyEntityId: retailPartners[0]!.id, valueMinor: 900_000 },
      { kind: "testing", title: "Testing services - Meridian Labs", status: "review", counterpartyEntityId: suppliers[3]!.id, valueMinor: 240_000 },
    ],
  });

  await repos.policies.create(db, businessId, {
    scope: "business",
    name: "Assisted mode: suppliers and spend",
    cedarText: `// Any supplier purchase order or deposit is a founder decision (hard gate).\n@outcome("ask")\npermit(principal, action == Action::"call", resource) when { context.capability == "purchase_order" };`,
    createdBy: ctx.owner.userId,
  });
  await repos.playbooks.create(db, businessId, {
    departmentId: squad.departmentBySlug.get("operations")?.id ?? null,
    name: "Monday stock check",
    sourceText: "Every Monday at 9, check stock at the 3PL for each SKU; if any SKU is under four weeks of cover, open a reorder task for sourcing and tell me in the Inbox.",
    compiled: { trigger: { cron: "0 9 * * 1" }, steps: [{ type: "create_task", params: { kind: "specialist", title: "Reorder check" } }], approvals: [{ capability: "purchase_order" }], stop: { condition: "any SKU under four weeks of cover" } },
    enabled: true,
    createdBy: ctx.owner.userId,
  });
  await seedDashboards(ctx, businessId);

  // --- inbox ---------------------------------------------------------------------------------------------------------
  const chief = squad.chief;
  const latest = journey.latestPayments[0];
  const won = latest ? mention(latest.customer.entityId, latest.customer.displayName) : "a new customer";
  const runwayText = finance.runwayMonths === null ? "no runway limit yet, as the business stays cash-flow positive" : `${finance.runwayMonths} months of runway (Estimate)`;
  const trophy = journey.data.milestones.filter((m) => m.trophyKey).at(-1);
  const inboxDrafts: Array<InboxSpec | null> = [
    {
      type: "decision",
      fromAgentId: chief.agent.id,
      subject: "Approve batch 002 before the Ireland launch?",
      bodyMd: [
        `${agentMention(agentEntities, squad.byTemplate.get("sourcing_manufacturing")!)} has the purchase-order pack for batch 002 ready: three SKUs, 2,000 units each, from ${mention(suppliers[0]!.id, suppliers[0]!.displayName)} with packaging from ${mention(suppliers[1]!.id, suppliers[1]!.displayName)}.`,
        `Landed cost is ${money(1_240, CURRENCY)} per unit (Estimate) against a ${money(5_400, CURRENCY)} routine price. Cash after the deposit leaves ${runwayText}.`,
        "The Board asks whether to place the order now, split it, or wait for the serum stability review.",
      ].join("\n\n"),
      statusStrip: [
        { metric: `Cash ${money(finance.balanceMinor, CURRENCY)}`, source: "accounts" },
        { metric: `Runway ${finance.runwayMonths ?? "n/a"} mo (Estimate)`, source: "forecasts" },
        { metric: `Customers ${journey.paidCustomers}`, source: "conversions" },
      ],
      exhibit: { kind: "table", spec_ref: "cash_position" },
      decision: {
        options: [
          { id: "order_now", label: "Place the full order now", recommended: true, consequence: "Deposit of 50% leaves this week; stock lands in six weeks, in time for the Ireland launch.", cost_minor: 3_720_000, reversible: false },
          { id: "split", label: "Order two SKUs now, serum after the stability review", recommended: false, consequence: "Lower deposit; serum arrives four weeks later than the rest.", cost_minor: 2_480_000, reversible: true },
          { id: "wait", label: "Wait for the stability review (two weeks)", recommended: false, consequence: "No spend now; risk of a stock-out on the cleanser in November (Estimate).", cost_minor: 0, reversible: true },
        ],
        free_text: true,
        expires_at: addDays(ctx.today, 5).toISOString(),
      },
      blocksContinue: true,
      createdDaysAgo: 0,
      costMinor: 240,
    },
    latest
      ? {
          type: "customer_won",
          fromAgentId: squad.byTemplate.get("distribution_strategist")?.agent.id ?? chief.agent.id,
          subject: `New order from ${latest.customer.displayName.slice(0, 40)}`,
          bodyMd: [
            `${won} ordered the routine for ${money(latest.conversion.amountMinor, CURRENCY)} through Shopify.`,
            `First touch was ${journey.data.touches.find((t) => t.visitorId === latest.customer.visitorId)?.channelKey?.replace(/_/g, " ") ?? "direct"}; ${agentMention(agentEntities, squad.byTemplate.get("channel_email_automation")!)} ran the welcome sequence in between.`,
            "Open the Customer Update to see the full journey with attribution weights (Estimate).",
          ].join("\n\n"),
          statusStrip: [{ metric: `Revenue 30d ${money(journey.revenueLast30dMinor, CURRENCY)}`, source: "conversions" }],
          exhibit: { kind: "chart", spec_ref: "conversions_30d" },
          sourceEventIds: latest.eventId ? [latest.eventId] : [],
          entityIds: [latest.customer.entityId],
          createdDaysAgo: 0,
        }
      : null,
    {
      type: "warning",
      fromAgentId: squad.byTemplate.get("finance_lead")?.agent.id ?? chief.agent.id,
      subject: "VAT return due in nine days",
      bodyMd: [
        `The Q3 VAT return is due in nine days. ${agentMention(agentEntities, squad.byTemplate.get("finance_lead")!)} has reconciled ${finance.transactions} bank lines (Estimate: management figures, cash basis).`,
        `Two supplier invoices from ${mention(suppliers[2]!.id, suppliers[2]!.displayName)} are missing VAT numbers; the legal lead has asked for them.`,
      ].join("\n\n"),
      statusStrip: [{ metric: "Due in 9 days", source: "filings" }],
      createdDaysAgo: 1,
    },
    {
      type: "update",
      fromAgentId: squad.byTemplate.get("engineering_lead")?.agent.id ?? chief.agent.id,
      subject: "Subscription pause and skip: 35% done",
      bodyMd: [
        `${agentMention(agentEntities, squad.byTemplate.get("backend_engineer")!)} has the Shopify connector calls for pause and skip passing against the test store; webhooks into the journey model are next.`,
        `${agentMention(agentEntities, squad.byTemplate.get("frontend_engineer")!)} starts the account page once the API lands. No merge to main without your approval (Assisted mode).`,
      ].join("\n\n"),
      exhibit: { kind: "table", spec_ref: "tasks_by_status" },
      createdDaysAgo: 1,
    },
    trophy
      ? {
          type: "milestone",
          fromAgentId: chief.agent.id,
          subject: `Milestone: ${trophy.label}`,
          bodyMd: `${trophy.label} reached on ${new Date(trophy.achievedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}. ${journey.paidCustomers} paying customers so far (synthetic demo data). The whole team gets the credit; ${agentMention(agentEntities, squad.byTemplate.get("channel_influencer")!)} brought the most first touches this quarter.`,
          createdDaysAgo: 2,
          state: "read",
        }
      : null,
    {
      type: "report",
      fromAgentId: chief.agent.id,
      subject: "Weekly debrief",
      bodyMd: [
        `Revenue last 30 days ${money(journey.revenueLast30dMinor, CURRENCY)}; channel spend ${money(journey.spendLast30dMinor, CURRENCY)}; blended cost per customer ${journey.paidCustomers ? money(Math.round(journey.spendLast30dMinor / Math.max(1, journey.paidCustomers / 24)), CURRENCY) : "n/a"} (Estimate).`,
        `Standout agent: ${agentMention(agentEntities, squad.byTemplate.get("formulation_chemist")!)} closed the serum stability work two days early. ${agentMention(agentEntities, squad.byTemplate.get("certification")!)} is degraded: the certification source feed times out; expected back tomorrow.`,
        `Next week: batch 002 decision, VAT return, creator wave 4 once ${mention(retailPartners[0]!.id, retailPartners[0]!.displayName)} confirms the wholesale terms.`,
      ].join("\n\n"),
      statusStrip: [{ metric: `Activation ${pct(journey.signups ? journey.activations / journey.signups : 0)}`, source: "conversions" }],
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
      createdDaysAgo: 3,
      state: "read",
    },
    {
      type: "decision",
      fromAgentId: chief.agent.id,
      subject: "Pause PR until the carton proof is final?",
      bodyMd: `${agentMention(agentEntities, squad.byTemplate.get("channel_pr")!)} has two pitches ready that show the new carton. The proof has one open correction. Pause PR for a week or send with the current render?`,
      decision: {
        options: [
          { id: "pause", label: "Pause PR for a week", recommended: true, consequence: "Pitches go out with the final carton.", cost_minor: 0, reversible: true },
          { id: "send", label: "Send now with the current render", recommended: false, consequence: "Coverage sooner; the render differs from the shipped carton.", cost_minor: 0, reversible: false },
        ],
        free_text: true,
        expires_at: null,
      },
      createdDaysAgo: 5,
      decided: { chosenOption: "pause", byKind: "user" },
    },
  ];
  const inboxSpecs = inboxDrafts.filter((s): s is InboxSpec => s !== null);
  const inbox = await seedInbox(ctx, businessId, inboxSpecs, CURRENCY);
  await repos.inbox.createHumanMessage(db, businessId, { fromUserId: ctx.owner.userId, subject: "Note to the lab", bodyMd: `Please keep the serum fragrance-free in every variant. ${mention(agentEntities.founder.id, DEMO_OWNER_DISPLAY_NAME)}`, entityIds: [agentEntities.founder.id] });
  // Mark the oldest sessions' agent entity as the customer-facing contact so search has an "agent" hit.
  await db.update(entitiesTable).set({ aliases: ["Chief of Staff", "CoS"] }).where(eq(entitiesTable.id, agentEntities.byAgentId.get(chief.agent.id)!.id));

  await repos.audit.append(db, businessId, {
    actorKind: "system",
    actorId: null,
    action: "seed.demo",
    target: { kind: "business", id: businessId },
    details: { app: APP_NAME, seed: ctx.seed, slug: NORTHWIND_SLUG, inboxItems: inbox.length, journeys: journey.counts.journeys, legalEntityId: legal.legalEntityId },
  });

  return {
    id: businessId,
    slug: NORTHWIND_SLUG,
    name: NORTHWIND_NAME,
    departmentIds: squad.departments.map((d) => d.id),
    agentIds: squad.agents.map((a) => a.agent.id),
    chiefOfStaffId: chief.agent.id,
    counts: { ...journey.counts, tasks: tasks.size + historical, inboxItems: inbox.length + 1, transactions: finance.transactions, suppliers: suppliers.length, retailPartners: retailPartners.length, sources: 3, proposals: 1, proposalHunks: proposal.hunks.length },
  };
}
