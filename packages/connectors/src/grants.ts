/**
 * Agent tool grants → the tools that serve them (BUILD §9.3; audit GPC-03). Agent templates (packages/agents) grant
 * capabilities in their own vocabulary ("repos.read", "mail.send", "tasks.list"); connectors serve tools by name
 * ("read_tree", "send_mail", "list_tasks"). This file is the one place that maps one onto the other, connector by
 * connector, and `resolveGrants` is what the orchestrator mints session tokens and configures MCP servers from.
 *
 * A grant names either a capability from the maps below, a connector's real tool name (what the Tools tab saves), or `*`.
 * Every capability a template grants resolves: to a real gateway tool, to an SDK built-in of the session workspace, or to
 * something the session runtime does itself. A template never grants on a connector that is not built or a capability no
 * tool serves (founder, Nov 11, 2026: agents are granted only tools that exist); the contract test in apps/orchestrator
 * holds every template to this. Agent versions stored before that date may still hold such grants: `resolveGrants` gives
 * them no tool, and `servedGrants` is what a screen shows.
 */
import type { PolicyHint } from "./contract";
import { anthropicTools } from "./connectors/anthropic/tools";
import { apolloTools } from "./connectors/apollo/tools";
import { posthogTools } from "./connectors/posthog/tools";
import { resendTools } from "./connectors/resend/tools";
import { bufferTools } from "./connectors/buffer/tools";
import { vercelTools } from "./connectors/vercel/tools";
import { firecrawlTools } from "./connectors/firecrawl/tools";
import { RUNWAY_ROUTE_ONLY_TOOLS, runwayTools } from "./connectors/runway/tools";
import { elevenlabsVoiceTools } from "./connectors/elevenlabs_voice/tools";
import { geminiTools } from "./connectors/gemini/tools";
import { indexNowTools } from "./connectors/indexnow/tools";
import { openaiTools } from "./connectors/openai/tools";
import { perplexityTools } from "./connectors/perplexity/tools";
import { serpapiTools } from "./connectors/serpapi/tools";
import { bolagsverketTools } from "./connectors/bolagsverket/tools";
import { cloudflareTools } from "./connectors/cloudflare_dns/tools";
import { companiesHouseTools } from "./connectors/companies_house/tools";
import { domainsTools } from "./connectors/domains/tools";
import { dropboxSignTools } from "./connectors/dropbox_sign/tools";
import { ecbTools } from "./connectors/ecb_rates/tools";
import { GITHUB_ROUTE_ONLY_TOOLS, githubTools } from "./connectors/github/tools";
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
import { elevenlabsTools } from "./connectors/elevenlabs/tools";
import { onesignalTools } from "./connectors/onesignal/tools";
import { platformNotifyTools } from "./connectors/platform_notify/tools";
import { webTools } from "./connectors/web/tools";
import { e2bTools } from "./connectors/e2b/tools";
import { platformMailTools } from "./connectors/platform_mail/tools";

const names = (tools: readonly { name: string }[]) => Object.freeze(tools.map((t) => t.name));

/** Every tool the gateway serves, by connector, with its policy hints: the registry's connectors plus the built-ins. */
const GATEWAY_TOOLS: Readonly<Record<string, readonly { name: string; hints: PolicyHint }[]>> = {
  anthropic: anthropicTools,
  voyage: voyageTools,
  openai_images: openaiImagesTools,
  elevenlabs: elevenlabsTools,
  onesignal: onesignalTools,
  platform_notify: platformNotifyTools,
  github: githubTools,
  google_drive: googleDriveTools,
  gmail: gmailTools,
  google_calendar: googleCalendarTools,
  notion: notionTools,
  cloudflare_dns: cloudflareTools,
  opencorporates: opencorporatesTools,
  bolagsverket: bolagsverketTools,
  domains: domainsTools,
  companies_house: companiesHouseTools,
  e2b: e2bTools,
  dropbox_sign: dropboxSignTools,
  ecb_rates: ecbTools,
  stripe: stripeTools,
  sendgrid: sendgridTools,
  shopify: shopifyTools,
  tink: tinkTools,
  plaid: plaidTools,
  openai: openaiTools,
  gemini: geminiTools,
  perplexity: perplexityTools,
  serpapi: serpapiTools,
  firecrawl: firecrawlTools,
  indexnow: indexNowTools,
  apollo: apolloTools,
  vercel: vercelTools,
  posthog: posthogTools,
  resend: resendTools,
  runway: runwayTools,
  elevenlabs_voice: elevenlabsVoiceTools,
  buffer: bufferTools,
  platform: platformTools,
  web: webTools,
  quarantine: quarantineTools,
  platform_mail: platformMailTools,
};

/** Every tool the gateway serves, by connector: the registry's connectors plus the built-ins (platform, web, quarantine). */
export const GATEWAY_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.fromEntries(Object.entries(GATEWAY_TOOLS).map(([key, tools]) => [key, names(tools)])));

/** A tool the credit saver never moves to a lower-cost model: it reaches outside, spends money or cannot be undone. */
function highStakesTool(hints: PolicyHint): boolean {
  // A hard-gated tool never runs (it becomes a founder task, `request_human_action`), so it does not count.
  if (hints.hardGate) return false;
  return Boolean(hints.contactsThirdParty || hints.spendsMoney || hints.irreversible);
}

/**
 * Whether a session granted `toolRefs` (`connector:tool` or `connector:*`, `ResolvedGrants.toolRefs`) holds a high-stakes
 * tool: one that reaches someone outside the business, spends money or cannot be undone (`contactsThirdParty`,
 * `spendsMoney`, `irreversible`: the hints the house rules' policy asks the founder about). Low credits keep such a session
 * on its usual model (the credit saver, apps/orchestrator `prepareSession` and every run). It fails closed: a connector or
 * tool this map does not know counts as high-stakes, so a tool added without its hints here is never downgraded.
 */
export function grantsActOutside(toolRefs: readonly string[]): boolean {
  return toolRefs.some((ref) => {
    const sep = ref.indexOf(":");
    const connector = sep < 0 ? ref : ref.slice(0, sep);
    const tool = sep < 0 ? "*" : ref.slice(sep + 1);
    const tools = GATEWAY_TOOLS[connector];
    if (!tools) return true;
    const granted = tool === "*" ? tools : tools.filter((t) => t.name === tool);
    if (granted.length === 0) return true;
    return granted.some((t) => highStakesTool(t.hints));
  });
}

const bankingCapabilities = { "accounts.list": ["list_accounts", "get_consent_status"], "transactions.list": ["list_transactions", "sync"] };

/** Capability → tools, per connector served through the gateway. */
export const CAPABILITY_TOOLS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  anthropic: { "panel.query": ["ask_panel"] },
  // The other assistants' panels, Google's results and AI Overview, a page as a crawler reads it, and telling search
  // engines a page changed: each on the founder's own key at that vendor (founder, 2026-11-12).
  openai: { "panel.query": ["ask_panel"] },
  gemini: { "panel.query": ["ask_panel"] },
  perplexity: { "panel.query": ["ask_panel"] },
  serpapi: { "serp.read": ["search_google"] },
  firecrawl: { "pages.read": ["scrape_page"] },
  indexnow: { "urls.submit": ["submit_urls"] },
  // Searching people is free at Apollo; a company search and a person lookup spend the founder's credits and ask first.
  apollo: { "people.search": ["search_people"], "organizations.search": ["search_organizations"], "people.enrich": ["enrich_person"] },
  // A redeploy goes live and uses the founder's build minutes: it asks first.
  vercel: { "deployments.list": ["list_deployments"], "deployments.read": ["list_deployments", "get_deployment"], "deployments.create": ["create_deployment"] },
  posthog: { "insights.query": ["query_insights"] },
  // The founder's own Resend account and verified domain; a message to someone outside the project asks first.
  resend: { "mail.send": ["send_mail", "list_domains"], "domains.read": ["list_domains"] },
  // Generated video and voiceover on the founder's own Runway and ElevenLabs accounts (founder, 2026-11-13). Starting a clip
  // or a voiceover spends the founder's money and asks first; looking a task up and listing voices are free reads.
  runway: { "video.generate": ["generate_video_from_text", "generate_video_from_image", "get_video_task"], "video.read": ["get_video_task"] },
  elevenlabs_voice: { "voiceover.generate": ["generate_voiceover", "list_voices"], "voices.list": ["list_voices"] },
  // The founder's own Buffer account: reading channels and a post's status runs; queuing a post publishes in public later and asks first.
  buffer: { "channels.read": ["list_channels"], "posts.queue": ["queue_post", "list_channels"], "posts.read": ["get_post"] },
  github: {
    // download_archive is the platform's own checkout (the gateway's archive route, ROUTE_ONLY_TOOLS): never an agent's tool.
    "repos.read": ["list_repos", "read_tree", "read_file", "compare_refs"],
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
    "tasks.update": ["update_task"],
    "sessions.reassign": ["assign_task", "list_sessions"],
    "tasks.block": ["block_task"],
    "tasks.handoff": ["handoff_task"],
    "tasks.complete": ["complete_task"],
    // WP-05 T3: the result of a task, saved for the founder and the next agent.
    "reports.write": ["save_report"],
    "reports.read": ["read_report"],
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
    // The team's documents in the code repository, default branch only (Nov 6, 2026: every agent).
    "docs.read": ["list_repository_docs", "read_repository_doc"],
    // The team's skills: the Chief of Staff gives agents library skills and the business's own skill files (Nov 6, 2026).
    "skills.manage": ["list_skills", "assign_skill", "remove_skill"],
  },
  web: { search: ["search_web"], fetch: ["fetch_page"] },
  quarantine: { read_untrusted: ["read_untrusted"] },
  // The project's Foundmill sending address (package 1.5): one message to one person, from the project.
  platform_mail: { "mail.send": ["send_mail"] },
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
 * Capabilities a template grants on a served connector that no tool serves yet, and why. Empty since Nov 11, 2026: every
 * template grant resolves (the contract test in apps/orchestrator fails on one that does not), and the grants removed
 * then are listed in packages/agents/src/templates/PLANNED_GRANTS.md. A new gap is still a deliberate entry here, with
 * its reason, and the contract test names it: build the tool, or leave the grant out of the template.
 */
export const NOT_YET_SERVED: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({});

/**
 * Connectors only the platform itself calls, from a service route of the gateway (never an agent session): `openai_images`
 * makes the faces of anthropomorphic agents on the platform key (`POST /v1/personas/portrait`); `onesignal` pushes to
 * founders' own phones from the mobile app (`POST /v1/push/send`); `platform_notify` emails a person from Foundmill
 * itself about their own project (`POST /v1/notify/email`); `elevenlabs` speaks an agent's turn and transcribes the founder's
 * on a Team call (`POST /v1/speech/synthesize` and `/v1/speech/transcribe`). A grant on one resolves to nothing, the gateway refuses
 * it on `/v1/call` and `/mcp/:connector` whatever a session token says, and the api neither lists it in
 * Settings › Integrations nor connects it for a business.
 */
export const SERVICE_ONLY_CONNECTORS: ReadonlySet<string> = new Set(["openai_images", "onesignal", "platform_notify", "elevenlabs"]);

/** Why a grant on a service-only connector resolves to nothing (`ResolvedGrants.unresolved`). */
export const SERVICE_ONLY_REASON = "the platform calls this connector itself; agents never do";

export function isServiceOnlyConnector(connectorKey: string): boolean {
  return SERVICE_ONLY_CONNECTORS.has(connectorKey);
}

/**
 * `connector:tool` refs only the platform calls, on a gateway route of their own or from the gateway's own checks:
 * `github:download_archive` (a code session's checkout, `POST /v1/github/archive`) and `github:get_repository` (pinning the
 * Code-tab repository). No grant resolves to one, so no agent session token carries one (the orchestrator mints its
 * checkout token with `github:download_archive` explicitly); the gateway also never lists one on `/mcp/:connector` and
 * refuses one on `/v1/call` for an agent session, whatever a token says (a `github:*` wildcard included).
 * `runway:download_video` is the platform's copy of a finished clip into a post draft's media (orchestrator
 * `post-media.ts`), on `/v1/call` with a token outside any session.
 */
export const ROUTE_ONLY_TOOLS: ReadonlySet<string> = new Set([...GITHUB_ROUTE_ONLY_TOOLS.map((t) => `github:${t}`), ...RUNWAY_ROUTE_ONLY_TOOLS.map((t) => `runway:${t}`)]);

/**
 * Tools whose answer is a media file the platform stores (a post draft's media, packages/db `post_media`), when a
 * platform token outside any session calls them: the gateway hands that caller the file as it came (still inside the
 * untrusted envelope with its notice), never a reader's digest, because code stores it and no agent reads it. An agent
 * session calling the same tool is unchanged: it gets the reader's digest and the typed facts, never the bytes.
 */
export const SERVICE_MEDIA_TOOLS: ReadonlySet<string> = new Set(["elevenlabs_voice:generate_voiceover", "runway:download_video"]);

export function isServiceMediaTool(connectorKey: string, tool: string): boolean {
  return SERVICE_MEDIA_TOOLS.has(`${connectorKey}:${tool}`);
}

const hasRouteOnlyTools = (connectorKey: string): boolean => [...ROUTE_ONLY_TOOLS].some((ref) => ref.startsWith(`${connectorKey}:`));

/** Why a grant of a route-only tool resolves to nothing (`ResolvedGrants.unresolved`). */
export const ROUTE_ONLY_REASON = "the platform calls this tool itself on its own gateway route; agents never do";

export function isRouteOnlyTool(connectorKey: string, tool: string): boolean {
  return ROUTE_ONLY_TOOLS.has(`${connectorKey}:${tool}`);
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
  /** Grants nothing serves (a connector that is not built, a capability no tool serves, or a service-only connector). */
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
      // A wildcard on a connector with route-only tools (GitHub) is spelled out without them, so the token never carries them.
      if (capability === "*" && !hasRouteOnlyTools(g.connectorKey)) {
        refs.add(`${g.connectorKey}:*`);
        mcp.add(`mcp__${g.connectorKey}`);
        servers.add(g.connectorKey);
        continue;
      }
      // A route-only tool (a repository archive) is never an agent's, whether granted by name or through `*`.
      const served = toolsForCapability(g.connectorKey, capability);
      const tools = served.filter((t) => !isRouteOnlyTool(g.connectorKey, t));
      if (tools.length === 0) {
        unresolved.push({ connectorKey: g.connectorKey, capability, reason: served.length > 0 ? ROUTE_ONLY_REASON : (NOT_YET_SERVED[g.connectorKey]?.[capability] ?? `${g.connectorKey} has no tool for "${capability}"`) });
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

/**
 * The grants a founder is shown (the agent profile's Tools tab, the Agents table): each grant without the capabilities
 * `resolveGrants` leaves unresolved, and no grant that has none left. An agent version stored before Nov 11, 2026 may
 * hold grants on connectors that were never built or capabilities no tool serves; a session never held them, so the
 * product does not list them. Order is kept, and so are the capability names as stored.
 */
export function servedGrants<G extends ToolGrantLike>(grants: readonly G[]): { connectorKey: string; tools: string[] }[] {
  const out: { connectorKey: string; tools: string[] }[] = [];
  for (const g of grants) {
    const gaps = new Set(resolveGrants([g]).unresolved.map((u) => u.capability));
    const tools = g.tools.filter((t) => !gaps.has(t));
    if (tools.length > 0) out.push({ connectorKey: g.connectorKey, tools });
  }
  return out;
}
