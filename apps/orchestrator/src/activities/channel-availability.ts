/**
 * Whether a channel may run for a business, as the orchestrator asks it (founder, 2026-11-11: only channels that can
 * really act run; packages/connectors `channelAvailability` is the rule). A channel in offline tracking always may
 * (the agent prepares, the founder submits). The business's integrations are read only where simulated results are
 * not allowed, so development, tests and the sample businesses cost no extra read and behave as before.
 *
 * Two questions, kept apart (founder, 2026-11-12, tap-to-post): `channelBlocked` asks whether a channel may be on the
 * board at all; `channelEngineBlocked` asks whether its engine may run. A channel the founder posts by tap (`by_tap`)
 * may be on the board and never has an engine: no agent can publish there, so nothing is launched or measured for it.
 */
import { channelAvailabilities, channelAvailability, channelAvailabilityFacts, everyChannelAvailable } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { channelEngineMayRun, type ChannelAvailability, type ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";

/** Every channel's availability for a business (all fifteen available, with no read, where simulated results are allowed for everyone). */
export async function channelAvailabilityFor(deps: Pick<OrchestratorDeps, "db" | "env">, businessId: string): Promise<Record<ChannelKey, ChannelAvailability>> {
  if (everyChannelAvailable(deps.env, { isDemo: false })) return channelAvailabilities({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: true });
  const [business, integrations] = await Promise.all([repos.businesses.get(deps.db, businessId), repos.integrations.list(deps.db, businessId)]);
  return channelAvailabilities(channelAvailabilityFacts(deps.env, business, integrations));
}

/** Null when the channel may be on the board; otherwise why it is not available (it is not in offline tracking either). */
export async function channelBlocked(deps: Pick<OrchestratorDeps, "db" | "env">, business: { id: string; isDemo: boolean }, channelKey: ChannelKey, kitMode: boolean): Promise<ChannelAvailability | null> {
  if (kitMode || everyChannelAvailable(deps.env, business)) return null;
  const availability = channelAvailability(channelKey, channelAvailabilityFacts(deps.env, business, await repos.integrations.list(deps.db, business.id)));
  return availability.available ? null : availability;
}

/**
 * Null when the channel's engine may run; otherwise why not: the channel is not available, or the founder posts it by
 * tap (`reason: "by_tap"`, available and still nothing for an agent to launch or measure).
 */
export async function channelEngineBlocked(deps: Pick<OrchestratorDeps, "db" | "env">, business: { id: string; isDemo: boolean }, channelKey: ChannelKey, kitMode: boolean): Promise<ChannelAvailability | null> {
  if (kitMode || everyChannelAvailable(deps.env, business)) return null;
  const availability = channelAvailability(channelKey, channelAvailabilityFacts(deps.env, business, await repos.integrations.list(deps.db, business.id)));
  return channelEngineMayRun(availability, kitMode) ? null : availability;
}
