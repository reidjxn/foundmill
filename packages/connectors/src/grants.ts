/**
 * Agent tool grants → the tools that serve them (BUILD §9.3; audit GPC-03). Agent templates (packages/agents) grant
 * capabilities in their own vocabulary ("repos.read", "mail.send", "tasks.list"); connectors serve tools by name
 * ("read_tree", "send_mail", "list_tasks"). This file is the one place that maps one onto the other, connector by
 * connector, and `resolveGrants` is what the orchestrator mints session tokens and configures MCP servers from.
 *
 * A grant names either a capability from the maps below, a connector's real tool name (what the Tools tab saves), or `*`.
 * Every capability a template grants on a connector this repo serves resolves to at least one real tool, or is listed in
 * NOT_YET_SERVED with the reason; connectors that do not exist yet (later phases) get no MCP server at all. The contract
 * test in apps/orchestrator holds every template to this.
 */
import { anthropicTools } from "./connectors/anthropic/tools";
import { bolagsverketTools } from "./connectors/bolagsverket/tools";
import { cloudflareTools } from "./connectors/cloudflare_dns/tools";
import { companiesHouseTools } from "./connectors/companies_house/tools";
import { domainsTools } from "./connectors/domains/tools";
import { dropboxSignTools } from "./connectors/dropbox_sign/tools";
import { ecbTools } from "./connectors/ecb_rates/tools";
import { githubTools } from "./connectors/github/tools";
import { gmailTools } from "./connectors/gmail/tools";
import { googleCalendarTools } from "./connectors/google_calendar/tools";
import { googleDriveTools } from "./connectors/google_drive/tools";
import { notionTools } from "./connectors/notion/tools";
import { opencorporatesTools } from "./connectors/opencorporates/tools";
import { plaidTools } from "./connectors/plaid/tools";
import { platformTools } from "./connectors/platform/tools";
import { quarantineTools } from "./connectors/quarantine";
import { sendgridTools } from "./connectors/sendgrid/tools";
import { shopifyTools } from "./connectors/shopify/tools";
import { stripeTools } from "./connectors/stripe/tools";
import { tinkTools } from "./connectors/tink/tools";
import { voyageTools } from "./connectors/voyage/tools";
import { openaiImagesTools } from "./connectors/openai_images/tools";
import { webTools } from "./connectors/web/tools";
import { e2bTools } from "./connectors/e2b/tools";

const names = (tools: readonly { name: string }[]) => Object.freeze(tools.map((t) => t.name));

/** Every tool the gateway serves, by connector: the registry's connectors plus the built-ins (platform, web, quarantine). */
export const GATEWAY_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  anthropic: names(anthropicTools),
  voyage: names(voyageTools),
  openai_images: names(openaiImagesTools),
  github: names(githubTools),
  google_drive: names(googleDriveTools),
  gmail: names(gmailTools),
  google_calendar: names(googleCalendarTools),
  notion: names(notionTools),
  cloudflare_dns: names(cloudflareTools),
  opencorporates: names(opencorporatesTools),
  bolagsverket: names(bolagsverketTools),
  domains: names(domainsTools),
  companies_house: names(companiesHouseTools),
  e2b: names(e2bTools),
  dropbox_sign: names(dropboxSignTools),
  ecb_rates: names(ecbTools),
  stripe: names(stripeTools),
  sendgrid: names(sendgridTools),
  shopify: names(shopifyTools),
  tink: names(tinkTools),
  plaid: names(plaidTools),
  platform: names(platformTools),
  web: names(webTools),
  quarantine: names(quarantineTools),
});

const bankingCapabilities = { "accounts.list": ["list_accounts", "get_consent_status"], "transactions.list": ["list_transactions", "sync"] };

/** Capability → tools, per connector served through the gateway. */
export const CAPABILITY_TOOLS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  anthropic: { "panel.query": ["ask_panel"] },
  github: {
    // download_archive is served on the gateway's archive route (a code session's checkout), never in an agent's MCP list.
    "repos.read": ["list_repos", "read_tree", "read_file", "download_archive"],
    "pulls.list": ["list_pull_requests"],
    "pulls.read": ["list_pull_requests", "get_pull_request"],
    // A pull request reports its merge state (get_pull_request); get_checks reads the check runs of an agent's branch head.
    "checks.read": ["get_pull_request", "get_checks"],
    "actions.read": ["get_checks"],
    // Starts the CI workflow on an agent/ branch (the founder's push settings still apply). Granted to the QA engineer and the engineering lead.
    "checks.run": ["run_checks"],
    "pulls.create": ["create_branch", "commit_files", "open_pr"],
    "pulls.update": ["commit_files"],
    "pulls.review": ["get_pull_request", "read_file"],
    "pulls.merge": ["merge_pr"],
  },
  gmail: { "drafts.create": ["create_draft"], "threads.read": ["list_messages", "get_message", "list_labels"] },
  google_calendar: { "events.list": ["list_calendars", "list_events", "get_event", "find_free_slots"], "events.create": ["create_event", "update_event", "find_free_slots"] },
  google_drive: { "files.list": ["search_files", "get_file"], "files.read": ["get_file", "export_text", "read_doc"], "files.write": ["create_doc", "append_to_doc"] },
  notion: { "pages.search": ["search", "query_data_source"], "pages.read": ["get_page", "get_page_content", "query_data_source"], "pages.write": ["create_page", "append_paragraphs"] },
  opencorporates: { "companies.search": ["search_companies", "get_company"] },
  companies_house: { "companies.search": ["search_companies"], "companies.read": ["get_company"], "officers.list": ["list_officers"] },
  // Bolagsverket looks companies up by organization number.
  bolagsverket: { "companies.search": ["get_organisation"], "companies.read": ["get_organisation", "list_documents"] },
  // Sending asks the founder in assisted mode (a contract tool); signing itself is a hard gate.
  dropbox_sign: { "requests.prepare": ["list_signature_requests", "get_signature_request", "send_signature_request"] },
  ecb_rates: { "rates.latest": ["get_daily_rates", "convert"] },
  stripe: {
    "balance.read": ["get_balance", "get_account", "list_payouts"],
    "charges.list": ["list_charges"],
    // A charge reports how much of it was refunded.
    "refunds.list": ["list_charges"],
    "invoices.list": ["list_invoices", "get_invoice"],
  },
  sendgrid: {
    "mail.send": ["send_mail", "list_verified_senders", "check_suppression"],
    "campaigns.create": ["create_campaign", "list_campaigns", "list_verified_senders"],
    "campaigns.schedule": ["schedule_campaign", "list_campaigns"],
    "stats.read": ["get_stats"],
    "suppressions.read": ["check_suppression"],
  },
  shopify: { "orders.list": ["list_orders", "get_order", "get_shop"], "draft_orders.create": ["create_draft_order", "list_products", "list_customers"] },
  tink: bankingCapabilities,
  plaid: bankingCapabilities,
  platform: {
    "tasks.list": ["list_tasks", "get_task"],
    "tasks.history": ["list_tasks", "get_task"],
    "merge_queue.read": ["list_tasks", "get_task"],
    "tasks.create": ["create_task"],
    "tasks.claim": ["claim_task"],
    "tasks.assign": ["assign_task"],
    "tasks.reprioritise": ["assign_task"],
    "sessions.reassign": ["assign_task", "list_sessions"],
    "tasks.block": ["block_task"],
    "tasks.handoff": ["handoff_task"],
    "tasks.complete": ["complete_task"],
    "messages.request": ["send_message", "list_messages"],
    "messages.inform": ["send_message", "list_messages"],
    "messages.review": ["send_message", "list_messages"],
    "sessions.shout": ["send_message"],
    "inbox.request_human_action": ["request_human_action"],
    // Offline tracking: the agent prepares, the founder submits (BUILD §2.3).
    "kit.create_founder_task": ["request_human_action"],
    "assets.request_approval": ["request_human_action"],
    "memory.search": ["search_entities"],
    "crm.entities.search": ["search_entities"],
    "entities.manifest.read": ["search_entities"],
    "business.mode.read": ["read_business"],
    "holiday.read_authority": ["read_business"],
    "budgets.read": ["read_business", "read_finance"],
    "approvals.list": ["list_approvals"],
    "sessions.list": ["list_sessions"],
    "suppression.check": ["check_contact"],
    "consent.check": ["check_contact"],
    "spec.read": ["read_product"],
    "roadmap.read": ["read_product"],
    "sources.list": ["read_product"],
    "sources.read": ["read_product"],
    "spec.propose": ["propose_spec_change"],
    "finance.metrics": ["read_finance"],
    "finance.transactions": ["read_finance"],
    // The categories the business's money is booked to, with their totals.
    "finance.chart_of_accounts.read": ["read_finance"],
    "legal.entity.read": ["read_legal"],
    "legal.compliance.calendar": ["read_legal"],
    "legal.contracts.list": ["read_legal"],
    "campaigns.list": ["read_distribution"],
  },
  web: { search: ["search_web"], fetch: ["fetch_page"] },
  quarantine: { read_untrusted: ["read_untrusted"] },
};

/**
 * Capabilities the Claude Agent SDK serves inside the session's own workspace with its built-in tools (no gateway server):
 * code tasks get the file tools (apps/orchestrator sdk-isolation.ts decides by task kind).
 */
export const SDK_BUILTIN_CAPABILITIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  sandbox: { read_file: ["Read", "Glob", "Grep"], write_file: ["Edit", "Write"] },
};

/**
 * Capabilities the host performs or supplies for the agent, so no tool is granted for them (what happens instead): the
 * session runtime saves and pushes a code task's workspace, and a utility (Tools: none) is handed its inputs in the call.
 */
export const SESSION_MANAGED_CAPABILITIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sandbox: {
    "git.commit": "the workspace is saved when the session ends and committed to agent/<taskId> (github.commit_files)",
    "git.push_branch": "the saved workspace is pushed to agent/<taskId> on the repository chosen on Development › Code",
  },
  platform: {
    "labels.read": "the classifier is handed the label set with each input",
    "routing.table.read": "the inbound sorter is handed the routing table with each item",
    "inbound.recent.read": "the inbound sorter is handed the recent items to check for duplicates",
    "policy.content.read": "moderation is handed the content policy with each item",
  },
};

/**
 * Capabilities a template grants on a served connector that no tool serves yet, and why. Pinned by the contract test so
 * a new gap is a deliberate entry here, never a silent one.
 */
export const NOT_YET_SERVED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  github: { "issues.list": "no Issues tool on the GitHub connector yet", "branches.list": "no branch listing tool yet (read_tree reads one ref)" },
  dropbox_sign: { "templates.list": "no template tool on the Dropbox Sign connector yet" },
  stripe: { "subscriptions.list": "no subscription tool on the Stripe connector yet" },
  sendgrid: { "subusers.read": "subusers are not modeled", "inbound.read": "inbound mail arrives as pushed events, not a tool" },
  shopify: { "payouts.list": "no Shopify Payments tool yet", "discounts.create": "no discount tool on the Shopify connector yet" },
  sandbox: {
    shell: "no shell in a live session: Bash is disallowed on the orchestrator host (SECURITY_REVIEW SEC-3)",
    run_tests: "tests cannot run in a live session without a shell (SEC-3)",
    playwright: "no browser in a live session without a shell (SEC-3)",
  },
  platform: Object.fromEntries(
    [
      "plans.compile", "cycles.read", "spec.publish", "roadmap.update", "sessions.pause", "sessions.resume", "channels.score", "channels.enable", "channels.disable", "channels.set_budget",
      "campaigns.results", "attribution.read", "benchmarks.read", "finance.categorise", "finance.forecast", "finance.rules.read", "cap_table.read", "cap_table.propose",
      "legal.contracts.review", "legal.policies.generate", "incorporation.prepare", "crm.entities.create", "crm.interactions.append", "documents.read", "documents.write",
      "costing.model.read", "costing.model.update", "campaigns.create", "campaigns.update", "campaigns.pause", "assets.create", "attribution.links.create", "attribution.codes.create",
      "rfq.create", "rfq.track", "quotes.record", "samples.track",
    ].map((c) => [c, "no platform tool for this yet: the agent asks its lead (send_message) or hands it to the founder"]),
  ),
};

/**
 * Connectors only the platform itself calls, from a service route of the gateway (never an agent session): `openai_images`
 * makes the faces of anthropomorphic agents on the platform key (`POST /v1/personas/portrait`). A grant on one resolves to
 * nothing, the gateway refuses it on `/v1/call` and `/mcp/:connector` whatever a session token says, and the api neither
 * lists it in Settings › Integrations nor connects it for a business.
 */
export const SERVICE_ONLY_CONNECTORS: ReadonlySet<string> = new Set(["openai_images"]);

/** Why a grant on a service-only connector resolves to nothing (`ResolvedGrants.unresolved`). */
export const SERVICE_ONLY_REASON = "the platform calls this connector itself; agents never do";

export function isServiceOnlyConnector(connectorKey: string): boolean {
  return SERVICE_ONLY_CONNECTORS.has(connectorKey);
}

export interface ToolGrantLike {
  connectorKey: string;
  tools: readonly string[];
}

export interface UnresolvedGrant {
  connectorKey: string;
  capability: string;
  reason: string;
}

export interface ResolvedGrants {
  /** `connector:tool` (or `connector:*`) refs for the gateway session token. */
  toolRefs: string[];
  /** Connectors the gateway serves for this session: one MCP server each, never one the gateway would 404. */
  servers: string[];
  /** MCP tool names the SDK may call (`mcp__<connector>__<tool>`, `mcp__<connector>` for a wildcard). */
  mcpTools: string[];
  /** Built-in SDK tools the grants ask for (the session's tool policy decides which a task kind gets). */
  builtinTools: string[];
  /** Grants nothing serves (a connector of a later phase, a capability in NOT_YET_SERVED, or a service-only connector). */
  unresolved: UnresolvedGrant[];
}

/** The real tools one granted capability (or tool name, or `*`) stands for on a connector; [] when nothing serves it. */
export function toolsForCapability(connectorKey: string, capability: string): readonly string[] {
  const served = GATEWAY_TOOL_NAMES[connectorKey];
  if (!served) return [];
  if (capability === "*") return served;
  // A capability a template names wins over a tool of the same name: `web` grants `fetch` as the page read (`fetch_page`),
  // while the tool called `fetch` is the Source Watcher's robots.txt-respecting reader that only the orchestrator grants.
  const byCapability = CAPABILITY_TOOLS[connectorKey]?.[capability];
  if (byCapability) return byCapability;
  return served.includes(capability) ? [capability] : [];
}

/** Resolve an agent version's grants into what its session may use (session token, MCP servers, SDK built-ins). */
export function resolveGrants(grants: readonly ToolGrantLike[]): ResolvedGrants {
  const refs = new Set<string>();
  const servers = new Set<string>();
  const mcp = new Set<string>();
  const builtins = new Set<string>();
  const unresolved: UnresolvedGrant[] = [];
  for (const g of grants) {
    if (isServiceOnlyConnector(g.connectorKey)) {
      for (const capability of g.tools) unresolved.push({ connectorKey: g.connectorKey, capability, reason: SERVICE_ONLY_REASON });
      continue;
    }
    for (const capability of g.tools) {
      const builtin = SDK_BUILTIN_CAPABILITIES[g.connectorKey]?.[capability];
      if (builtin) {
        for (const t of builtin) builtins.add(t);
        continue;
      }
      if (SESSION_MANAGED_CAPABILITIES[g.connectorKey]?.[capability]) continue;
      if (!GATEWAY_TOOL_NAMES[g.connectorKey]) {
        unresolved.push({ connectorKey: g.connectorKey, capability, reason: SDK_BUILTIN_CAPABILITIES[g.connectorKey] ? (NOT_YET_SERVED[g.connectorKey]?.[capability] ?? "not a capability of the session workspace") : `the ${g.connectorKey} connector is not built yet` });
        continue;
      }
      if (capability === "*") {
        refs.add(`${g.connectorKey}:*`);
        mcp.add(`mcp__${g.connectorKey}`);
        servers.add(g.connectorKey);
        continue;
      }
      const tools = toolsForCapability(g.connectorKey, capability);
      if (tools.length === 0) {
        unresolved.push({ connectorKey: g.connectorKey, capability, reason: NOT_YET_SERVED[g.connectorKey]?.[capability] ?? `${g.connectorKey} has no tool for "${capability}"` });
        continue;
      }
      servers.add(g.connectorKey);
      for (const t of tools) {
        refs.add(`${g.connectorKey}:${t}`);
        mcp.add(`mcp__${g.connectorKey}__${t}`);
      }
    }
  }
  return { toolRefs: [...refs], servers: [...servers], mcpTools: [...mcp], builtinTools: [...builtins], unresolved };
}
