/**
 * Connector keys agent templates may reference in their tool grants (BUILD §13.2 catalogue by phase, §9.9 task board).
 *
 * `packages/connectors` owns the real registry; this list is the agreed vocabulary of keys so templates typecheck without
 * importing that package. Grants name capabilities ("repos.read", "tasks.list"); packages/connectors `resolveGrants`
 * (src/grants.ts) maps them onto the real tools that serve them, and apps/orchestrator's grants-contract test holds every
 * template to it: every grant resolves completely. Only connectors the gateway serves are listed (founder, Nov 11, 2026:
 * agents are granted only tools that exist), so a grant on a connector that is not built does not compile. The grants
 * the templates held on connectors of later phases are kept in templates/PLANNED_GRANTS.md; add a key here in the same
 * change that builds its connector.
 */

/** Platform-internal tool surfaces (not third-party connectors): served by the gateway, or the session workspace for `sandbox`. */
export const PLATFORM_CONNECTOR_KEYS = [
  /** Typed task board and typed messages (BUILD §9.9): tasks.create/claim/block/handoff/complete, messages.request/inform/review. */
  "platform",
  /** The code session's workspace (BUILD §9.3): read_file, write_file and the save and push the session runtime does. */
  "sandbox",
  /** Web search + fetch; every result is wrapped untrusted and read through the quarantined reader. */
  "web",
  /** Haiku quarantined reader as a tool: read_untrusted(schema, content) → typed JSON (BUILD §9.8). */
  "quarantine",
  /** The project's Foundmill sending address (package 1.5): mail.send, one message to one person from the project. */
  "platform_mail",
] as const;

export const THIRD_PARTY_CONNECTOR_KEYS = [
  "anthropic",
  "voyage",
  // Not `openai_images` or `onesignal`: the platform calls those itself (packages/connectors SERVICE_ONLY_CONNECTORS),
  // so no template may grant them.
  "github",
  "google_drive",
  "gmail",
  "google_calendar",
  "notion",
  "cloudflare_dns",
  "opencorporates",
  "bolagsverket",
  "companies_house",
  "e2b",
  "dropbox_sign",
  "ecb_rates",
  /** Domain availability from the registry (RDAP); the Commit screen asks it through the gateway, agents may too. */
  "domains",
  "stripe",
  "sendgrid",
  "tink",
  "plaid",
  "shopify",
  // On the founder's own key at each vendor (founder, 2026-11-12): the other assistants' panels, Google's results and
  // AI Overview, a page as a crawler reads it, and telling search engines a page changed.
  "openai",
  "gemini",
  "perplexity",
  "serpapi",
  "firecrawl",
  "indexnow",
  "apollo",
  "vercel",
  "posthog",
  "resend",
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
  // The team's documents in the code repository (default branch), so research and planning read the handover too.
  "docs.read",
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
