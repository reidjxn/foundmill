/**
 * The single list that drives the cross-tenant suite: every business-scoped table (business_id not null)
 * with a sample insert and its intended write posture.
 *
 *   member  → owner/admin/member may write (BUILD §7.1 default)
 *   admin   → only owner/admin may write
 *   service → app roles read only; rows are produced by services (service_role)
 *   append  → app roles may insert, never update/delete (audit_log, Team call turns and action items)
 *
 * Tables with a nullable business_id, user-owned tables, the social tables and `project_pages` (one row per business)
 * have their own suites.
 */
import { CHANNEL_KEYS } from "@foundmill/shared";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import * as s from "../../schema";
import type { BusinessFixture } from "./fixtures";

export type WriteMode = "member" | "admin" | "service" | "append";

export type TenantTable = PgTable & { id: AnyPgColumn; businessId: AnyPgColumn };

export interface TenantTableSpec {
  name: string;
  table: TenantTable;
  write: WriteMode;
  /** Insert values excluding business_id (the test adds it). Called once per insert; must produce unique rows. */
  sample: (f: BusinessFixture) => Record<string, unknown>;
  /** Update payload for the "can/cannot update" cases. Defaults to touching updated_at. */
  patch?: Record<string, unknown>;
}

const counter = (() => {
  let n = 0;
  return () => ++n;
})();
const uniq = (prefix: string) => `${prefix}-${counter()}-${crypto.randomUUID().slice(0, 8)}`;
const day = () => {
  const n = counter();
  return `2026-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 28)).padStart(2, "0")}`;
};
/** Pops one id from a fixture pool so unique-pair tables never collide across inserts. */
const take = (pool: string[], who: string): string => {
  const id = pool.pop();
  if (!id) throw new Error(`${who} sample: fixture pool exhausted`);
  return id;
};

const spec = <T extends TenantTable>(name: string, table: T, write: WriteMode, sample: TenantTableSpec["sample"], patch?: Record<string, unknown>): TenantTableSpec => ({
  name,
  table,
  write,
  sample,
  patch,
});

export const TENANT_TABLES: TenantTableSpec[] = [
  // 0003 product
  spec("spec_blocks", s.specBlocks, "member", () => ({ section: "vision", position: counter() })),
  spec("spec_versions", s.specVersions, "member", () => ({ version: counter() })),
  spec("change_proposals", s.changeProposals, "member", (f) => ({ title: uniq("proposal"), proposedByAgentId: f.agentId })),
  spec("roadmap_items", s.roadmapItems, "member", () => ({ title: uniq("item"), horizon: "later" })),
  spec("roadmap_dependencies", s.roadmapDependencies, "member", (f) => ({ fromItem: f.roadmapItemId, toItem: take(f.roadmapItemIds, "roadmap_dependencies") })),
  spec("proposal_hunks", s.proposalHunks, "member", (f) => ({ proposalId: f.proposalId, specBlockId: f.specBlockId, position: counter() })),
  spec("sources", s.sources, "member", () => ({ kind: "doc", title: uniq("source"), uri: "https://example.test/doc" })),
  // 0062 product sign-offs (one round per kind; the api decides as the user, services open rounds)
  spec("product_signoffs", s.productSignoffs, "member", () => ({ kind: "spec", round: 100 + counter() })),
  // 0072 goals (one proposal per revision; seeded as replaced so the one-proposed and one-active indexes never collide)
  spec("goals", s.goals, "member", () => ({ revision: 100 + counter(), sentence: uniq("Get the first 10 paying customers by Dec 19"), metricKind: "paying_customers", targetValue: 10, dueOn: "2026-12-19", status: "replaced" })),
  // 0074 the demo businesses' sample rows (written by the seed and the roll-forward with the service role; one row per table)
  spec("demo_sample_rows", s.demoSampleRows, "service", () => ({ tableName: uniq("tasks"), rowIds: [crypto.randomUUID()] })),
  // 0004 agents, departments, tasks
  spec("agents", s.agents, "member", () => ({ name: uniq("agent"), agentType: "engineer" })),
  spec("agent_versions", s.agentVersions, "member", (f) => ({ agentId: f.agentId, version: 100 + counter() })),
  spec("departments", s.departments, "admin", () => ({ name: uniq("dept"), slug: uniq("dept") })),
  spec("department_members", s.departmentMembers, "admin", (f) => ({ departmentId: f.departmentId, memberKind: "agent", memberId: crypto.randomUUID() })),
  spec("screen_definitions", s.screenDefinitions, "member", (f) => ({ departmentId: f.departmentId, tabSlug: uniq("tab"), title: "Tab" })),
  spec("agent_skills", s.agentSkills, "service", (f) => ({ agentId: f.agentId, skillKey: uniq("skill"), group: "craft", displayed: 10, potential: 15 })),
  spec("training_runs", s.trainingRuns, "member", (f) => ({ agentId: f.agentId, fromVersionId: f.agentVersionId })),
  spec("tasks", s.tasks, "member", (f) => ({ kind: "code", title: uniq("task"), assigneeAgentId: f.agent2Id, departmentId: f.departmentId })),
  spec("task_edges", s.taskEdges, "member", (f) => ({ fromTask: f.taskId, toTask: take(f.taskIds, "task_edges") })),
  spec("agent_sessions", s.agentSessions, "service", (f) => ({ agentId: f.agentId, versionId: f.agentVersionId, taskId: f.taskId })),
  spec("agent_metrics", s.agentMetrics, "service", (f) => ({ agentId: f.agent2Id, day: day(), tasksDone: 1 })),
  // 0015 verified App installations (written by the gateway)
  spec("app_installations", s.appInstallations, "service", () => ({ connectorKey: uniq("connector"), installationId: String(counter()), verifiedBy: "founder-login", verifiedAt: new Date("2026-10-09T00:00:00Z") })),
  // 0017 the business logo (written by the api with the service role after its checks; one row per business)
  spec("business_logos", s.businessLogos, "service", () => ({ source: "upload", mime: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), sha256: "0".repeat(64), width: 512, height: 512 })),
  // 0018 business foundations (one row per business; written by the api's service role and the orchestrator)
  spec("business_foundations", s.businessFoundations, "service", () => ({ door: "ideation", status: "pending" })),
  // 0063 product research: the plan row is service-written (one per business); its artifacts are the team's
  spec("product_research", s.productResearch, "service", () => ({ status: "pending" })),
  spec("research_artifacts", s.researchArtifacts, "member", (f) => ({ kind: "interview_plan", title: uniq("artifact"), createdByAgentId: f.agentId })),
  // 0013 workspaces (written by the orchestrator)
  spec("workspace_blobs", s.workspaceBlobs, "service", () => ({ sha256: crypto.randomUUID().replace(/-/g, "").padEnd(64, "0"), sizeBytes: 1, content: new Uint8Array([1]) })),
  spec("workspace_snapshots", s.workspaceSnapshots, "service", (f) => ({ taskId: f.taskId, files: [], fileCount: 0 })),
  spec("playbooks", s.playbooks, "member", (f) => ({ departmentId: f.departmentId, name: uniq("playbook"), sourceText: "When x do y" })),
  spec("holiday_periods", s.holidayPeriods, "admin", () => ({ untilAt: new Date("2026-12-24T00:00:00Z") })),
  // 0005 inbox
  spec("inbox_items", s.inboxItems, "member", (f) => ({ type: "update", subject: uniq("subject"), fromAgentId: f.agentId })),
  spec("plans", s.plans, "member", (f) => ({ origin: "free_text", inboxItemId: f.inboxItemId })),
  spec("decisions", s.decisions, "member", (f) => ({ inboxItemId: f.inboxItemId, chosenOption: "a", planId: f.planId })),
  spec("plan_actions", s.planActions, "member", (f) => ({ planId: f.planId, type: "reply_only", position: counter() })),
  spec("composer_buffer", s.composerBuffer, "service", () => ({ candidate: { subject: "x" }, sourceHash: uniq("hash") })),
  // 0006 distribution
  spec("channels", s.channels, "member", () => ({ channelKey: CHANNEL_KEYS[counter() % 14]!, line: "attack" })),
  spec("campaigns", s.campaigns, "member", (f) => ({ channelId: f.channelId, name: uniq("campaign") })),
  spec("assets", s.assets, "member", (f) => ({ campaignId: f.campaignId, kind: "email", title: uniq("asset") })),
  spec("channel_metrics", s.channelMetrics, "service", (f) => ({ channelId: f.channelId, campaignId: f.campaignId, day: day(), spendMinor: 100 })),
  // 0007 journey
  spec("visitors", s.visitors, "service", () => ({ anonId: uniq("anon") })),
  spec("touches", s.touches, "service", (f) => ({ visitorId: f.visitorId, channelKey: "seo", campaignId: f.campaignId })),
  spec("conversions", s.conversions, "service", (f) => ({ entityId: f.entityId, kind: "signup" })),
  spec("journeys", s.journeys, "service", (f) => {
    const conversionId = f.conversionIds.pop();
    if (!conversionId) throw new Error("journeys sample: out of fixture conversions");
    return { conversionId, matchdayLevel: "friendly" };
  }),
  spec("milestones", s.milestones, "member", () => ({ kind: "customer", label: uniq("milestone") })),
  // 0044 chapter titles (written by the composer with the service role)
  spec("chapter_titles", s.chapterTitles, "service", () => ({ chapterId: `${1000 + (counter() % 9000)}-Q${1 + (counter() % 4)}`, title: uniq("Chapter") })),
  // 0008 crm
  spec("entities", s.entities, "member", () => ({ kind: "person", displayName: uniq("Person"), identifiers: { email: `${uniq("p")}@x.test` } })),
  spec("entity_roles", s.entityRoles, "member", (f) => ({ entityId: f.entityId, role: "lead", stage: "new" })),
  spec("relationships", s.relationships, "member", (f) => ({ fromEntity: f.entityId, toEntity: f.entity2Id, type: uniq("works_at") })),
  spec("interactions", s.interactions, "member", (f) => ({ kind: "note", entityIds: [f.entityId], summary: "Spoke on the phone" })),
  spec("mentions", s.mentions, "member", (f) => ({ entityId: f.entityId, containerKind: "inbox_item", containerId: crypto.randomUUID() })),
  spec("field_provenance", s.fieldProvenance, "member", (f) => ({ entityId: f.entityId, field: "email", source: "import" })),
  spec("merge_log", s.mergeLog, "member", (f) => ({ keptId: f.entityId, mergedId: crypto.randomUUID() })),
  // 0079 what a contact agreed to (a follower of the public page): written by the api's service connection only
  spec("contact_consents", s.contactConsents, "service", (f) => ({ entityId: f.entityId, purpose: "email", source: "page", sourceRef: uniq("page"), consentText: "I agree to get email from Alpha about this project. I can unsubscribe at any time." })),
  // 0009 finance
  spec("accounts", s.accounts, "admin", () => ({ provider: "mock_bank", externalId: uniq("acct"), name: "Ops" })),
  spec("transactions", s.transactions, "member", (f) => ({ accountId: f.accountId, externalId: uniq("tx"), bookedAt: new Date(), amountMinor: -1200 })),
  spec("ledger_snapshots", s.ledgerSnapshots, "member", () => ({ period: uniq("2026-01"), basis: "cash" })),
  spec("forecasts", s.forecasts, "member", (f) => ({ scenario: "base", generatedByAgentId: f.agentId })),
  spec("securities", s.securities, "admin", () => ({ class: uniq("Series"), kind: "preferred" })),
  spec("cap_table_entries", s.capTableEntries, "admin", (f) => ({ holderEntityId: f.entityId, securityId: f.securityId, quantity: "1000" })),
  spec("usage_ledger", s.usageLedger, "service", (f) => ({ agentId: f.agentId, sessionId: f.sessionId, kind: "tokens", quantity: 500, costMinor: 3 })),
  spec("credit_balances", s.creditBalances, "service", () => ({ period: uniq("2026-02"), balanceMinor: 10000 })),
  // 0033 credit top-ups through Stripe Checkout (written by the api and the ingest webhook with the service role)
  spec("billing_checkouts", s.billingCheckouts, "service", () => ({ mode: "mock", amountMinor: 5000, currency: "USD" })),
  // 0053 saved session recordings (the orchestrator writes them with the service role when a session finishes)
  spec("session_recordings", s.sessionRecordings, "service", (f) => ({ sessionId: f.sessionId, events: [{ id: "1-0", event: { kind: "note", at: "2026-10-12T09:00:00.000Z", level: "info", source: "agent", text: "Started" } }], eventCount: 1, bytes: 90 })),
  // 0010 legal
  spec("legal_entities", s.legalEntities, "admin", () => ({ jurisdiction: "GB", entityType: "ltd", legalName: uniq("Legal") })),
  spec("incorporations", s.incorporations, "admin", (f) => ({ legalEntityId: f.legalEntityId, route: "kit" })),
  spec("filings", s.filings, "member", (f) => ({ legalEntityId: f.legalEntityId, kind: "confirmation_statement", dueAt: new Date() })),
  spec("contracts", s.contracts, "member", (f) => ({ counterpartyEntityId: f.entity2Id, kind: "supplier" })),
  spec("compliance_events", s.complianceEvents, "member", (f) => ({ legalEntityId: f.legalEntityId, kind: "vat_return", dueAt: new Date() })),
  // 0057 regulated-sector gates (Legal › Regulatory)
  spec("regulatory_gates", s.regulatoryGates, "member", () => ({ sector: uniq("sector"), applies: true, done: ["claims"] })),
  // 0011 integrations & governance (credentials has its own suite)
  spec("integrations", s.integrations, "admin", () => ({ connectorKey: uniq("connector") })),
  spec("webhooks", s.webhooks, "admin", (f) => ({ integrationId: f.integrationId, connectorKey: "stripe", endpointPath: uniq("/webhooks/stripe") })),
  spec("policies", s.policies, "admin", () => ({ scope: "business", cedarText: "permit(principal, action, resource);" })),
  spec("approvals", s.approvals, "member", (f) => ({ planActionId: f.planActionId, agentId: f.agentId, tool: "stripe.refund" })),
  spec("audit_log", s.auditLog, "append", () => ({ actorKind: "user", action: uniq("action") }), { details: { tampered: true } }),
  spec("events", s.events, "member", () => ({ type: "task.started", payload: { n: counter() } })),
  spec("outbox", s.outbox, "member", (f) => {
    const eventId = f.eventIds.pop();
    if (!eventId) throw new Error("outbox sample: out of fixture events");
    return { eventId };
  }),
  // 0020 founder ↔ agent conversations (the Inbox's access model: members write, viewers read)
  spec("agent_threads", s.agentThreads, "member", (f) => ({ agentId: f.agentId, subjectKind: "task", subjectId: crypto.randomUUID() })),
  spec("agent_messages", s.agentMessages, "member", (f) => ({ threadId: f.agentThreadId, authorKind: "agent", agentId: f.agentId, bubbles: [uniq("bubble")] })),
  // 0082 Team call (the desk's access model; turns and action items are insert-only for app roles; rls/team-calls.test.ts has the rest)
  spec("team_calls", s.teamCalls, "member", (f) => ({ kind: "one_to_one", agentIds: [f.agentId], startedBy: f.memberId, topic: uniq("topic") })),
  spec("team_call_turns", s.teamCallTurns, "append", (f) => ({ callId: f.teamCallId, seq: 1000 + counter(), speaker: "founder", userId: f.memberId, via: "typed", text: uniq("What is on our list?") }), { text: "tampered" }),
  spec("team_call_actions", s.teamCallActions, "append", (f) => ({ callId: f.teamCallId, position: 1000 + counter(), actionType: "create_task", title: uniq("Draft the launch email"), status: "not_filed", reason: "Example" }), { title: "tampered" }),
];

/**
 * 0094: the tables a collaborator does not read at all (their select policy is `is_member_not_collaborator`): the ones
 * only owners and admins write, and the Money tables services write, outside what a collaborator's screens use. The
 * generic suite checks a collaborator reads none of their rows and everyone else reads them as before.
 */
export const COLLABORATOR_CLOSED_TABLES: readonly string[] = ["accounts", "securities", "cap_table_entries", "usage_ledger", "credit_balances", "billing_checkouts", "legal_entities", "incorporations", "integrations", "webhooks", "policies", "app_installations"];
/**
 * Admin- or service-written tables a collaborator still reads, each for a screen of theirs (0094's header gives the
 * reasons). Named so a change to the list is a decision.
 */
export const COLLABORATOR_STILL_READS_ADMIN_TABLES: readonly string[] = ["departments", "department_members", "holiday_periods", "business_logos", "business_foundations", "product_research", "session_recordings", "contact_consents", "demo_sample_rows"];
/**
 * 0095: the Money and Legal tables members write. A collaborator neither reads nor writes them (select
 * `is_member_not_collaborator`, write `has_role(owner/admin/member) and is_member_not_collaborator`), while an owner, a
 * cofounder, an admin and a member write them as before and a viewer reads them.
 */
export const COLLABORATOR_CLOSED_MONEY_LEGAL: readonly string[] = ["transactions", "ledger_snapshots", "forecasts", "filings", "contracts", "compliance_events", "regulatory_gates"];

/** Keeps the catalogue honest: every spec must name the table its Drizzle object points at. */
export const expectedTableNames = () => TENANT_TABLES.map((t) => t.name);

// Kept for the schema-mirror test, which must know which tables deliberately sit outside this list.
export const NON_TENANT_TABLES = [
  "memberships",
  "businesses",
  "founder_profiles",
  "account_preferences",
  // 0074: a person's phones (user-owned, no business_id); covered by rls/founder-devices.test.ts.
  "founder_devices",
  // 0080: handles a person left, kept for them for 90 days (user-owned, service role only); rls/person-profiles.test.ts.
  "person_handle_releases",
  // 0085: a person's own events and their delivery queue (user-owned, no business_id; written by services only, the
  // queue service role only); covered by rls/account-events.test.ts.
  "account_events",
  "account_outbox",
  // 0086 the idea box (docs/IDEA_BOX.md): a signed-out visitor's card and the waitlist; the api's alone (no client
  // role, RLS on, no policy); covered by rls/idea-drafts.test.ts.
  "idea_drafts",
  "waitlist_entries",
  "ideas",
  "idea_versions",
  "idea_comparisons",
  "dashboard_layouts",
  "saved_table_views",
  "inbox_item_reads",
  "skill_definitions",
  "skill_tests",
  "suppression_list",
  "credentials",
  "connections",
  "message_threads",
  "messages",
  "communities",
  "community_members",
  "posts",
  "post_reports",
  "network_attestations",
  "negotiation_threads",
  // 0067: a platform asset (no business_id), service role only; covered by repos/personas.test.ts.
  "persona_portraits",
  // 0077: business-scoped, but one row per business (the generated suite inserts a second); covered by rls/project-pages.test.ts.
  "project_pages",
  // 0078: business-scoped, one row per business, written by services only; covered by rls/project-mail.test.ts.
  "project_mail",
  // 0078: a platform table (no business_id: the project it belonged to is gone), service role only; covered by rls/project-mail.test.ts.
  "retired_mail_local_parts",
  // 0083: one person's rows in one business (presence, visit days, founder emails); covered by rls/founder-return.test.ts.
  "founder_presence",
  "founder_visit_days",
  "founder_notifications",
  // 0088: who or what brought a new person (user-owned, service role only); rls/attributions.test.ts.
  "attributions",
  // 0091: admissions (user-owned, service role only) and invitations (business-scoped, but its token hash and address
  // are not readable by a client, so the generic suite cannot select them); both in rls/invitations.test.ts.
  "account_admissions",
  "invitations",
  // 0105: showcase requests (the house's, written by the service only) and consents (one founder's own row, read only
  // by that founder); both in rls/showcase.test.ts.
  "showcase_requests",
  "showcase_consents",
] as const;

