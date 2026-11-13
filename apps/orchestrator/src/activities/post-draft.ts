/**
 * postDraft activity (docs/NETWORK.md F3 "Tap-to-post", F7 "Posting"; founder, Nov 12, 2026: "a post the social channel
 * agent wrote"): the social agent drafts one post for the founder to share by tap, after a real thing happened to the
 * project (its page went live, a founder showed a milestone on the page, its first follower confirmed).
 *
 * Drafting is separate from running the channel. The channel engine never runs for a channel the founder posts by tap
 * (./channel.ts: no agent can publish there, so nothing is planned, launched or measured), and that rule is unchanged:
 * this activity launches, schedules, publishes and measures nothing. It writes words, as a draft on the Creative tab,
 * and the founder's own press does the rest.
 *
 * The rules, the facts the agent is given, the check of its answer and the write are packages/db `draftTeamPost` and
 * packages/agents `post-draft.ts`, the same path apps/api takes in process when Temporal does not answer. This file
 * answers the one question that needs the connectors' rule (is the social channel available by tap for this business)
 * and writes `post.drafted` through the outbox in the transaction that stores the draft.
 */
import { channelAvailability, channelAvailabilityFacts, everyChannelAvailable } from "@foundmill/connectors";
import { draftTeamPost, repos, type TeamPostDraftResult, type TeamPostTriggerInput } from "@foundmill/db";
import { POST_DRAFT_CHANNEL } from "@foundmill/agents";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent, systemActor } from "../events";

export interface PostDraftInput {
  businessId: string;
  /** What happened: the event that made the team write, and the milestone it names where it names one. */
  trigger: TeamPostTriggerInput;
}

export type PostDraftResult = TeamPostDraftResult;

/** Whether the social channel is available to the business and posted by tap (`byTap`: true with `by_tap`, and where simulated results are allowed). */
export async function socialPostedByTap(deps: Pick<OrchestratorDeps, "db" | "env">, business: { id: string; isDemo: boolean }): Promise<boolean> {
  const integrations = everyChannelAvailable(deps.env, business) ? [] : await repos.integrations.list(deps.db, business.id);
  const availability = channelAvailability(POST_DRAFT_CHANNEL, channelAvailabilityFacts(deps.env, business, integrations));
  return availability.available && availability.byTap === true;
}

export function createPostDraftActivities(deps: OrchestratorDeps) {
  return {
    async draftSharePost(input: PostDraftInput): Promise<PostDraftResult> {
      return draftTeamPost({ db: deps.db, models: deps.models, appUrl: deps.env.APP_URL, log: deps.log, now: () => deps.clock.now() }, input.businessId, input.trigger, {
        channelByTap: (business) => socialPostedByTap(deps, business),
        onWritten: (tx, { asset, ref, agentId }) =>
          emitEvent(tx, { businessId: input.businessId, type: "post.drafted", actor: agentId ? agentActor(agentId) : systemActor, payload: { assetId: asset.id, trigger: ref.trigger, subject: ref.subject, agentId } }, { idempotencyKey: `post.drafted:${asset.id}` }),
      });
    },
  };
}
