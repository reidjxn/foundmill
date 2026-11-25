import type { Connector } from "../contract";
import type { LiveConnectorOptions } from "../platform";
import { createRemoteMcpConnector } from "./build";
import { FOUNDER_EXECUTED_FOLDED_NAMES, foldedToolName, HUBSPOT_MCP, LIGHTBRINGER_MCP, LOVABLE_MCP, NOTION_MCP, SENTRY_MCP, SHOPIFY_MCP } from "./servers";

export { createRemoteMcpConnector, createRemoteMcpMock, remoteToolList, toolName, hardGateName, listProblems, remoteErrorReason, UNLISTED_HINTS, UNLISTED_TOOL, type RemoteServer, type RemoteTool } from "./build";
import { hardGateName as HARD_NAME, remoteNameWords, toolName, UNLISTED_TOOL as UNLISTED } from "./build";
export { createMcpCustomConnector, assertPublicServer, MCP_CUSTOM_KEY } from "./custom";
export { REMOTE_MCP_SERVERS, NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP, LIGHTBRINGER_DEMO_INVENTION, LIGHTBRINGER_DEMO_FAIL_INVENTION, SENTRY_MCP, SENTRY_DEMO_ISSUE, SENTRY_DEMO_INJECTION_ISSUE, LOVABLE_MCP, LOVABLE_DEMO_PROJECT, LOVABLE_DEMO_REFUSED_PROMPT } from "./servers";

export const createNotionMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(NOTION_MCP, o);
export const createHubspotMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(HUBSPOT_MCP, o);
export const createShopifyMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(SHOPIFY_MCP, o);
export const createLightbringerMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(LIGHTBRINGER_MCP, o);
export const createSentryMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(SENTRY_MCP, o);
export const createLovableMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(LOVABLE_MCP, o);

/** Connectors with no live implementation yet (a remote server nobody could sign in to): Settings hides them where mocks are not allowed. */
export const MOCK_ONLY_CONNECTORS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP, SENTRY_MCP, LOVABLE_MCP].filter((s) => !s.live).map((s) => s.key));

const REMOTE_KEYS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP, SENTRY_MCP, LOVABLE_MCP].map((s) => s.key).concat("mcp_custom"));

/** Words that, as an argument's name or as an operation's value, delete, trash, archive, remove, merge or wipe records. */
const REMOVING = ["delet", "destroy", "purge", "erase", "wipe", "trash", "archiv", "remov", "drop", "truncat", "merg"];
/** An argument name: any of its words starting with a removing stem (`archived`, `deleteIds`, `in_trash`). */
const removingName = (name: string): boolean => remoteNameWords(name).some((w) => REMOVING.some((stem) => w.startsWith(stem)));
/** An operation's value: a removing stem anywhere in its letters (`HARD_DELETE`, `batchArchive`). */
const removingValue = (value: string): boolean => {
  const letters = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return REMOVING.some((stem) => letters.includes(stem));
};
/** Argument names that carry an operation (`action`, `operationType`, `crud_action`, `requestType`). */
const OPERATION_WORDS = new Set(["operation", "operations", "op", "ops", "action", "actions", "type", "mode", "command", "method", "verb", "kind", "crud", "request", "intent"]);
const operationName = (name: string): boolean => remoteNameWords(name).some((w) => OPERATION_WORDS.has(w));

/**
 * Whether these arguments could delete, trash, archive or merge, at any depth: an operation-like argument whose value
 * says so (`{ action: "delete" }`, `{ operationType: "HARD_DELETE" }`), an argument named so that is set
 * (`archived: true`, `properties: { in_trash: true }`), or the same inside a string that holds JSON. HubSpot documents no
 * arguments for its `manage_*` tools (`tool_guidance` describes them at run time), so this reads the shape the call has
 * and fails closed: on any such word, and on arguments nested too deep to read.
 */
function removingArgs(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "string") {
    const t = value.trim();
    if (!/^[[{]/.test(t)) return false;
    try {
      return removingArgs(JSON.parse(t), depth + 1);
    } catch {
      return false;
    }
  }
  if (value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (operationName(k) && (typeof v === "string" ? removingValue(v) : Array.isArray(v) && v.some((x) => typeof x === "string" && removingValue(x)))) return true;
    if (removingName(k) && v !== false && v !== null && v !== undefined && v !== "" && v !== 0) return true;
    if (removingArgs(v, depth + 1)) return true;
  }
  return false;
}

/** The folded names of every server's listed hard-gate tools: naming one through `call_unlisted_tool`, in any spelling, is refused. */
const LISTED_HARD_GATES: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP, SENTRY_MCP, LOVABLE_MCP].flatMap((s) => s.tools.filter((t) => t.hints?.hardGate).map((t) => foldedToolName(t.remote))));
const SENTRY_ACCESS_WORDS = ["dsn", "key", "team", "member", "access"];

/** The documented `notion-update-page` commands (developers.notion.com/guides/mcp/tools-pages-reference, Nov 22, 2026). */
const NOTION_PAGE_COMMANDS = new Set(["update_properties", "update_content"]);

/**
 * Why a listed change tool's call would cross a hard gate (permanent delete, an access change), or null. Read from the
 * vendors' tool references on Nov 22, 2026: Notion's `notion-update-page` documents `update_properties` and
 * `update_content` only, so any other command (or none) cannot show what it removes; `notion-move-pages` moves items
 * that "inherit access from the new parent", an access change the arguments cannot rule out; `notion-update-database`
 * (now `notion-update-data-source`) removes every select, multi-select or status option a call leaves out, and a
 * property set to null is removed with its values.
 */
function removingListedCall(connectorKey: string, tool: string, args: Record<string, unknown>): string | null {
  if (connectorKey === "notion_mcp") {
    if (tool === "notion_move_pages") return "notion-move-pages (moved pages take the new parent's access)";
    // The command may sit at the top or under `data` (the shape of Notion's earlier server): both must be a documented one.
    const nested = args.data && typeof args.data === "object" ? (args.data as Record<string, unknown>).command : undefined;
    if (tool === "notion_update_page" && (!NOTION_PAGE_COMMANDS.has(String(args.command ?? nested)) || (nested !== undefined && !NOTION_PAGE_COMMANDS.has(String(nested))))) return `notion-update-page with command ${JSON.stringify(args.command ?? nested ?? null)}`;
    if (tool === "notion_update_database") {
      const props = args.properties && typeof args.properties === "object" ? Object.values(args.properties as Record<string, unknown>) : [];
      if (props.some((p) => p === null) || JSON.stringify(args).includes('"options"')) return "notion-update-database removing a property or options";
    }
    if (tool === "notion_update_page" || tool === "notion_update_database") return removingArgs(args) ? `${tool.replace(/_/g, "-")} that deletes or trashes` : null;
    return null;
  }
  if (connectorKey === "hubspot_mcp" && tool.startsWith("manage_")) return removingArgs(args) ? `${tool} that deletes, archives or merges` : null;
  // Sentry posts `update_issue`'s `reason` as a comment on the issue: a note goes through add_issue_note, which is a send.
  if (connectorKey === "sentry_mcp" && tool === "update_issue" && args.reason !== undefined && args.reason !== null && args.reason !== "") return "update-issue with a reason (posted as a comment; use add_issue_note)";
  return null;
}

/**
 * The remote call that would cross a hard gate (money out, signing, terms, permanent delete, security, access): the
 * remote tool name a `call_unlisted_tool` call asks for, or a listed change tool whose arguments delete, trash or change
 * access. Null otherwise. The gateway denies it before anyone is asked, so no approval can run it.
 */
export function remoteHardGateCall(connectorKey: string, tool: string, args: unknown): string | null {
  if (!REMOTE_KEYS.has(connectorKey)) return null;
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (tool !== UNLISTED) return removingListedCall(connectorKey, tool, a);
  const name = a.tool;
  if (typeof name !== "string") return null;
  if (HARD_NAME(name) || LISTED_HARD_GATES.has(foldedToolName(name))) return name;
  // Sentry: a tool about project keys, teams, members or access is a security setting, whatever its verb.
  if (connectorKey === "sentry_mcp" && (SENTRY_ACCESS_WORDS.some((w) => foldedToolName(name).includes(w)) || foldedToolName(name).startsWith("createproject"))) return name;
  return null;
}

/**
 * The listed tools of every server that only the founder's own press runs (`hints.founderExecuted`), as `connector:tool`
 * refs. No agent holds one, the gateway refuses a session-token call to one whatever the token says, and the one executor
 * is `POST /v1/founder-actions/execute` (apps/gateway `founder-action.ts`).
 */
export const FOUNDER_EXECUTED_TOOLS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP, SENTRY_MCP, LOVABLE_MCP].flatMap((s) => s.tools.filter((t) => t.hints?.founderExecuted).map((t) => `${s.key}:${toolName(t.remote)}`)));

/** The founder-executed tool a `call_unlisted_tool` call names (in any spelling `toolName` folds together), or null. Denied before anyone is asked. */
export function remoteFounderExecutedCall(_connectorKey: string, tool: string, args: unknown): string | null {
  // Any connector's `call_unlisted_tool`, `mcp_custom` included: a founder-executed tool's name, in any spelling, is never reached around the press.
  if (tool !== UNLISTED) return null;
  const name = (args as { tool?: unknown } | null)?.tool;
  return typeof name === "string" && FOUNDER_EXECUTED_FOLDED_NAMES.has(foldedToolName(name)) ? name : null;
}
