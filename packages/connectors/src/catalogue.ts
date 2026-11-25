/**
 * Every connector this package ships, and the registry the gateway / ingest / api build from them. The
 * live side is constructed with the host's `LiveConnectorOptions` (platform secrets, fetch, business
 * resolver, suppression hook); the mock side is always available and needs nothing.
 */
import type { Connector } from "./contract";
import type { LiveConnectorOptions } from "./platform";
import { createRegistry, type ConnectorRegistry } from "./registry";
import { createAnthropicConnector } from "./connectors/anthropic";
import { createBolagsverketConnector } from "./connectors/bolagsverket";
import { createCloudflareDnsConnector } from "./connectors/cloudflare_dns";
import { createCompaniesHouseConnector } from "./connectors/companies_house";
import { createDomainsConnector } from "./connectors/domains";
import { createDropboxSignConnector } from "./connectors/dropbox_sign";
import { createE2bConnector } from "./connectors/e2b";
import { createFfmpegConnector, createGimpConnector, createInkscapeConnector, createLibreofficeConnector } from "./connectors/cli_anything";
import { createEcbRatesConnector } from "./connectors/ecb_rates";
import { createGithubConnector } from "./connectors/github";
import { createGmailConnector } from "./connectors/gmail";
import { createGoogleCalendarConnector } from "./connectors/google_calendar";
import { createGoogleDriveConnector } from "./connectors/google_drive";
import { createNotionConnector } from "./connectors/notion";
import { createOpencorporatesConnector } from "./connectors/opencorporates";
import { createPlaidConnector } from "./connectors/plaid";
import { createSendgridConnector } from "./connectors/sendgrid";
import { createShopifyConnector } from "./connectors/shopify";
import { createStripeConnector } from "./connectors/stripe";
import { createTinkConnector } from "./connectors/tink";
import { createVoyageConnector } from "./connectors/voyage";
import { createOpenaiImagesConnector } from "./connectors/openai_images";
import { createElevenlabsConnector } from "./connectors/elevenlabs";
import { createOnesignalConnector } from "./connectors/onesignal";
import { createPlatformNotifyConnector } from "./connectors/platform_notify";
import { createSendingDomainConnector } from "./connectors/sending_domain";
import { createOpensrsConnector } from "./connectors/opensrs";
import { createPlatformConnector } from "./connectors/platform";
import { createQuarantineConnector } from "./connectors/quarantine";
import { createWebConnector } from "./connectors/web";
import { createPlatformMailConnector } from "./connectors/platform_mail";
import { createOpenaiConnector } from "./connectors/openai";
import { createGeminiConnector } from "./connectors/gemini";
import { createPerplexityConnector } from "./connectors/perplexity";
import { createSerpapiConnector } from "./connectors/serpapi";
import { createFirecrawlConnector } from "./connectors/firecrawl";
import { createElevenlabsVoiceConnector } from "./connectors/elevenlabs_voice";
import { createRunwayConnector } from "./connectors/runway";
import { createIndexNowConnector } from "./connectors/indexnow";
import { createApolloConnector } from "./connectors/apollo";
import { createVercelConnector } from "./connectors/vercel";
import { createPosthogConnector } from "./connectors/posthog";
import { createResendConnector } from "./connectors/resend";
import { createBufferConnector } from "./connectors/buffer";
import { BROWSER_CONNECTOR_FACTORIES } from "./connectors/browser";
import { createHubspotMcpConnector, createLightbringerMcpConnector, createMcpCustomConnector, createNotionMcpConnector, createSentryMcpConnector, createShopifyMcpConnector } from "./remote-mcp";

export type ConnectorFactory = (options?: LiveConnectorOptions) => Connector;

/** Factories keyed by connector key, in catalogue order (BUILD §13.2). */
export const CONNECTOR_FACTORIES: Readonly<Record<string, ConnectorFactory>> = Object.freeze({
  anthropic: createAnthropicConnector,
  voyage: createVoyageConnector,
  openai_images: createOpenaiImagesConnector,
  // Speech for Team call: service-only, on the platform's ELEVENLABS_API_KEY.
  elevenlabs: createElevenlabsConnector,
  onesignal: createOnesignalConnector,
  // Foundmill's own email to its users (packages 1.5 and 5.1): service-only, on the platform's SendGrid key.
  platform_notify: createPlatformNotifyConnector,
  // A project's own domain at the platform's SendGrid (WP-08 domain plan): service-only, the gateway's `/v1/domains/own`.
  sending_domain: createSendingDomainConnector,
  // Domains registered through Foundmill on its OpenSRS reseller account (WP-08 Path A): service-only, `/v1/domains/register`.
  opensrs: createOpensrsConnector,
  github: createGithubConnector,
  google_drive: createGoogleDriveConnector,
  gmail: createGmailConnector,
  google_calendar: createGoogleCalendarConnector,
  notion: createNotionConnector,
  cloudflare_dns: createCloudflareDnsConnector,
  opencorporates: createOpencorporatesConnector,
  bolagsverket: createBolagsverketConnector,
  companies_house: createCompaniesHouseConnector,
  e2b: createE2bConnector,
  dropbox_sign: createDropboxSignConnector,
  ecb_rates: createEcbRatesConnector,
  domains: createDomainsConnector,
  stripe: createStripeConnector,
  sendgrid: createSendgridConnector,
  shopify: createShopifyConnector,
  tink: createTinkConnector,
  plaid: createPlaidConnector,
  // The founder's own key at each vendor, never a platform key (founder, 2026-11-12): how a project appears in other
  // assistants' answers and in Google, what a crawler reads on a page, and telling search engines a page changed.
  openai: createOpenaiConnector,
  gemini: createGeminiConnector,
  perplexity: createPerplexityConnector,
  serpapi: createSerpapiConnector,
  firecrawl: createFirecrawlConnector,
  indexnow: createIndexNowConnector,
  // Also on the founder's own key: leads, deployments, product analytics and email from the founder's own domain.
  apollo: createApolloConnector,
  vercel: createVercelConnector,
  posthog: createPosthogConnector,
  resend: createResendConnector,
  // Generated video and voiceover for ready-to-post kits, on the founder's own keys (founder, 2026-11-13). `elevenlabs_voice`
  // is not the platform's `elevenlabs` (Team call speech): it never reads the platform key.
  runway: createRunwayConnector,
  elevenlabs_voice: createElevenlabsVoiceConnector,
  // Posts queued in the founder's own Buffer account, which publishes them on the networks the founder connected there.
  buffer: createBufferConnector,
  // A vendor's own remote MCP server, the gateway its only client (founder, 2026-11-19). The Notion and Shopify API
  // connectors above stay until their MCP replacement is live.
  notion_mcp: createNotionMcpConnector,
  hubspot_mcp: createHubspotMcpConnector,
  shopify_mcp: createShopifyMcpConnector,
  lightbringer_mcp: createLightbringerMcpConnector,
  sentry_mcp: createSentryMcpConnector,
  mcp_custom: createMcpCustomConnector,
  // A website the team works in through the hosted browser, one connector per site on the site list (founder, Nov 22, 2026).
  ...BROWSER_CONNECTOR_FACTORIES,
});

export const CONNECTOR_KEYS = Object.freeze(Object.keys(CONNECTOR_FACTORIES));

/**
 * Connectors the gateway serves itself next to the catalogue (BUILD §9.9 task board and messages, web reads, the
 * quarantined reader). Not in CONNECTOR_FACTORIES: there is nothing to connect in Settings › Integrations, and their live
 * side needs host hooks only the gateway has (`platform`, `quarantinedReader`).
 */
export const BUILTIN_CONNECTOR_FACTORIES = Object.freeze({
  platform: createPlatformConnector,
  web: createWebConnector,
  quarantine: createQuarantineConnector,
  // A project's Foundmill sending address (package 1.5): the platform's own SendGrid account, nothing to connect.
  platform_mail: createPlatformMailConnector,
  // Open-source programs the team drives in the project's sandbox (CLI-Anything, founder 2026-11-19): nothing to connect.
  cli_inkscape: createInkscapeConnector,
  cli_libreoffice: createLibreofficeConnector,
  cli_ffmpeg: createFfmpegConnector,
  cli_gimp: createGimpConnector,
} satisfies Record<string, ConnectorFactory>);

/**
 * Connectors whose mode follows another key's switch: `platform_mail` and `platform_notify` are SendGrid underneath, so
 * they run live exactly where `sendgrid` does (`INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` naming `sendgrid`; packages/shared `platformMailMode`).
 */
export const CONNECTOR_MODE_KEYS: Readonly<Record<string, string>> = Object.freeze({ platform_mail: "sendgrid", platform_notify: "sendgrid", sending_domain: "sendgrid" });

/** The key whose switch decides this connector's mode (itself, unless `CONNECTOR_MODE_KEYS` names another). */
export const modeKeyOf = (connectorKey: string): string => CONNECTOR_MODE_KEYS[connectorKey] ?? connectorKey;

export const BUILTIN_CONNECTOR_KEYS: readonly string[] = Object.freeze(Object.keys(BUILTIN_CONNECTOR_FACTORIES));

/**
 * Built-ins whose live side runs in every INTEGRATIONS_MODE: it is the platform's own data (`platform`) or its metered
 * model client, which follows MODEL_MODE (`quarantine`), so agents in a mock-mode deployment still work on the real task
 * board. `web` reaches the internet and follows the mode like a vendor.
 */
export const ALWAYS_LIVE_CONNECTORS: ReadonlySet<string> = new Set(["platform", "quarantine"]);

/**
 * Account-free connectors whose mock refuses a simulated send by itself on a person's project (apps/gateway
 * platform-mail.ts and notify-email.ts), so the gateway's connection refusal leaves them to it (WP-05 T1).
 */
export const SELF_REFUSING_MOCK_CONNECTORS: ReadonlySet<string> = new Set(["platform_mail", "platform_notify"]);

/** The built-in connectors, live side wired with `options`. */
export function createBuiltinConnectors(options: LiveConnectorOptions = {}): Connector[] {
  return Object.values(BUILTIN_CONNECTOR_FACTORIES).map((factory) => factory(options));
}

/** Build every connector (live side wired with `options`; the registry serves mocks in mock mode). */
export function createAllConnectors(options: LiveConnectorOptions = {}): Connector[] {
  return Object.values(CONNECTOR_FACTORIES).map((factory) => factory(options));
}

/** The registry hosts use: `createDefaultRegistry({ secrets, resolveBusinessId, isSuppressed })`. */
export function createDefaultRegistry(options: LiveConnectorOptions = {}): ConnectorRegistry {
  return createRegistry(createAllConnectors(options));
}
