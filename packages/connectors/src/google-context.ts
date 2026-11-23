/**
 * Gmail and Google Calendar as context (founder, Nov 19, 2026). Agents read the founder's own drafts, inbox and calendar
 * only on a project where the founder said yes (`integrations.settings.contextReads`), and the inbox only once Google
 * granted `gmail.readonly`. Without that, these reads are taken out of the session's grants before its token is minted,
 * so the gateway refuses them as out of scope. Gmail drafts need gmail.compose (restricted at Google, Nov 23, 2026), so
 * without it no draft tool is in a session; writing events is unchanged; sends and invitations run in assisted and
 * automated mode (founder, Nov 23, 2026).
 */
import { GATEWAY_TOOL_NAMES } from "./grants";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Restricted at Google (Nov 23, 2026): without it, no Gmail draft tool is in a session at all. */
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_DRAFT_TOOLS = ["create_draft", "list_drafts", "get_draft"] as const;

/** The reads that carry the founder's own mail and calendar text, by what turns them on. */
export const CONTEXT_READ_TOOLS = {
  gmail: { drafts: ["list_drafts", "get_draft"], inbox: ["list_messages", "get_message"] },
  google_calendar: { events: ["list_calendars", "list_events", "get_event"] },
} as const;

/** What the founder turned on for one project, and what Google granted. */
export interface ContextReads {
  gmail: { on: boolean; scopes: readonly string[] };
  googleCalendar: { on: boolean };
}

/** The context reads this project does not allow, as `connector:tool` refs. */
export function blockedContextReads(reads: ContextReads): Set<string> {
  const blocked = new Set<string>();
  const add = (connector: string, tools: readonly string[]) => tools.forEach((t) => blocked.add(`${connector}:${t}`));
  if (!reads.gmail.scopes.includes(GMAIL_COMPOSE_SCOPE)) add("gmail", GMAIL_DRAFT_TOOLS);
  if (!reads.gmail.on) add("gmail", [...CONTEXT_READ_TOOLS.gmail.drafts, ...CONTEXT_READ_TOOLS.gmail.inbox]);
  else if (!reads.gmail.scopes.includes(GMAIL_READONLY_SCOPE)) add("gmail", CONTEXT_READ_TOOLS.gmail.inbox);
  if (!reads.googleCalendar.on) add("google_calendar", CONTEXT_READ_TOOLS.google_calendar.events);
  return blocked;
}

/** The grants without the blocked reads; a `connector:*` grant on gmail or google_calendar is spelled out without them. */
export function withContextReads<G extends { toolRefs: string[]; mcpTools: string[] }>(grants: G, reads: ContextReads): G {
  const blocked = blockedContextReads(reads);
  if (blocked.size === 0) return grants;
  const refs: string[] = [];
  const mcp: string[] = [];
  for (const ref of grants.toolRefs) {
    const [connector = "", tool = ""] = ref.split(":");
    const tools = tool === "*" && connector in CONTEXT_READ_TOOLS ? (GATEWAY_TOOL_NAMES[connector] ?? []) : [tool];
    for (const t of tools) if (!blocked.has(`${connector}:${t}`)) refs.push(tool === "*" && !(connector in CONTEXT_READ_TOOLS) ? ref : `${connector}:${t}`);
  }
  for (const m of grants.mcpTools) {
    const [, connector = "", tool] = m.split("__");
    if (tool === undefined && connector in CONTEXT_READ_TOOLS) {
      for (const t of GATEWAY_TOOL_NAMES[connector] ?? []) if (!blocked.has(`${connector}:${t}`)) mcp.push(`mcp__${connector}__${t}`);
    } else if (tool === undefined || !blocked.has(`${connector}:${tool}`)) mcp.push(m);
  }
  return { ...grants, toolRefs: [...new Set(refs)], mcpTools: [...new Set(mcp)] };
}
