/**
 * Which channels can really act for a business, as the api serves and enforces it (founder, 2026-11-11: "The Channel
 * Board shows only channels that can really act; the rest are listed as not available yet in Builder view"). The rule
 * is packages/connectors `channelAvailability`; the words are packages/shared `channel-availability.ts`.
 *
 * - `channelRowsFor` is what `distribution.channels.list` sends with every channel (the answer plus one plain sentence).
 * - `assertChannelMayRun` is the refusal behind the Board toggle, a plan's `enable_channel` and a campaign going live: a
 *   channel that is not available is refused with a typed error (`channel_not_available`), unless it is in offline
 *   tracking (the agent prepares the materials and the founder submits them).
 *
 * Where simulated results are allowed (a sample business anywhere, any business in development or test) every channel
 * is available and no integration is read, so the mock golden path is unchanged.
 */
import { channelAvailabilityFacts, channelAvailabilityRows, channelRefusal, everyChannelAvailable, firstChannelToOpen, type ChannelAvailabilityFacts } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, CHANNEL_KEYS, channelMayRun, noChannelSentence, type ChannelAvailabilityRow, type ChannelKey, type Env } from "@foundmill/shared";

/** What the availability of a business's channels is read from: the deployment's env and the business row. */
export interface ChannelAvailabilityScope {
  env: Pick<Env, "APP_ENV" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  businessId: string;
  business: { isDemo: boolean };
}

/** The error code of a refused channel (the web reads `data.appCode`). */
export const CHANNEL_NOT_AVAILABLE = "channel_not_available";

const ALL_SIMULATED: ChannelAvailabilityFacts = { liveConnectors: [], connectedConnectors: [], mockResultsAllowed: true };

/** The facts for this business; its integrations are read only when simulated results are not allowed for it. */
export async function channelFactsFor(db: Executor, scope: ChannelAvailabilityScope): Promise<ChannelAvailabilityFacts> {
  if (everyChannelAvailable(scope.env, scope.business)) return ALL_SIMULATED;
  return channelAvailabilityFacts(scope.env, scope.business, await repos.integrations.list(db, scope.businessId));
}

export interface ChannelAvailabilityAnswer {
  /** Every channel's availability with its founder sentence, by key. */
  rows: Record<ChannelKey, ChannelAvailabilityRow>;
  /** The channels that are available, in `CHANNEL_KEYS` order. */
  available: ChannelKey[];
  /** When no channel is available: what a founder reads instead of a recommendation or a start (null otherwise). */
  noneSentence: string | null;
}

export function channelAnswer(facts: ChannelAvailabilityFacts): ChannelAvailabilityAnswer {
  const rows = channelAvailabilityRows(facts);
  const available = CHANNEL_KEYS.filter((k) => rows[k].available);
  return { rows, available, noneSentence: available.length === 0 ? noChannelSentence({ opensFirst: firstChannelToOpen(rows) }) : null };
}

export async function channelRowsFor(db: Executor, scope: ChannelAvailabilityScope): Promise<ChannelAvailabilityAnswer> {
  return channelAnswer(await channelFactsFor(db, scope));
}

/** The channels of `channels` that may run: available, or in offline tracking. What an engine is started for. */
export async function runnableChannels<C extends { channelKey: string; kitMode: boolean }>(db: Executor, scope: ChannelAvailabilityScope, channels: readonly C[]): Promise<C[]> {
  if (everyChannelAvailable(scope.env, scope.business)) return [...channels];
  const { rows } = await channelRowsFor(db, scope);
  return channels.filter((c) => channelMayRun(rows[c.channelKey as ChannelKey], c.kitMode));
}

/** The channels an option's actions would turn on, fund or give work to. */
export function optionChannels(option: { actions?: readonly { type: string; params?: Record<string, unknown> }[] }): ChannelKey[] {
  const keys = new Set<ChannelKey>();
  for (const a of option.actions ?? []) {
    if (a.type !== "enable_channel" && a.type !== "set_budget" && a.type !== "create_task") continue;
    const channel = a.params?.channel;
    if (typeof channel === "string" && (CHANNEL_KEYS as readonly string[]).includes(channel)) keys.add(channel as ChannelKey);
  }
  return [...keys];
}

/**
 * The options of a decision a founder can really be offered: one whose actions rely on a channel that cannot run is
 * left out (its label and consequence would promise work no agent can do), the rest stay as written. Exactly one stays
 * recommended: the original pick when it survives, otherwise the first that is left.
 */
export function offerableOptions<O extends { recommended: boolean; because?: string; actions?: readonly { type: string; params?: Record<string, unknown> }[] }>(options: readonly O[], mayRun: (channel: ChannelKey) => boolean): { options: O[]; dropped: number } {
  const kept = options.filter((o) => optionChannels(o).every(mayRun));
  const dropped = options.length - kept.length;
  if (dropped === 0 || kept.length === 0 || kept.some((o) => o.recommended)) return { options: kept, dropped };
  return { options: kept.map((o, i) => ({ ...o, recommended: i === 0 })), dropped };
}

/** A decision note offers at least two options (the Inbox contract, packages/db `createItem`). */
export const MIN_DECISION_OPTIONS = 2;

/** The line added to a decision whose options were cut down to what can run. */
export const OPTIONS_LEFT_OUT_LINE = "Routes that depend on a channel the team cannot run yet are left out for now; they come back as those channels open.";

/** The typed refusal for a channel that cannot run. */
export function channelNotAvailableError(channelKey: ChannelKey, row: ChannelAvailabilityRow): AppError {
  return new AppError(CHANNEL_NOT_AVAILABLE, channelRefusal(channelKey, row), 409, { channelKey, reason: row.reason, ...(row.connectorKey ? { connectorKey: row.connectorKey, connectable: row.connectable === true } : {}) });
}

/** Throws `channel_not_available` unless the channel is available or in offline tracking. */
export async function assertChannelMayRun(db: Executor, scope: ChannelAvailabilityScope, channel: { channelKey: ChannelKey; kitMode: boolean }): Promise<void> {
  if (channel.kitMode || everyChannelAvailable(scope.env, scope.business)) return;
  const { rows } = await channelRowsFor(db, scope);
  if (!channelMayRun(rows[channel.channelKey], channel.kitMode)) throw channelNotAvailableError(channel.channelKey, rows[channel.channelKey]);
}
