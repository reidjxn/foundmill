/**
 * Connector keys agent templates may reference in their tool grants (BUILD §13.2 catalogue by phase, §9.9 task board).
 *
 * `packages/connectors` owns the real registry; this list is the agreed vocabulary of keys so templates typecheck without
 * importing that package. Grants name capabilities ("repos.read", "tasks.list"); packages/connectors `resolveGrants`
 * (src/grants.ts) maps them onto the real tools that serve them, and apps/orchestrator's grants-contract test holds every
 * template to it: each grant on a connector the gateway serves resolves to at least one real tool, and a key the repo
 * does not build yet is one of the later-phase keys below (it gets no MCP server).
 */

/** Platform-internal tool surfaces (not third-party connectors): served by the gateway, or the session workspace for `sandbox`. */
export const PLATFORM_CONNECTOR_KEYS = [
  /** Typed task board and typed messages (BUILD §9.9): tasks.create/claim/block/handoff/complete, messages.request/inform/review. */
  "platform",
  /** Sandbox tools for coding agents (BUILD §9.3): shell, read_file, write_file, run_tests, playwright, git. */
  "sandbox",
  /** Web search + fetch; every result is wrapped untrusted and read through the quarantined reader. */
  "web",
  /** Haiku quarantined reader as a tool: read_untrusted(schema, content) → typed JSON (BUILD §9.8). */
  "quarantine",
] as const;

export const THIRD_PARTY_CONNECTOR_KEYS = [
  // Phase 1
  "anthropic",
  "voyage",
  // Not `openai_images`: the faces of anthropomorphic agents are made by the platform itself (the gateway's portrait
  // route); it is a service-only connector (packages/connectors SERVICE_ONLY_CONNECTORS), so no template may grant it.
  "recraft",
  "github",
  "google_drive",
  "gmail",
  "google_calendar",
  "notion",
  "cloudflare_dns",
  "registrar",
  "opencorporates",
  "bolagsverket",
  "companies_house",
  "e2b",
  "dropbox_sign",
  "ecb_rates",
  /** Domain availability from the registry (RDAP); the Commit screen asks it through the gateway, agents may too. */
  "domains",
  // Phase 2
  "stripe",
  "sendgrid",
  "zerobounce",
  "apollo",
  "people_data_labs",
  "hunter",
  "search_console",
  "bing_webmaster",
  "pagespeed",
  "dataforseo",
  "ga4",
  "tink",
  "plaid",
  "vercel",
  "supabase_management",
  "posthog",
  "sentry",
  "linear",
  "figma",
  "slack",
  "twilio",
  "cal_com",
  "shopify",
  "shippo",
  "codat",
  "ledgy",
  "crm_importers",
  "microsoft_graph",
  "stripe_identity",
  "linkedin_oidc",
  // Phase 3
  "browserbase",
  "google_ads",
  "meta_marketing",
  "tiktok_marketing",
  "linkedin_marketing",
  "microsoft_ads",
  "reddit_ads",
  "x_ads",
  "instagram",
  "facebook_pages",
  "tiktok_publishing",
  "linkedin_publishing",
  "x_publishing",
  "youtube",
  "threads",
  "pinterest",
  "modash",
  "rewardful",
  "partnerstack",
  "impact",
  "awin",
  "lob",
  "stannp",
  "postgrid",
  "gelato",
  "vistar",
  "adquick",
  "spotify_ad_studio",
  "pr_newswire",
  "ein_presswire",
  "qwoted",
  "brand24",
  "trustpilot",
  "google_business_profile",
  "luma",
  "eventbrite",
  "elevenlabs",
  "heygen",
  "openai",
  "gemini",
  "perplexity",
  "freightos",
  "flexport",
  "shipbob",
  "octopart",
  "hts_taric",
  "mercury",
  "truelayer",
  "paddle",
  "app_store_connect",
  "google_play",
  "deel",
  "stripe_tax",
  "uspto_euipo",
  "crunchbase",
  "google_places",
  "pubchem",
  "cosing",
] as const;

export const CONNECTOR_KEYS = [...PLATFORM_CONNECTOR_KEYS, ...THIRD_PARTY_CONNECTOR_KEYS] as const;
export type ConnectorKey = (typeof CONNECTOR_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(CONNECTOR_KEYS);
export function isConnectorKey(key: string): key is ConnectorKey {
  return KEY_SET.has(key);
}

/** Typed helper so template files get completion and a compile error on an unknown connector key. */
export function grant<K extends ConnectorKey>(connectorKey: K, tools: [string, ...string[]]): { connectorKey: K; tools: string[] } {
  return { connectorKey, tools };
}

/** Tools every agent gets on the platform connector (task board + typed messages + escalation). */
export const PLATFORM_BASE_TOOLS: [string, ...string[]] = [
  "tasks.list",
  "tasks.claim",
  "tasks.block",
  "tasks.handoff",
  "tasks.complete",
  "messages.request",
  "messages.inform",
  "messages.review",
  "inbox.request_human_action",
  "memory.search",
];

/** Extra platform tools for leads: they create tasks and assign them (BUILD §9.9 "Leads assign; workers report"). */
export const PLATFORM_LEAD_TOOLS: [string, ...string[]] = [...PLATFORM_BASE_TOOLS, "tasks.create", "tasks.assign", "tasks.reprioritise", "tasks.update", "budgets.read"];

/**
 * What a code session can do in its workspace: read and write files (the SDK's own tools), and have its work saved and
 * pushed (the session runtime). No shell, no test run, no browser: Bash is disallowed in a live session (SECURITY_REVIEW
 * SEC-3) and the platform runs the acceptance tests after the session ends, so granting them only promised the agent a
 * tool no one serves (Nov 1, 2026: every live session logged the gap, and an agent wrote "I had no shell, so nothing was run").
 */
export const SANDBOX_TOOLS: [string, ...string[]] = ["read_file", "write_file", "git.commit", "git.push_branch"];
export const WEB_TOOLS: [string, ...string[]] = ["search", "fetch"];
export const QUARANTINE_TOOLS: [string, ...string[]] = ["read_untrusted"];
