/**
 * Platform-level secrets and host hooks for the live connectors. Secrets never travel through
 * `ToolContext.credential` when they belong to the platform (Stripe platform key, GitHub App private key,
 * Tink/Plaid client credentials...). `shared/env.ts` knows only a subset of them; the host (gateway, ingest)
 * supplies the rest through `LiveConnectorOptions.secrets` — never by reading `process.env` here
 * (docs/ARCHITECTURE.md §3).
 */
import { loadEnv, type Env } from "@foundmill/shared";
import type { FetchLike } from "./http";
import type { BusinessResolver } from "./webhooks";
import type { PlatformHost } from "./connectors/platform/tools";

export interface PlatformSecrets {
  anthropicApiKey?: string;
  voyageApiKey?: string;
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

/** The subset of platform secrets `packages/shared` env schema already declares (BUILD §4.6). */
export function platformSecretsFromEnv(env: Env = loadEnv()): PlatformSecrets {
  const s: PlatformSecrets = {};
  if (env.ANTHROPIC_API_KEY) s.anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (env.VOYAGE_API_KEY) s.voyageApiKey = env.VOYAGE_API_KEY;
  if (env.E2B_API_KEY) s.e2bApiKey = env.E2B_API_KEY;
  if (env.STRIPE_SECRET_KEY) s.stripeSecretKey = env.STRIPE_SECRET_KEY;
  if (env.STRIPE_WEBHOOK_SECRET) s.stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (env.SENDGRID_API_KEY) s.sendgridApiKey = env.SENDGRID_API_KEY;
  if (env.SENDGRID_WEBHOOK_PUBLIC_KEY) s.sendgridWebhookPublicKey = env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (env.GITHUB_APP_ID) s.githubAppId = env.GITHUB_APP_ID;
  // A PEM pasted into a single-line variable arrives with literal "\n"; the App needs real line breaks.
  if (env.GITHUB_APP_PRIVATE_KEY) s.githubAppPrivateKey = env.GITHUB_APP_PRIVATE_KEY.includes("\n") ? env.GITHUB_APP_PRIVATE_KEY : env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (env.GITHUB_APP_SLUG) s.githubAppSlug = env.GITHUB_APP_SLUG;
  if (env.GITHUB_APP_CLIENT_ID) s.githubAppClientId = env.GITHUB_APP_CLIENT_ID;
  if (env.GITHUB_APP_CLIENT_SECRET) s.githubAppClientSecret = env.GITHUB_APP_CLIENT_SECRET;
  if (env.GITHUB_WEBHOOK_SECRET) s.githubWebhookSecret = env.GITHUB_WEBHOOK_SECRET;
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
