/**
 * The LIVE social layer's delivery, screening and limits (BUILD §11.14; audit #28, #34, #65, #66, FU-S-2).
 *
 * Delivery. A connection request or a message is about its RECIPIENT, and it stays theirs: nothing about it is written
 * to any business, neither an event (`connection.requested`, `message.received`) nor an Inbox note. A business's event
 * log, its Inbox and its `ev:` stream are read by every member and advisor with access to the sections they feed, so
 * filing a founder's private network messages there showed them to the founder's staff (FU-S-2). The recipient is reached
 * on their own instead: after the commit their stream channel `u:{userId}` gets a content-free signal, so their Network
 * badge and lists refresh in whichever business they have open, Personal or LIVE, and the request, the thread and its
 * messages are read through `live.*`, which only the people in them can call (`live.summary` counts them for the badge).
 * The catalogue declares both event types person-addressed (`PERSON_ADDRESSED_EVENT_TYPES`): the events repo refuses
 * them, a table constraint (0059) holds the log to it and apps/stream never delivers one.
 *
 * Screening. Every new or edited community post passes the moderation route (Haiku; deterministic in mock mode) plus a
 * few deterministic checks before it is shown: a held post waits for the community's owner and moderators. A screen that
 * fails holds the post rather than letting it through.
 *
 * Limits. Requests, messages, posts (each one a model call), new communities, invitations and reports are limited per
 * signed-in person (process-local sliding windows, like the logo limits; see rate-limit.ts for the replica caveat).
 */
import { APP_NAME } from "@foundmill/config";
import { buildCommunityScreenRequest, communityScreenLocalFlags, communityScreenVerdict, type CommunityScreenKind } from "@foundmill/agents";
import { repos, type Executor, type Message, type MessageThread, type PostScreening } from "@foundmill/db";
import { publishUserSignal, type StreamRedis, type UserSignalKind } from "@foundmill/events";
import { ModerationOutput, type ModelClient } from "@foundmill/models";
import { ForbiddenError } from "@foundmill/shared";
import type { ApiLogger } from "./log";
import { RateLimitedError, SlidingWindowLimiter, type WindowLimit } from "./rate-limit";

// ---------------------------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Per signed-in person. A post (new or edited) is one moderation model call. */
export const LIVE_LIMITS = {
  requests: [{ limit: 30, windowMs: HOUR }],
  messages: [
    { limit: 20, windowMs: MINUTE },
    { limit: 200, windowMs: HOUR },
  ],
  posts: [
    { limit: 6, windowMs: MINUTE },
    { limit: 40, windowMs: HOUR },
  ],
  communities: [{ limit: 3, windowMs: DAY }],
  invites: [{ limit: 50, windowMs: DAY }],
  reports: [{ limit: 30, windowMs: HOUR }],
} as const satisfies Record<string, readonly WindowLimit[]>;
export type LiveAction = keyof typeof LIVE_LIMITS;

const WHAT: Record<LiveAction, string> = { requests: "Connection request", messages: "Message", posts: "Post", communities: "New community", invites: "Invitation", reports: "Report" };

/** One process-wide limiter (tests reset it). */
export const liveLimiter = new SlidingWindowLimiter();

/** Spends one of the person's `action`s, or throws TOO_MANY_REQUESTS with a sentence they can act on. */
export function takeLive(userId: string, action: LiveAction): void {
  const r = liveLimiter.takeAll(LIVE_LIMITS[action].map((rule, i) => ({ key: `live:${action}:${i}:${userId}`, rule })));
  if (!r.ok) throw new RateLimitedError(WHAT[action], r.retryAfterMs);
}

// ---------------------------------------------------------------------------------------------------------------------
// The network is for adults
// ---------------------------------------------------------------------------------------------------------------------

/** What a founder is told when a business would go LIVE before their 18+ confirmation is on record (FORBIDDEN). */
export const GO_LIVE_ADULTS_ONLY = "Confirm that you are 18 or older to go live: the network is for adults.";

/**
 * A business going LIVE (Settings › Mode, or Take charge as a LIVE business) puts it on the network, which is for adults
 * (BUILD §11.14): the founder confirms once that they are 18 or older (`confirm`, from the dialog that asks), or has
 * already. Going back to Personal never asks.
 */
export async function requireAdultToGoLive(db: Executor, userId: string, confirm: boolean | undefined): Promise<void> {
  if (confirm) await repos.social.confirmAdult(db, userId);
  else if (!(await repos.social.adultConfirmedAt(db, userId))) throw new ForbiddenError(GO_LIVE_ADULTS_ONLY);
}

// ---------------------------------------------------------------------------------------------------------------------
// Text from other people, made safe to quote
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Other people's words as plain text: entity markup reduced to its name, Markdown and HTML punctuation dropped (no links,
 * images or mentions can come through), whitespace collapsed, cut to `max` characters.
 */
export function plainQuote(text: string, max: number): string {
  const plain = text
    .replace(/\[\[ent:[^|\]]*\|([^\]]*)\]\]/g, "$1")
    .replace(/[[\]()<>!*_`#|~\\{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// ---------------------------------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The people a message reaches: everyone else in its thread who has not muted it. Nothing is written for them (see the
 * header: a message belongs to the people in its thread); they are signalled after the commit (`signalPeople`) and read
 * the thread on Network. A muted thread signals nobody.
 */
export function messageRecipients(input: { message: Pick<Message, "fromUser">; thread: Pick<MessageThread, "participantIds" | "mutedIds"> }): string[] {
  const { message, thread } = input;
  return thread.participantIds.filter((id) => id !== message.fromUser && !thread.mutedIds.includes(id));
}

/**
 * Content-free signals on each person's own stream channel, after the change committed. Best effort: without Redis, or
 * when a publish fails, the badge catches up on its next poll.
 */
export async function signalPeople(deps: { redis: StreamRedis | null; log: ApiLogger }, userIds: readonly string[], kind: UserSignalKind, ids: { threadId?: string; communityId?: string } = {}): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  await Promise.all(
    [...new Set(userIds)].map((userId) =>
      publishUserSignal(redis, userId, { kind, ...ids }).catch((err: unknown) => deps.log.warn({ err: (err as Error).message, kind }, "live signal not published")),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------------------------------------------------

export interface ScreenInput {
  text: string;
  /** What is being screened: a post, or a community's name and description. */
  kind: CommunityScreenKind;
  communityName: string;
  /** Booked to this business's usage ledger when the person speaks for one; otherwise the call is not booked. */
  businessId?: string | null;
}

/**
 * The moderation screen (@foundmill/agents `community-screen`): deterministic checks first (they hold on their own),
 * then the `moderation` route with the text as untrusted data. A screen that fails (the model is unavailable, the
 * answer does not parse) holds the post.
 */
export async function screenText(deps: { models: ModelClient; log: ApiLogger }, input: ScreenInput): Promise<PostScreening> {
  const local = communityScreenLocalFlags(input.text);
  try {
    const request = buildCommunityScreenRequest({ text: input.text, kind: input.kind, communityName: plainQuote(input.communityName, 120), appName: APP_NAME });
    const result = await deps.models.complete({
      ...request,
      schema: ModerationOutput,
      attribution: { ...(input.businessId ? { businessId: input.businessId } : {}), kind: "moderation" },
      scope: "moderation",
    });
    const out = result.json as ModerationOutput;
    const verdict = communityScreenVerdict(local, out);
    return { ...verdict, rationale: cut(out.rationale, 1000), mode: result.mode === "live" ? "live" : "mock" };
  } catch (err) {
    deps.log.warn({ err: (err as Error).message }, "moderation screen failed; holding the post for review");
    return { decision: "hold", flags: local, rationale: "The moderation screen was unavailable, so a moderator reviews this before members see it.", mode: "unavailable" };
  }
}
