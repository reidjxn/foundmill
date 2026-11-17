/**
 * The team's agents as the API shows and hires them. Hiring from a template (`hireFromTemplate`, `hireMany`) is
 * implemented once in packages/db (`src/hire.ts`, WP-06 T5) and re-exported here.
 */
import { servedGrants } from "@foundmill/connectors";

/**
 * An agent version's stored tool grants as a founder is shown them (the profile's Tools tab, the Agents table): only
 * grants that resolve to something an agent can use (`servedGrants`, packages/connectors). A version stored before
 * Nov 11, 2026 may still list connectors that were never built or capabilities no tool serves; no session ever held
 * them, so no screen lists them. The stored row is not changed, and anything that is not a grant is left out.
 */
export function shownToolGrants(stored: unknown): { connectorKey: string; tools: string[] }[] {
  if (!Array.isArray(stored)) return [];
  const grants: { connectorKey: string; tools: string[] }[] = [];
  for (const g of stored as { connectorKey?: unknown; tools?: unknown }[]) {
    if (typeof g?.connectorKey !== "string") continue;
    grants.push({ connectorKey: g.connectorKey, tools: Array.isArray(g.tools) ? g.tools.filter((t): t is string => typeof t === "string") : [] });
  }
  return servedGrants(grants);
}

/** One hire implementation lives in packages/db (WP-06 T5); re-exported so commit.ts and the team router keep their imports. */
export { hireFromTemplate, hireMany, type HiredAgent, type HireOptions, type PlannedHire } from "@foundmill/db";
