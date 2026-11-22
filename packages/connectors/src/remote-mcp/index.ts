import type { Connector } from "../contract";
import type { LiveConnectorOptions } from "../platform";
import { createRemoteMcpConnector } from "./build";
import { HUBSPOT_MCP, NOTION_MCP, SHOPIFY_MCP } from "./servers";

export { createRemoteMcpConnector, createRemoteMcpMock, remoteToolList, toolName, hardGateName, UNLISTED_HINTS, UNLISTED_TOOL, type RemoteServer, type RemoteTool } from "./build";
import { hardGateName as HARD_NAME, remoteNameWords, UNLISTED_TOOL as UNLISTED } from "./build";
export { createMcpCustomConnector, assertPublicServer, MCP_CUSTOM_KEY } from "./custom";
export { REMOTE_MCP_SERVERS, NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP } from "./servers";

export const createNotionMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(NOTION_MCP, o);
export const createHubspotMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(HUBSPOT_MCP, o);
export const createShopifyMcpConnector = (o?: LiveConnectorOptions): Connector => createRemoteMcpConnector(SHOPIFY_MCP, o);

/** Connectors with no live implementation yet (a remote server nobody could sign in to): Settings hides them where mocks are not allowed. */
export const MOCK_ONLY_CONNECTORS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP].filter((s) => !s.live).map((s) => s.key));

const REMOTE_KEYS: ReadonlySet<string> = new Set([NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP].map((s) => s.key).concat("mcp_custom"));

/** Words that, as an argument's name or as an operation's value, delete, trash, archive, remove, merge or wipe records. */
const REMOVING = ["delet", "destroy", "purge", "erase", "wipe", "trash", "archiv", "remov", "drop", "truncat", "merg"];
const removes = (word: string): boolean => remoteNameWords(word).some((w) => REMOVING.some((stem) => w.startsWith(stem)));
const OPERATION_KEYS = new Set(["operation", "operations", "op", "action", "actions", "type", "mode", "command", "method", "verb", "kind"]);

/**
 * Whether these arguments could delete, trash, archive or merge: an operation-like argument (at any depth) whose value
 * says so (`{ action: "delete" }`), or an argument named so at the top level that is set (`archived: true`,
 * `in_trash: true`). HubSpot documents no arguments for its `manage_*` tools (`tool_guidance` describes them at run time),
 * so this reads the shape the call has, and fails closed on any such word.
 */
function removingArgs(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (OPERATION_KEYS.has(k.toLowerCase()) && (typeof v === "string" ? removes(v) : Array.isArray(v) && v.some((x) => typeof x === "string" && removes(x)))) return true;
    if (depth === 0 && removes(k) && v !== false && v !== null && v !== undefined) return true;
    if (removingArgs(v, depth + 1)) return true;
  }
  return false;
}

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
    if (tool === "notion_update_page" && !NOTION_PAGE_COMMANDS.has(String(args.command))) return `notion-update-page with command ${JSON.stringify(args.command ?? null)}`;
    if (tool === "notion_update_database") {
      const props = args.properties && typeof args.properties === "object" ? Object.values(args.properties as Record<string, unknown>) : [];
      if (props.some((p) => p === null) || JSON.stringify(args).includes('"options"')) return "notion-update-database removing a property or options";
    }
    if (tool === "notion_update_page" || tool === "notion_update_database") return removingArgs(args) ? `${tool.replace(/_/g, "-")} that deletes or trashes` : null;
    return null;
  }
  if (connectorKey === "hubspot_mcp" && tool.startsWith("manage_")) return removingArgs(args) ? `${tool} that deletes, archives or merges` : null;
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
  return typeof name === "string" && HARD_NAME(name) ? name : null;
}
