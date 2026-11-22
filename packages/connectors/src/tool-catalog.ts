/**
 * The tool catalog (founder, Nov 22, 2026): for each kind of tool a project can need, the options Foundmill knows. The
 * tool scout (`tool_scout` skill, the Chief of Staff's `recommend_tool`) starts here and may still suggest a vendor
 * that is not listed; the note then says "not yet checked by Foundmill".
 *
 * This is data about vendors, not a list of connectors: `connectorKey` names the connector or remote MCP server
 * Foundmill serves for an entry, where one exists (`CONNECTOR_FACTORIES` in ./catalogue.ts); an entry without one comes
 * in by the route it names (the founder's own key in Settings › Integrations, or a link on the project page).
 * `route: "foundmill"` is Foundmill's own feature: nothing to sign up for, no vendor.
 *
 * Booking and scheduling is Foundmill's own, free on every plan (founder, Nov 22, 2026): no booking vendor is listed
 * or named by the team.
 *
 * Every price is an Estimate, a band read from the vendor's public pricing on `checkedOn`; the scout checks the
 * current price before it recommends. The entries of Nov 22, 2026 were written from what the session knew, not from
 * a fresh read of each pricing page: re-check an entry and move its date when you touch it.
 */
import { APP_NAME } from "@foundmill/config";
import { TOOL_CATEGORIES, type ToolCategory, type ToolRoute } from "@foundmill/shared";

/** A coarse monthly price for a project in its first chapter. Always shown with "Estimate". */
export type PriceBand = "free" | "free_tier" | "usage" | "under_50" | "50_to_250" | "over_250" | "quote";

export const PRICE_BAND_WORDS: Readonly<Record<PriceBand, string>> = Object.freeze({
  free: "free",
  free_tier: "free to start, paid as you grow",
  usage: "pay for what you use",
  under_50: "under $50 a month",
  "50_to_250": "$50 to $250 a month",
  over_250: "over $250 a month",
  quote: "priced on request",
});

export interface CatalogTool {
  /** snake_case, unique. */
  key: string;
  name: string;
  categories: readonly ToolCategory[];
  /** The vendor's own site; absent for Foundmill's own. */
  url?: string;
  /** Where its customers can be: "global", or ISO country and region codes ("US", "EU", "UK"). */
  regions: "global" | readonly string[];
  route: ToolRoute;
  /** The connector or remote MCP server Foundmill serves for it, if any. */
  connectorKey?: string;
  /** A test or sandbox mode exists, so the team can build against it before a live key is entered. */
  testMode: boolean;
  priceBand: PriceBand;
  /** One line a founder can read. */
  note: string;
  /** The day the entry was last checked, ISO. */
  checkedOn: string;
}

const CHECKED = "2026-11-22";
const own = (key: string, name: string, categories: ToolCategory[], note: string): CatalogTool => ({ key, name, categories, regions: "global", route: "foundmill", testMode: true, priceBand: "free", note, checkedOn: CHECKED });
const vendor = (t: Omit<CatalogTool, "checkedOn">): CatalogTool => ({ ...t, checkedOn: CHECKED });

export const TOOL_CATALOG: readonly CatalogTool[] = Object.freeze([
  // Foundmill's own: used first, with no vendor.
  own("foundmill_booking", `${APP_NAME} booking`, ["booking"], "Customers pick a time on your project's page. Free on every plan."),
  own("foundmill_page_form", "The form on your project's page", ["forms"], "People leave their email on your page and agree to hear from you."),
  own("foundmill_sending_address", "Your project's sending address", ["email"], `Email from your project's ${APP_NAME} address, with a daily cap and your approval for outside contact.`),

  vendor({ key: "stripe", name: "Stripe", categories: ["payments", "subscriptions", "invoicing_accounting"], url: "https://stripe.com", regions: "global", route: "api_key", connectorKey: "stripe", testMode: true, priceBand: "usage", note: "Card payments, subscriptions and invoices; a fee per payment, no monthly fee." }),
  vendor({ key: "stripe_identity", name: "Stripe Identity", categories: ["kyc_identity"], url: "https://stripe.com/identity", regions: "global", route: "api_key", connectorKey: "stripe", testMode: true, priceBand: "usage", note: "Checks a person's ID document and selfie; a fee per check." }),
  vendor({ key: "persona", name: "Persona", categories: ["kyc_identity", "aml_screening"], url: "https://withpersona.com", regions: "global", route: "api_key", testMode: true, priceBand: "free_tier", note: "Identity checks with watchlist screening in one flow." }),
  vendor({ key: "veriff", name: "Veriff", categories: ["kyc_identity"], url: "https://www.veriff.com", regions: "global", route: "api_key", testMode: true, priceBand: "50_to_250", note: "Identity checks with wide document coverage." }),
  vendor({ key: "sumsub", name: "Sumsub", categories: ["kyc_identity", "aml_screening"], url: "https://sumsub.com", regions: "global", route: "api_key", testMode: true, priceBand: "usage", note: "Identity checks, sanctions screening and transaction monitoring; a fee per check with a monthly minimum." }),
  vendor({ key: "complyadvantage", name: "ComplyAdvantage", categories: ["aml_screening"], url: "https://complyadvantage.com", regions: "global", route: "api_key", testMode: true, priceBand: "quote", note: "Sanctions, watchlist and adverse-media screening." }),
  vendor({ key: "dropbox_sign", name: "Dropbox Sign", categories: ["e_signature"], url: "https://sign.dropbox.com", regions: "global", route: "api_key", connectorKey: "dropbox_sign", testMode: true, priceBand: "under_50", note: "Sends a document for signature. You sign and send; the team prepares." }),
  vendor({ key: "xero", name: "Xero", categories: ["invoicing_accounting"], url: "https://www.xero.com", regions: "global", route: "link", testMode: true, priceBand: "under_50", note: "Bookkeeping and invoices; common in the UK, Australia and New Zealand." }),
  vendor({ key: "quickbooks", name: "QuickBooks Online", categories: ["invoicing_accounting"], url: "https://quickbooks.intuit.com", regions: ["US", "CA", "UK"], route: "link", testMode: true, priceBand: "under_50", note: "Bookkeeping and invoices; common in the US." }),
  vendor({ key: "resend", name: "Resend", categories: ["email"], url: "https://resend.com", regions: "global", route: "api_key", connectorKey: "resend", testMode: true, priceBand: "free_tier", note: "Email from your own domain, on your own account." }),
  vendor({ key: "twilio", name: "Twilio", categories: ["sms"], url: "https://www.twilio.com", regions: "global", route: "api_key", testMode: true, priceBand: "usage", note: "Text messages; a fee per message, and some countries ask you to register the sender first." }),
  vendor({ key: "tally", name: "Tally", categories: ["forms"], url: "https://tally.so", regions: "global", route: "link", testMode: false, priceBand: "free_tier", note: "Longer forms and surveys, linked from your page." }),
  vendor({ key: "hubspot", name: "HubSpot", categories: ["help_desk"], url: "https://www.hubspot.com", regions: "global", route: "remote_mcp", connectorKey: "hubspot_mcp", testMode: false, priceBand: "free_tier", note: "A shared inbox and customer records." }),
  vendor({ key: "posthog", name: "PostHog", categories: ["analytics"], url: "https://posthog.com", regions: "global", route: "api_key", connectorKey: "posthog", testMode: false, priceBand: "free_tier", note: "What people do in your product, with a large free allowance." }),
  vendor({ key: "shopify", name: "Shopify", categories: ["shipping", "inventory"], url: "https://www.shopify.com", regions: "global", route: "remote_mcp", connectorKey: "shopify_mcp", testMode: true, priceBand: "under_50", note: "A store with stock counts and shipping labels built in." }),
  vendor({ key: "shippo", name: "Shippo", categories: ["shipping"], url: "https://goshippo.com", regions: ["US", "CA", "UK", "EU", "AU"], route: "api_key", testMode: true, priceBand: "free_tier", note: "Compares carriers and prints labels; a small fee per label." }),
  // Approved by the founder, Nov 22, 2026: the catalog's patents and IP vendor, through its own remote MCP server.
  vendor({ key: "lightbringer", name: "Lightbringer", categories: ["patents_ip"], url: "https://lightbringer.com", regions: ["US"], route: "remote_mcp", testMode: false, priceBand: "quote", note: "Prepares and files a patent application with its own patent practitioners. You file with one press; the fee is quoted before you do." }),
]);

const BY_KEY = new Map(TOOL_CATALOG.map((t) => [t.key, t] as const));

export const catalogTool = (key: string): CatalogTool | null => BY_KEY.get(key) ?? null;

/** The options for a category, Foundmill's own first. */
export function catalogFor(category: ToolCategory): CatalogTool[] {
  return TOOL_CATALOG.filter((t) => t.categories.includes(category)).sort((a, b) => Number(b.route === "foundmill") - Number(a.route === "foundmill"));
}

/** Foundmill's own feature for a category, when it has one: used with no vendor and nothing to recommend. */
export const foundmillOwnFor = (category: ToolCategory): CatalogTool | null => catalogFor(category).find((t) => t.route === "foundmill") ?? null;

/** The connector keys that already cover a category: a project connected to one of them has a tool for the need. */
export function connectorKeysFor(category: ToolCategory): string[] {
  return [...new Set(catalogFor(category).flatMap((t) => (t.connectorKey ? [t.connectorKey] : [])))];
}

/** A catalog entry by the name an agent wrote ("stripe", "Stripe Identity"), or null: not in the catalog. */
export function catalogToolNamed(name: string, category: ToolCategory): CatalogTool | null {
  const wanted = name.trim().toLowerCase();
  return catalogFor(category).find((t) => t.key === wanted || t.name.toLowerCase() === wanted) ?? null;
}

/** The catalog as the scout reads it: one line per option of a category. */
export function catalogLines(category: ToolCategory): string[] {
  return catalogFor(category).map((t) => `${t.name}: ${t.note} ${PRICE_BAND_WORDS[t.priceBand]} (Estimate, checked ${t.checkedOn}). Comes in by: ${t.route === "foundmill" ? `${APP_NAME}'s own, nothing to sign up for` : t.route === "remote_mcp" ? "the vendor's own sign-in in Settings › Integrations" : t.route === "api_key" ? "your own key in Settings › Integrations" : "a link"}. ${t.testMode ? "Has a test mode." : "No test mode."}`);
}

export { TOOL_CATEGORIES };
