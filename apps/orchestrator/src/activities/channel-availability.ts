/**
 * Whether a channel may run for a business, as the orchestrator asks it (founder, 2026-11-11: only channels that can
 * really act run; packages/connectors `channelAvailability` is the rule). A channel in offline tracking always may
 * (the agent prepares, the founder submits). The business's integrations are read only where simulated results are
 * not allowed, so development, tests and the sample businesses cost no extra read and behave as before.
 */
import { channelAvailabilities, channelAvailability, channelAvailabilityFacts, everyChannelAvailable } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import type { ChannelAvailability, ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";

/** Every channel's availability for a business (all fifteen available, with no read, where simulated results are allowed for everyone). */
export async function channelAvailabilityFor(deps: Pick<OrchestratorDeps, "db" | "env">, businessId: string): Promise<Record<ChannelKey, ChannelAvailability>> {
  if (everyChannelAvailable(deps.env, { isDemo: false })) return channelAvailabilities({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: true });
  const [business, integrations] = await Promise.all([repos.businesses.get(deps.db, businessId), repos.integrations.list(deps.db, businessId)]);
  return channelAvailabilities(channelAvailabilityFacts(deps.env, business, integrations));
}

/** Null when the channel may run; otherwise why it is not available (it is not in offline tracking either). */
export async function channelBlocked(deps: Pick<OrchestratorDeps, "db" | "env">, business: { id: string; isDemo: boolean }, channelKey: ChannelKey, kitMode: boolean): Promise<ChannelAvailability | null> {
  if (kitMode || everyChannelAvailable(deps.env, business)) return null;
  const availability = channelAvailability(channelKey, channelAvailabilityFacts(deps.env, business, await repos.integrations.list(deps.db, business.id)));
  return availability.available ? null : availability;
}
