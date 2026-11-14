/**
 * Which channels can really act (founder, 2026-11-11: "The Channel Board shows only channels that can really act; the
 * rest are listed as not available yet in Builder view").
 *
 * A channel is available for a business when an agent can itself take the channel's outward action through a
 * connector that is real for that business. `CHANNEL_ACTING_TOOLS` is the one place that says which gateway tools
 * count as that action; `channelAvailability` is the one rule the api (the rows it serves, the refusals), the
 * orchestrator (the channel engine) and anything else decide from. The words a founder reads are in packages/shared
 * `channel-availability.ts`.
 *
 * Where simulated results are allowed (`mockResultsAllowed`: a sample business anywhere, any business in development
 * or test) every channel stays available, so the mock golden path, the tests and the two sample businesses behave as
 * before with all fifteen.
 */
import { CHANNEL_KEYS, CHANNEL_META, channelAvailabilitySentence, channelNotAvailableMessage, channelSharedByTap, liveConnectorKeys, mockResultsAllowed, platformMailLive, type ChannelAvailability, type ChannelAvailabilityRow, type ChannelKey, type Env, type NoChannelFacts } from "@foundmill/shared";

/**
 * The gateway tools (`connector:tool`) that count as a channel acting outwardly. An empty list means no publisher is
 * built for the channel yet: adding one is a deliberate edit here (the test in `__tests__/channel-availability.test.ts`
 * pins which channels are empty, and that every ref names a tool a connector serves).
 */
export const CHANNEL_ACTING_TOOLS: Readonly<Record<ChannelKey, readonly string[]>> = Object.freeze({
  // Empty on purpose: Apollo finds people, which is a read. The channel's outward action is reaching them, and that
  // goes through the email channel's own tools and approvals (security review, Nov 12, 2026).
  lead_generation: [],
  // The founder's own SendGrid when connected, else the project's Foundmill sending address (package 1.5).
  email_automation: ["sendgrid:send_mail", "platform_mail:send_mail", "resend:send_mail"],
  seo: ["github:commit_files"],
  geo: ["github:commit_files"],
  content: [],
  // The founder's own Buffer when connected: the team queues each post (the founder approves it first). Until then the founder posts by tap.
  social: ["buffer:queue_post"],
  paid_ads: [],
  influencer: [],
  affiliate: [],
  direct_mail: [],
  print: [],
  broadcast: [],
  outdoor: [],
  pr: [],
  events: [],
});

/** What `channelAvailability` decides from. Plain data, so an activity can carry it. */
export interface ChannelAvailabilityFacts {
  /** Connectors that run live on this deployment: "all" with `INTEGRATIONS_MODE=live`, else the keys in `LIVE_CONNECTORS`. */
  liveConnectors: "all" | readonly string[];
  /** Connectors this business has connected (an integration whose status is connected or degraded). */
  connectedConnectors: readonly string[];
  /** `mockResultsAllowed(appEnv, isDemo)`: simulated results are allowed for this business. */
  mockResultsAllowed: boolean;
  /**
   * The project's Foundmill sending address really sends here (`platformMailLive`: PLATFORM_MAIL_DOMAIN set and SendGrid
   * live). It needs nothing connected, so `platform_mail` counts as connected for every project while this is true.
   */
  platformMail?: boolean;
}

const connectorOf = (ref: string): string => ref.slice(0, ref.indexOf(":"));

/** The project's Foundmill sending address (`platform_mail`, package 1.5). */
const PLATFORM_MAIL_CONNECTOR = "platform_mail";

/**
 * Whether a channel is available for a business, and why (pure).
 * - Simulated results allowed → available, `simulated_allowed` (with `byTap` for a channel the founder can also post
 *   by tap, so the Board says so on a development stack too).
 * - An acting tool whose connector is live here and connected for the business → available, `acts`.
 * - A channel the founder posts by tap (`channelSharedByTap`: today social, while a network's share window opens with
 *   the text and the link filled in) → available, `by_tap`, with no connector. `acts` comes first: once a connector
 *   publishes, the team posts. The team does not run a `by_tap` channel (packages/shared `channelTeamRuns`).
 * - No acting tool → `no_publisher`.
 * - Otherwise `not_connected`, naming the connector to connect (`connectable` when it is live here, so connecting it is
 *   the founder's step; false when the connector itself is not switched on yet).
 */
export function channelAvailability(channelKey: ChannelKey, facts: ChannelAvailabilityFacts, actingTools: Readonly<Record<ChannelKey, readonly string[]>> = CHANNEL_ACTING_TOOLS): ChannelAvailability {
  const byTap = channelSharedByTap(channelKey);
  if (facts.mockResultsAllowed) return { available: true, reason: "simulated_allowed", ...(byTap ? { byTap: true } : {}) };
  const connectors = [...new Set((actingTools[channelKey] ?? []).map(connectorOf))];
  const live = (key: string) => facts.liveConnectors === "all" || facts.liveConnectors.includes(key);
  // The Foundmill sending address has no account to connect: it acts wherever it is switched on (`facts.platformMail`).
  const acts = (key: string) => (key === PLATFORM_MAIL_CONNECTOR ? facts.platformMail === true : live(key) && facts.connectedConnectors.includes(key));
  if (connectors.some(acts)) return { available: true, reason: "acts" };
  // The founder posts it with one press: available with no connector, and never a channel the team runs.
  if (byTap) return { available: true, reason: "by_tap", byTap: true };
  if (connectors.length === 0) return { available: false, reason: "no_publisher" };
  // What is left to name is a connector the founder could connect; the platform address is never theirs to connect.
  const connectable = connectors.filter((key) => key !== PLATFORM_MAIL_CONNECTOR);
  const first = connectable.find(live);
  return { available: false, reason: "not_connected", connectorKey: first ?? connectable[0] ?? connectors[0]!, connectable: first !== undefined };
}

/** Every channel's availability, in `CHANNEL_KEYS` order. */
export function channelAvailabilities(facts: ChannelAvailabilityFacts): Record<ChannelKey, ChannelAvailability> {
  return Object.fromEntries(CHANNEL_KEYS.map((key) => [key, channelAvailability(key, facts)])) as Record<ChannelKey, ChannelAvailability>;
}

/**
 * The display names of the connectors `CHANNEL_ACTING_TOOLS` names, for the sentence a founder reads ("connect SendGrid
 * in Settings › Integrations"). The unit test holds each to its connector's own `displayName`.
 */
export const ACTING_CONNECTOR_NAMES: Readonly<Record<string, string>> = Object.freeze({ sendgrid: "SendGrid", github: "GitHub", resend: "Resend", buffer: "Buffer", platform_mail: "Email from your project" });

/** A channel's availability with its founder sentence (null when available): what the api sends with each channel. */
export function channelAvailabilityRow(channelKey: ChannelKey, facts: ChannelAvailabilityFacts): ChannelAvailabilityRow {
  const availability = channelAvailability(channelKey, facts);
  return { ...availability, sentence: channelAvailabilitySentence(availability, availability.connectorKey ? ACTING_CONNECTOR_NAMES[availability.connectorKey] : null) };
}

/** Every channel's row, in `CHANNEL_KEYS` order. */
export function channelAvailabilityRows(facts: ChannelAvailabilityFacts): Record<ChannelKey, ChannelAvailabilityRow> {
  return Object.fromEntries(CHANNEL_KEYS.map((key) => [key, channelAvailabilityRow(key, facts)])) as Record<ChannelKey, ChannelAvailabilityRow>;
}

/** The refusal a founder reads when a channel that cannot run is turned on (see `channelNotAvailableMessage`). */
export function channelRefusal(channelKey: ChannelKey, availability: ChannelAvailability): string {
  return channelNotAvailableMessage(channelKey, availability, availability.connectorKey ? ACTING_CONNECTOR_NAMES[availability.connectorKey] : null);
}

/** Connectors that publish through the project's own code repository. */
const REPOSITORY_CONNECTORS: ReadonlySet<string> = new Set(["github"]);

/**
 * What opens first when no channel can run: the first channel (in `CHANNEL_KEYS` order) the founder can open by
 * connecting something now; null when none is theirs to open (the sentence then says email opens first).
 */
export function firstChannelToOpen(rows: Readonly<Record<ChannelKey, ChannelAvailability>>): NoChannelFacts["opensFirst"] {
  // A channel that runs through a code repository (SEO and GEO commit pages to the project's own site) is never named
  // as the first to open: most projects have no repository, and a first-time founder is not sent to connect one to
  // find customers. It still appears, with its reason, in the "Not available yet" list.
  const key = CHANNEL_KEYS.find((k) => rows[k].reason === "not_connected" && rows[k].connectable === true && !REPOSITORY_CONNECTORS.has(rows[k].connectorKey ?? ""));
  if (!key) return null;
  const connectorKey = rows[key].connectorKey;
  return { label: CHANNEL_META[key].label, connectorName: connectorKey ? (ACTING_CONNECTOR_NAMES[connectorKey] ?? null) : null, connectable: true };
}

/** An integration row as the facts need it (`repos.integrations.list` rows fit). */
export interface IntegrationFact {
  connectorKey: string;
  status: string;
  archivedAt?: Date | string | null;
}

/** Integration statuses that count as connected: `mock`, `expired` and `disconnected` do not. */
export const CONNECTED_INTEGRATION_STATUSES: readonly string[] = ["connected", "degraded"];

/**
 * The facts for one business: the deployment's live connectors (`INTEGRATIONS_MODE`, `LIVE_CONNECTORS`), the
 * business's connected integrations (GitHub counts once its installation is connected) and whether simulated results
 * are allowed for it (`APP_ENV`, `businesses.is_demo`).
 */
export function channelAvailabilityFacts(env: Pick<Env, "APP_ENV" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS"> & Partial<Pick<Env, "PLATFORM_MAIL_DOMAIN">>, business: { isDemo: boolean }, integrations: readonly IntegrationFact[]): ChannelAvailabilityFacts {
  return {
    liveConnectors: env.INTEGRATIONS_MODE === "live" ? "all" : liveConnectorKeys(env),
    connectedConnectors: integrations.filter((i) => !i.archivedAt && CONNECTED_INTEGRATION_STATUSES.includes(i.status)).map((i) => i.connectorKey),
    mockResultsAllowed: mockResultsAllowed(env.APP_ENV, business.isDemo),
    platformMail: platformMailLive(env),
  };
}

/** True when every channel is available whatever the business connected: no integration read is needed. */
export function everyChannelAvailable(env: Pick<Env, "APP_ENV">, business: { isDemo: boolean }): boolean {
  return mockResultsAllowed(env.APP_ENV, business.isDemo);
}
