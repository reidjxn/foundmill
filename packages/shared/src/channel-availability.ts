/**
 * Whether a channel can really act for a business (founder, 2026-11-11: "The Channel Board shows only channels that can
 * really act; the rest are listed as not available yet in Builder view"). Plain data and words, no Zod and no
 * connector code, so the browser reads the same types and sentences the services write.
 *
 * The rule itself (which gateway tools count as a channel acting, and `channelAvailability`) lives in
 * packages/connectors `channel-availability.ts`, next to the tools it names. The api computes each channel's answer
 * and sends it with the row; screens only read it.
 */
import { CHANNEL_META, type ChannelKey } from "./constants";
import { postsByTap } from "./share-targets";

/**
 * Whether a business may be shown simulated results while connectors are mock: a sample business anywhere, and any
 * business on a development or test stack. Staging and production never simulate for a person's own project. The
 * channel engine's invented metrics (package 0.4) and channel availability (package 0.5) share this one rule.
 */
export function mockResultsAllowed(appEnv: string, isDemo: boolean): boolean {
  return isDemo || appEnv === "development" || appEnv === "test";
}

/**
 * Why a channel is or is not available:
 * - `acts`: an agent holds a tool that takes the channel's outward action, on a connector that is live and connected.
 * - `simulated_allowed`: simulated results are allowed for this business (`mockResultsAllowed`), so every channel runs.
 * - `no_publisher`: no tool takes this channel's outward action yet.
 * - `not_connected`: such a tool exists, but its connector is not live here or the business has not connected it.
 * - `by_tap`: no agent can publish here, and none has to: the founder posts each draft with one press in the network's
 *   own share window, with the text and the link already filled in (tap-to-post; founder, 2026-11-12). Available with
 *   no connector, for the channels in `CHANNELS_SHARED_BY_TAP` only. The team does not run such a channel
 *   (`channelTeamRuns`): nothing is launched or measured for it, and no result is ever invented.
 */
export const CHANNEL_AVAILABILITY_REASONS = ["acts", "no_publisher", "not_connected", "simulated_allowed", "by_tap"] as const;
export type ChannelAvailabilityReason = (typeof CHANNEL_AVAILABILITY_REASONS)[number];

/**
 * The channels a founder can post to by tap (docs/DECISIONS.md 2026-11-12, "the only by-hand part of the social post
 * should be clicking the button to actually post it"). Today: social. A channel is added here only when its drafts
 * arrive with nothing left for the founder to type, paste, pick or attach.
 */
export const CHANNELS_SHARED_BY_TAP: readonly ChannelKey[] = ["social"];

/**
 * Whether `channelKey` is posted by tap today: it is in the list, and at least one network's share window still opens
 * with the text and the link filled in (`postsByTap`, derived from the share targets themselves, so a network that
 * stops pre-filling takes the channel's availability with it and nothing here needs editing).
 */
export function channelSharedByTap(channelKey: ChannelKey): boolean {
  return CHANNELS_SHARED_BY_TAP.includes(channelKey) && postsByTap();
}

/** What a founder reads beside a channel they post to by tap. */
export const CHANNEL_BY_TAP_SENTENCE = "You post each one with one press: the text and link are filled in for you.";

export interface ChannelAvailability {
  available: boolean;
  reason: ChannelAvailabilityReason;
  /**
   * The founder can post this channel's drafts with one press (`channelSharedByTap`). True with `by_tap`, and also where
   * simulated results are allowed (the share window works the same on a development stack and for a sample business).
   * Never set with `acts`: once a connector publishes, the team posts.
   */
  byTap?: boolean;
  /** `not_connected` only: the connector whose connection opens the channel. */
  connectorKey?: string;
  /** `not_connected` only: true when that connector is live here, so connecting it is the founder's step; false when it is not switched on yet. */
  connectable?: boolean;
}

/**
 * What the api sends with each channel: the answer plus one plain sentence. Null when the channel is available and the
 * team runs it; for a channel the founder posts by tap it says so (`CHANNEL_BY_TAP_SENTENCE`).
 */
export interface ChannelAvailabilityRow extends ChannelAvailability {
  sentence: string | null;
}

/** The heading of the Builder view list of channels that cannot run yet. */
export const CHANNELS_NOT_AVAILABLE_TITLE = "Not available yet";

/**
 * The plain reason a channel is not available, for a founder: null when it is available. `connectorName` is the
 * connector's display name ("SendGrid") for `not_connected`. A connector that is not switched on yet is never the
 * founder's step, so the sentence says nothing is waiting on them.
 */
export function channelAvailabilitySentence(a: ChannelAvailability, connectorName?: string | null): string | null {
  if (a.available) return a.byTap ? CHANNEL_BY_TAP_SENTENCE : null;
  if (a.reason === "not_connected") {
    const name = connectorName?.trim() || "its connection";
    return a.connectable
      ? `Not available yet: connect ${name} in Settings › Integrations and the team can run this.`
      : `Not available yet: ${name} is not switched on for your project yet. Nothing is waiting on you.`;
  }
  return "Not available yet: the team cannot publish here yet.";
}

/**
 * Whether a channel may be on the board: it is available (the team runs it, or the founder posts it by tap), or it is
 * in offline tracking (the agent prepares the materials and the founder submits them, which is honest whatever the
 * connectors are). Whether its engine runs is `channelEngineMayRun`.
 */
export function channelMayRun(availability: Pick<ChannelAvailability, "available"> | null | undefined, kitMode: boolean | null | undefined): boolean {
  return availability?.available !== false || kitMode === true;
}

/**
 * Whether the team itself can take the channel's outward action: it is available for a reason other than the founder
 * posting it. A channel posted by tap is available and is not this: no agent can publish there.
 */
export function channelTeamRuns(availability: Pick<ChannelAvailability, "available" | "reason"> | null | undefined): boolean {
  return availability?.available !== false && availability?.reason !== "by_tap";
}

/**
 * Whether a channel's engine may run (plan, draft, launch, measure): the team runs it, or it is in offline tracking. A
 * channel the founder posts by tap never has an engine: an agent cannot publish there, so nothing is launched, nothing
 * is measured and no result is invented for it.
 */
export function channelEngineMayRun(availability: Pick<ChannelAvailability, "available" | "reason"> | null | undefined, kitMode: boolean | null | undefined): boolean {
  return kitMode === true || channelTeamRuns(availability);
}

/**
 * The refusal when something tries to launch or schedule a campaign on a channel the founder posts by tap (the api's
 * typed error message, and what an agent's plan reads): the founder posts it, the team does not.
 */
export function channelByTapRefusal(channelKey: ChannelKey): string {
  return `${CHANNEL_META[channelKey].label} is yours to post, one press at a time: the team cannot publish there, so nothing is launched. Open a drafted post and press Share.`;
}

/** The refusal a founder reads when they try to turn on a channel that cannot run (the api's typed error message). */
export function channelNotAvailableMessage(channelKey: ChannelKey, a: ChannelAvailability, connectorName?: string | null): string {
  const label = CHANNEL_META[channelKey].label;
  if (a.reason === "not_connected") {
    const name = connectorName?.trim() || "its connection";
    return a.connectable
      ? `${label} is not available yet: connect ${name} in Settings › Integrations and the team can run it.`
      : `${label} is not available yet: ${name} is not switched on for your project yet. Nothing is waiting on you.`;
  }
  return `${label} is not available yet: the team cannot publish there yet.`;
}

/** Facts for the sentence shown when no channel can run on its own. */
export interface NoChannelFacts {
  /** The first channel that will open, by display name ("Email automation"); null when none is in sight. */
  opensFirst?: { label: string; connectorName: string | null; connectable: boolean } | null;
  /** Channels the founder can post to by tap now, by display name ("Social media"): said last, as what is ready. */
  byTap?: readonly string[];
}

/**
 * What a founder reads when no channel can run on its own: what opens first, and that nothing is wrong. Used by the
 * Board's empty state (`emptyWhy("channel_board")`), the Strategist's empty recommendation and the notes about
 * starting distribution, so they all say the same thing.
 */
export function noChannelSentence(facts: NoChannelFacts = {}): string {
  const first = facts.opensFirst;
  const ready = facts.byTap?.length ? ` ${facts.byTap.join(" and ")} ${facts.byTap.length === 1 ? "is" : "are"} ready now: you post each one with one press.` : "";
  if (first?.connectable && first.connectorName) {
    return `No channel can run on its own yet. ${first.label} opens first: connect ${first.connectorName} in Settings › Integrations and the team can run it. Nothing is wrong.${ready}`;
  }
  return `No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you.${ready}`;
}
