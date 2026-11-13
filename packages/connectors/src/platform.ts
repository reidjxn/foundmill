/**
 * Platform-level secrets and host hooks for the live connectors. Secrets never travel through
 * `ToolContext.credential` when they belong to the platform (Stripe platform key, GitHub App private key,
 * Tink/Plaid client credentials...). `shared/env.ts` declares every one of them and `platformSecretsFromEnv` maps them;
 * the host (gateway, ingest, api) passes the result through `LiveConnectorOptions.secrets` — never by reading
 * `process.env` here (docs/ARCHITECTURE.md §3).
 */
import { loadEnv, type Env } from "@foundmill/shared";
import type { FetchLike } from "./http";
import type { BusinessResolver } from "./webhooks";
import type { PlatformHost } from "./connectors/platform/tools";

export interface PlatformSecrets {
  anthropicApiKey?: string;
  voyageApiKey?: string;
  /** Image generation for the faces of anthropomorphic agents (the `openai_images` connector). */
  openaiApiKey?: string;
  /** Speech for Team call (the `elevenlabs` connector): the platform key and the optional JSON override of the accent ids. */
  elevenlabsApiKey?: string;
  elevenlabsSpeechAccentIds?: string;
  /** Push to the mobile app's phones (the `onesignal` connector): the OneSignal app id and its REST API key. */
  onesignalAppId?: string;
  onesignalApiKey?: string;
  e2bApiKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeConnectClientId?: string;
  sendgridApiKey?: string;
  sendgridWebhookPublicKey?: string;
  /** Shared token the Inbound Parse URL carries as `?token=`; Inbound Parse has no signature scheme. */
  sendgridInboundToken?: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubWebhookSecret?: string;
  /** The App's URL name (github.com/apps/<slug>): connect() without an installation id returns its install page. */
  githubAppSlug?: string;
  /** The App's OAuth client id and secret: connect() exchanges GitHub's code to learn who installed the App. */
  githubAppClientId?: string;
  githubAppClientSecret?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  tinkClientId?: string;
  tinkClientSecret?: string;
  plaidClientId?: string;
  plaidSecret?: string;
  plaidEnv?: "sandbox" | "production";
  companiesHouseApiKey?: string;
  bolagsverketClientId?: string;
  bolagsverketClientSecret?: string;
  opencorporatesApiToken?: string;
  cloudflareApiToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  notionClientId?: string;
  notionClientSecret?: string;
  dropboxSignApiKey?: string;
}

/**
 * Every platform secret, read from the shared env schema (packages/shared/src/env.ts declares each variable; BUILD
 * §4.6, docs/DEPLOY.md §5.6). Hosts (gateway, ingest, the api's registry) pass this to the live connectors; nothing in
 * this package reads `process.env`. `platform-secrets.test.ts` holds every `PlatformSecrets` key and every variable a
 * connector's ConfigError names to this mapping.
 */
export function platformSecretsFromEnv(env: Env = loadEnv()): PlatformSecrets {
  const s: PlatformSecrets = {};
  const set = <K extends keyof PlatformSecrets>(key: K, value: PlatformSecrets[K] | undefined) => {
    if (value) s[key] = value;
  };
  set("anthropicApiKey", env.ANTHROPIC_API_KEY);
  set("voyageApiKey", env.VOYAGE_API_KEY);
  set("openaiApiKey", env.OPENAI_API_KEY);
  set("elevenlabsApiKey", env.ELEVENLABS_API_KEY);
  set("elevenlabsSpeechAccentIds", env.ELEVENLABS_SPEECH_ACCENT_IDS);
  set("onesignalAppId", env.ONESIGNAL_APP_ID);
  set("onesignalApiKey", env.ONESIGNAL_API_KEY);
  set("e2bApiKey", env.E2B_API_KEY);
  set("stripeSecretKey", env.STRIPE_SECRET_KEY);
  set("stripeWebhookSecret", env.STRIPE_WEBHOOK_SECRET);
  set("stripeConnectClientId", env.STRIPE_CONNECT_CLIENT_ID);
  set("sendgridApiKey", env.SENDGRID_API_KEY);
  set("sendgridWebhookPublicKey", env.SENDGRID_WEBHOOK_PUBLIC_KEY);
  set("sendgridInboundToken", env.SENDGRID_INBOUND_TOKEN);
  set("githubAppId", env.GITHUB_APP_ID);
  // A PEM pasted into a single-line variable arrives with literal "\n"; the App needs real line breaks.
  set("githubAppPrivateKey", env.GITHUB_APP_PRIVATE_KEY && (env.GITHUB_APP_PRIVATE_KEY.includes("\n") ? env.GITHUB_APP_PRIVATE_KEY : env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")));
  set("githubAppSlug", env.GITHUB_APP_SLUG);
  set("githubAppClientId", env.GITHUB_APP_CLIENT_ID);
  set("githubAppClientSecret", env.GITHUB_APP_CLIENT_SECRET);
  set("githubWebhookSecret", env.GITHUB_WEBHOOK_SECRET);
  set("shopifyClientId", env.SHOPIFY_CLIENT_ID);
  set("shopifyClientSecret", env.SHOPIFY_CLIENT_SECRET);
  set("tinkClientId", env.TINK_CLIENT_ID);
  set("tinkClientSecret", env.TINK_CLIENT_SECRET);
  set("plaidClientId", env.PLAID_CLIENT_ID);
  set("plaidSecret", env.PLAID_SECRET);
  set("plaidEnv", env.PLAID_ENV);
  set("companiesHouseApiKey", env.COMPANIES_HOUSE_API_KEY);
  set("bolagsverketClientId", env.BOLAGSVERKET_CLIENT_ID);
  set("bolagsverketClientSecret", env.BOLAGSVERKET_CLIENT_SECRET);
  set("opencorporatesApiToken", env.OPENCORPORATES_API_TOKEN);
  set("cloudflareApiToken", env.CLOUDFLARE_API_TOKEN);
  set("googleClientId", env.GOOGLE_CLIENT_ID);
  set("googleClientSecret", env.GOOGLE_CLIENT_SECRET);
  set("notionClientId", env.NOTION_CLIENT_ID);
  set("notionClientSecret", env.NOTION_CLIENT_SECRET);
  set("dropboxSignApiKey", env.DROPBOX_SIGN_API_KEY);
  return s;
}

export interface LiveConnectorOptions {
  secrets?: PlatformSecrets;
  /** Injected for tests of the live code paths; defaults to global fetch. */
  fetch?: FetchLike;
  now?: () => Date;
  /** Maps vendor accounts to businesses for shared webhook endpoints (Stripe Connect, GitHub App). */
  resolveBusinessId?: BusinessResolver;
  /** Per-business webhook secrets (Dropbox Sign API key, Shopify per-shop secret) looked up by the host. */
  getBusinessSecret?: (businessId: string, name: string) => Promise<string | null>;
  /** Global suppression list check (BUILD §2.3); SendGrid refuses a send when it returns true. */
  isSuppressed?: (businessId: string, address: string) => Promise<boolean>;
  /** The platform's own data behind the `platform` connector (task board, messages, reads); the gateway provides it. */
  platform?: PlatformHost;
  /**
   * The origin of this deployment's public project pages (`APP_URL`), for `indexnow` connected for a Foundmill-hosted page
   * (founder, 2026-11-12): the gateway provides it, and names the page's own slug as `hostedSlug` in the connect input.
   */
  hostedPagesOrigin?: string;
  /** The quarantined reader behind `quarantine.read_untrusted` (BUILD §9.8 step 2); the gateway provides it. */
  quarantinedReader?: QuarantinedReader;
}

/**
 * Typed fields out of untrusted content (Haiku, no tools): absent fields are null, instructions inside are ignored. The
 * caller (business, agent, session) is who the model usage is booked to.
 */
export type QuarantinedReader = (input: { businessId: string; agentId: string; sessionId: string | null; fields: string[]; content: string }) => Promise<Record<string, string | number | boolean | null>>;

export type ResolvedLiveOptions = Required<Pick<LiveConnectorOptions, "secrets" | "fetch" | "now">> & Omit<LiveConnectorOptions, "secrets" | "fetch" | "now">;

export function resolveLiveOptions(opts: LiveConnectorOptions = {}): ResolvedLiveOptions {
  return { ...opts, secrets: opts.secrets ?? platformSecretsFromEnv(), fetch: opts.fetch ?? globalThis.fetch, now: opts.now ?? (() => new Date()) };
}
