/**
 * The portable archive's reader (Settings › Danger zone "Export everything", BUILD §11.15; routers business.export).
 *
 * Every business-scoped table is classified here once: exported (with the section of the product it belongs to, so a
 * member walled off a section never exports it, and the columns kept back) or left out (with the reason the archive
 * states). `__tests__/repos/portability.test.ts` fails when a table with a `business_id` column is in neither list, so
 * a new table can never be silently missing from the export again. Rows are read in id order, page by page, until the
 * table is exhausted (`nextAfter: null`); nothing here stops at a row count.
 */
import { and, asc, eq, getTableColumns, getTableName, gt, is, ne, type AnyColumn, type SQL } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as s from "../schema";
import type { Executor } from "./_shared";

/** The product sections a table belongs to (apps/api `SECTIONS` minus LIVE, which is never exported). */
export const EXPORT_SECTIONS = ["product", "development", "distribution", "finance", "team", "legal", "inbox", "crm", "settings", "billing"] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

type BusinessTable = PgTable & { id: AnyColumn; businessId: AnyColumn };

export interface ExportTableSpec {
  table: BusinessTable;
  section: ExportSection;
  /** Columns (schema property names) never written to the archive. */
  omit?: readonly string[];
  /** When set, only these columns are written (connector plumbing: what is connected, never how). */
  pick?: readonly string[];
  /** When set, only the rows this condition keeps are written (the business's own rows, never someone else's walk-through). */
  rows?: SQL;
}

const t = (table: PgTable, section: ExportSection, columns: { omit?: readonly string[]; pick?: readonly string[]; rows?: SQL } = {}): ExportTableSpec => ({ table: table as BusinessTable, section, ...columns });

/** Exported tables by their SQL name (the archive's keys), grouped by section. */
export const EXPORT_TABLES: Readonly<Record<string, ExportTableSpec>> = {
  // product
  business_foundations: t(s.businessFoundations, "product"),
  spec_blocks: t(s.specBlocks, "product"),
  spec_versions: t(s.specVersions, "product"),
  product_signoffs: t(s.productSignoffs, "product"),
  goals: t(s.goals, "product"),
  project_pages: t(s.projectPages, "product"),
  change_proposals: t(s.changeProposals, "product"),
  proposal_hunks: t(s.proposalHunks, "product"),
  roadmap_items: t(s.roadmapItems, "product"),
  roadmap_dependencies: t(s.roadmapDependencies, "product"),
  sources: t(s.sources, "product"),
  product_research: t(s.productResearch, "product"),
  research_artifacts: t(s.researchArtifacts, "product"),
  ideas: t(s.ideas, "product"),
  idea_versions: t(s.ideaVersions, "product"),
  idea_comparisons: t(s.ideaComparisons, "product"),
  // development
  tasks: t(s.tasks, "development"),
  task_edges: t(s.taskEdges, "development"),
  agent_sessions: t(s.agentSessions, "development"),
  // team
  departments: t(s.departments, "team"),
  department_members: t(s.departmentMembers, "team"),
  agents: t(s.agents, "team"),
  agent_versions: t(s.agentVersions, "team"),
  agent_skills: t(s.agentSkills, "team"),
  skill_definitions: t(s.skillDefinitions, "team"),
  skill_tests: t(s.skillTests, "team"),
  training_runs: t(s.trainingRuns, "team"),
  agent_metrics: t(s.agentMetrics, "team"),
  playbooks: t(s.playbooks, "team"),
  agent_threads: t(s.agentThreads, "team"),
  agent_messages: t(s.agentMessages, "team"),
  team_calls: t(s.teamCalls, "team"),
  team_call_turns: t(s.teamCallTurns, "team"),
  team_call_actions: t(s.teamCallActions, "team"),
  // distribution (channels, campaigns and the customer journey)
  channels: t(s.channels, "distribution"),
  campaigns: t(s.campaigns, "distribution"),
  assets: t(s.assets, "distribution"),
  channel_metrics: t(s.channelMetrics, "distribution"),
  suppression_list: t(s.suppressionList, "distribution"),
  visitors: t(s.visitors, "distribution"),
  touches: t(s.touches, "distribution"),
  conversions: t(s.conversions, "distribution"),
  journeys: t(s.journeys, "distribution"),
  chapter_titles: t(s.chapterTitles, "distribution"),
  milestones: t(s.milestones, "distribution"),
  // crm
  entities: t(s.entities, "crm"),
  entity_roles: t(s.entityRoles, "crm"),
  relationships: t(s.relationships, "crm"),
  interactions: t(s.interactions, "crm"),
  mentions: t(s.mentions, "crm"),
  field_provenance: t(s.fieldProvenance, "crm"),
  contact_consents: t(s.contactConsents, "crm"),
  merge_log: t(s.mergeLog, "crm"),
  // finance
  accounts: t(s.accounts, "finance", { omit: ["externalId"] }),
  transactions: t(s.transactions, "finance"),
  ledger_snapshots: t(s.ledgerSnapshots, "finance"),
  forecasts: t(s.forecasts, "finance"),
  securities: t(s.securities, "finance"),
  cap_table_entries: t(s.capTableEntries, "finance"),
  // billing
  usage_ledger: t(s.usageLedger, "billing"),
  credit_balances: t(s.creditBalances, "billing"),
  // Credit top-ups: what was bought and when. The Stripe session and its payment page stay out (provider plumbing).
  billing_checkouts: t(s.billingCheckouts, "billing", { omit: ["externalId", "checkoutUrl", "paidEventId"] }),
  // Bought credits by purchase: how much is left of each and when it expires (0098).
  credit_lots: t(s.creditLots, "billing"),
  // legal
  legal_entities: t(s.legalEntities, "legal"),
  incorporations: t(s.incorporations, "legal"),
  filings: t(s.filings, "legal"),
  contracts: t(s.contracts, "legal"),
  compliance_events: t(s.complianceEvents, "legal"),
  regulatory_gates: t(s.regulatoryGates, "legal"),
  // inbox
  inbox_items: t(s.inboxItems, "inbox"),
  inbox_item_reads: t(s.inboxItemReads, "inbox"),
  plans: t(s.plans, "inbox"),
  plan_actions: t(s.planActions, "inbox"),
  decisions: t(s.decisions, "inbox"),
  approvals: t(s.approvals, "inbox"),
  // settings
  // An example membership (0065, `source = 'example'`) is a visitor's read-only walk around a demo business, not a
  // seat of this business, so it never travels in the business's archive.
  memberships: t(s.memberships, "settings", { pick: ["id", "userId", "role", "createdAt"], rows: ne(s.memberships.source, "example") }),
  integrations: t(s.integrations, "settings", { pick: ["id", "connectorKey", "status", "authKind", "scopes", "accountLabel", "lastHealthAt", "lastError", "createdAt", "updatedAt"] }),
  project_mail: t(s.projectMail, "settings", { pick: ["id", "localPart", "status", "dailyCap", "createdAt"] }),
  // The founders' postal address for marketing email (0101): the business's own, so it travels with it.
  project_postal_addresses: t(s.projectPostalAddresses, "settings", { pick: ["id", "address", "createdAt", "updatedAt"] }),
  app_installations: t(s.appInstallations, "settings", { pick: ["id", "connectorKey", "accountLabel", "verifiedAt", "createdAt"] }),
  policies: t(s.policies, "settings"),
  holiday_periods: t(s.holidayPeriods, "settings"),
  screen_definitions: t(s.screenDefinitions, "settings"),
  dashboard_layouts: t(s.dashboardLayouts, "settings"),
  saved_table_views: t(s.savedTableViews, "settings"),
  business_logos: t(s.businessLogos, "settings"),
  audit_log: t(s.auditLog, "settings"),
};

/** Business-scoped tables left out of the archive, with the reason the archive states. */
export const EXPORT_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  credentials: "Credentials and connector tokens are never exported (ciphertext or plaintext).",
  webhooks: "Webhook endpoints and their secret references are connector plumbing, not business data.",
  events: "The internal event log; the audit log and the Inbox in this archive record what happened.",
  outbox: "The event delivery queue (internal).",
  founder_presence: "When each person was last in the business: one person's own activity, not business data.",
  founder_visit_days: "The days each person opened the business: one person's own activity, not business data.",
  founder_notifications: "The emails sent to each founder: one person's own mail, readable only by them in Settings.",
  invitations: "Links to join the project: their token hashes and the addresses they were sent to are not the business's data to carry elsewhere; the People in the archive are who joined.",
  founder_departures: "When a founder's standing ended and who ended it, kept so a founder demoted or removed by someone else can still hear about and cancel a deletion; the People in the archive are who is in the project now.",
  founder_cancel_links: "One-click links that cancel a deletion request, kept as token hashes for the emails that carry them: not the business's data to carry elsewhere.",
  composer_buffer: "Inbox notes waiting to be written (internal queue).",
  workspace_blobs: "Sandbox file snapshots; the code reaches your repository through pushes.",
  workspace_snapshots: "Sandbox file snapshots; the code reaches your repository through pushes.",
  session_recordings: "Replay copies of agent session streams (kept so a session can be replayed after its stream expires); the sessions themselves are exported.",
  posts: "LIVE network posts belong to the network, not to the business.",
  community_members: "LIVE network memberships belong to the network, not to the business.",
  demo_sample_rows: "Which rows of a sample business are the sample's own (internal to the sample's roll-forward).",
};

/** One row as it is written to the archive: dates as ISO strings, bytes as base64, everything else as stored. */
export type PortableRow = Record<string, unknown>;

/** JSON-safe copy of a stored value (Date → ISO string, bytes → `{ encoding: "base64", data }`). */
export function portableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { encoding: "base64", data: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(portableValue);
  return value;
}

export const portabilityRepo = {
  /**
   * One page of an exported table for the business, in id order after `after` (exclusive). `nextAfter` is the id to
   * pass back for the next page, null once the table is exhausted. Unknown or excluded tables are refused.
   */
  async page(db: Executor, businessId: string, tableName: string, options: { after?: string | null; limit?: number } = {}): Promise<{ rows: PortableRow[]; nextAfter: string | null }> {
    const spec = EXPORT_TABLES[tableName];
    if (!spec) throw new Error(`table ${tableName} is not exported`);
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 5000);
    const rows = (await db
      .select()
      .from(spec.table)
      .where(and(eq(spec.table.businessId, businessId), spec.rows, options.after ? gt(spec.table.id, options.after) : undefined))
      .orderBy(asc(spec.table.id))
      .limit(limit + 1)) as Record<string, unknown>[];
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const keep = (key: string) => (spec.pick ? spec.pick.includes(key) : !spec.omit?.includes(key));
    return {
      rows: page.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => keep(k)).map(([k, v]) => [k, portableValue(v)]))),
      nextAfter: more ? String(page.at(-1)!.id) : null,
    };
  },

  /** Every table of the schema with a `business_id` column (what the classification must cover). */
  businessScopedTables(): string[] {
    const tables: PgTable[] = [];
    for (const value of Object.values(s) as unknown[]) if (is(value, PgTable)) tables.push(value);
    return tables
      .filter((table) => "businessId" in getTableColumns(table))
      .map((table) => getTableName(table))
      .sort();
  },
};
