/**
 * Which channels can really act for a business, as the api serves and enforces it (founder, 2026-11-11: "The Channel
 * Board shows only channels that can really act; the rest are listed as not available yet in Builder view"). The rule
 * is packages/connectors `channelAvailability`; the words are packages/shared `channel-availability.ts`.
 *
 * - `channelRowsFor` is what `distribution.channels.list` sends with every channel (the answer plus one plain sentence).
 * - `assertChannelMayRun` is the refusal behind the Board toggle and a plan's `enable_channel`: a channel that is not
 *   available is refused with a typed error (`channel_not_available`), unless it is in offline tracking (the agent
 *   prepares the materials and the founder submits them).
 * - `assertChannelMayLaunch` is the refusal behind a campaign being scheduled or going live: the same, and also a
 *   channel the founder posts by tap (`by_tap`, founder 2026-11-12). That one is available and may be on the board, but
 *   no agent can publish there, so nothing is launched on it, no engine starts for it (`runnableChannels`) and the
 *   Strategist never picks it as a starter (`teamRuns`).
 *
 * Where simulated results are allowed (a sample business anywhere, any business in development or test) every channel
 * is available and no integration is read, so the mock golden path is unchanged.
 */
import { channelAvailabilityFacts, channelAvailabilityRows, channelRefusal, everyChannelAvailable, firstChannelToOpen, type ChannelAvailabilityFacts } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, CHANNEL_KEYS, CHANNEL_META, channelActsRefusal, channelByTapRefusal, channelEngineMayRun, channelMayRun, channelTeamRuns, noChannelSentence, type ChannelAvailabilityRow, type ChannelKey, type Env } from "@foundmill/shared";

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
  /** The channels that are available, in `CHANNEL_KEYS` order: the ones the team runs and the ones the founder posts by tap. */
  available: ChannelKey[];
  /**
   * The available channels the team itself can run (`channelTeamRuns`): what a starter, a scoring task, a default start
   * and Week 1's promise are chosen from. A channel the founder posts by tap is available and is not in this list.
   */
  teamRuns: ChannelKey[];
  /**
   * When the team can run no channel: what a founder reads instead of a recommendation or a start (null otherwise). It
   * ends with what is ready by tap, when something is.
   */
  noneSentence: string | null;
}

export function channelAnswer(facts: ChannelAvailabilityFacts): ChannelAvailabilityAnswer {
  const rows = channelAvailabilityRows(facts);
  const available = CHANNEL_KEYS.filter((k) => rows[k].available);
  const teamRuns = available.filter((k) => channelTeamRuns(rows[k]));
  const byTap = available.filter((k) => !channelTeamRuns(rows[k])).map((k) => CHANNEL_META[k].label);
  return { rows, available, teamRuns, noneSentence: teamRuns.length === 0 ? noChannelSentence({ opensFirst: firstChannelToOpen(rows), byTap }) : null };
}

export async function channelRowsFor(db: Executor, scope: ChannelAvailabilityScope): Promise<ChannelAvailabilityAnswer> {
  return channelAnswer(await channelFactsFor(db, scope));
}

/**
 * The channels of `channels` whose engine may run: the team runs them, or they are in offline tracking. What an engine
 * is started for. A channel the founder posts by tap is left out: no agent can publish there, so it has no engine.
 */
export async function runnableChannels<C extends { channelKey: string; kitMode: boolean }>(db: Executor, scope: ChannelAvailabilityScope, channels: readonly C[]): Promise<C[]> {
  if (everyChannelAvailable(scope.env, scope.business)) return [...channels];
  const { rows } = await channelRowsFor(db, scope);
  return channels.filter((c) => channelEngineMayRun(rows[c.channelKey as ChannelKey], c.kitMode));
}

/** Why an engine did not start for a channel that is on the board: the founder posts it by tap, so there is nothing for an engine to launch. */
export const FOUNDER_POSTS_CHANNEL = "founder_posts_by_tap";

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

/**
 * Throws `channel_not_available` unless a campaign may be scheduled or go live on the channel: the team runs it, or it
 * is in offline tracking. A channel the founder posts by tap is refused in its own words (`reason: "by_tap"`): the
 * founder posts it, so nothing is launched there and nothing is reported as launched.
 */
export async function assertChannelMayLaunch(db: Executor, scope: ChannelAvailabilityScope, channel: { channelKey: ChannelKey; kitMode: boolean }): Promise<void> {
  if (channel.kitMode || everyChannelAvailable(scope.env, scope.business)) return;
  const { rows } = await channelRowsFor(db, scope);
  const row = rows[channel.channelKey];
  if (!channelMayRun(row, channel.kitMode)) throw channelNotAvailableError(channel.channelKey, row);
  if (!channelEngineMayRun(row, channel.kitMode)) throw new AppError(CHANNEL_NOT_AVAILABLE, row.reason === "acts" ? channelActsRefusal(channel.channelKey) : channelByTapRefusal(channel.channelKey), 409, { channelKey: channel.channelKey, reason: row.reason });
}
