/**
 * The LIVE social layer's delivery, screening and limits (BUILD §11.14; audit #28, #34, #65, #66).
 *
 * Delivery. A connection request or a message is about its RECIPIENT, never its sender. Inside the transaction that
 * stores it, each LIVE business the recipient speaks for on the network (owner or admin of a listed business), other than
 * the sender's own businesses, gets the event (`connection.requested`, `message.received`) and a human message in its
 * Inbox › Messages tab, written here rather than narrated by the composer (the catalogue marks both events not
 * narratable): the note quotes the sender's words as plain text and says where to answer. A burst of messages in one
 * thread, or a request asked again, makes one unread note. After the
 * commit the recipient's own stream channel `u:{userId}` gets a content-free signal, so their Network badge refreshes
 * in whichever business they have open, Personal or LIVE. People with no LIVE business still get the badge.
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
import { repos, type Connection, type Executor, type Message, type MessageThread, type PostScreening } from "@foundmill/db";
import { publishUserSignal, type StreamRedis, type UserSignalKind } from "@foundmill/events";
import { ModerationOutput, type ModelClient } from "@foundmill/models";
import { ForbiddenError } from "@foundmill/shared";
import { writeEventRow } from "./events";
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
// Text from other people, made safe to quote in an Inbox note
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Other people's words as plain text for a note: entity markup reduced to its name, Markdown and HTML punctuation
 * dropped (no links, images or mentions can come through), whitespace collapsed, cut to `max` characters.
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

/** How the recipient sees the sender's name: their profile visibility applies, and having written to them names them. */
async function nameFor(tx: Executor, viewerId: string, userId: string): Promise<string> {
  const { users } = await repos.social.lookupPeople(tx, viewerId, { userIds: [userId] });
  return plainQuote(users[0]?.displayName ?? "", 60) || "A founder";
}

/** A human message in a business's Inbox › Messages tab, sourced from (and narrating) the given events. */
async function fileHumanMessage(tx: Executor, businessId: string, input: { fromUserId: string; subject: string; bodyMd: string; eventIds: string[] }): Promise<string> {
  const item = await repos.inbox.createItem(tx, businessId, { type: "human_message", from_agent_id: null, subject: cut(input.subject, 80), body_md: input.bodyMd, source_event_ids: input.eventIds }, { fromUserId: input.fromUserId });
  await repos.events.markNarrated(tx, businessId, input.eventIds);
  const created = await writeEventRow(tx, {
    businessId,
    type: "inbox.item_created",
    actor: { kind: "user", id: input.fromUserId },
    payload: { inboxItemId: item.id, type: "human_message", fromAgentId: null, subject: item.subject, blocksContinue: false, sourceEventIds: input.eventIds, cost: null },
  });
  // `inbox.item_created` is never narrated (as the composer's persist does).
  await repos.events.markNarrated(tx, businessId, [created]);
  return item.id;
}

// ---------------------------------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The businesses the sender belongs to. Nothing is filed there, even when the recipient speaks for one of them (two
 * co-founders writing to each other): its Inbox is the sender's too, and would tell them about their own words.
 */
async function senderBusinesses(tx: Executor, userId: string): Promise<Set<string>> {
  return new Set((await repos.memberships.listForUser(tx, userId)).map((m) => m.businessId));
}

/**
 * A new connection request reaches the recipient: `connection.requested` and an Inbox note in each LIVE business they
 * speak for (none the requester belongs to). Runs inside the request's transaction (repos.social.requestConnection
 * `onCreated`), so a repeated request, which returns the existing row, never notifies again; asking, withdrawing and
 * asking again adds no second note while the first is unread. Returns the businesses notified.
 */
export async function deliverConnectionRequest(tx: Executor, input: { connection: Connection; fromBusinessId: string | null }): Promise<string[]> {
  const { connection } = input;
  const to = connection.toUser;
  const theirs = await senderBusinesses(tx, connection.fromUser);
  const businesses = ((await repos.social.listedBusinessesFor(tx, [to])).get(to) ?? []).filter((b) => !theirs.has(b));
  if (!businesses.length) return [];
  const name = await nameFor(tx, to, connection.fromUser);
  const fromBusiness = input.fromBusinessId ? (await repos.social.lookupPeople(tx, to, { businessIds: [input.fromBusinessId] })).businesses[0] : undefined;
  const who = fromBusiness?.live ? `${name} of ${plainQuote(fromBusiness.name, 80)}` : name;
  const note = connection.message ? plainQuote(connection.message, 500) : "";
  const bodyMd = [
    `${who} asked to connect with you on ${APP_NAME}.`,
    note ? `Their note: “${note}”` : "",
    "Accept, ignore or block the request on Network. Nothing is answered until you choose, and an agent never answers it for you.",
  ]
    .filter(Boolean)
    .join("\n\n");
  for (const businessId of businesses) {
    const eventId = await writeEventRow(tx, {
      businessId,
      type: "connection.requested",
      actor: { kind: "user", id: connection.fromUser },
      payload: { connectionId: connection.id, fromUserId: connection.fromUser, toUserId: to, fromBusinessId: fromBusiness?.live ? fromBusiness.businessId : null, fromEntityId: null, message: connection.message ?? null },
    });
    if (await repos.social.hasUnreadRequestNote(tx, businessId, connection.fromUser)) {
      await repos.events.markNarrated(tx, businessId, [eventId]);
      continue;
    }
    await fileHumanMessage(tx, businessId, { fromUserId: connection.fromUser, subject: `Connection request from ${name}`, bodyMd, eventIds: [eventId] });
  }
  return businesses;
}

/**
 * A message reaches everyone else in its thread who has not muted it: `message.received` in each LIVE business they
 * speak for (once per business, however many of its people are in the thread; none the sender belongs to) and an Inbox
 * note, unless that business already has an unread note for this thread. Runs inside the Send's transaction. Returns
 * the people to signal.
 */
export async function deliverMessage(tx: Executor, input: { message: Message; thread: MessageThread }): Promise<string[]> {
  const { message, thread } = input;
  const recipients = thread.participantIds.filter((id) => id !== message.fromUser && !thread.mutedIds.includes(id));
  if (!recipients.length) return [];
  const [byPerson, theirs] = await Promise.all([repos.social.listedBusinessesFor(tx, recipients), senderBusinesses(tx, message.fromUser)]);
  const preview = plainQuote(message.body, 280);
  const seen = new Set<string>(theirs);
  for (const recipient of recipients) {
    const businesses = (byPerson.get(recipient) ?? []).filter((b) => !seen.has(b));
    if (!businesses.length) continue;
    const name = await nameFor(tx, recipient, message.fromUser);
    const where = thread.kind === "group" ? `in a group conversation${thread.subject ? `, “${plainQuote(thread.subject, 80)}”` : ""}` : "";
    for (const businessId of businesses) {
      seen.add(businessId);
      const eventId = await writeEventRow(tx, {
        businessId,
        type: "message.received",
        actor: { kind: "user", id: message.fromUser },
        payload: { messageId: message.id, threadId: thread.id, fromUserId: message.fromUser, fromEntityId: null, preview, hasAttachments: false, negotiation: false },
      });
      if (await repos.social.hasUnreadThreadNote(tx, businessId, thread.id)) {
        await repos.events.markNarrated(tx, businessId, [eventId]);
        continue;
      }
      const bodyMd = [
        `${name} wrote to you on Network${where ? ` ${where}` : ""}:`,
        `“${preview}”`,
        "Open Network to read the conversation and reply. An agent can draft a reply for you, but only your own Send sends it.",
      ].join("\n\n");
      await fileHumanMessage(tx, businessId, { fromUserId: message.fromUser, subject: `Message from ${name}`, bodyMd, eventIds: [eventId] });
    }
  }
  return recipients;
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
