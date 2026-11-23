/**
 * Throttles on the LIVE writes a person makes to other people (audit GLS2F-05, LS2-05): connection requests, messages and
 * posts. Each is per signed-in person, with a second key on the person asked, the thread or the community, so one account
 * cannot flood another person, a thread, a feed or the event outbox. Backed by the shared store (`ctx.limits`: Redis in
 * staging and production, so every replica counts together); a refusal is a 429 with plain copy.
 */
import { LIMITS } from "@foundmill/config";
import { takeOrThrow, type LimitEntry, type RateLimitStore } from "./rate-limit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIVE_LIMITS = {
  requests: { limit: LIMITS.liveRequestsPerUserPerHour, windowMs: HOUR },
  requestsToOne: { limit: LIMITS.liveRequestsPerPairPerDay, windowMs: DAY },
  requestsReceived: { limit: LIMITS.liveRequestsPerRecipientPerDay, windowMs: DAY },
  messages: { limit: LIMITS.liveMessagesPerUserPerMinute, windowMs: MINUTE },
  messagesPerHour: { limit: LIMITS.liveMessagesPerUserPerHour, windowMs: HOUR },
  messagesInThread: { limit: LIMITS.liveMessagesPerThreadPerMinute, windowMs: MINUTE },
  postsPerMinute: { limit: LIMITS.livePostsPerUserPerMinute, windowMs: MINUTE },
  postsPerHour: { limit: LIMITS.livePostsPerUserPerHour, windowMs: HOUR },
  communities: { limit: LIMITS.liveCommunitiesPerUserPerDay, windowMs: DAY },
  invites: { limit: LIMITS.liveInvitesPerUserPerDay, windowMs: DAY },
  reports: { limit: LIMITS.liveReportsPerUserPerHour, windowMs: HOUR },
  joins: { limit: LIMITS.liveJoinsPerUserPerDay, windowMs: DAY },
  communityEdits: { limit: LIMITS.liveCommunityEditsPerUserPerDay, windowMs: DAY },
  communityReads: { limit: LIMITS.liveCommunityReadsPerUserPerMinute, windowMs: MINUTE },
} as const;

/** Spends one connection request from the person and from the pair, or throws TOO_MANY_REQUESTS. */
export async function takeConnectionRequest(limits: RateLimitStore, userId: string, toUserId: string): Promise<void> {
  const entries: LimitEntry[] = [
    { key: `live:request:${userId}`, rule: LIVE_LIMITS.requests },
    { key: `live:request:${userId}:${toUserId}`, rule: LIVE_LIMITS.requestsToOne },
  ];
  await takeOrThrow(limits, "Connection request", entries);
}

/** Spends one of the requests a person receives in a day from everyone (M2); taken only when a request reaches them. */
export async function takeRequestReceived(limits: RateLimitStore, toUserId: string): Promise<void> {
  await takeOrThrow(limits, "Requests to this person", [{ key: `live:request-received:${toUserId}`, rule: LIVE_LIMITS.requestsReceived }]);
}

/** People searches (Find people, the name search) a person may run in a minute: each one reads every public profile. */
export const PEOPLE_SEARCHES_PER_MINUTE = 30;

/** Spends one people search from the person (shared store, every api replica). */
export async function takePeopleSearch(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Search", [{ key: `live:people-search:${userId}`, rule: { limit: PEOPLE_SEARCHES_PER_MINUTE, windowMs: MINUTE } }]);
}

/** Spends one message from the person and from the thread (or, for a first message, from the recipients). */
export async function takeMessage(limits: RateLimitStore, userId: string, target: string): Promise<void> {
  const entries: LimitEntry[] = [
    { key: `live:message:${userId}`, rule: LIVE_LIMITS.messages },
    { key: `live:message:${userId}:hour`, rule: LIVE_LIMITS.messagesPerHour },
    { key: `live:message:${userId}:${target}`, rule: LIVE_LIMITS.messagesInThread },
  ];
  await takeOrThrow(limits, "Message", entries);
}

/** Spends one post (or reply) from the person, per minute and per hour. */
export async function takePost(limits: RateLimitStore, userId: string): Promise<void> {
  const entries: LimitEntry[] = [
    { key: `live:post:${userId}:minute`, rule: LIVE_LIMITS.postsPerMinute },
    { key: `live:post:${userId}:hour`, rule: LIVE_LIMITS.postsPerHour },
  ];
  await takeOrThrow(limits, "Post", entries);
}

/** Spends one new community from the person's day. */
export async function takeCommunity(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "New community", [{ key: `live:community:${userId}`, rule: LIVE_LIMITS.communities }]);
}

/** Spends one community invitation from the person's day. */
export async function takeCommunityInvite(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Invitation", [{ key: `live:invite:${userId}`, rule: LIVE_LIMITS.invites }]);
}

/** Spends one community join (or accepted invitation) from the person's day. */
export async function takeCommunityJoin(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Joining communities", [{ key: `live:join:${userId}`, rule: LIVE_LIMITS.joins }]);
}

/** Spends one change to a community from its owner's day (a new name or description is a screening model call). */
export async function takeCommunityEdit(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Community changes", [{ key: `live:community-edit:${userId}`, rule: LIVE_LIMITS.communityEdits }]);
}

/** Spends one community read (a list, a community, its feed, its queue, invitations) from the person's minute. */
export async function takeCommunityRead(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Reading communities", [{ key: `live:community-read:${userId}`, rule: LIVE_LIMITS.communityReads }]);
}

/** Spends one post report from the person's hour. */
export async function takePostReport(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Report", [{ key: `live:report:${userId}`, rule: LIVE_LIMITS.reports }]);
}
