/**
 * Ledgerly (BUILD §17.2): a B2B SaaS club (month-end reconciliation for fintech operations teams), LIVE game mode,
 * Automated business mode and currently on holiday. A GitHub test repository reference, Stripe subscriptions as
 * payments, all 15 channels in mixed states, a cap table with common stock, an option pool and two post-money
 * SAFEs, a community, a leaderboard entry, and a coding squad with recorded sessions.
 */
import { getArchetypeSeed, getSkillDefinition } from "@foundmill/agents";
import { APP_NAME, CREDITS_CURRENCY, LIMITS } from "@foundmill/config";
import type { DecisionType, EventType } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { openApprovalItem } from "../approvals";
import { repos } from "../repos";
import { agentSessions, type Entity } from "../schema";
import { agentMention, seedAgentEntities, seedChannels, seedDashboards, seedHistoricalTasks, seedInbox, seedIntegrations, seedRoadmap, seedActiveGoal, seedSignedOffAndSelling, seedSpec, seedTasks, seededRelevance, type InboxSpec, type RoadmapSpec, type TaskSpec } from "./content";
import { ensureSeedCommunity, ensureSeedPost } from "./community";
import { BOOTSTRAPPED_COMMUNITY_SLUG, DEMO_OWNER_DISPLAY_NAME, DEMO_SEED_AUDIT_ACTION, LEDGERLY_BUSINESS_ID, LEDGERLY_COMMUNITY_SLUG, LEDGERLY_GITHUB_REPO, LEDGERLY_NAME, LEDGERLY_SLUG } from "./constants";
import { addDays, addHours, atHour, mention, money, pct, quarterFacts, quarterKey, type SeedCtx } from "./context";
import { recordSampleRows } from "./roll-forward";
import { seedFinance } from "./finance";
import { seedJourney } from "./journey";
import { seedLegal } from "./legal";
import { seedLedgerlyResearch } from "./research";
import { applyAgentStatuses, seedSquad } from "./squad";
import type { SeededBusiness } from "./types";

const CURRENCY = "GBP";

/** The vacation's grant and wake events (the holiday row and its `holiday.started` event carry the same lists). */
const HOLIDAY_AUTHORITY: DecisionType[] = ["spend_above_threshold", "publish_content", "merge_to_main", "message_customers"];
const HOLIDAY_WAKE_EVENTS: EventType[] = ["runway.threshold_crossed", "credential.expiring", "channel.threshold_breached", "filing.due", "agent.health_changed"];
/** The backend engineer's training run (old → new per skill) and the coach's summary. */
const TRAINING_RESULTS: Record<string, { old: number; new: number }> = { testing: { old: 12, new: 14 }, security_awareness: { old: 11, new: 13 }, api_design: { old: 13, new: 13 }, speed: { old: 12, new: 11 } };
const TRAINING_COACH_SUMMARY = "Tenancy tests now come first; speed dipped one point because of the extra test per route. Promote: the trade is right for a multi-tenant product.";

const SPEC_TEXT: Record<string, string[]> = {
  Problem: ["Operations teams at 20-200 person fintechs close the month by hand: exports from Stripe, the bank and the ledger are matched in spreadsheets, and unmatched lines wait for someone to notice."],
  Customers: ["Operations managers and finance leads at UK and US fintechs with 20-200 staff; the buyer is the head of operations, the user is the ops analyst."],
  "Value proposition": ["Close month-end in two days, not nine: Ledgerly matches payouts, invoices and bank lines automatically and routes exceptions to the right person with evidence."],
  Features: ["Stripe, bank and ledger sync; matching rules with explanations; exception queue with approvals by email; close checklist; audit trail export."],
  "Non-functional requirements": ["Every tenant isolated by row-level security; sync within five minutes; exports reproducible from stored evidence."],
  Data: ["Payouts, invoices, bank transactions, ledger journals, matching decisions, approvals; nothing moves money."],
  Integrations: ["Stripe, Xero, open banking (Tink), GitHub for the product, SendGrid for lifecycle email."],
  Pricing: ["£49 per seat per month; annual plans at ten months; enterprise from £12,000 per year with SSO and an audit export."],
  Metrics: ["MRR, net revenue retention, days to close per customer, exceptions resolved per analyst-hour."],
  Risks: ["Bank connection consent expiry; a ledger vendor changing its API; a large customer demanding on-premise deployment."],
};

const ROADMAP: RoadmapSpec[] = [
  { title: "Approval workflow (email approvals for CFOs)", horizon: "now", status: "in_progress", confidence: 4, startOffsetDays: -21, durationDays: 35, section: "Features", ownerDepartmentSlug: "development" },
  { title: "Xero sync v2 (journals and tracking categories)", horizon: "now", status: "in_progress", confidence: 3, startOffsetDays: -10, durationDays: 30, section: "Integrations", ownerDepartmentSlug: "development" },
  { title: "Audit trail export (CSV and PDF)", horizon: "next", status: "planned", confidence: 4, startOffsetDays: 14, durationDays: 21, section: "Features", ownerDepartmentSlug: "development" },
  { title: "Multi-currency matching", horizon: "next", status: "planned", confidence: 3, startOffsetDays: 30, durationDays: 45, section: "Features", ownerDepartmentSlug: "development" },
  { title: "US bank coverage through Plaid", horizon: "next", status: "planned", confidence: 3, startOffsetDays: 40, durationDays: 30, section: "Integrations", ownerDepartmentSlug: "development" },
  { title: "SSO and audit export for enterprise", horizon: "later", status: "planned", confidence: 2, startOffsetDays: 90, durationDays: 60, section: "Pricing", ownerDepartmentSlug: "development" },
  { title: "Close checklist templates by industry", horizon: "later", status: "idea", confidence: 2, startOffsetDays: 120, durationDays: 40, section: "Features", ownerDepartmentSlug: "product" },
  { title: "Partner program for accountants", horizon: "later", status: "idea", confidence: 1, startOffsetDays: 180, durationDays: 90, ownerDepartmentSlug: "distribution" },
];

const HISTORY_TITLES = [
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "backend_engineer", title: "Matching rule fix" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "frontend_engineer", title: "Exception queue polish" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "qa_engineer", title: "Regression suite extension" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "data_engineer", title: "Sync pipeline tuning" },
  { kind: "code" as const, departmentSlug: "development", assigneeTemplateKey: "infra_engineer", title: "Deploy pipeline change" },
  { kind: "channel" as const, departmentSlug: "distribution", assigneeTemplateKey: "channel_seo", title: "Month-end close article" },
  { kind: "channel" as const, departmentSlug: "distribution", assigneeTemplateKey: "channel_lead_generation", title: "Target customer sourcing" },
  { kind: "channel" as const, departmentSlug: "distribution", assigneeTemplateKey: "channel_email_automation", title: "Trial nurture iteration" },
  { kind: "research" as const, departmentSlug: "product", assigneeTemplateKey: "researcher", title: "Competitor pricing scan" },
  { kind: "finance" as const, departmentSlug: "finance", assigneeTemplateKey: "finance_lead", title: "Investor update draft" },
  { kind: "legal" as const, departmentSlug: "legal", assigneeTemplateKey: "legal_lead", title: "DPA review" },
  { kind: "ops" as const, departmentSlug: "team", assigneeTemplateKey: "chief_of_staff", title: "Cycle retrospective" },
];

export async function seedLedgerly(ctx: SeedCtx): Promise<SeededBusiness> {
  const { db } = ctx;
  const businessId = LEDGERLY_BUSINESS_ID;
  const archetype = getArchetypeSeed("b2b_saas");
  const log = (m: string) => ctx.log(`[${LEDGERLY_SLUG}] ${m}`);

  await repos.businesses.create(db, {
    id: businessId,
    name: LEDGERLY_NAME,
    slug: LEDGERLY_SLUG,
    gameMode: "live",
    businessMode: "automated",
    archetype: "b2b_saas",
    kitPrimary: "#1b4fd8",
    kitSecondary: "#f5c400",
    region: "eu",
    planTier: "scale",
    // On the platform's credits like Northwind: a seeded business on its own key would need a stored key, and none is
    // seeded (the demo must work out of the box and every Settings tab must tell the same story; audit BILL-05, MLSL-23).
    modelBilling: "credits",
    glossary: { customer: "account", win: "closed-won" },
    currency: CURRENCY,
    createdBy: ctx.owner.userId,
    // Synthetic numbers: LIVE for its own owners (the demo of the network), never listed for anyone else (0044).
    isDemo: true,
  });
  for (const owner of ctx.owners) await repos.memberships.add(db, businessId, { userId: owner.userId, role: "owner" });
  await repos.businesses.commit(db, businessId, { archetype: "b2b_saas", committedAt: ctx.startDate });

  // The archetype hires five channel agents; the founder later enabled GEO and paid search, so those engines were hired too.
  const squad = await seedSquad(ctx, businessId, archetype, {
    currency: CURRENCY,
    extraMembers: [
      { templateKey: "channel_geo", departmentSlug: "distribution" },
      { templateKey: "channel_paid_ads", departmentSlug: "distribution" },
    ],
  });
  await applyAgentStatuses(ctx, businessId, squad, {
    fallback: "healthy",
    byTemplate: { data_engineer: "injured", channel_pr: "degraded", channel_content: "healthy", docs_writer: "idle", moderation: "idle", triage: "healthy" },
  });
  log(`team: ${squad.agents.length} agents in ${squad.departments.length} departments`);

  const channels = await seedChannels(ctx, businessId, squad, CURRENCY, {
    enabled: ["lead_generation", "email_automation", "seo", "content", "pr", "geo", "paid_ads"],
    recommended: ["lead_generation", "email_automation", "seo", "content", "geo"],
    fit: { lead_generation: 18, email_automation: 16, seo: 16, content: 15, geo: 13, pr: 11, paid_ads: 10, events: 9, social: 8, affiliate: 7, influencer: 4, direct_mail: 5, print: 3, broadcast: 3, outdoor: 2 },
    budgetMinor: { lead_generation: 50_000, email_automation: 15_000, seo: 30_000, content: 40_000, pr: 10_000, geo: 5_000, paid_ads: 20_000 },
    kitMode: { print: true, broadcast: true, outdoor: true },
    why: {
      lead_generation: "Operations managers at 20-200 person fintechs are a narrow, reachable list; outbound with a lawful basis per country gives signal in weeks (Estimate).",
      geo: "Month-end questions are already asked of AI assistants; share-of-answer panels are labeled approximate.",
    },
  });

  const agentEntities = await seedAgentEntities(ctx, businessId, squad, DEMO_OWNER_DISPLAY_NAME);

  const journey = await seedJourney(ctx, {
    businessId,
    slug: LEDGERLY_SLUG,
    archetype: "b2b_saas",
    currency: CURRENCY,
    siteHost: "ledgerly.example",
    squad,
    departments: squad.departments,
    channels,
    customerSource: "stripe",
    visibility: "public",
  });

  // --- CRM: contacts at customer accounts, investors, co-founder, employee ------------------------------------------
  const topCustomers = [...journey.customersByEntityId.values()].filter((c) => c.paidAt && !c.churnedAt).sort((a, b) => (b.amountMinor ?? 0) - (a.amountMinor ?? 0)).slice(0, 4);
  const contactNames = ["Mina Ortiz", "Lior Jansen", "Dara Ekholm", "Sol Nakano"];
  const contacts: Entity[] = [];
  const outbound = squad.byTemplate.get("channel_lead_generation");
  for (const [i, c] of topCustomers.entries()) {
    const name = contactNames[i]!;
    const domain = (await repos.entities.get(db, businessId, c.entityId)).identifiers.domain ?? "customer.example";
    const person = await repos.entities.create(db, businessId, { kind: "person", displayName: name, aliases: [name.split(" ")[0]!], identifiers: { email: `${name.toLowerCase().replace(/ /g, ".")}@${domain}` }, lawfulBasis: "contract", source: "stripe", visibility: "public" });
    await repos.entities.addRole(db, businessId, person.id, { role: "champion", stage: i === 0 ? "cfo" : "ops_manager", ownerRef: outbound ? { kind: "agent", id: outbound.agent.id } : null });
    await repos.entities.upsertRelationship(db, businessId, { fromEntity: person.id, toEntity: c.entityId, type: "works_at", strength: 0.9 });
    await repos.entities.createInteraction(db, businessId, { kind: i % 2 ? "meeting" : "email", occurredAt: addDays(ctx.today, -ctx.rng.int(1, 30)), entityIds: [person.id, c.entityId], agentId: outbound?.agent.id ?? null, summary: i % 2 ? "Quarterly review: happy with the close time, asked about multi-currency." : "Replied to the renewal email; wants the audit export before year end.", direction: "inbound" });
    contacts.push(person);
  }
  const coFounder = await repos.entities.create(db, businessId, { kind: "team_member", displayName: "Priya Nandakumar", aliases: ["Priya"], identifiers: { email: "priya@ledgerly.example" }, source: "membership", visibility: "public" });
  await repos.entities.addRole(db, businessId, coFounder.id, { role: "co_founder", stage: "active" });
  const employee = await repos.entities.create(db, businessId, { kind: "team_member", displayName: "Tomas Weiss", aliases: ["Tomas"], identifiers: { email: "tomas@ledgerly.example" }, source: "membership", visibility: "private" });
  await repos.entities.addRole(db, businessId, employee.id, { role: "staff", stage: "solutions_engineer" });
  const investorA = await repos.entities.create(db, businessId, { kind: "organisation", displayName: "Harbor Angels Syndicate", identifiers: { domain: "harborangels.example" }, lawfulBasis: "contract", source: "cap_table", visibility: "private" });
  const investorB = await repos.entities.create(db, businessId, { kind: "organisation", displayName: "Beacon Ventures", identifiers: { domain: "beaconventures.example" }, lawfulBasis: "contract", source: "cap_table", visibility: "private" });
  for (const inv of [investorA, investorB]) await repos.entities.addRole(db, businessId, inv.id, { role: "investor", stage: "safe_holder" });
  await repos.entities.upsertRelationship(db, businessId, { fromEntity: coFounder.id, toEntity: agentEntities.founder.id, type: "co_founder_of", strength: 1 });
  await repos.entities.upsertRelationship(db, businessId, { fromEntity: investorB.id, toEntity: investorA.id, type: "co_invests_with", strength: 0.5 });

  // --- cap table (BUILD §11.8): common, option pool, two post-money SAFEs ------------------------------------------
  // The pool's unallocated 950,000 options stay authorized but unissued (authorized − issued is what is left to grant);
  // only grants to people are issuances. Vesting is the shared `VestingSchedule` shape.
  const formed = addDays(ctx.startDate, 5).toISOString().slice(0, 10);
  const ordinary = await repos.capTable.createSecurity(db, businessId, { class: "Ordinary", kind: "common", terms: { nominalMinor: 0, votes: 1, label: "Ordinary shares of £0.0001" }, authorisedQuantity: 10_000_000, currency: CURRENCY });
  const options = await repos.capTable.createSecurity(db, businessId, { class: "EMI option pool", kind: "option", terms: { poolPct: 10, defaultVesting: "4 years, 1-year cliff, monthly", scheme: "EMI" }, authorisedQuantity: 1_000_000, currency: CURRENCY });
  const safeA = await repos.capTable.createSecurity(db, businessId, { class: "SAFE 2025-A (post-money)", kind: "safe", terms: { postMoney: true, valuationCapMinor: 600_000_000, discountPct: 0, mfn: true, amountMinor: 25_000_000, label: "YC post-money SAFE, cap £6.0m" }, currency: CURRENCY });
  const safeB = await repos.capTable.createSecurity(db, businessId, { class: "SAFE 2026-B (post-money)", kind: "safe", terms: { postMoney: true, valuationCapMinor: 1_100_000_000, discountPct: 15, mfn: false, amountMinor: 40_000_000, label: "Post-money SAFE, cap £11.0m, 15% discount" }, currency: CURRENCY });
  await repos.capTable.createEntry(db, businessId, { holderEntityId: agentEntities.founder.id, securityId: ordinary.id, quantity: 6_000_000, priceMinor: 0, issuedAt: formed });
  await repos.capTable.createEntry(db, businessId, { holderEntityId: coFounder.id, securityId: ordinary.id, quantity: 2_000_000, priceMinor: 0, vesting: { months: 48, cliffMonths: 12, startDate: formed, acceleration: "double-trigger" }, issuedAt: formed });
  await repos.capTable.createEntry(db, businessId, { holderEntityId: employee.id, securityId: options.id, quantity: 50_000, priceMinor: 12, vesting: { months: 48, cliffMonths: 12, startDate: addDays(ctx.today, -200).toISOString().slice(0, 10) }, issuedAt: addDays(ctx.today, -200).toISOString().slice(0, 10) });
  const safeADate = addDays(ctx.startDate, Math.round(ctx.days * 0.27));
  const safeBDate = addDays(ctx.startDate, Math.round(ctx.days * 0.72));
  await repos.capTable.createEntry(db, businessId, { holderEntityId: investorA.id, securityId: safeA.id, quantity: 250_000, priceMinor: 100, issuedAt: safeADate.toISOString().slice(0, 10) });
  await repos.capTable.createEntry(db, businessId, { holderEntityId: investorB.id, securityId: safeB.id, quantity: 400_000, priceMinor: 100, issuedAt: safeBDate.toISOString().slice(0, 10) });

  // --- product -----------------------------------------------------------------------------------------------------------
  const { ids: specIds, versionId: specVersionId } = await seedSpec(ctx, businessId, archetype.specOutline, SPEC_TEXT, squad.byTemplate.get("product_lead")?.agent.id ?? null);
  // Signed off in the first days and selling since week three (founder, 2026-10-18): the channels keep running.
  await seedSignedOffAndSelling(ctx, businessId, specVersionId);
  await seedActiveGoal(ctx, businessId, squad.chief.agent.id);
  const roadmapIds = await seedRoadmap(ctx, businessId, ROADMAP, specIds, squad);
  // The Product Researcher's plan to test the specification with the ICP (Product › Research).
  const research = await seedLedgerlyResearch(ctx, businessId, squad, specIds);
  log(`research: ${research.artifacts} artifacts`);
  await repos.product.createSource(db, businessId, {
    kind: "doc",
    uri: `https://github.com/${LEDGERLY_GITHUB_REPO}`,
    title: `Repository ${LEDGERLY_GITHUB_REPO} (test repo, mock connector)`,
    relevance: seededRelevance(specIds, { summary: "The repository holds the approval workflow, the Xero sync and the matching rules the spec describes.", sections: [["Features", 0.97], ["Integrations", 0.83]], topics: ["approval workflow", "xero sync", "matching rules"], severity: "low", checkedAt: addHours(ctx.today, -3) }),
    fetchedAt: addHours(ctx.today, -3),
  });
  await repos.product.createSource(db, businessId, {
    kind: "issue",
    uri: `https://github.com/${LEDGERLY_GITHUB_REPO}/issues/142`,
    title: "#142 Invoice PDF 500 for customers with no address",
    relevance: seededRelevance(specIds, { summary: "Invoice PDFs fail for customers with no billing address; the spec does not say what an invoice shows without one.", sections: [["Features", 0.88], ["Data", 0.55]], topics: ["invoices", "bug"], checkedAt: addHours(ctx.today, -3) }),
    fetchedAt: addHours(ctx.today, -3),
  });
  await repos.product.createSource(db, businessId, {
    kind: "competitor",
    uri: "https://example.com/competitor-pricing",
    title: "Competitor pricing scan (two fixtures)",
    relevance: seededRelevance(specIds, {
      summary: "A competitor charges $29 and $79 per month and bundles email approvals for CFOs into every plan.",
      sections: [["Pricing", 0.7], ["Features", 0.46]],
      topics: ["pricing", "annual billing", "approvals"],
      checkedAt: addDays(ctx.today, -12),
      extra: { pricing: "Starter $29 per month; Growth $79 per month; annual billing saves two months", strengths: ["Email approvals in every plan", "Annual billing saves two months"], weaknesses: ["Multi-entity only on the higher plan"] },
    }),
    fetchedAt: addDays(ctx.today, -12),
  });

  // --- coding squad tasks with recorded sessions ---------------------------------------------------------------------
  const rec = (slug: string) => `recordings/ledgerly/${slug}.jsonl`;
  const taskSpecs: TaskSpec[] = [
    { kind: "code", title: "Approval workflow: email approvals", goal: "CFOs approve exceptions from an email with a signed one-click link; every approval is audited.", acceptance: ["Signed links expire in 48 hours", "Approval recorded with actor and evidence", "Playwright test for the email flow"], status: "running", departmentSlug: "development", assigneeTemplateKey: "backend_engineer", roadmapTitle: "Approval workflow (email approvals for CFOs)", startedDaysAgo: 0, durationHours: 3.5, progress: 0.6, phase: "testing", fileScope: ["apps/api/approvals/**", "packages/mail/**"], recordingRef: rec("approval-workflow-email") },
    { kind: "code", title: "Approval queue screen", goal: "Exception queue with approve/reject and the evidence panel.", acceptance: ["Keyboard navigable", "Storybook story", "Matches the design tokens"], status: "review", departmentSlug: "development", assigneeTemplateKey: "frontend_engineer", roadmapTitle: "Approval workflow (email approvals for CFOs)", startedDaysAgo: 1, durationHours: 4, phase: "review", fileScope: ["apps/web/queue/**"], recordingRef: rec("approval-queue-screen") },
    { kind: "code", title: "Review: approval workflow PR #318", goal: "Review the approval workflow change for correctness, tenancy and tests.", acceptance: ["Findings with file and line", "Tenancy test present"], status: "running", departmentSlug: "development", assigneeTemplateKey: "review_agent", roadmapTitle: "Approval workflow (email approvals for CFOs)", startedDaysAgo: 0, durationHours: 1, progress: 0.4, phase: "review", recordingRef: rec("review-pr-318") },
    { kind: "code", title: "Xero journals sync", goal: "Pull journals and tracking categories from the Xero demo company and store them as ledger lines.", acceptance: ["Incremental sync by modified-since", "Contract test against fixtures"], status: "blocked", departmentSlug: "development", assigneeTemplateKey: "integration_agent", roadmapTitle: "Xero sync v2 (journals and tracking categories)", startedDaysAgo: 2, durationHours: 2, phase: "implementing", recordingRef: rec("xero-journals-sync") },
    { kind: "code", title: "Fix invoice PDF 500 for customers with no address", goal: "Invoices for customers without a billing address render with a placeholder instead of failing.", acceptance: ["Regression test", "No change to invoices with an address"], status: "merging", departmentSlug: "development", assigneeTemplateKey: "backend_engineer", startedDaysAgo: 1, durationHours: 1.5, phase: "merge", recordingRef: rec("invoice-pdf-500") },
    { kind: "code", title: "Regression suite for matching rules", goal: "Golden fixtures for the twelve matching rules.", acceptance: ["Every rule has a fixture", "Runs under 60 seconds"], status: "done", departmentSlug: "development", assigneeTemplateKey: "qa_engineer", startedDaysAgo: 2, durationHours: 2.5, recordingRef: rec("matching-regression-suite") },
    { kind: "code", title: "Sync pipeline backfill job", goal: "Backfill 90 days of payouts for new accounts without blocking the live sync.", acceptance: ["Backfill runs in a separate queue"], status: "stopped", departmentSlug: "development", assigneeTemplateKey: "data_engineer", startedDaysAgo: 3, durationHours: 1, recordingRef: rec("backfill-job") },
    { kind: "code", title: "Plan: audit trail export", goal: "Task graph for CSV and PDF export of the audit trail with acceptance tests.", acceptance: ["Tasks under four hours", "No shared file scopes"], status: "ready", departmentSlug: "development", assigneeTemplateKey: "planner", roadmapTitle: "Audit trail export (CSV and PDF)" },
    { kind: "code", title: "Deploy preview environments per PR", goal: "Each PR gets a preview environment with seeded mock data.", acceptance: ["Preview URL in the PR", "Torn down on merge"], status: "planned", departmentSlug: "development", assigneeTemplateKey: "infra_engineer" },
    { kind: "channel", title: "Month-end close checklist (SEO brief + article)", goal: "Brief and draft the 'month-end close checklist' article for the keyword cluster.", acceptance: ["Brief with target queries", "Draft under 1,800 words", "Founder approves anything in their name"], status: "done", departmentSlug: "distribution", assigneeTemplateKey: "channel_seo", startedDaysAgo: 2, durationHours: 2 },
    { kind: "channel", title: "Outbound to target customers, batch 14", goal: "Source, verify and score 60 contacts; exclude personal addresses and suppressed contacts.", acceptance: ["Lawful basis per country", "Suppression respected"], status: "running", departmentSlug: "distribution", assigneeTemplateKey: "channel_lead_generation", startedDaysAgo: 0, durationHours: 2, progress: 0.7 },
    { kind: "finance", title: "Q3 investor update", goal: "Draft the Q3 update with real numbers, labels and the asks.", acceptance: ["Every number cites a record", "Asks listed"], status: "review", departmentSlug: "finance", assigneeTemplateKey: "finance_lead", startedDaysAgo: 1, durationHours: 1.5 },
    { kind: "legal", title: "Renew ICO data protection fee", goal: "Prepare the renewal for the founder to pay (payment is a founder action).", acceptance: ["Amount and deadline stated", "No payment made"], status: "ready", departmentSlug: "legal", assigneeTemplateKey: "legal_lead" },
    { kind: "ops", title: "Vacation daily digest", goal: "Summarize the day's decisions taken under the vacation authority.", acceptance: ["Every decision cites its reason"], status: "done", departmentSlug: "team", assigneeTemplateKey: "chief_of_staff", startedDaysAgo: 1, durationHours: 0.5 },
  ];
  const tasks = await seedTasks(ctx, businessId, taskSpecs, squad, roadmapIds, CURRENCY);
  const historical = await seedHistoricalTasks(ctx, businessId, squad, HISTORY_TITLES, 140, CURRENCY);
  log(`tasks: ${tasks.size} current + ${historical} historical`);

  // --- training: the backend engineer was trained and promoted to version 2 ------------------------------------------
  const backend = squad.byTemplate.get("backend_engineer")!;
  const v1 = backend.versionId;
  const v2 = await repos.agents.createVersion(db, businessId, backend.agent.id, {
    instructions: { ...backend.template.instructions, rules: [...backend.template.instructions.rules, "Write the tenancy test before the handler; a route without a cross-tenant test is not done."] },
    tools: backend.template.tools,
    modelKey: backend.template.modelKey,
    state: "live",
    createdByKind: "agent",
    createdBy: squad.byTemplate.get("engineering_lead")?.agent.id ?? null,
  });
  const run = await repos.training.create(db, businessId, { agentId: backend.agent.id, fromVersionId: v1, toVersionId: v2.id, status: "awaiting_decision", costMinor: 1_850, currency: CREDITS_CURRENCY, requestedBy: ctx.owner.userId });
  await repos.training.update(db, businessId, run.id, {
    status: "awaiting_decision",
    results: TRAINING_RESULTS,
    coachSummaryMd: TRAINING_COACH_SUMMARY,
  });
  await repos.training.decide(db, businessId, run.id, "promoted", { watchUntil: addDays(ctx.today, 7) });
  await repos.skills.upsertForAgent(db, businessId, backend.agent.id, [
    { skillKey: "testing", group: "craft", tested: 14, proven: 13.2, nLive: 9, displayed: 14, potential: 16 },
    { skillKey: "security_awareness", group: "craft", tested: 13, proven: null, nLive: 0, displayed: 13, potential: 15 },
  ]);
  backend.versionId = v2.id;

  // --- holiday (Automated mode, BUILD §9.6): started three days ago, back in eleven --------------------------------
  const holiday = await repos.holidays.start(db, businessId, {
    untilAt: addDays(ctx.today, 11),
    authority: {
      decisionTypes: HOLIDAY_AUTHORITY,
      maxSpendPerDecisionMinor: 50_000,
      neverDoes: ["sign_contracts", "hire_agents", "change_models"],
      label: "Chief of Staff decides within this grant; everything else queues for the founder",
    },
    budgetCeilingMinor: 250_000,
    currency: CURRENCY,
    wakeEvents: HOLIDAY_WAKE_EVENTS,
    startedBy: ctx.owner.userId,
    startedAt: addDays(ctx.today, -3),
  });

  // --- integrations, finance, legal -------------------------------------------------------------------------------------
  const integrationIds = await seedIntegrations(ctx, businessId, [
    { connectorKey: "github", authKind: "app", accountLabel: LEDGERLY_GITHUB_REPO, scopes: ["contents:read", "pull_requests:write", "issues:read"], settings: { repo: LEDGERLY_GITHUB_REPO, defaultBranch: "main", installationId: "mock-installation", writeEnabled: true } },
    { connectorKey: "stripe", authKind: "api_key", accountLabel: "acct_ledgerly_test", scopes: ["customers:read", "invoices:read", "subscriptions:read"], settings: { livemode: false } },
    { connectorKey: "sendgrid", authKind: "api_key", accountLabel: "mail.ledgerly.example", scopes: ["mail.send", "marketing.campaigns"], settings: { sendingDomain: "mail.ledgerly.example", dmarc: "p=reject" } },
    { connectorKey: "tink", authKind: "oauth", accountLabel: "Ledgerly Ltd current account", scopes: ["accounts:read", "transactions:read"] },
    { connectorKey: "notion", authKind: "oauth", accountLabel: "Ledgerly workspace", scopes: ["read"], status: "degraded" },
  ]);
  const finance = await seedFinance(ctx, {
    businessId,
    slug: LEDGERLY_SLUG,
    currency: CURRENCY,
    provider: "tink",
    accountName: "Ledgerly Ltd current account",
    integrationId: integrationIds.get("tink") ?? null,
    consentExpiresAt: addDays(ctx.today, 6),
    payoutCounterparty: "Stripe",
    payoutCategory: "revenue",
    revenueByMonth: journey.revenueByMonth,
    agentSpendByMonth: journey.agentSpendByMonth,
    adSpendByMonth: journey.adSpendByMonth,
    cogsRate: 0,
    supplierNames: [],
    fixedCosts: [
      { counterparty: "Cloud hosting", category: "hosting", amountMinor: 64_000, cadence: "monthly", description: "Compute, database, object storage" },
      { counterparty: "Xero", category: "software", amountMinor: 3_000, cadence: "monthly" },
      { counterparty: "Notion", category: "software", amountMinor: 6_400, cadence: "monthly" },
      { counterparty: "Quist Accountants", category: "professional_fees", amountMinor: 60_000, cadence: "quarterly", description: "Quarterly accounts, VAT and R&D claim", day: 18 },
      { counterparty: "Hiscox", category: "insurance", amountMinor: 140_000, cadence: "yearly", description: "D&O and professional indemnity", day: 9 },
      { counterparty: "Tomas Weiss (payroll)", category: "payroll", amountMinor: 520_000, cadence: "monthly", description: "Solutions engineer salary", day: 25 },
    ],
    financing: [
      { at: atHour(safeADate, 11), counterparty: investorA.displayName, amountMinor: 25_000_000, description: "SAFE 2025-A subscription", category: "financing", counterpartyEntityId: investorA.id },
      { at: atHour(safeBDate, 11), counterparty: investorB.displayName, amountMinor: 40_000_000, description: "SAFE 2026-B subscription", category: "financing", counterpartyEntityId: investorB.id },
    ],
    financeLeadAgentId: squad.byTemplate.get("finance_lead")?.agent.id ?? null,
    recentSessions: journey.recentSessions,
    modelBilling: "credits",
  });
  const legal = await seedLegal(ctx, businessId, {
    legalName: "Ledgerly Ltd",
    jurisdiction: "GB",
    entityType: "private_limited_company",
    regNo: "15106734",
    registeredAddress: { line1: "71 Beacon Lane", city: "London", postcode: "EC2A 4NE", country: "GB" },
    officers: [
      { name: DEMO_OWNER_DISPLAY_NAME, role: "Director", appointedAt: formed },
      { name: "Priya Nandakumar", role: "Director", appointedAt: formed },
    ],
    // 8,000,000 ordinary shares of £0.0001 nominal.
    shareCapitalMinor: 80_000,
    currency: CURRENCY,
    formedDaysAgo: ctx.days - 5,
    incorporationRoute: "companies_house_web",
    filings: [
      { kind: "confirmation_statement", title: "Confirmation statement (CS01)", dueInDays: 73, status: "upcoming" },
      { kind: "annual_accounts", title: "Annual accounts (small company)", dueInDays: 150, status: "upcoming" },
      { kind: "vat_return", title: "VAT return Q3", dueInDays: 21, status: "upcoming" },
      { kind: "emi_notification", title: "EMI option grant notification (Tomas Weiss)", dueInDays: -170, status: "filed", ref: "EMI-2026-01" },
      { kind: "sh01", title: "SH01 return of allotment (SAFE conversion placeholder)", dueInDays: 400, status: "waived" },
    ],
    compliance: [
      { kind: "ico_fee", title: "ICO data protection fee renewal", dueInDays: 16, recurrence: "yearly" },
      { kind: "rd_tax_credit", title: "R&D tax credit claim", dueInDays: 120, recurrence: "yearly" },
      { kind: "safe_side_letter", title: "Information rights report to SAFE holders", dueInDays: 30, recurrence: "quarterly" },
      { kind: "soc2_readiness", title: "SOC 2 readiness review", dueInDays: 90 },
    ],
    contracts: [
      { kind: "customer_msa", title: `Master services agreement - ${topCustomers[0] ? journey.customersByEntityId.get(topCustomers[0].entityId)!.displayName : "enterprise account"}`, status: "active", counterpartyEntityId: topCustomers[0]?.entityId ?? null, valueMinor: topCustomers[0]?.amountMinor ?? 1_200_000, signedDaysAgo: 120, obligations: ["99.9% uptime", "Audit export on request"] },
      { kind: "safe", title: "SAFE 2025-A - Harbor Angels Syndicate", status: "signed", counterpartyEntityId: investorA.id, valueMinor: 25_000_000, signedDaysAgo: ctx.days - Math.round(ctx.days * 0.27) },
      { kind: "safe", title: "SAFE 2026-B - Beacon Ventures", status: "signed", counterpartyEntityId: investorB.id, valueMinor: 40_000_000, signedDaysAgo: ctx.days - Math.round(ctx.days * 0.72) },
      { kind: "dpa", title: "Data processing agreement - cloud hosting", status: "active", signedDaysAgo: 300 },
      { kind: "customer_msa", title: `Master services agreement - ${topCustomers[1] ? journey.customersByEntityId.get(topCustomers[1].entityId)!.displayName : "second account"}`, status: "awaiting_signature", counterpartyEntityId: topCustomers[1]?.entityId ?? null, valueMinor: 1_200_000 },
    ],
  });

  await repos.policies.create(db, businessId, {
    scope: "business",
    name: "Automated mode: vacation authority",
    cedarText: `// During a vacation the Chief of Staff may approve spend up to the per-decision cap; contracts and hires always ask.\n@outcome("ask")\npermit(principal, action == Action::"call", resource) when { context.capability == "sign_contract" || context.capability == "hire_agent" };`,
    createdBy: ctx.owner.userId,
  });
  await repos.playbooks.create(db, businessId, {
    departmentId: squad.departmentBySlug.get("distribution")?.id ?? null,
    name: "Trial-ending nudge",
    sourceText: "When a trial has three days left and the account has not connected Stripe, send the 'connect Stripe' how-to from the lifecycle agent and tell lead generation to book a call if the account fits the target customer.",
    compiled: { trigger: { event: "activation.reached", condition: "trial_days_left == 3 && !stripe_connected" }, steps: [{ action: { type: "send_message", params: { template: "connect-stripe-howto" } }, label: "Send the connect Stripe how-to" }, { action: { type: "create_task", params: { kind: "channel", title: "Book a call" } }, label: "Ask lead generation to book a call" }], approvals: [], stop: { event: "payment.received" } },
    enabled: true,
    createdBy: ctx.owner.userId,
  });

  // A pending approval raised during the holiday (spend above the per-decision cap queues for the founder).
  const paidAds = squad.byTemplate.get("channel_paid_ads");
  const plan = await repos.plans.create(db, businessId, {
    origin: "holiday",
    summaryMd: "Raise the search campaign budget for the month-end close keyword cluster (above the vacation per-decision cap).",
    status: "executing",
    actions: [
      { type: "set_budget", params: { channelKey: "paid_ads", budgetMinor: 60_000 }, agentId: paidAds?.agent.id ?? null, policyOutcome: "ask", status: "awaiting_approval" },
      { type: "create_task", params: { kind: "channel", title: "Refresh search ad copy" }, agentId: paidAds?.agent.id ?? null, policyOutcome: "allow", status: "pending" },
    ],
  });
  const pendingAction = plan.actions[0]!;
  const pendingApproval = await repos.approvals.create(db, businessId, {
    planActionId: pendingAction.id,
    agentId: paidAds?.agent.id ?? null,
    connectorKey: "platform",
    tool: "set_budget",
    args: { channelKey: "paid_ads", budgetMinor: 60_000, currency: CURRENCY },
    reasons: ["spend above the vacation per-decision cap (£500.00)", "assisted-caps rule"],
    amountMinor: 60_000,
    currency: CURRENCY,
  });
  // The founder answers it in the Inbox, like every approval (audit FR-01): Approve or Reject on its decision item.
  if (paidAds) await openApprovalItem(db, businessId, pendingApproval, { agentId: paidAds.agent.id, agentName: paidAds.agent.name, taskTitle: null, argsSummary: "Raise the paid search budget to £600.00 for the month-end close keyword cluster" });

  // --- social: community and leaderboard (LIVE) ----------------------------------------------------------------------
  // Public communities real founders join: a rebuild adopts them (members and posts stay) instead of recreating them.
  const community = await ensureSeedCommunity(db, { name: "Fintech ops founders", slug: LEDGERLY_COMMUNITY_SLUG, descriptionMd: "Founders selling to operations teams at fintechs. Benchmarks are shared as verified metrics only.", ownerBusinessId: businessId, createdBy: ctx.owner.userId });
  const outboundPost = await ensureSeedPost(db, { communityId: community.id, authorUserId: ctx.owner.userId, businessId, bodyMd: "We moved first-touch to outbound for UK fintechs and the time to first reply halved. Lawful basis per country is the whole game." });
  await ensureSeedPost(db, { communityId: community.id, authorUserId: ctx.owner.userId, businessId, parentPostId: outboundPost.id, bodyMd: "Follow-up: the same pattern held for Irish fintechs in September, with a slightly longer legitimate-interest review." });
  await ensureSeedPost(db, { communityId: community.id, authorUserId: ctx.owner.userId, businessId, bodyMd: "Question for the room: does anyone run share-of-answer panels for AI assistants and treat them as more than approximate?" });
  // A second public community the demo founder has not joined (no creator): the demo founder sees Join on offer.
  await ensureSeedCommunity(db, { name: "Bootstrapped founders", slug: BOOTSTRAPPED_COMMUNITY_SLUG, descriptionMd: "Founders building without outside funding. Share what you tried, what it cost and what it returned." });
  // data: customers won since the quarter began (first payments), and MRR growth since the day before it began.
  const quarter = quarterFacts(ctx, journey.data.meta.startDate, journey.data.series.mrrMinorByDay);
  const wonThisQuarter = (await repos.journeys.countConversions(db, businessId, { from: quarter.startsAt })).payment;
  const board = await repos.social.upsertLeaderboard(db, { boardKind: "growth", division: "b2b_saas", period: quarterKey(ctx.today), metric: "mrr_growth_pct", archetype: "b2b_saas", region: "eu" });
  await repos.social.setLeaderboardEntries(db, board.id, [{ businessId, metricValue: quarter.mrrGrowthPct, verified: true, form: "WWDLW" }]);
  const customersBoard = await repos.social.upsertLeaderboard(db, { boardKind: "customers_won", division: "b2b_saas", period: quarterKey(ctx.today), metric: "customers_won", archetype: "b2b_saas", region: "eu" });
  await repos.social.setLeaderboardEntries(db, customersBoard.id, [{ businessId, metricValue: wonThisQuarter, verified: true, form: "WLWWW" }]);

  await seedDashboards(ctx, businessId);

  // --- events the inbox cites -----------------------------------------------------------------------------------------
  const dataEngineer = squad.byTemplate.get("data_engineer")!;
  // Written straight to the events table (no outbox validation on this path), so each payload is built to its
  // catalogue schema here; seed-on-boot.test.ts checks every seeded event against packages/events (audit #432).
  const evHealth = await repos.events.write(db, businessId, {
    type: "agent.health_changed",
    actor: { kind: "system", id: "health" },
    entityIds: [],
    payload: {
      agentId: dataEngineer.agent.id,
      from: "healthy",
      to: "injured",
      reason: "GitHub rate limit hit twice in a row on the backfill job; back when the limit resets",
      signals: { heartbeatAgeMs: null, errorRate: null, loopDetected: false, credentialExpired: false, rateLimited: true, budgetRemaining: null },
      expectedReturnAt: addDays(ctx.today, 1).toISOString(),
      sessionId: null,
    },
    occurredAt: addDays(ctx.today, -1),
  });
  const evHoliday = await repos.events.write(db, businessId, {
    type: "holiday.started",
    actor: { kind: "user", id: ctx.owner.userId },
    entityIds: [],
    payload: {
      holidayId: holiday.id,
      workflowId: `holiday:${holiday.id}`,
      untilAt: holiday.untilAt?.toISOString() ?? null,
      untilCondition: null,
      budgetCeiling: holiday.budgetCeilingMinor === null ? null : { amountMinor: Number(holiday.budgetCeilingMinor), currency: CURRENCY },
      authority: HOLIDAY_AUTHORITY,
      wakeEvents: HOLIDAY_WAKE_EVENTS,
      cadenceAgentHours: LIMITS.cycleTimeBoxAgentHours,
    },
    occurredAt: addDays(ctx.today, -3),
  });
  const tinkIntegrationId = integrationIds.get("tink")!;
  const evCred = await repos.events.write(db, businessId, {
    type: "credential.expiring",
    actor: { kind: "system", id: "credentials" },
    entityIds: [],
    // An open-banking consent: the integration stands for the credential (as the nightly consent scan reports it).
    payload: { integrationId: tinkIntegrationId, credentialId: tinkIntegrationId, connectorKey: "tink", accountLabel: "Ledgerly Ltd current account", expiresAt: addDays(ctx.today, 6).toISOString(), daysRemaining: 6, affectedAgentIds: [], expired: false },
    occurredAt: addHours(ctx.today, -5),
  });
  const evTraining = await repos.events.write(db, businessId, {
    type: "training.completed",
    actor: { kind: "agent", id: squad.byTemplate.get("engineering_lead")?.agent.id ?? backend.agent.id },
    entityIds: [],
    payload: {
      trainingRunId: run.id,
      agentId: backend.agent.id,
      fromVersionId: v1 ?? v2.id,
      toVersionId: v2.id,
      status: "succeeded",
      cost: { amountMinor: 1_850, currency: CURRENCY },
      durationMs: 38 * 60_000,
      testsRun: 24,
      skillDeltas: Object.entries(TRAINING_RESULTS).map(([skillKey, r]) => ({ skillKey, group: getSkillDefinition(skillKey)?.group ?? "craft", before: r.old, after: r.new })),
      coachSummary: TRAINING_COACH_SUMMARY,
      recommendation: "promote",
    },
    occurredAt: addDays(ctx.today, -2),
  });
  await repos.events.markNarrated(db, businessId, [evHealth.id, evHoliday.id, evTraining.id]);

  // --- inbox -----------------------------------------------------------------------------------------------------------------
  const chief = squad.chief;
  const latest = journey.latestPayments[0];
  const won = latest ? mention(latest.customer.entityId, latest.customer.displayName) : "a new account";
  const trophy = journey.data.milestones.filter((m) => m.trophyKey).at(-1);
  const inboxDrafts: Array<InboxSpec | null> = [
    {
      type: "report",
      fromAgentId: chief.agent.id,
      subject: "Vacation report: day 3",
      bodyMd: [
        `You are away for 11 more days. Within the authority grant I took two decisions today and queued one.`,
        `Decided: published the month-end close checklist article by ${agentMention(agentEntities, squad.byTemplate.get("channel_seo")!)} (publish_content; reason: founder-approved outline, no claims in your name); merged the invoice PDF fix by ${agentMention(agentEntities, backend)} after ${agentMention(agentEntities, squad.byTemplate.get("review_agent")!)} cleared it (merge_to_main).`,
        `Queued for you: the paid search budget increase to ${money(60_000, CURRENCY)} per month is above the per-decision cap. Spend so far this vacation: ${money(32_400, CURRENCY)} of the ${money(250_000, CURRENCY)} ceiling (Estimate).`,
        `${agentMention(agentEntities, dataEngineer)} is down (GitHub rate limit hit on the backfill job); expected back tomorrow. MRR ${money(journey.mrrMinorNow, CURRENCY)} (synthetic).`,
      ].join("\n\n"),
      statusStrip: [
        { metric: `MRR ${money(journey.mrrMinorNow, CURRENCY)}`, source: "conversions" },
        { metric: `Runway ${finance.runwayMonths ?? "n/a"} mo (Estimate)`, source: "forecasts" },
        { metric: `Vacation spend ${money(32_400, CURRENCY)}`, source: "usage_ledger" },
      ],
      exhibit: { kind: "table", spec_ref: "tasks_by_status" },
      sourceEventIds: [evHoliday.id],
      createdDaysAgo: 0,
      costMinor: 310,
    },
    {
      type: "decision",
      fromAgentId: chief.agent.id,
      subject: "Raise the search budget above the vacation cap?",
      bodyMd: [
        `${agentMention(agentEntities, paidAds!)} wants to raise the month-end close search campaign to ${money(60_000, CURRENCY)} per month: cost per customer over the last 14 days is ${money(4_100, CURRENCY)} (Estimate), under the ${money(6_000, CURRENCY)} cap.`,
        "This is above my per-decision authority, so it waits for you. Nothing is spent until you decide.",
      ].join("\n\n"),
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
      decision: {
        options: [
          { id: "approve", label: `Approve ${money(60_000, CURRENCY)} per month`, recommended: true, consequence: "Engine raises the daily cap tomorrow; pauses if cost per customer exceeds the cap for 48 hours.", cost_minor: 60_000, reversible: true },
          { id: "half", label: `Approve ${money(40_000, CURRENCY)} per month`, recommended: false, consequence: "Smaller test, slower signal.", cost_minor: 40_000, reversible: true },
          { id: "decline", label: "Keep the current budget", recommended: false, consequence: "No change; outbound and SEO carry the quarter.", cost_minor: 0, reversible: true },
        ],
        free_text: true,
        expires_at: addDays(ctx.today, 11).toISOString(),
      },
      createdDaysAgo: 0,
      costMinor: 220,
    },
    latest
      ? {
          type: "customer_won",
          fromAgentId: outbound?.agent.id ?? chief.agent.id,
          subject: `${latest.customer.displayName.slice(0, 44)} subscribed`,
          bodyMd: [
            `${won} started a ${money(latest.conversion.amountMinor, CURRENCY)} per month subscription through Stripe${latest.customer.enterprise ? " (annual enterprise contract)" : ""}.`,
            `${agentMention(agentEntities, outbound!)} booked the discovery call; ${agentMention(agentEntities, squad.byTemplate.get("channel_email_automation")!)} ran the trial sequence. Open the Customer Update for the full journey (attribution weights are an Estimate).`,
          ].join("\n\n"),
          statusStrip: [{ metric: `Paying accounts ${journey.paidCustomers}`, source: "conversions" }],
          exhibit: { kind: "chart", spec_ref: "conversions_30d" },
          sourceEventIds: latest.eventId ? [latest.eventId] : [],
          entityIds: [latest.customer.entityId],
          createdDaysAgo: 0,
        }
      : null,
    {
      type: "warning",
      fromAgentId: squad.byTemplate.get("finance_lead")?.agent.id ?? chief.agent.id,
      subject: "Bank consent expires in six days",
      bodyMd: [
        `The open-banking consent for the Ledgerly Ltd current account lapses in six days. Reconnecting is a founder action; ${agentMention(agentEntities, squad.byTemplate.get("finance_lead")!)} will pause cash reporting rather than show stale numbers.`,
        `Cash ${money(finance.balanceMinor, CURRENCY)}, net burn ${money(finance.netBurnMinor, CURRENCY)} per month, runway ${finance.runwayMonths ?? "n/a"} months (Estimate, cash basis).`,
      ].join("\n\n"),
      statusStrip: [{ metric: "Consent lapses in 6 days", source: "accounts" }],
      exhibit: { kind: "chart", spec_ref: "runway_forecast" },
      sourceEventIds: [evCred.id],
      createdDaysAgo: 0,
    },
    {
      type: "update",
      fromAgentId: squad.byTemplate.get("engineering_lead")?.agent.id ?? chief.agent.id,
      subject: "PR #318 approval workflow: tests passing, review in progress",
      bodyMd: [
        `${agentMention(agentEntities, backend)} has the signed approval links passing in the sandbox (recording available). ${agentMention(agentEntities, squad.byTemplate.get("review_agent")!)} is reviewing tenancy and the expiry window.`,
        `${agentMention(agentEntities, squad.byTemplate.get("frontend_engineer")!)} finished the queue screen and handed it to review. Xero journals sync is blocked on a fixture from the vendor.`,
      ].join("\n\n"),
      exhibit: { kind: "table", spec_ref: "roadmap_status" },
      createdDaysAgo: 1,
    },
    trophy
      ? {
          type: "milestone",
          fromAgentId: chief.agent.id,
          subject: `Milestone: ${trophy.label}`,
          bodyMd: `${trophy.label} reached (synthetic demo data). ${journey.paidCustomers} paying accounts; MRR ${money(journey.mrrMinorNow, CURRENCY)}. Standout agent: ${agentMention(agentEntities, outbound!)}, most first touches this quarter.`,
          createdDaysAgo: 2,
          state: "read",
        }
      : null,
    {
      type: "decision",
      fromAgentId: chief.agent.id,
      subject: "Publish the month-end close article?",
      bodyMd: `${agentMention(agentEntities, squad.byTemplate.get("channel_seo")!)} drafted the article from the approved brief; no claims in your name. Publishing is inside the vacation authority, so I decided: publish.`,
      decision: {
        options: [
          { id: "publish", label: "Publish now", recommended: true, consequence: "Article goes live; internal links added by SEO.", cost_minor: 0, reversible: true },
          { id: "hold", label: "Hold for the founder", recommended: false, consequence: "Waits eleven days.", cost_minor: 0, reversible: true },
        ],
        free_text: false,
        expires_at: null,
      },
      createdDaysAgo: 1,
      decided: { chosenOption: "publish", byKind: "chief_of_staff" },
    },
    {
      type: "update",
      fromAgentId: squad.byTemplate.get("engineering_lead")?.agent.id ?? chief.agent.id,
      subject: "Training: backend engineer promoted to v2",
      bodyMd: `${agentMention(agentEntities, backend)} was trained on tenancy-first testing: Testing 12 → 14, Security awareness 11 → 13, Speed 12 → 11. Promoted; watching for a week.`,
      sourceEventIds: [evTraining.id],
      exhibit: { kind: "agent_tile", spec_ref: "tasks_by_status" },
      createdDaysAgo: 2,
      state: "read",
    },
  ];
  const inboxSpecs = inboxDrafts.filter((s): s is InboxSpec => s !== null);
  const inbox = await seedInbox(ctx, businessId, inboxSpecs, CURRENCY);
  const report = inbox[0];
  if (report) await repos.holidays.setReport(db, businessId, holiday.id, report.id);
  await repos.inbox.createHumanMessage(db, businessId, { fromUserId: ctx.owner.userId, subject: "Away until the 18th", bodyMd: `Back on the 18th. ${mention(coFounder.id, "Priya")} can be reached for anything legal. ${mention(agentEntities.founder.id, DEMO_OWNER_DISPLAY_NAME)}`, entityIds: [coFounder.id, agentEntities.founder.id] });

  // Mark the recorded sessions of the running tasks as live (open) with the holiday workflow id.
  for (const [title, t] of tasks) {
    if (t.task.status !== "running") continue;
    for (const sessionId of t.sessionIds) await db.update(agentSessions).set({ workflowId: `holiday:${holiday.id}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}` }).where(eq(agentSessions.id, sessionId));
  }

  // Every row written so far is the sample's own: the only rows the roll-forward ever moves (roll-forward.ts).
  await recordSampleRows(db, businessId);
  // The build's last write: seed-on-boot reads it as "this business was built completely" (demoSeedState).
  await repos.audit.append(db, businessId, {
    actorKind: "system",
    actorId: null,
    action: DEMO_SEED_AUDIT_ACTION,
    target: { kind: "business", id: businessId },
    details: { app: APP_NAME, seed: ctx.seed, anchor: ctx.today.toISOString(), slug: LEDGERLY_SLUG, inboxItems: inbox.length, journeys: journey.counts.journeys, holidayId: holiday.id, legalEntityId: legal.legalEntityId, communityId: community.id, leaderboardId: board.id, activation: pct(journey.signups ? journey.activations / journey.signups : 0) },
  });

  return {
    id: businessId,
    slug: LEDGERLY_SLUG,
    name: LEDGERLY_NAME,
    departmentIds: squad.departments.map((d) => d.id),
    agentIds: squad.agents.map((a) => a.agent.id),
    chiefOfStaffId: chief.agent.id,
    counts: { ...journey.counts, tasks: tasks.size + historical, inboxItems: inbox.length + 1, transactions: finance.transactions, contacts: contacts.length, capTableEntries: 6 },
  };
}
