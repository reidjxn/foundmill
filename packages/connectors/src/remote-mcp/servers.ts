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
 *
 * LIGHTBRINGER (patents, founder's direction of 2026-11-22): https://mcp.lightbringer.com/mcp, server lightbringer-mcp-server
 * 4.27.0, MCP 2025-06-18, as read on Nov 22, 2026 (51 tools). OAuth: the protected-resource metadata names the
 * authorization server https://app.lightbringer.com and the scopes `mcp:read`, `mcp:write` and `mcp:trade-secrets`, bearer
 * token in the header. Foundmill asks for `mcp:read` and `mcp:write` only, never `mcp:trade-secrets`. Foundmill's own OAuth
 * client was approved on 2026-11-22; until LIGHTBRINGER_MCP_CLIENT_ID is set the entry is mock-only (`live: false`) and
 * Settings hides it. The server has no tool that files a patent or quotes or takes a fee: its own instructions say payments
 * and paid terms need a human handoff, and `request_patent_preparation` "does not itself complete preparation, file a patent
 * or pay for services". It only tells Lightbringer's patent team the founder wants the invention prepared; Lightbringer then
 * quotes its fee and takes payment and terms itself, with the founder. That tool is `founderExecuted`: no agent ever calls
 * it, the gateway runs it only from the founder's one press on the exact payload (apps/gateway `founder-action.ts`).
 */
import { createHash } from "node:crypto";
import { AppError } from "@foundmill/shared";
import type { JsonSchemaObject } from "../contract";
import { fact } from "../facts";
import type { PlatformSecrets } from "../platform";
import type { RemoteServer, RemoteTool } from "./build";
import { LIGHTBRINGER_SCHEMAS } from "./lightbringer-schemas";

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
  { remote: "notion-update-page", writes: true, description: "Change a page's properties or content.", inputSchema: obj({ page_id: str("Page id"), command: { type: "string", enum: ["update_properties", "update_content"], description: "update_properties (properties, icon, cover) or update_content (search and replace)" } }, ["page_id", "command"]) },
  { remote: "notion-move-pages", description: "Move pages to another parent.", inputSchema: obj({ page_or_database_ids: { type: "array", items: { type: "string" } }, new_parent: { type: "object" } }, ["page_or_database_ids", "new_parent"]), hints: { irreversible: true } },
  { remote: "notion-duplicate-page", writes: true, description: "Copy a page.", inputSchema: obj({ page_id: str("Page id") }, ["page_id"]) },
  { remote: "notion-create-database", writes: true, description: "Create a database.", inputSchema: obj({ title: str("Title"), properties: { type: "object" } }, ["properties"]) },
  { remote: "notion-update-database", writes: true, description: "Change a database's properties.", inputSchema: obj({ database_id: str("Database id") }, ["database_id"]) },
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
  // Records and pages in the founder's own account run with no approval (founder, Nov 23, 2026: "They should never have to
  // approve individual steps"); deleting one is still refused (`remoteHardGateCall`).
  { remote: "manage_crm_objects", writes: true, description: "Create or change CRM records.", inputSchema: obj() },
  { remote: "manage_blog_post", writes: true, description: "Create or change blog posts.", inputSchema: obj() },
  { remote: "manage_landing_page", writes: true, description: "Create or change landing pages.", inputSchema: obj() },
  { remote: "manage_website_page", writes: true, description: "Create or change website pages.", inputSchema: obj() },
  // Mail and posts reach outside people: they ask in augmented mode only, like a Buffer post (founder, Nov 24, 2026).
  { remote: "manage_marketing_email", description: "Create or change marketing emails.", inputSchema: obj(), hints: { contactsThirdParty: true } },
  { remote: "manage_social_posts", description: "Create or change social posts.", inputSchema: obj(), hints: { contactsThirdParty: true } },
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

const LB_ASKS = { contactsThirdParty: true, irreversible: true, askAlways: true } as const;
const lb = (remote: string, description: string, extra: Partial<RemoteTool> = {}): RemoteTool => ({ remote, description, inputSchema: LIGHTBRINGER_SCHEMAS[remote]!, ...extra });
/** A hard-gated Lightbringer tool: permanent deletion or sharing access, done by the founder in Lightbringer. */
const lbGated = (remote: string, description: string, title: string, instructions: string): RemoteTool => lb(remote, description, { hints: { hardGate: true }, humanAction: { title, instructions } });
const LB_DELETE = (what: string) => `Deleting ${what} cannot be undone, so you do it in Lightbringer.`;

/**
 * Lightbringer's tools by what Foundmill lets happen (a reviewed list of 35 of its 51; the rest are reachable only through
 * `call_unlisted_tool`, which asks first). The invention disclosure is the founder's own, inside the founder's own
 * Lightbringer organization: reading, drafting and the automated feedback run; anything that reaches Lightbringer's
 * practitioners or another person, or changes what others see, asks first in every mode (`askAlways`); deletion and sharing
 * access are the founder's own steps; the request to prepare a patent is the founder's one press.
 */
const LIGHTBRINGER_TOOLS: RemoteTool[] = [
  lb("whoami", "Who is signed in at Lightbringer and for which organization."),
  lb("list_innovations", "List the inventions in the founder's Lightbringer organization."),
  lb("get_innovation", "Read one invention disclosure.", {
    // The typed read the note and the press check rely on: an id, a short title, a reference and a hash of the text.
    facts: (structured) => {
      const s = (structured ?? {}) as { id?: unknown; title?: unknown; refNum?: unknown; markdown?: unknown };
      return { inventionId: fact.id(s.id), title: fact.label(s.title), refNum: fact.id(s.refNum), contentHash: typeof s.markdown === "string" ? createHash("sha256").update(s.markdown).digest("hex") : null };
    },
  }),
  lb("get_innovation_template", "The sections an invention disclosure needs."),
  lb("search", "Search the organization's Lightbringer records."),
  lb("fetch", "Read one Lightbringer record by id."),
  lb("show_patent_portfolio", "Show the organization's patent portfolio."),
  lb("search_public_patents", "Search public patents."),
  lb("get_credits", "How many Lightbringer credits the organization has."),
  lb("list_tasks", "List Lightbringer's work on an invention."),
  lb("get_task_status", "The status of one Lightbringer task."),
  lb("list_reviews", "List the reviews waiting on the organization."),
  lb("get_review", "Read one review."),
  lb("get_company_context", "Read the company context Lightbringer holds."),
  // Drafting and checking a disclosure inside the founder's own organization: nobody outside is contacted and nothing is filed.
  // The recorded schema is long (lightbringer-schemas.ts); an agent gets a short one and reads the sections from get_innovation_template, and Lightbringer checks the values.
  lb("register_innovation", "Create a draft invention disclosure. Take the sections from get_innovation_template.", { writes: true, inputSchema: obj({ definition: { type: "object" } }, ["definition"]) }),
  lb("update_innovation", "Change sections of a draft invention disclosure.", { writes: true }),
  lb("start_innovation_feedback", "Start Lightbringer's automated feedback on a draft disclosure.", { writes: true }),
  // These reach Lightbringer's practitioners or another person, or change what others see: the founder is asked every time.
  lb("respond_to_review", "Answer a review from Lightbringer's practitioners.", { hints: LB_ASKS }),
  lb("add_comment", "Comment on a review.", { hints: LB_ASKS }),
  lb("add_discussion_comment", "Add to a review's discussion.", { hints: LB_ASKS }),
  lb("reply_to_comment", "Reply to a comment on a review.", { hints: LB_ASKS }),
  lb("comment", "Comment on a record.", { hints: LB_ASKS }),
  lb("set_validation_countries", "Choose the countries a patent is validated in.", { hints: LB_ASKS }),
  lb("import_patent", "Bring a public patent into the organization's records.", { hints: LB_ASKS }),
  lb("start_journey", "Start one of Lightbringer's guided workflows.", { hints: LB_ASKS }),
  lb("ask_agent", "Message Lightbringer's agent on a task.", { hints: LB_ASKS }),
  lb("answer_agent", "Answer a question Lightbringer's agent asked.", { hints: LB_ASKS }),
  lb("update_company_context", "Change the company context others at Lightbringer see.", { hints: LB_ASKS }),
  // Sharing access to the organization's records is a security setting (HARD_GATE_STEMS "invit"): the founder does it in Lightbringer.
  lbGated("invite_members", "Invite people to the organization's records.", "Invite people in Lightbringer", "Giving someone access to your invention records is a security setting, so you do it in Lightbringer."),
  lbGated("delete_asset", "Delete a Lightbringer asset.", "Delete this in Lightbringer", LB_DELETE("an asset")),
  lbGated("delete_strategy", "Delete a strategy.", "Delete this in Lightbringer", LB_DELETE("a strategy")),
  lbGated("delete_task", "Delete a task.", "Delete this in Lightbringer", LB_DELETE("a task")),
  lbGated("delete_comment", "Delete a comment.", "Delete this in Lightbringer", LB_DELETE("a comment")),
  // The founder's one press, never an agent: tells Lightbringer's patent team the founder wants this invention prepared.
  lb("request_patent_preparation", "Ask Lightbringer's patent team to prepare this invention for a patent filing. Runs only from the founder's own press.", { writes: true, hints: { contactsThirdParty: true, irreversible: true, founderExecuted: true } }),
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

/** The invention the recorded mock knows; `inv_demo_fail` is the one whose request the mock refuses (tests, the Playwright spec). */
export const LIGHTBRINGER_DEMO_INVENTION = "inv_demo_1";
export const LIGHTBRINGER_DEMO_FAIL_INVENTION = "inv_demo_fail";
const LB_URL = "https://app.lightbringer.com";
const lbInvention = (id: string) => ({ id, title: "Self-leveling bike rack hinge", refNum: "LB-2026-0042", url: `${LB_URL}/innovations/${id}`, markdown: "# Self-leveling bike rack hinge\n\n## Problem\nBike racks tilt when the car is loaded unevenly.\n\n## Solution\nA hinge with a weighted cam keeps the rack level." });
const lbText = (text: string, structured?: unknown) => ({ text, ...(structured !== undefined ? { structured } : {}) });
const lbId = (a: Record<string, unknown>): string => (typeof a.invention_id === "string" ? a.invention_id : LIGHTBRINGER_DEMO_INVENTION);

export const LIGHTBRINGER_MCP: RemoteServer = {
  key: "lightbringer_mcp",
  displayName: "Lightbringer",
  url: "https://mcp.lightbringer.com/mcp",
  live: false,
  scopes: ["mcp:read", "mcp:write"],
  clientEnv: "LIGHTBRINGER_MCP_CLIENT_ID / MCP_OAUTH_SECRET",
  clientOf: (s: PlatformSecrets) => (s.lightbringerMcpClientId ? { clientId: s.lightbringerMcpClientId } : null),
  tools: LIGHTBRINGER_TOOLS,
  mock: {
    whoami: () => lbText("Signed in as a sample founder at Northwind Bikes", { user: { name: "Sample Founder", role: "owner" }, organisation: { name: "Northwind Bikes", country: "US" } }),
    list_innovations: () => lbText("1 invention: Self-leveling bike rack hinge (LB-2026-0042)", { inventions: [{ id: LIGHTBRINGER_DEMO_INVENTION, title: "Self-leveling bike rack hinge", refNum: "LB-2026-0042", url: `${LB_URL}/innovations/${LIGHTBRINGER_DEMO_INVENTION}` }] }),
    get_innovation: (a) => lbText("Self-leveling bike rack hinge (LB-2026-0042)", lbInvention(lbId(a))),
    get_innovation_template: sample("Sections: problem, solution, technical details, prior art, variants, inventors, public disclosures"),
    search: () => lbText("1 result: Self-leveling bike rack hinge (innovation)", { results: [{ id: LIGHTBRINGER_DEMO_INVENTION, title: "Self-leveling bike rack hinge", category: "innovation" }] }),
    fetch: (a) => lbText("Self-leveling bike rack hinge (LB-2026-0042)", lbInvention(typeof a.id === "string" ? a.id : LIGHTBRINGER_DEMO_INVENTION)),
    show_patent_portfolio: sample("Portfolio: 1 invention disclosure, 0 filed patents"),
    search_public_patents: () => lbText("2 public patents about self-leveling hinges", { total: 2 }),
    get_credits: () => lbText("12 Lightbringer credits left", { credits: 12 }),
    list_tasks: () => lbText("1 task: Automated feedback on LB-2026-0042 (done)", { tasks: [{ id: "task_demo_1", status: "done" }] }),
    get_task_status: () => lbText("Task task_demo_1 is done", { id: "task_demo_1", status: "done" }),
    list_reviews: () => lbText("0 reviews waiting", { reviews: [] }),
    get_review: sample("No such review in the sample organization"),
    get_company_context: sample("Northwind Bikes: bike racks for city cyclists"),
    register_innovation: () => lbText("Created draft LB-2026-0042", { id: LIGHTBRINGER_DEMO_INVENTION, refNum: "LB-2026-0042", url: `${LB_URL}/innovations/${LIGHTBRINGER_DEMO_INVENTION}` }),
    update_innovation: sample("Updated the draft disclosure"),
    start_innovation_feedback: () => lbText("Started automated feedback (task task_demo_2)", { taskId: "task_demo_2" }),
    respond_to_review: sample("Sent the response to the review"),
    add_comment: sample("Added the comment"),
    add_discussion_comment: sample("Added to the discussion"),
    reply_to_comment: sample("Sent the reply"),
    comment: sample("Added the comment"),
    set_validation_countries: sample("Saved the validation countries"),
    import_patent: sample("Imported the patent into the organization's records"),
    start_journey: sample("Started the guided workflow"),
    ask_agent: sample("Sent the message to Lightbringer's agent"),
    answer_agent: sample("Sent the answers to Lightbringer's agent"),
    update_company_context: sample("Updated the company context"),
    request_patent_preparation: (a) => {
      // The recorded refusal: what a vendor that cannot take the request answers, so the failure path is testable.
      if (lbId(a) === LIGHTBRINGER_DEMO_FAIL_INVENTION) throw new AppError("remote_tool_error", "The tool reported an error", 502);
      return lbText("Preparation requested for LB-2026-0042", { id: lbId(a), url: `${LB_URL}/innovations/${lbId(a)}`, refNum: "LB-2026-0042", outcome: "requested" });
    },
  },
};

export const REMOTE_MCP_SERVERS: readonly RemoteServer[] = [NOTION_MCP, HUBSPOT_MCP, SHOPIFY_MCP, LIGHTBRINGER_MCP];

/** A tool name folded to lower case letters and digits, so `requestPatentPreparation`, `request-patent-preparation` and `Request Patent Preparation` are one name. */
export const foldedToolName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The folded names of the founder-executed tools of every server (their `remote` names): no server may be reached around the founder's press under any of them. */
export const FOUNDER_EXECUTED_FOLDED_NAMES: ReadonlySet<string> = new Set(REMOTE_MCP_SERVERS.flatMap((s) => s.tools.filter((t) => t.hints?.founderExecuted).map((t) => foldedToolName(t.remote))));

/** The hosts of the servers Foundmill has a list for: a custom server never points at one of them. */
export const LISTED_SERVER_HOSTS: ReadonlyMap<string, string> = new Map(REMOTE_MCP_SERVERS.map((s) => [new URL(s.url).hostname.toLowerCase(), s.displayName]));
