/**
 * Door B's source catalogue routed to the gateway (BUILD §11.1; audit ARB-07, api-services-09, VGPC-X3, VSEC-X2).
 *
 * One table says, for every source the picker offers, which connector tool reads it and with which arguments. The api
 * writes the source rows from it (`sources.relevance.import`) and the orchestrator's `importSource` activity calls the
 * gateway from it, so the two can never disagree about what a source is (they once did: the api stored placeholder
 * addresses that the orchestrator's pattern router did not recognize). Every route is a read: an import never writes.
 * Linear and Jira have no connector yet, so they have no route and a business import refuses them up front.
 */

export const IMPORT_SOURCE_KEYS = ["github", "google_drive", "notion", "linear", "jira", "website", "stripe", "shopify", "bank", "registry"] as const;
export type ImportSourceKeyName = (typeof IMPORT_SOURCE_KEYS)[number];

export interface ImportCall {
  connector: string;
  tool: string;
  args: Record<string, unknown>;
}

/** The connector tool that reads each source; null where no connector exists yet. */
export const IMPORT_TOOLS: Readonly<Record<ImportSourceKeyName, { connector: string; tool: string } | null>> = {
  github: { connector: "github", tool: "read_tree" },
  google_drive: { connector: "google_drive", tool: "search_files" },
  notion: { connector: "notion", tool: "search" },
  linear: null,
  jira: null,
  website: { connector: "web", tool: "fetch" },
  stripe: { connector: "stripe", tool: "get_account" },
  shopify: { connector: "shopify", tool: "get_shop" },
  bank: { connector: "tink", tool: "list_accounts" },
  registry: { connector: "opencorporates", tool: "search_companies" },
};

/** True when a business import can read this source through a connector. */
export function hasImportConnector(key: string): boolean {
  return Boolean(IMPORT_TOOLS[key as ImportSourceKeyName]);
}

/**
 * The gateway call that reads a source, from the key and the (normalized) value the founder typed: `owner/name` for a
 * repository, an address for a website, a registration number for the registry. Null when the key has no connector or
 * the value does not fit the tool (so the source is reported as not read, never sent with arguments the tool rejects).
 */
export function importCallFor(key: string, value: string): ImportCall | null {
  const route = IMPORT_TOOLS[key as ImportSourceKeyName];
  if (!route) return null;
  const v = value.trim();
  const base = { connector: route.connector, tool: route.tool };
  switch (key as ImportSourceKeyName) {
    case "github": {
      const [owner, repo, ...rest] = v.split("/");
      return owner && repo && rest.length === 0 ? { ...base, args: { owner, repo, recursive: true } } : null;
    }
    case "google_drive":
      // Drive's own query syntax: everything that is not in the trash.
      return { ...base, args: { q: "trashed = false", pageSize: 50 } };
    case "notion":
      return { ...base, args: { query: "", pageSize: 50 } };
    case "website":
      return v ? { ...base, args: { url: v } } : null;
    case "registry":
      return v.length >= 2 ? { ...base, args: { q: v } } : null;
    case "stripe":
    case "shopify":
    case "bank":
      return { ...base, args: {} };
    case "linear":
    case "jira":
      return null;
  }
}
