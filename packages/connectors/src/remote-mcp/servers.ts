/**
 * Foundmill's lists for the vendors' remote MCP servers (founder, 2026-11-19), with each vendor's OAuth and terms as
 * checked on Nov 19, 2026 from the vendor's own documentation. Tool names and schemas are recorded from that
 * documentation and from the servers' published tool lists; the live server may differ, which is why `call_unlisted_tool`
 * exists (asks first). Refresh a list by running `tools/list` against the live server with a test account and diffing.
 *
 * NOTION: https://mcp.notion.com/mcp (streamable HTTP). OAuth 2.0 authorization code + PKCE S256 with the `resource`
 * parameter; metadata at /.well-known/oauth-protected-resource/mcp and /.well-known/oauth-authorization-server; clients
 * register once per issuer (dynamic registration, public client `token_endpoint_auth_method: none`) and keep the
 * client id (NOTION_MCP_CLIENT_ID); re-registering orphans earlier grants. Access tokens about 8 hours; refresh tokens
 * rotate on every refresh and last up to 180 days; `invalid_grant` is terminal (the founder reconnects). No scopes.
 * Terms: a connected client reads and writes whatever the signing-in member can; workspace owners may restrict clients
 * (Enterprise). Not documented: a revocation endpoint (revoked only if the metadata lists one).
 *
 * HUBSPOT: https://mcp.hubspot.com. OAuth 2.0 with PKCE (required), from a HubSpot developer-platform app: client id and
 * secret (HUBSPOT_MCP_CLIENT_ID / HUBSPOT_MCP_CLIENT_SECRET), the redirect URL set on the app. Read and write on CRM
 * objects and engagements; users, teams and marketing content are read-only; sensitive data properties are not exposed;
 * an account admin must connect first; the app follows HubSpot's app distribution limits. HubSpot plans OAuth 2.1
 * (single-use rotating refresh tokens) later: the refresh queue in client.ts already serializes refreshes.
 *
 * SHOPIFY: Shopify removed the Storefront MCP's catalog and cart tools from `https://{shop}/api/mcp`; they are now
 * UCP at `https://{shop}/api/ucp/mcp`, which asks for an agent profile per request, and Checkout and Customer Accounts
 * MCP list no tools or sign-in in the documentation. Nothing here can be signed into by a founder yet, so the entry is
 * mock-only (`live: false`) and Settings hides it until Shopify's sign-in and the per-store address are confirmed. The
 * existing Shopify API connector stays until then.
 */
import type { JsonSchemaObject } from "../contract";
import type { PlatformSecrets } from "../platform";
import type { RemoteServer, RemoteTool } from "./build";

const obj = (properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true });
const str = (description: string) => ({ type: "string", description });

const SEND_AND_NOTIFY = { contactsThirdParty: true, irreversible: true } as const;

const NOTION_TOOLS: RemoteTool[] = [
  { remote: "notion-search", description: "Search the workspace (and connected sources) by meaning.", inputSchema: obj({ query: str("What to look for"), query_type: str("internal or user") }, ["query"]) },
  { remote: "notion-fetch", description: "Read a page or database by its URL or id.", inputSchema: obj({ id: str("Page or database URL or id") }, ["id"]) },
  { remote: "notion-get-users", description: "List the people in the workspace.", inputSchema: obj({ query: str("Name or email to look for") }) },
  { remote: "notion-get-teams", description: "List the teamspaces.", inputSchema: obj({ query: str("Teamspace name") }) },
  { remote: "notion-get-comments", description: "Read the comments on a page.", inputSchema: obj({ page_id: str("Page id") }, ["page_id"]) },
  { remote: "notion-create-pages", writes: true, description: "Create pages in the founder's own workspace.", inputSchema: obj({ parent: { type: "object" }, pages: { type: "array", items: { type: "object" } } }, ["pages"]) },
  { remote: "notion-update-page", description: "Change a page's properties or content.", inputSchema: obj({ page_id: str("Page id"), command: { type: "string", enum: ["update_properties", "update_content"], description: "update_properties (properties, icon, cover) or update_content (search and replace)" } }, ["page_id", "command"]), hints: { irreversible: true } },
  { remote: "notion-move-pages", description: "Move pages to another parent.", inputSchema: obj({ page_or_database_ids: { type: "array", items: { type: "string" } }, new_parent: { type: "object" } }, ["page_or_database_ids", "new_parent"]), hints: { irreversible: true } },
  { remote: "notion-duplicate-page", writes: true, description: "Copy a page.", inputSchema: obj({ page_id: str("Page id") }, ["page_id"]) },
  { remote: "notion-create-database", writes: true, description: "Create a database.", inputSchema: obj({ title: str("Title"), properties: { type: "object" } }, ["properties"]) },
  { remote: "notion-update-database", description: "Change a database's properties.", inputSchema: obj({ database_id: str("Database id") }, ["database_id"]), hints: { irreversible: true } },
  // A comment notifies the people mentioned in it.
  { remote: "notion-create-comment", description: "Comment on a page; people mentioned are notified.", inputSchema: obj({ page_id: str("Page id"), rich_text: { type: "array" } }, ["page_id", "rich_text"]), hints: SEND_AND_NOTIFY },
];

const HUBSPOT_READ = (remote: string, description: string): RemoteTool => ({ remote, description, inputSchema: obj() });
const HUBSPOT_TOOLS: RemoteTool[] = [
  HUBSPOT_READ("get_user_details", "Who is connected and what the account allows."),
  HUBSPOT_READ("get_organization_details", "The HubSpot account's details."),
  HUBSPOT_READ("discover_hubspot_schema", "Objects, properties and pipelines of the account."),
  HUBSPOT_READ("search_crm_objects", "Search contacts, companies, deals and tickets."),
  HUBSPOT_READ("get_crm_objects", "Read CRM records by id."),
  HUBSPOT_READ("query_crm_data", "Run a read query over CRM data."),
  HUBSPOT_READ("search_properties", "Find CRM properties."),
  HUBSPOT_READ("get_properties", "Read CRM property definitions."),
  HUBSPOT_READ("search_owners", "Find record owners."),
  HUBSPOT_READ("read_campaign_data", "Read campaign data."),
  HUBSPOT_READ("get_marketing_email_analytics", "Marketing email results."),
  HUBSPOT_READ("get_content_analytics_report", "Content results."),
  HUBSPOT_READ("search_conversations", "Search conversations."),
  HUBSPOT_READ("get_social_channels", "Connected social channels."),
  HUBSPOT_READ("read_social_posts", "Read social posts."),
  HUBSPOT_READ("get_social_post_analytics", "Social post results."),
  // Create or change records the account's people and customers see: asks first.
  { remote: "manage_crm_objects", description: "Create or change CRM records.", inputSchema: obj(), hints: { contactsThirdParty: true, irreversible: true } },
  { remote: "manage_marketing_email", description: "Create or change marketing emails.", inputSchema: obj(), hints: SEND_AND_NOTIFY },
  { remote: "manage_social_posts", description: "Create or change social posts.", inputSchema: obj(), hints: SEND_AND_NOTIFY },
  { remote: "manage_blog_post", description: "Create or change blog posts.", inputSchema: obj(), hints: SEND_AND_NOTIFY },
  { remote: "manage_landing_page", description: "Create or change landing pages.", inputSchema: obj(), hints: SEND_AND_NOTIFY },
  { remote: "manage_website_page", description: "Create or change website pages.", inputSchema: obj(), hints: SEND_AND_NOTIFY },
];

const SHOPIFY_TOOLS: RemoteTool[] = [
  { remote: "search_catalog", description: "Search the store's products.", inputSchema: obj({ query: str("What to look for") }, ["query"]) },
  { remote: "lookup_catalog", description: "Look products up by id.", inputSchema: obj({ ids: { type: "array", items: { type: "string" } } }, ["ids"]) },
  { remote: "get_product", description: "One product's details.", inputSchema: obj({ id: str("Product id") }, ["id"]) },
  { remote: "get_cart", description: "Read a cart.", inputSchema: obj({ cart_id: str("Cart id") }, ["cart_id"]) },
  { remote: "ask_business", description: "Ask the store's policies and FAQ.", inputSchema: obj({ question: str("The question") }, ["question"]) },
  { remote: "create_cart", writes: true, description: "Start a cart (no payment).", inputSchema: obj() },
  { remote: "update_cart", writes: true, description: "Replace a cart's lines (send every line to keep).", inputSchema: obj({ cart_id: str("Cart id") }, ["cart_id"]) },
  // A checkout takes a customer's money: only the customer or the founder does that.
  { remote: "complete_checkout", description: "Complete a checkout.", inputSchema: obj(), hints: { spendsMoney: true, hardGate: true }, humanAction: { title: "Complete this checkout in Shopify", instructions: "A checkout takes a customer's money, so it is done in the store by the customer or by you." } },
];

const sample = (text: string) => () => ({ text });

export const NOTION_MCP: RemoteServer = {
  key: "notion_mcp",
  displayName: "Notion",
  url: "https://mcp.notion.com/mcp",
  live: true,
  clientEnv: "NOTION_MCP_CLIENT_ID / MCP_OAUTH_SECRET",
  clientOf: (s: PlatformSecrets) => (s.notionMcpClientId ? { clientId: s.notionMcpClientId } : null),
  tools: NOTION_TOOLS,
  mock: {
    "notion-search": () => ({ text: "Results: Customer interviews (page), Launch checklist (page), Pricing notes (page)", structured: { results: [{ id: "page-interviews", title: "Customer interviews" }, { id: "page-launch", title: "Launch checklist" }] } }),
    "notion-fetch": sample("Launch checklist\n- Pick a name\n- Publish the page\n- Email five people"),
    "notion-create-pages": sample("Created 1 page: Weekly notes"),
    "notion-update-page": sample("Updated the page"),
  },
};

export const HUBSPOT_MCP: RemoteServer = {
  key: "hubspot_mcp",
  displayName: "HubSpot",
  url: "https://mcp.hubspot.com",
  live: true,
  clientEnv: "HUBSPOT_MCP_CLIENT_ID / HUBSPOT_MCP_CLIENT_SECRET / MCP_OAUTH_SECRET",
  clientOf: (s: PlatformSecrets) => (s.hubspotMcpClientId ? { clientId: s.hubspotMcpClientId, ...(s.hubspotMcpClientSecret ? { clientSecret: s.hubspotMcpClientSecret } : {}) } : null),
  tools: HUBSPOT_TOOLS,
  mock: {
    get_user_details: sample("Connected as the owner of a sample HubSpot account"),
    search_crm_objects: () => ({ text: "2 contacts match: Maja Lindqvist (lead), Jonas Berg (customer)", structured: { total: 2 } }),
    manage_crm_objects: sample("Created contact: Maja Lindqvist"),
  },
};

export const SHOPIFY_MCP: RemoteServer = {
  key: "shopify_mcp",
  displayName: "Shopify store",
  url: "https://example-store.myshopify.com/api/ucp/mcp",
  live: false,
  clientEnv: "SHOPIFY_MCP_CLIENT_ID / MCP_OAUTH_SECRET",
  clientOf: (s: PlatformSecrets) => (s.shopifyMcpClientId ? { clientId: s.shopifyMcpClientId } : null),
  tools: SHOPIFY_TOOLS,
  mock: {
    search_catalog: () => ({ text: "3 products: Calming serum, Barrier cream, Cleansing oil", structured: { total: 3 } }),
    get_cart: sample("Cart is empty"),
    create_cart: sample("Started cart cart_1"),
  },
};

export const REMOTE_MCP_SERVERS: readonly RemoteServer[] = [NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP];
