/** Single place that reads process.env (docs/ARCHITECTURE.md §3). */
import { z } from "zod";
import { MAIL_LOCAL_PART_PATTERN, mailLocalPartReserved } from "./platform-mail";
import { sitesDomainProblem } from "./sites";

const Env = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  INTEGRATIONS_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Connectors that run live while INTEGRATIONS_MODE is mock, comma-separated (e.g. "github"). */
  LIVE_CONNECTORS: z.string().default(""),
  MODEL_MODE: z.enum(["mock", "live"]).default("mock"),
  /** apps/api: multiplies every model-backed allowance (services/model-limits.ts). Honored only when APP_ENV is development or test: the Playwright stack presses Take charge and the other model-backed buttons far more often than a person does. */
  MODEL_LIMIT_SCALE: z.coerce.number().min(1).max(1_000).catch(1).default(1),
  /** packages/models: honour `speed: "fast"` on the routes that ask for it (Opus fast mode, beta, 2× price). Off unless "1" or "true". */
  MODEL_FAST_MODE: z.string().optional().transform((v) => v === "1" || v?.trim().toLowerCase() === "true"),
  /** Mock model client only: simulated wait before the first token / first streamed element, in ms (0 = instant, the default). */
  MOCK_MODEL_LATENCY_MS: z.coerce.number().int().min(0).max(600_000).catch(0).default(0),
  /** Mock model client only: simulated writing time per streamed element, in ms (0 = instant, the default). */
  MOCK_MODEL_STREAM_MS: z.coerce.number().int().min(0).max(600_000).catch(0).default(0),
  APP_URL: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().default(4000),
  GATEWAY_PORT: z.coerce.number().default(4001),
  COMPOSER_PORT: z.coerce.number().default(4002),
  STREAM_PORT: z.coerce.number().default(4003),
  COLLAB_PORT: z.coerce.number().default(4004),
  INGEST_PORT: z.coerce.number().default(4005),
  GATEWAY_URL: z.string().default("http://localhost:4001"),
  COMPOSER_URL: z.string().default("http://localhost:4002"),
  /** apps/api and apps/orchestrator: how long a composer call (refresh, narrate) may take; unset = LIMITS.composerClientTimeoutMs. Keep it above the composer's deadline. */
  COMPOSER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional().catch(undefined),
  /**
   * apps/api: the size of its database pool (default 10). Raise it only with room under Postgres's `max_connections`
   * for every service's pool and Temporal's (docs/DEPLOY.md "Database connections"). The transaction gate
   * (apps/api services/tx-gate.ts) follows it: requests hold at most this many transactions less a reserve of 4.
   */
  API_DB_POOL_MAX: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  INGEST_URL: z.string().default("http://localhost:4005"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** apps/api, apps/stream, apps/collab: verifies legacy HS256 Supabase tokens without JWKS (optional; JWKS is used otherwise). */
  SUPABASE_JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  /** apps/api: longest wait at boot for the migration lock (and for table locks a migration needs) before exiting 1 (docs/DEPLOY.md §3). */
  MIGRATION_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).catch(60_000).default(60_000),
  /** Every Node service: time from SIGTERM to exit, draining requests, sockets and workers; keep below railway.toml `drainingSeconds`. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).catch(45_000).default(45_000),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Foundmill's Z.ai key: GLM-5.3 Flash for every account not on a paid plan (WP-13). Unset: free calls are refused. */
  ZAI_API_KEY: z.string().optional(),
  /**
   * The month's ceiling on what the free plan costs Foundmill, in US cents: Haiku 5.5 and GLM-5.3 Flash together, web
   * search included (founder, Nov 16, 2026: $600). Free work slows at 80% and is held at 100% (WP-13 T6).
   */
  FREE_PLAN_MONTHLY_CAP_CENTS: z.coerce.number().int().min(0).max(10_000_000).default(60_000),
  VOYAGE_API_KEY: z.string().optional(),
  /** apps/gateway: the platform key behind the `openai_images` connector (AI-generated faces of anthropomorphic agents). */
  OPENAI_API_KEY: z.string().optional(),
  /** apps/gateway: the platform key behind the `elevenlabs` connector (speech for Team call, docs/TEAM_CALL.md §3). */
  ELEVENLABS_API_KEY: z.string().optional(),
  /** apps/gateway: optional JSON `{ "<accent>": "<ElevenLabs voice id>" }` replacing the connector's default accent ids key by key. */
  ELEVENLABS_SPEECH_ACCENT_IDS: z.string().optional(),
  /** apps/gateway: the OneSignal app id and REST API key behind the `onesignal` connector (push to the mobile app's phones, docs/mobile). */
  ONESIGNAL_APP_ID: z.string().optional(),
  ONESIGNAL_API_KEY: z.string().optional(),
  /** apps/gateway: Cloudflare Turnstile's secret key for the bot check of the idea box (docs/IDEA_BOX.md) and of a public page's Follow form. Unset on staging or production, the idea box drafts nothing and pages take no followers. */
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /** apps/api: the Domain of the idea box's cookie (`fm_idea`), so the web app reads it too: `foundmill.com` in production. Unset: a host-only cookie (local stacks). */
  IDEA_COOKIE_DOMAIN: z.string().regex(/^[a-z0-9.-]{3,253}$/).optional(),
  /** apps/api: the idea box's daily ceiling on model spend across every visitor, in US cents (founder, 2026-11-13: $20). */
  IDEA_BOX_DAILY_CEILING_CENTS: z.coerce.number().int().min(0).max(100_000).default(2_000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("foundmill"),
  E2B_API_KEY: z.string().optional(),
  /** The E2B template the orchestrator's acceptance sandboxes start from; empty means E2B's `base` (docs/DEPLOY.md §5). */
  E2B_TEMPLATE: z.string().optional(),
  BROWSERBASE_API_KEY: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  DEV_MASTER_KEY: z.string().optional(),
  SESSION_TOKEN_SECRET: z.string().optional(),
  /** The api's own service-token secret for its calls to the gateway (WP-11 T12, N4); 32+ characters. Unset: the shared one. */
  API_SERVICE_TOKEN_SECRET: z.string().optional(),
  /** "1" while the switch to API_SERVICE_TOKEN_SECRET is in progress: the gateway still accepts the api signed with the shared secret. */
  API_SERVICE_TOKEN_LEGACY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * apps/ingest: signing secret of the platform Stripe endpoint for Foundmill's own billing (`POST /billing/stripe`:
   * credit top-ups paid through Checkout). Separate from STRIPE_WEBHOOK_SECRET (the businesses' own Stripe events) so
   * a delivery signed for one can never pass as the other; unset refuses every billing delivery.
   */
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  /** The GitHub App's URL name (github.com/apps/<slug>): Connect opens its installation page. */
  GITHUB_APP_SLUG: z.string().optional(),
  /** The App's OAuth client: connecting exchanges the code GitHub sends after installing to check who installed it. */
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  /*
   * Platform keys of the other live connectors (packages/connectors `platformSecretsFromEnv`; docs/DEPLOY.md §5.6). Set
   * them on the gateway (every agent tool call), on ingest when the connector's webhook goes live, and on the api for
   * what it calls directly (registry lookups, OAuth consent links and code exchanges).
   */
  /** Stripe Connect platform client id (`ca_…`), for Connect onboarding links. */
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  /** apps/ingest: the token SendGrid Inbound Parse carries as `?token=` (Inbound Parse has no signature). */
  SENDGRID_INBOUND_TOKEN: z.string().optional(),
  /*
   * The Foundmill sending address of every project (docs/THESIS_REVIEW.md package 1.5; packages/shared
   * `platform-mail.ts`). Unset domain: the feature is off everywhere and nothing changes. It sends for real only where
   * SendGrid runs live on the gateway (INTEGRATIONS_MODE=live or LIVE_CONNECTORS naming `sendgrid`), on the platform's
   * own SENDGRID_API_KEY (gateway only); elsewhere it runs its mock and every result says it was simulated.
   */
  /** The sending domain, e.g. `mail.foundmill.com` (api, gateway, ingest, orchestrator). A project sends from `<slug>@<domain>`. */
  PLATFORM_MAIL_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined)
    .refine((v) => v === undefined || /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), { message: "PLATFORM_MAIL_DOMAIN must be a domain name such as mail.foundmill.com" }),
  /**
   * Foundmill Sites (WP-07): the domain project sites are served on (`<slug>.<domain>`, previews `p-<token>.<domain>`),
   * read by api, orchestrator and sites. Unset means the feature is off everywhere: no tab, no note, no Planner
   * destination. Outside development and test it must not be APP_URL's host or a parent or subdomain of it.
   */
  SITES_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined)
    .refine((v) => v === undefined || /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), { message: "SITES_DOMAIN must be a domain name such as example-sites.app" }),
  /** apps/sites: the api it calls for a site's sign-up form (WP-07 T6; `publicPage.siteConsent`, `publicPage.follow`). Unset: `http://localhost:4000` on development and test; elsewhere sign-ups are closed. */
  SITES_API_URL: z.string().optional(),
  /**
   * apps/sites: Cloudflare Turnstile's site key for a site's sign-up form (a public value; the widget's hostnames must
   * include SITES_DOMAIN). Empty uses the mock token, which the api accepts on development and test stacks only.
   */
  SITES_TURNSTILE_SITE_KEY: z.string().optional(),
  /** Messages one project may send from its Foundmill address per UTC day (gateway; the api shows it). An operator raises one project's cap in `project_mail.daily_cap`. */
  PLATFORM_MAIL_DAILY_CAP: z.coerce.number().int().min(1).max(10_000).default(50),
  /** Messages every project together may send from the platform domain per UTC day: protects the domain's reputation (gateway). */
  PLATFORM_MAIL_DAILY_CEILING: z.coerce.number().int().min(1).max(1_000_000).default(2_000),
  /**
   * gateway: Foundmill's own emails to its users (packages 1.5 and 5.1) per UTC day, every person together. A ceiling
   * of their own (`pn:all:day`), never counted against PLATFORM_MAIL_DAILY_CEILING, so they never take the projects'
   * room; and they wait while the projects' mail has used more than 75% of that ceiling.
   */
  PLATFORM_NOTIFY_DAILY_CEILING: z.coerce.number().int().min(1).max(1_000_000).default(1_000),
  /**
   * Every ordinary founder notice together in a UTC day (`pn:safety:day`; security review P2-3): enforced, apart from
   * PLATFORM_NOTIFY_DAILY_CEILING. 0 (or an empty value, which reads as 0) is refused at boot: it would silence every
   * ordinary founder notice; unset it for the default.
   */
  PLATFORM_SAFETY_DAILY_CEILING: z.coerce
    .number()
    .int()
    .min(1, { message: "PLATFORM_SAFETY_DAILY_CEILING must be 1 or more (0, or an empty value, would refuse every founder notice); unset it for the default of 5,000" })
    .max(1_000_000)
    .default(5_000),
  /**
   * The circuit breaker over every essential founder notice together in a UTC day (`pn:safety:reserved:day`; final
   * review): a warning at half, an error at the ceiling, and past it each person gets one folded email for the day. 0 (or
   * an empty value) is refused at boot, as above.
   */
  PLATFORM_SAFETY_RESERVED_DAILY_CEILING: z.coerce
    .number()
    .int()
    .min(1, { message: "PLATFORM_SAFETY_RESERVED_DAILY_CEILING must be 1 or more (0, or an empty value, would fold every essential founder notice); unset it for the default of 20,000" })
    .max(10_000_000)
    .default(20_000),
  /** gateway + ingest: signs the custom args on every send and the unsubscribe links, so a delivery event or an unsubscribe is bound to its project. 32+ random bytes. */
  PLATFORM_MAIL_SIGNING_SECRET: z.string().optional(),
  /** ingest: the token the platform's Inbound Parse URL carries as `?token=` (`/mail/inbound`). Never the businesses' SENDGRID_INBOUND_TOKEN. */
  PLATFORM_MAIL_INBOUND_TOKEN: z.string().optional(),
  /** ingest: the verification key of the platform account's Event Webhook that posts to `/mail/events` (base64 SPKI, as SendGrid shows it). */
  PLATFORM_MAIL_EVENT_PUBLIC_KEY: z.string().optional(),
  /** gateway: the public address of ingest (`https://ingest.foundmill.com`): every message's unsubscribe link points at `<it>/mail/unsubscribe`. Defaults to INGEST_URL. */
  INGEST_PUBLIC_URL: z.string().optional(),
  /**
   * gateway: the local part Foundmill's own email to its users is sent from, on PLATFORM_MAIL_DOMAIN (`hello` gives
   * `Foundmill <hello@mail.foundmill.com>`; packages 1.5 and 5.1). It must be one of the reserved words no project's
   * address may hold (`MAIL_RESERVED_LOCAL_PARTS`), so no project can ever send as Foundmill.
   */
  PLATFORM_NOTIFY_LOCAL_PART: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || "hello")
    .refine((v) => MAIL_LOCAL_PART_PATTERN.test(v) && mailLocalPartReserved(v), { message: "PLATFORM_NOTIFY_LOCAL_PART must be a reserved local part such as hello, so no project can hold it" }),
  /**
   * apps/api: email a person when a note has waited a day for their answer (the notify pass, hourly; packages 1.5 and
   * 5.1). On unless "off" (or "0"/"false"); it sends only where PLATFORM_MAIL_DOMAIN is set.
   */
  NOTIFY_EMAIL: z
    .string()
    .optional()
    .transform((v): "on" | "off" => (/^(off|0|false|no)$/i.test((v ?? "").trim()) ? "off" : "on")),
  /** Shopify public app (OAuth): its API key and secret key. */
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  /** Tink open banking: the app's client credentials from the Tink console. */
  TINK_CLIENT_ID: z.string().optional(),
  TINK_CLIENT_SECRET: z.string().optional(),
  /** Plaid: client id and secret from the Plaid dashboard, and which Plaid environment they belong to. */
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).optional(),
  /** UK Companies House public data API key (platform key; every business's lookups use it). */
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  /** Bolagsverket (Swedish companies registry) client credentials from portal.api.bolagsverket.se. */
  BOLAGSVERKET_CLIENT_ID: z.string().optional(),
  BOLAGSVERKET_CLIENT_SECRET: z.string().optional(),
  /** OpenCorporates API token (platform key). */
  OPENCORPORATES_API_TOKEN: z.string().optional(),
  /** Cloudflare API token (Zone:Read, DNS:Edit); a business's own token takes precedence. */
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  /** Google OAuth client (Gmail, Calendar, Drive): consent links, code exchange and token refresh. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Notion public integration (OAuth) client. */
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  /** Dropbox Sign API key; a business's own key takes precedence. */
  DROPBOX_SIGN_API_KEY: z.string().optional(),
  /**
   * Every Node service: OTLP/HTTP base URL traces (and the orchestrator's Temporal metrics) are sent to, e.g. Grafana
   * Cloud's `https://otlp-gateway-<zone>.grafana.net/otlp` (packages/shared telemetry.ts). Unset: no traces.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  /** Headers for that endpoint, `key=value,…` (percent-encoded values), e.g. `Authorization=Basic%20<base64>`. */
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  /** Every Node service: Sentry project DSN that error-level log lines and uncaught exceptions are reported to. Unset: none. */
  SENTRY_DSN: z.string().optional(),
  SEED_OWNER_EMAILS: z.string().optional(),
  /**
   * apps/api: who may use the app, comma-separated emails and `@domain`s (`founder@example.com, @example.org`). When set,
   * every signed-in request from any other account is refused (FORBIDDEN, `not_invited`); unset admits every account
   * that can sign in. Staging sets it while sign-up is open (docs/DEPLOY.md §4).
   */
  SIGNUP_ALLOWLIST: z.string().optional(),
  /**
   * apps/api, apps/stream, apps/collab: open sign-up (THESIS_REVIEW package 2.2, founder 2026-11-12). "1"/"true"/"on":
   * anyone who signs in with a confirmed address is admitted until the day's new accounts reach
   * SIGNUP_DAILY_CEILING (UTC day), after which a new person is refused with `on_waitlist`; the addresses SIGNUP_ALLOWLIST names are
   * admitted without counting. Off (the default): invite-only while SIGNUP_ALLOWLIST is set, and everyone is admitted
   * while it is not (`signupMode`, @foundmill/shared allowlist.ts).
   */
  SIGNUP_OPEN: z.string().optional(),
  /**
   * apps/api: the waitlist emails a person the day their place opens (WP-03 T2's `waitlist-admissions` sweep on the
   * orchestrator, through the gateway's platform mail). "1"/"true"/"on" lets the waitlist's saved line promise that
   * email, and only while platform mail is live here too (`waitlistEmails`). Unset (the default): the line says it cannot
   * email yet. Set by the Desktop session together with WAITLIST_ADMIT_PER_DAY, after WP-00 S1 and S2 (docs/DEPLOY.md §4).
   */
  WAITLIST_EMAILS: z.string().optional(),
  /** apps/api: with SIGNUP_OPEN, how many new accounts are admitted per UTC day before the rest are refused with `on_waitlist`. */
  SIGNUP_DAILY_CEILING: z.coerce.number().int().min(0).max(1_000_000).default(200),
  /**
   * apps/api: with SIGNUP_OPEN, how many new accounts open sign-up admits per UTC day from one private email domain
   * (WP-03 T8). The large mailbox providers (@foundmill/shared `COMMON_MAIL_DOMAINS`) are not counted by domain. Past
   * it a new person waits with `on_waitlist`. 5 is an Estimate (founder, Nov 15, 2026, D7).
   */
  SIGNUP_PER_DOMAIN_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(5),
  /**
   * apps/api: with SIGNUP_OPEN, the cutover for "a person from before open sign-up" (an ISO timestamp): only an account
   * whose founder profile was created before it is admitted without counting toward SIGNUP_DAILY_CEILING. Unset: the
   * moment migration 0093 ran, which the database stores (`admission_existing_before()`).
   */
  SIGNUP_EXISTING_BEFORE: z.iso.datetime({ offset: true }).optional(),
  /**
   * apps/api: whether a credit top-up may be paid by simulation (the Billing tab's mock checkout, no money moves) when
   * Stripe is not live. "1"/"true" or "0"/"false"; unset allows it only when APP_ENV is development or test
   * (`allowMockPayments`). Simulated credits never pay for live model calls whatever this says (docs/DEPLOY.md §4).
   */
  ALLOW_MOCK_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => {
      const s = v?.trim().toLowerCase();
      return s === undefined || s === "" ? undefined : s === "1" || s === "true";
    }),
  /** apps/api: build the demo businesses once at boot and give SEED_OWNER_EMAILS owner memberships (docs/DEPLOY.md §3). */
  SEED_ON_BOOT: z.string().optional(),
  /** Opens the LIVE surfaces (network, communities, Go live) on this deployment; closed unless 1/true/yes/on (`liveModeOpen`). */
  LIVE_MODE: z.string().optional(),
  /** Seed data volume multiplier (1 = the full two years of history). */
  SEED_VOLUME_SCALE: z.coerce.number().positive().optional(),
  /**
   * apps/api: roll the demo businesses' sample rows forward with the calendar at boot and every hour (DECISIONS
   * 2026-11-10). On unless "off" (or "0"/"false"); unset or empty is on.
   */
  DEMO_ROLL_FORWARD: z
    .string()
    .optional()
    .transform((v): "on" | "off" => (/^(off|0|false|no)$/i.test((v ?? "").trim()) ? "off" : "on")),
  DEV_AUTH_USER_ID: z.string().optional(),
});
export type Env = z.infer<typeof Env>;
/** Every variable the shared schema reads (scripts/env-example.test.mjs keeps .env.example equal to it). */
export const ENV_KEYS = Object.keys(Env.shape) as (keyof Env)[];

let cached: Env | undefined;
export function loadEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const raw = { ...process.env, ...overrides };
  // A deployed process (NODE_ENV=production, as the image sets) never runs on the development defaults: APP_ENV unset
  // would otherwise mean development, with its public dev secrets and unverified dev sign-in (SECURITY_REVIEW SEC-9).
  // `test` stays allowed when named: CI boots the built image with APP_ENV=test to check that it starts.
  if (raw.NODE_ENV === "production" && (!raw.APP_ENV?.trim() || raw.APP_ENV.trim() === "development")) {
    throw new Error("Invalid environment: APP_ENV must be set to staging or production when NODE_ENV=production (it is unset or development)");
  }
  const parsed = Env.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const env = parsed.data;
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    env.DEV_AUTH_USER_ID = undefined; // never honoured outside development/test (docs/DECISIONS.md)
    // Simulated model latency is a development knob: a deployed service's mock client (a live service without its key
    // falls back to it) never waits on purpose.
    env.MOCK_MODEL_LATENCY_MS = 0;
    env.MOCK_MODEL_STREAM_MS = 0;
  }
  if (env.SITES_DOMAIN && env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    const problem = sitesDomainProblem(env.SITES_DOMAIN, env.APP_URL);
    if (problem) throw new Error(`Invalid environment: ${problem}`);
  }
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}
export const resetEnvCache = () => { cached = undefined; };
export const isMockIntegrations = (env = loadEnv()) => env.INTEGRATIONS_MODE === "mock";
/** Connectors named in LIVE_CONNECTORS. */
export const liveConnectorKeys = (env: Pick<Env, "LIVE_CONNECTORS">): string[] => env.LIVE_CONNECTORS.split(",").map((k) => k.trim()).filter(Boolean);
/** The mode one connector runs in: live everywhere in live mode, or when LIVE_CONNECTORS names it. */
export const connectorMode = (env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">, connectorKey: string): "mock" | "live" => (env.INTEGRATIONS_MODE === "live" || liveConnectorKeys(env).includes(connectorKey) ? "live" : "mock");
/**
 * The LIVE_CONNECTORS entry for the platform's own billing (credit top-ups through Stripe Checkout on the platform
 * account, docs/DEPLOY.md §5). Separate from `stripe`, the businesses' own Stripe connector, so taking real payments
 * never switches every business's Stripe tools to live (and the reverse). The api and the gateway read it alike.
 */
export const PLATFORM_BILLING_LIVE_KEY = "stripe_billing";
/** How credit top-ups are paid here: through Stripe (live) or simulated (mock). */
export const platformBillingMode = (env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">): "mock" | "live" => connectorMode(env, PLATFORM_BILLING_LIVE_KEY);
/**
 * The Foundmill sending address (package 1.5) runs on SendGrid: it is live exactly where SendGrid is live on this
 * service (INTEGRATIONS_MODE=live or LIVE_CONNECTORS naming `sendgrid`) and its domain is set; with the domain set and
 * SendGrid mock it runs its mock (simulated). Unset domain: off.
 */
export const PLATFORM_MAIL_MODE_KEY = "sendgrid";
export const platformMailDomain = (env: Partial<Pick<Env, "PLATFORM_MAIL_DOMAIN">>): string | null => env.PLATFORM_MAIL_DOMAIN?.trim().toLowerCase() || null;
export const platformMailMode = (env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">): "mock" | "live" => connectorMode(env, PLATFORM_MAIL_MODE_KEY);
/** PLATFORM_MAIL_SIGNING_SECRET's shortest accepted length. */
export const PLATFORM_MAIL_SECRET_MIN_LENGTH = 32;
/**
 * PLATFORM_MAIL_SIGNING_SECRET, trimmed (null when unset). The gateway and ingest call it at boot: with the domain set,
 * anywhere but an explicit development or test stack, a missing or short secret stops the service from starting, so
 * no deployment ever signs or verifies with the public development secret.
 */
export function platformMailSigningSecret(env: Pick<Env, "APP_ENV"> & Partial<Pick<Env, "PLATFORM_MAIL_DOMAIN" | "PLATFORM_MAIL_SIGNING_SECRET">>): string | null {
  const secret = env.PLATFORM_MAIL_SIGNING_SECRET?.trim() || null;
  if (platformMailDomain(env) === null || env.APP_ENV === "development" || env.APP_ENV === "test") return secret;
  if (!secret || secret.length < PLATFORM_MAIL_SECRET_MIN_LENGTH) throw new Error(`PLATFORM_MAIL_SIGNING_SECRET must be set to at least ${PLATFORM_MAIL_SECRET_MIN_LENGTH} characters when PLATFORM_MAIL_DOMAIN is set and APP_ENV is ${env.APP_ENV}`);
  return secret;
}
/** True when projects really send from their Foundmill address on this deployment. */
export const platformMailLive = (env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS"> & Partial<Pick<Env, "PLATFORM_MAIL_DOMAIN">>): boolean => platformMailDomain(env) !== null && platformMailMode(env) === "live";
/**
 * May the waitlist promise its email here (WAITLIST_EMAILS on, and platform mail live)? The api passes it with the
 * `not_invited` and `on_waitlist` refusals so the web's saved line says "We email …" only where the email is sent.
 */
export const waitlistEmails = (env: Partial<Pick<Env, "WAITLIST_EMAILS" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS" | "PLATFORM_MAIL_DOMAIN">>): boolean =>
  /^(1|true|yes|on)$/i.test((env.WAITLIST_EMAILS ?? "").trim()) && platformMailLive({ INTEGRATIONS_MODE: env.INTEGRATIONS_MODE ?? "mock", LIVE_CONNECTORS: env.LIVE_CONNECTORS ?? "", PLATFORM_MAIL_DOMAIN: env.PLATFORM_MAIL_DOMAIN });
export const isMockModels = (env = loadEnv()) => env.MODEL_MODE === "mock";
/** ALLOW_MOCK_PAYMENTS, or by default only in development and test: may a top-up be paid by simulation here? */
export const allowMockPayments = (env: Pick<Env, "APP_ENV" | "ALLOW_MOCK_PAYMENTS">): boolean => env.ALLOW_MOCK_PAYMENTS ?? (env.APP_ENV === "development" || env.APP_ENV === "test");
export const servicePort = (env: Env, named: "API_PORT" | "GATEWAY_PORT" | "COMPOSER_PORT" | "STREAM_PORT" | "COLLAB_PORT" | "INGEST_PORT"): number => env.PORT ?? env[named];
