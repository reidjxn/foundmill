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
import { createPlatformConnector } from "./connectors/platform";
import { createQuarantineConnector } from "./connectors/quarantine";
import { createWebConnector } from "./connectors/web";
import { createPlatformMailConnector } from "./connectors/platform_mail";

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
} satisfies Record<string, ConnectorFactory>);

/**
 * Connectors whose mode follows another key's switch: `platform_mail` and `platform_notify` are SendGrid underneath, so
 * they run live exactly where `sendgrid` does (`INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` naming `sendgrid`; packages/shared `platformMailMode`).
 */
export const CONNECTOR_MODE_KEYS: Readonly<Record<string, string>> = Object.freeze({ platform_mail: "sendgrid", platform_notify: "sendgrid" });

/** The key whose switch decides this connector's mode (itself, unless `CONNECTOR_MODE_KEYS` names another). */
export const modeKeyOf = (connectorKey: string): string => CONNECTOR_MODE_KEYS[connectorKey] ?? connectorKey;

export const BUILTIN_CONNECTOR_KEYS: readonly string[] = Object.freeze(Object.keys(BUILTIN_CONNECTOR_FACTORIES));

/**
 * Built-ins whose live side runs in every INTEGRATIONS_MODE: it is the platform's own data (`platform`) or its metered
 * model client, which follows MODEL_MODE (`quarantine`), so agents in a mock-mode deployment still work on the real task
 * board. `web` reaches the internet and follows the mode like a vendor.
 */
export const ALWAYS_LIVE_CONNECTORS: ReadonlySet<string> = new Set(["platform", "quarantine"]);

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
