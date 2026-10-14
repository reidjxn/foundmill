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
  messages: { limit: LIMITS.liveMessagesPerUserPerMinute, windowMs: MINUTE },
  messagesInThread: { limit: LIMITS.liveMessagesPerThreadPerMinute, windowMs: MINUTE },
  postsPerMinute: { limit: LIMITS.livePostsPerUserPerMinute, windowMs: MINUTE },
  postsPerHour: { limit: LIMITS.livePostsPerUserPerHour, windowMs: HOUR },
} as const;

/** Spends one connection request from the person and from the pair, or throws TOO_MANY_REQUESTS. */
export async function takeConnectionRequest(limits: RateLimitStore, userId: string, toUserId: string): Promise<void> {
  const entries: LimitEntry[] = [
    { key: `live:request:${userId}`, rule: LIVE_LIMITS.requests },
    { key: `live:request:${userId}:${toUserId}`, rule: LIVE_LIMITS.requestsToOne },
  ];
  await takeOrThrow(limits, "Connection request", entries);
}

/** Spends one message from the person and from the thread (or, for a first message, from the recipients). */
export async function takeMessage(limits: RateLimitStore, userId: string, target: string): Promise<void> {
  const entries: LimitEntry[] = [
    { key: `live:message:${userId}`, rule: LIVE_LIMITS.messages },
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
