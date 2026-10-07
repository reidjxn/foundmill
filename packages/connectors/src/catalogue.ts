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

export type ConnectorFactory = (options?: LiveConnectorOptions) => Connector;

/** Factories keyed by connector key, in catalogue order (BUILD §13.2). */
export const CONNECTOR_FACTORIES: Readonly<Record<string, ConnectorFactory>> = Object.freeze({
  anthropic: createAnthropicConnector,
  voyage: createVoyageConnector,
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
  stripe: createStripeConnector,
  sendgrid: createSendgridConnector,
  shopify: createShopifyConnector,
  tink: createTinkConnector,
  plaid: createPlaidConnector,
});

export const CONNECTOR_KEYS = Object.freeze(Object.keys(CONNECTOR_FACTORIES));

/** Build every connector (live side wired with `options`; the registry serves mocks in mock mode). */
export function createAllConnectors(options: LiveConnectorOptions = {}): Connector[] {
  return Object.values(CONNECTOR_FACTORIES).map((factory) => factory(options));
}

/** The registry hosts use: `createDefaultRegistry({ secrets, resolveBusinessId, isSuppressed })`. */
export function createDefaultRegistry(options: LiveConnectorOptions = {}): ConnectorRegistry {
  return createRegistry(createAllConnectors(options));
}
