/**
 * LIVE social layer — public_profiles, connections, message threads/messages, communities, posts,
 * leaderboards, negotiation_threads (BUILD §7.2 "LIVE social", §7.3, §11.14; routers live.*).
 *
 * Most of this is user-scoped, not business-scoped (connections and messages are between people), so the
 * account-scoped functions take `userId` first (ARCHITECTURE §4 exception). Leaderboards and negotiations are
 * business-facing. Personal businesses never appear in `publicProfiles`/`searchPublic`: the `public_profiles`
 * view only selects LIVE businesses (0012), so the visibility rule is enforced in SQL, not here.
 */
import { AppError, ARCHETYPES, DATA_REGIONS, ForbiddenError, NotFoundError, ValidationError, VISIBILITY } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import {
  businesses, communities, COMMUNITY_KINDS, communityMembers, CONNECTION_STATUSES, connections, events, founderProfiles, inboxItems, leaderboardEntries, leaderboards, memberships, messages, messageThreads,
  NEGOTIATION_STATUSES, negotiationThreads, networkAttestations, POST_REPORT_REASONS, postReports, posts, publicProfiles,
  type COMMUNITY_ROLES, type Community, type CommunityMember, type Connection, type Leaderboard, type LeaderboardEntry, type Message, type MessageThread, type NegotiationThread, type Post,
  type POST_REPORT_RESOLUTIONS, type PostReport, type PostScreening, type PublicProfile,
} from "../schema";
import { Id, JsonObject, numericText, one, PageInput, parseInput, rowsOf, sqlState, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const CreateCommunityInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
  descriptionMd: z.string().default(""),
  visibility: z.enum(VISIBILITY).default("public"),
  kind: z.enum(COMMUNITY_KINDS).default("category"),
  ownerBusinessId: Id.nullable().optional(),
  createdBy: Id.nullable().optional(),
});
export type CreateCommunityInput = z.input<typeof CreateCommunityInput>;

/** The moderation screen's verdict, as stored on the post (0027). */
export const PostScreeningInput = z.object({
  decision: z.enum(["allow", "hold"]),
  flags: z.array(z.string().max(60)).max(20),
  rationale: z.string().max(1000),
  mode: z.enum(["mock", "live", "unavailable"]),
});

export const CreatePostInput = z.object({
  communityId: Id,
  authorUserId: Id,
  businessId: Id.nullable().optional(),
  parentPostId: Id.nullable().optional(),
  bodyMd: z.string().trim().min(1).max(20_000),
  entityIds: z.array(Id).default([]),
  /** The screen's verdict: a held post starts `pending_review`, out of the feed until a moderator approves it. */
  screening: PostScreeningInput.optional(),
});
export type CreatePostInput = z.input<typeof CreatePostInput>;

/** A post, as the moderators' queue lists it: why it is there (held by the screen, reports, hidden) and the open reports. */
export interface ModerationQueueItem {
  post: Post;
  openReports: number;
  reasons: (typeof POST_REPORT_REASONS)[number][];
}

/** What a moderator may do to a post: hide it (restorable), remove it (final), or restore/approve it into the feed. */
export const POST_MODERATION_ACTIONS = ["hide", "remove", "restore"] as const;
export type PostModerationAction = (typeof POST_MODERATION_ACTIONS)[number];

/** What an owner or moderator may do to a member. Restoring lifts a mute, and turns a ban back into "left". */
export const MEMBER_MODERATION_ACTIONS = ["mute", "ban", "restore"] as const;
export type MemberModerationAction = (typeof MEMBER_MODERATION_ACTIONS)[number];

/** A member who reads a community: active, or muted (reads but cannot post). */
const READING = ["active", "muted"] as const;

export const UpsertLeaderboardInput = z.object({
  boardKind: z.string().trim().min(1).max(60),
  division: z.string().trim().min(1).max(40).default("open"),
  /** e.g. 2026-Q4, 2026-10 or all-time. */
  period: z.string().trim().min(1).max(20),
  metric: z.string().trim().min(1).max(60),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  region: z.enum(DATA_REGIONS).nullable().optional(),
});
export type UpsertLeaderboardInput = z.input<typeof UpsertLeaderboardInput>;

export const LeaderboardEntryInput = z.object({
  businessId: Id,
  metricValue: z.number(),
  /** Only verified metric values enter a board (BUILD §7.2 "verified only"); unverified rows are kept but flagged. */
  verified: z.boolean().default(true),
  form: z.string().max(10).default(""),
});
export type LeaderboardEntryInput = z.input<typeof LeaderboardEntryInput>;

export const CreateNegotiationInput = z.object({
  businessB: Id,
  agentA: Id.nullable().optional(),
  agentB: Id.nullable().optional(),
  subject: z.string().max(200).default(""),
  /** The founder-set limits at the moment the thread opened (price bounds, walk-away, concession cap). */
  limitsSnapshot: JsonObject.default({}),
  workflowId: z.string().max(200).nullable().optional(),
});
export type CreateNegotiationInput = z.input<typeof CreateNegotiationInput>;

const sortPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** The connections row between two people, whichever of them asked. */
const pairOf = (a: string, b: string) => or(and(eq(connections.fromUser, a), eq(connections.toUser, b)), and(eq(connections.fromUser, b), eq(connections.toUser, a)));

/** Key of an unordered pair of people. */
const pairKey = (a: string, b: string) => sortPair(a, b).join("|");

/** What a sender is told when a Send cannot go: not connected and blocked read the same, so a block is never announced. */
const CANNOT_MESSAGE = "You cannot message this person";
/** A group needs everyone connected with everyone (0027): said without naming who is not, so no block is announced. */
const GROUP_NEEDS_CONNECTIONS = "Everyone in a group conversation must be connected with everyone else in it";

/** Why the owner of a community joined by invitation cannot leave it. */
const OWNER_STAYS = "You own this community and it is joined by invitation only, so you cannot leave it: nobody could let you back in";

/** Reports from this many different members hold a visible post for the moderators. */
export const REPORTS_TO_HOLD = 3;

/** Businesses a person speaks for on the network, at most this many (delivery fans out to each). */
export const MAX_NETWORK_BUSINESSES = 5;

/** One call may write to at most this many people (a thread is a conversation, not a mailing list). */
export const MAX_MESSAGE_RECIPIENTS = 20;

/** A business that may appear on a board: LIVE, committed and not archived (the SQL `is_public`). */
const publicBusiness = and(eq(businesses.gameMode, "live"), isNotNull(businesses.committedAt), isNull(businesses.archivedAt));

/** What the viewer may know about another user: `displayName` is null when their profile visibility keeps it back. */
export interface PersonCard {
  userId: string;
  displayName: string | null;
}

/** Public facts about a business (its name and logo inputs). Own businesses are included in any game mode. */
export interface BusinessCard {
  businessId: string;
  name: string;
  slug: string | null;
  kitPrimary: string | null;
  kitSecondary: string | null;
  archetype: string | null;
  live: boolean;
}

export const socialRepo = {
  // public profiles (view over LIVE businesses + founders who opted in) -------------------------------------------------
  async publicProfile(db: Executor, businessId: string): Promise<PublicProfile | null> {
    const rows = await db.select().from(publicProfiles).where(and(eq(publicProfiles.businessId, businessId), eq(publicProfiles.kind, "business"))).limit(1);
    return rows[0] ?? null;
  },

  /** Name search over public profiles only ("On {APP_NAME}" results in universal search). */
  async searchPublic(db: Executor, q: string, options: { limit?: number; kind?: (typeof publicProfiles.kind.enumValues)[number] } = {}): Promise<PublicProfile[]> {
    const term = parseInput(z.string().trim().min(1).max(120), q, "query");
    const limit = options.limit ?? 20;
    return db
      .select()
      .from(publicProfiles)
      .where(and(options.kind ? eq(publicProfiles.kind, options.kind) : undefined, or(sql`${publicProfiles.displayName} % ${term}`, sql`lower(${publicProfiles.displayName}) like lower(${term}) || '%'`)))
      .orderBy(desc(sql`similarity(${publicProfiles.displayName}, ${term})`), asc(publicProfiles.displayName))
      .limit(limit);
  },

  // the network is for adults (0027) ----------------------------------------------------------------------------------
  /** When this person confirmed that they are 18 or older; null when they have not (BUILD §11.14 "18+ only"). */
  async adultConfirmedAt(db: Executor, userId: string): Promise<Date | null> {
    const rows = await db.select({ at: networkAttestations.adultConfirmedAt }).from(networkAttestations).where(eq(networkAttestations.userId, userId)).limit(1);
    return rows[0]?.at ?? null;
  },

  /** Records the person's own confirmation that they are 18 or older. The first one stands; asking again changes nothing. */
  async confirmAdult(db: Executor, userId: string): Promise<Date> {
    const v = parseInput(Id, userId, "user");
    await db.insert(networkAttestations).values({ userId: v }).onConflictDoNothing({ target: networkAttestations.userId });
    return one(await db.select({ at: networkAttestations.adultConfirmedAt }).from(networkAttestations).where(eq(networkAttestations.userId, v)).limit(1), "attestation").at;
  },

  // connections (user-scoped) -----------------------------------------------------------------------------------------
  /**
   * A new request. Whoever has blocked the other, the answer is no: the blocker is told to unblock first; the blocked
   * person only learns that the request could not be sent (a block is never announced). One row exists per pair of
   * people, whichever of them asked: asking someone who already asked you (or is connected to you) returns that row. Two
   * requests racing for the same pair meet the unique index (23505) and get the winner's answer.
   */
  async requestConnection(db: Executor, fromUser: string, toUser: string, message?: string | null, options: { onCreated?: (tx: Executor, connection: Connection) => Promise<void> } = {}): Promise<Connection> {
    const v = parseInput(z.object({ fromUser: Id, toUser: Id, message: z.string().max(1000).nullable().optional() }), { fromUser, toUser, message }, "connection request");
    if (v.fromUser === v.toUser) throw new ValidationError("Cannot connect to yourself", { fromUser });
    const answerFor = async (tx: Executor): Promise<Connection | null> => {
      const existing = await tx
        .select()
        .from(connections)
        .where(or(and(eq(connections.fromUser, v.fromUser), eq(connections.toUser, v.toUser)), and(eq(connections.fromUser, v.toUser), eq(connections.toUser, v.fromUser))))
        .orderBy(sql`case ${connections.status} when 'blocked' then 0 when 'accepted' then 1 else 2 end`, desc(connections.createdAt))
        .limit(1);
      const current = existing[0];
      if (current?.status === "blocked") {
        if (current.blockedBy === v.fromUser) throw new ValidationError("You blocked this person; unblock them to connect again", { connectionId: current.id });
        throw new ValidationError("This request could not be sent");
      }
      if (current) return current;
      // Under row-level security the blocked person cannot see the block's row; the policy function can.
      const blocked = rowsOf<{ blocked: boolean }>(await tx.execute(sql`select connection_is_blocked(${v.fromUser}::uuid, ${v.toUser}::uuid) as blocked`));
      if (blocked[0]?.blocked) throw new ValidationError("This request could not be sent");
      return null;
    };
    // `onCreated` runs inside the transaction only when this call inserted the row (not for an answer that already
    // existed), so whatever it writes (the recipient's notification) commits with the request or not at all.
    const create = async (tx: Executor): Promise<Connection> => {
      const created = one(await tx.insert(connections).values({ fromUser: v.fromUser, toUser: v.toUser, message: v.message ?? null }).returning(), "connection");
      await options.onCreated?.(tx, created);
      return created;
    };
    try {
      return await db.transaction(async (tx) => (await answerFor(tx)) ?? (await create(tx)));
    } catch (err) {
      if (sqlState(err) !== "23505") throw err;
      const winner = await db.transaction((tx) => answerFor(tx));
      if (winner) return winner;
      throw new AppError("conflict", "This request clashed with another; try again", 409);
    }
  },

  /**
   * Only the recipient may accept; either side may block, and the block records who. A blocked row belongs to its
   * blocker: nobody else can change it, and `accepted` is never written over a block (unblock, then ask again).
   */
  async respondConnection(db: Executor, userId: string, connectionId: string, status: "accepted" | "blocked"): Promise<Connection> {
    const s = parseInput(z.enum(["accepted", "blocked"]), status, "connection status");
    return db.transaction(async (tx) => {
      const current = one(await tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1), "connection", connectionId);
      const isParty = current.fromUser === userId || current.toUser === userId;
      if (!isParty) throw new ValidationError("Not a party to this connection", { connectionId });
      if (current.status === "blocked") {
        if (current.blockedBy !== userId) throw new ValidationError("This connection cannot be changed", { connectionId });
        if (s === "blocked") return current;
        throw new ValidationError("Unblock this person before connecting again", { connectionId });
      }
      if (s === "accepted") {
        if (current.toUser !== userId) throw new ValidationError("Only the recipient can accept", { connectionId });
        if (current.status === "accepted") return current;
      }
      // Matches the status that was read: if the row moved in between (the other side answered or blocked), nothing is
      // written over it and the caller is told to look again.
      const rows = await tx
        .update(connections)
        .set({ status: s, respondedAt: new Date(), blockedBy: s === "blocked" ? userId : null })
        .where(and(eq(connections.id, connectionId), eq(connections.status, current.status)))
        .returning();
      if (!rows[0]) throw new AppError("conflict", "This connection changed while you were answering; look again", 409, { connectionId });
      return rows[0];
    });
  },

  /**
   * Blocks a person, whether or not a connection row exists between the two (a stranger in a group thread, an ex-
   * connection whose row was removed). An existing request or connection becomes the block; otherwise a blocked row is
   * created. A block the other person set already stands for both of them, so it is left alone and nothing is announced
   * (null). The block belongs to `userId` like any other: only they lift it.
   */
  async blockPerson(db: Executor, userId: string, otherId: string): Promise<Connection | null> {
    const v = parseInput(z.object({ userId: Id, otherId: Id }), { userId, otherId }, "block");
    if (v.userId === v.otherId) throw new ValidationError("You cannot block yourself");
    const attempt = () =>
      db.transaction(async (tx): Promise<Connection | null> => {
        if (!(await socialRepo.existingUsers(tx, [v.otherId])).has(v.otherId)) throw new NotFoundError("person", v.otherId);
        const existing = (await tx.select().from(connections).where(pairOf(v.userId, v.otherId)).limit(1))[0];
        if (existing?.status === "blocked") return existing.blockedBy === v.userId ? existing : null;
        if (existing) {
          const rows = await tx
            .update(connections)
            .set({ status: "blocked", blockedBy: v.userId, respondedAt: new Date() })
            .where(and(eq(connections.id, existing.id), eq(connections.status, existing.status)))
            .returning();
          if (!rows[0]) throw new AppError("conflict", "This connection changed while you were blocking; try again", 409);
          return rows[0];
        }
        return one(await tx.insert(connections).values({ fromUser: v.userId, toUser: v.otherId, status: "blocked", blockedBy: v.userId, respondedAt: new Date() }).returning(), "connection");
      });
    try {
      return await attempt();
    } catch (err) {
      // Two writes racing for the pair (a request arriving as the block is written): read the winner and block it.
      if (sqlState(err) !== "23505") throw err;
      return attempt();
    }
  },

  /**
   * Withdraws or declines a request, ends a connection, or lifts a block; a block can only be lifted by whoever set it.
   * Ending a connection also closes the two people's direct thread to new messages (see `sendState`). Returns the row
   * that was deleted (null when there was none the caller could remove).
   */
  async removeConnection(db: Executor, userId: string, connectionId: string): Promise<Connection | null> {
    const rows = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
    const current = rows[0];
    if (!current || (current.fromUser !== userId && current.toUser !== userId)) return null;
    if (current.status === "blocked" && current.blockedBy !== userId) throw new ValidationError("This connection cannot be removed", { connectionId });
    const deleted = await db
      .delete(connections)
      .where(and(eq(connections.id, connectionId), or(eq(connections.fromUser, userId), eq(connections.toUser, userId)), or(sql`${connections.status} <> 'blocked'`, eq(connections.blockedBy, userId))))
      .returning();
    return deleted[0] ?? null;
  },

  async listConnections(db: Executor, userId: string, filter: { status?: (typeof CONNECTION_STATUSES)[number]; direction?: "incoming" | "outgoing" } = {}): Promise<Connection[]> {
    const f = parseInput(z.object({ status: z.enum(CONNECTION_STATUSES).optional(), direction: z.enum(["incoming", "outgoing"]).optional() }), filter, "connection filter");
    return db
      .select()
      .from(connections)
      .where(
        and(
          f.direction === "incoming" ? eq(connections.toUser, userId) : f.direction === "outgoing" ? eq(connections.fromUser, userId) : or(eq(connections.fromUser, userId), eq(connections.toUser, userId)),
          f.status ? eq(connections.status, f.status) : undefined,
          // A block is never announced: the person who was blocked does not see the row, only the blocker does.
          or(sql`${connections.status} <> 'blocked'`, eq(connections.blockedBy, userId)),
        ),
      )
      .orderBy(desc(connections.createdAt));
  },

  async areConnected(db: Executor, userA: string, userB: string): Promise<boolean> {
    const rows = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.status, "accepted"), or(and(eq(connections.fromUser, userA), eq(connections.toUser, userB)), and(eq(connections.fromUser, userB), eq(connections.toUser, userA)))))
      .limit(1);
    return rows.length > 0;
  },

  // messages (user-scoped) --------------------------------------------------------------------------------------------
  /** The people among `otherIds` who exist (an auth user). */
  async existingUsers(db: Executor, ids: readonly string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await db.select({ id: authUsers.id }).from(authUsers).where(inArray(authUsers.id, [...ids]));
    return new Set(rows.map((r) => r.id));
  },

  /** Who among `otherIds` has a block with `userId`, whichever of them set it. */
  async blockedWith(db: Executor, userId: string, otherIds: readonly string[]): Promise<Set<string>> {
    if (!otherIds.length) return new Set();
    const rows = await db
      .select({ fromUser: connections.fromUser, toUser: connections.toUser })
      .from(connections)
      .where(and(eq(connections.status, "blocked"), or(and(eq(connections.fromUser, userId), inArray(connections.toUser, [...otherIds])), and(eq(connections.toUser, userId), inArray(connections.fromUser, [...otherIds])))));
    return new Set(rows.map((r) => (r.fromUser === userId ? r.toUser : r.fromUser)));
  },

  /** Who among `otherIds` is an accepted connection of `userId`. */
  async connectedWith(db: Executor, userId: string, otherIds: readonly string[]): Promise<Set<string>> {
    if (!otherIds.length) return new Set();
    const rows = await db
      .select({ fromUser: connections.fromUser, toUser: connections.toUser })
      .from(connections)
      .where(and(eq(connections.status, "accepted"), or(and(eq(connections.fromUser, userId), inArray(connections.toUser, [...otherIds])), and(eq(connections.toUser, userId), inArray(connections.fromUser, [...otherIds])))));
    return new Set(rows.map((r) => (r.fromUser === userId ? r.toUser : r.fromUser)));
  },

  /** True when every two of these people are accepted connections (a block between any two reads as not connected). */
  async allConnected(db: Executor, people: readonly string[]): Promise<boolean> {
    const ids = [...new Set(people)];
    if (ids.length < 2) return true;
    const rows = await db
      .select({ fromUser: connections.fromUser, toUser: connections.toUser })
      .from(connections)
      .where(and(eq(connections.status, "accepted"), inArray(connections.fromUser, ids), inArray(connections.toUser, ids)));
    const linked = new Set(rows.map((r) => pairKey(r.fromUser, r.toUser)));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (!linked.has(pairKey(ids[i]!, ids[j]!))) return false;
    return true;
  },

  /**
   * The thread between exactly these participants (created if missing). Two people share one `direct` thread; three or
   * more a `group`, and a group that shrank to two (someone left) is never taken for the pair's direct thread. Low
   * level: no checks on who may write to whom.
   */
  async findOrCreateThread(db: Executor, userId: string, participantIds: readonly string[], subject?: string | null): Promise<MessageThread> {
    const v = parseInput(z.object({ participantIds: z.array(Id).min(1), subject: z.string().max(200).nullable().optional() }), { participantIds, subject }, "thread");
    const members = [...new Set([userId, ...v.participantIds])].sort();
    const kind = members.length > 2 ? "group" : "direct";
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(messageThreads)
        .where(and(isNull(messageThreads.archivedAt), eq(messageThreads.kind, kind), sql`(select array_agg(x order by x) from unnest(${messageThreads.participantIds}) x) = array[${sql.join(members.map((m) => sql`${m}::uuid`), sql`, `)}]::uuid[]`))
        .limit(1);
      if (existing[0]) return existing[0];
      return one(await tx.insert(messageThreads).values({ participantIds: members, kind, subject: v.subject ?? null }).returning(), "thread");
    });
  },

  /**
   * The thread a person's own Send opens to some recipients (up to MAX_MESSAGE_RECIPIENTS). Every recipient must exist
   * and be a connection (an accepted request), and nobody may have blocked the other; the last two read the same to the
   * sender, so a block is never announced. A stranger's id is not an address. A group (two or more recipients) also
   * needs every two of its people connected with each other (0027): an introducer cannot put a founder in a room with
   * strangers who could then write to them.
   */
  async startThread(db: Executor, userId: string, recipientIds: readonly string[], subject?: string | null): Promise<MessageThread> {
    const v = parseInput(z.object({ recipientIds: z.array(Id).min(1).max(MAX_MESSAGE_RECIPIENTS) }), { recipientIds }, "recipients");
    const others = [...new Set(v.recipientIds)].filter((id) => id !== userId);
    if (!others.length) throw new ValidationError("Choose someone other than yourself to write to");
    return db.transaction(async (tx) => {
      const known = await socialRepo.existingUsers(tx, others);
      if (others.some((id) => !known.has(id))) throw new NotFoundError("recipient");
      const blocked = await socialRepo.blockedWith(tx, userId, others);
      const contacts = await socialRepo.connectedWith(tx, userId, others);
      if (others.some((id) => blocked.has(id) || !contacts.has(id))) throw new ForbiddenError(CANNOT_MESSAGE);
      if (others.length > 1 && !(await socialRepo.allConnected(tx, others))) throw new ForbiddenError(GROUP_NEEDS_CONNECTIONS);
      return socialRepo.findOrCreateThread(tx, userId, others, subject);
    });
  },

  /**
   * Leaves a thread: the person is taken out of its participants (they stop reading it and getting its messages) and
   * listed as having left. The last person to leave deletes it, since nobody can read it any more.
   */
  async leaveThread(db: Executor, userId: string, threadId: string): Promise<{ left: true; deleted: boolean }> {
    return db.transaction(async (tx) => {
      // The row is locked: two people leaving a pair at once must not both remove themselves (an empty thread breaks the
      // participants check); the second one waits, then finds itself the last and deletes it.
      const thread = one(await tx.select().from(messageThreads).where(eq(messageThreads.id, threadId)).for("update").limit(1), "thread", threadId);
      if (!thread.participantIds.includes(userId)) throw new ValidationError("Not a participant of this thread", { threadId });
      if (thread.participantIds.length <= 1) {
        await tx.delete(messageThreads).where(eq(messageThreads.id, threadId));
        return { left: true, deleted: true };
      }
      await tx
        .update(messageThreads)
        .set({
          participantIds: sql`array_remove(${messageThreads.participantIds}, ${userId}::uuid)`,
          mutedIds: sql`array_remove(${messageThreads.mutedIds}, ${userId}::uuid)`,
          leftIds: sql`array_append(array_remove(${messageThreads.leftIds}, ${userId}::uuid), ${userId}::uuid)`,
        })
        .where(eq(messageThreads.id, threadId));
      return { left: true, deleted: false };
    });
  },

  /** Mutes (or unmutes) a thread for one participant: it stops counting toward their unread badge and reaching their Inbox. */
  async setThreadMuted(db: Executor, userId: string, threadId: string, muted: boolean): Promise<{ muted: boolean }> {
    await socialRepo.getThread(db, userId, threadId);
    await db
      .update(messageThreads)
      .set({ mutedIds: muted ? sql`array_append(array_remove(${messageThreads.mutedIds}, ${userId}::uuid), ${userId}::uuid)` : sql`array_remove(${messageThreads.mutedIds}, ${userId}::uuid)` })
      .where(eq(messageThreads.id, threadId));
    return { muted };
  },

  /**
   * Whether `userId` may write into this thread now, and why not: the others must all still be there, connected with
   * them and not blocked either way (a removed connection closes a direct thread to new messages; a block closes it for
   * both). `closed` reads the same for a block and for no connection, so a block is never announced.
   */
  async sendState(db: Executor, userId: string, thread: Pick<MessageThread, "id" | "participantIds" | "archivedAt">): Promise<{ canSend: boolean; reason: "archived" | "alone" | "closed" | null }> {
    if (thread.archivedAt) return { canSend: false, reason: "archived" };
    const others = thread.participantIds.filter((id) => id !== userId);
    if (!others.length) return { canSend: false, reason: "alone" };
    const [blocked, contacts] = await Promise.all([socialRepo.blockedWith(db, userId, others), socialRepo.connectedWith(db, userId, others)]);
    if (others.some((id) => blocked.has(id) || !contacts.has(id))) return { canSend: false, reason: "closed" };
    return { canSend: true, reason: null };
  },

  async listThreads(db: Executor, userId: string, page: PageInput = {}): Promise<Page<MessageThread>> {
    const p = parseInput(PageInput, page, "page");
    const ks = timeKeyset<MessageThread>(messageThreads.createdAt, messageThreads.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(messageThreads)
      .where(and(isNull(messageThreads.archivedAt), sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, ks.after(p.cursor)))
      .orderBy(sql`${messageThreads.lastMessageAt} desc nulls last`, ...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async getThread(db: Executor, userId: string, threadId: string): Promise<MessageThread> {
    const t = one(await db.select().from(messageThreads).where(eq(messageThreads.id, threadId)).limit(1), "thread", threadId);
    if (!t.participantIds.includes(userId)) throw new ValidationError("Not a participant of this thread", { threadId });
    return t;
  },

  /**
   * One message into a thread the sender is in. The sender must still be connected with everyone else in it and nobody
   * may have blocked anybody (0027: the rule is checked on every Send, not only when the thread starts, so removing a
   * connection closes your direct thread to new messages and a group member you are not connected with cannot write to
   * you). `onSent` runs in the same transaction (delivery to the recipients).
   */
  async sendMessage(db: Executor, userId: string, threadId: string, body: string, options: { onSent?: (tx: Executor, message: Message, thread: MessageThread) => Promise<void> } = {}): Promise<Message> {
    const b = parseInput(z.string().trim().min(1).max(20_000), body, "message body");
    return db.transaction(async (tx) => {
      const thread = await socialRepo.getThread(tx, userId, threadId);
      const state = await socialRepo.sendState(tx, userId, thread);
      if (state.reason === "archived") throw new ValidationError("This conversation is closed", { threadId });
      if (state.reason === "alone") throw new ValidationError("Everyone else has left this conversation", { threadId });
      if (!state.canSend) throw new ForbiddenError(CANNOT_MESSAGE);
      const msg = one(await tx.insert(messages).values({ threadId, fromUser: userId, body: b, readBy: [userId] }).returning(), "message");
      await tx.update(messageThreads).set({ lastMessageAt: msg.createdAt }).where(eq(messageThreads.id, threadId));
      await options.onSent?.(tx, msg, thread);
      return msg;
    });
  },

  async listMessages(db: Executor, userId: string, threadId: string, page: PageInput = {}): Promise<Page<Message>> {
    await socialRepo.getThread(db, userId, threadId);
    const p = parseInput(PageInput, page, "page");
    const ks = timeKeyset<Message>(messages.createdAt, messages.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, threadId), ks.after(p.cursor)))
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async markThreadRead(db: Executor, userId: string, threadId: string): Promise<number> {
    await socialRepo.getThread(db, userId, threadId);
    const rows = await db
      .update(messages)
      .set({ readBy: sql`array_append(${messages.readBy}, ${userId}::uuid)` })
      .where(and(eq(messages.threadId, threadId), sql`not (${messages.readBy} @> array[${userId}::uuid])`))
      .returning({ id: messages.id });
    return rows.length;
  },

  /** Unread messages across the person's threads, for their badge: threads they muted do not count. */
  async unreadCount(db: Executor, userId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .where(and(sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, sql`not (${messageThreads.mutedIds} @> array[${userId}::uuid])`, sql`not (${messages.readBy} @> array[${userId}::uuid])`));
    return Number(rows[0]?.n ?? 0);
  },

  /** Connection requests waiting for this person's answer. */
  async incomingRequestCount(db: Executor, userId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(connections).where(and(eq(connections.toUser, userId), eq(connections.status, "requested")));
    return Number(rows[0]?.n ?? 0);
  },

  /** Unread messages per thread for one user (thread id → count; threads with none are absent). */
  async unreadByThread(db: Executor, userId: string): Promise<Map<string, number>> {
    const rows = await db
      .select({ threadId: messages.threadId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .where(and(sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, sql`not (${messages.readBy} @> array[${userId}::uuid])`))
      .groupBy(messages.threadId);
    return new Map(rows.map((r) => [r.threadId, Number(r.n)]));
  },

  /**
   * Names for the people and businesses a page is about to show. A user's display name follows their profile
   * visibility (BUILD §11.14): yourself and Public always; Connections to accepted connections; Community also to
   * people who share a community with you; Private to nobody. Whoever has written to you (a pending request, a message
   * in a thread you are in) is named as well, since they chose to make contact. Businesses come from `public_profiles`
   * (LIVE and committed) plus every business the viewer belongs to, in any game mode.
   */
  async lookupPeople(db: Executor, viewerId: string, input: { userIds?: readonly string[]; businessIds?: readonly string[] }): Promise<{ users: PersonCard[]; businesses: BusinessCard[] }> {
    const v = parseInput(z.object({ userIds: z.array(Id).max(200).default([]), businessIds: z.array(Id).max(500).default([]) }), input, "lookup");
    const userIds = [...new Set(v.userIds)];
    const businessIds = [...new Set(v.businessIds)];

    let users: PersonCard[] = [];
    if (userIds.length) {
      const profiles = await db
        .select({ userId: founderProfiles.userId, displayName: founderProfiles.displayName, visibility: founderProfiles.visibility })
        .from(founderProfiles)
        .where(and(inArray(founderProfiles.userId, userIds), isNull(founderProfiles.archivedAt)));
      const others = userIds.filter((id) => id !== viewerId);
      const accepted = new Set<string>();
      const contacted = new Set<string>();
      const coMembers = new Set<string>();
      if (others.length) {
        const links = await db
          .select({ fromUser: connections.fromUser, toUser: connections.toUser, status: connections.status })
          .from(connections)
          .where(or(and(eq(connections.fromUser, viewerId), inArray(connections.toUser, others)), and(eq(connections.toUser, viewerId), inArray(connections.fromUser, others))));
        for (const l of links) {
          const other = l.fromUser === viewerId ? l.toUser : l.fromUser;
          if (l.status === "accepted") accepted.add(other);
          else if (l.status === "requested" && l.toUser === viewerId) contacted.add(other);
        }
        const writers = await db
          .selectDistinct({ userId: messages.fromUser })
          .from(messages)
          .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
          .where(and(sql`${messageThreads.participantIds} @> array[${viewerId}::uuid]`, inArray(messages.fromUser, others)));
        for (const w of writers) contacted.add(w.userId);
        const mine = db.select({ communityId: communityMembers.communityId }).from(communityMembers).where(and(eq(communityMembers.userId, viewerId), eq(communityMembers.status, "active")));
        const shared = await db
          .selectDistinct({ userId: communityMembers.userId })
          .from(communityMembers)
          .where(and(inArray(communityMembers.userId, others), eq(communityMembers.status, "active"), inArray(communityMembers.communityId, mine)));
        for (const s of shared) coMembers.add(s.userId);
      }
      const byId = new Map(profiles.map((p) => [p.userId, p]));
      users = userIds.map((userId) => {
        const p = byId.get(userId);
        if (!p) return { userId, displayName: null };
        const visible =
          userId === viewerId ||
          p.visibility === "public" ||
          contacted.has(userId) ||
          (p.visibility === "connections" && accepted.has(userId)) ||
          (p.visibility === "community" && (accepted.has(userId) || coMembers.has(userId)));
        return { userId, displayName: visible ? p.displayName : null };
      });
    }

    const cards = new Map<string, BusinessCard>();
    if (businessIds.length) {
      const pub = await db
        .select({ businessId: publicProfiles.businessId, name: publicProfiles.displayName, slug: publicProfiles.slug, kitPrimary: publicProfiles.kitPrimary, kitSecondary: publicProfiles.kitSecondary, archetype: publicProfiles.archetype })
        .from(publicProfiles)
        .where(and(eq(publicProfiles.kind, "business"), inArray(publicProfiles.businessId, businessIds)));
      for (const b of pub) cards.set(b.businessId, { ...b, live: true });
      const own = await db
        .select({ businessId: businesses.id, name: businesses.name, slug: businesses.slug, kitPrimary: businesses.kitPrimary, kitSecondary: businesses.kitSecondary, archetype: businesses.archetype, gameMode: businesses.gameMode })
        .from(businesses)
        .innerJoin(memberships, eq(memberships.businessId, businesses.id))
        .where(and(eq(memberships.userId, viewerId), inArray(businesses.id, businessIds), isNull(businesses.archivedAt)));
      for (const b of own) cards.set(b.businessId, { businessId: b.businessId, name: b.name, slug: b.slug, kitPrimary: b.kitPrimary, kitSecondary: b.kitSecondary, archetype: b.archetype, live: b.gameMode === "live" });
    }
    return { users, businesses: [...cards.values()] };
  },

  // delivery (who a request or a message reaches) --------------------------------------------------------------------
  /**
   * The listed businesses (LIVE, committed, not archived) each of these people speaks for on the network: the ones
   * where they are owner or admin, as the `public_profiles` founder rows are. A request or a message to the person is
   * delivered to the Inbox of each (at most MAX_NETWORK_BUSINESSES, oldest first). People with none get no Inbox note;
   * their Network badge still counts it.
   */
  async listedBusinessesFor(db: Executor, userIds: readonly string[]): Promise<Map<string, string[]>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    const rows = await db
      .select({ userId: memberships.userId, businessId: businesses.id })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(inArray(memberships.userId, ids), inArray(memberships.role, ["owner", "admin"]), publicBusiness))
      .orderBy(asc(businesses.createdAt), asc(businesses.id));
    for (const r of rows) {
      const list = out.get(r.userId) ?? [];
      if (list.length < MAX_NETWORK_BUSINESSES) list.push(r.businessId);
      out.set(r.userId, list);
    }
    return out;
  },

  /** The owner of a listed business: the person "Ask to connect" on a leaderboard row reaches. Null when it is not listed. */
  async listedBusinessOwner(db: Executor, businessId: string): Promise<string | null> {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, "owner"), publicBusiness))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    return rows[0]?.userId ?? null;
  },

  /**
   * True when this business's Inbox already has an unread note for a message in this thread: a burst of messages makes
   * one note, not one each (the Network page has every message).
   */
  async hasUnreadThreadNote(db: Executor, businessId: string, threadId: string): Promise<boolean> {
    const rows = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .innerJoin(events, and(eq(events.businessId, inboxItems.businessId), sql`${events.id} = any(${inboxItems.sourceEventIds})`))
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.type, "human_message"), eq(inboxItems.state, "unread"), eq(events.type, "message.received"), sql`${events.payload}->>'threadId' = ${threadId}`))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * True when this business's Inbox already has an unread note for a connection request from this person: asking,
   * withdrawing and asking again makes one note, not one each (Network lists the request itself).
   */
  async hasUnreadRequestNote(db: Executor, businessId: string, fromUserId: string): Promise<boolean> {
    const rows = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .innerJoin(events, and(eq(events.businessId, inboxItems.businessId), sql`${events.id} = any(${inboxItems.sourceEventIds})`))
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.type, "human_message"), eq(inboxItems.state, "unread"), eq(events.type, "connection.requested"), sql`${events.payload}->>'fromUserId' = ${fromUserId}`))
      .limit(1);
    return rows.length > 0;
  },

  // communities -------------------------------------------------------------------------------------------------------
  /**
   * With `viewerId`, only what that user may see: public communities, the ones they belong to (active or muted) and the
   * ones they are invited to (communities_select).
   */
  async listCommunities(db: Executor, options: { visibility?: (typeof VISIBILITY)[number]; limit?: number; viewerId?: string } = {}): Promise<Community[]> {
    return db
      .select()
      .from(communities)
      .where(
        and(
          isNull(communities.archivedAt),
          options.visibility ? eq(communities.visibility, options.visibility) : undefined,
          options.viewerId
            ? or(
                eq(communities.visibility, "public"),
                sql`exists (select 1 from ${communityMembers} cm where cm.community_id = ${communities.id} and cm.user_id = ${options.viewerId}::uuid and cm.status in ('active','muted','invited'))`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(communities.memberCount), asc(communities.name))
      .limit(options.limit ?? 100);
  },

  async getCommunity(db: Executor, communityId: string): Promise<Community> {
    return one(await db.select().from(communities).where(eq(communities.id, communityId)).limit(1), "community", communityId);
  },

  async getCommunityBySlug(db: Executor, slug: string): Promise<Community | null> {
    const rows = await db.select().from(communities).where(eq(communities.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  /** Creates the community and makes the creator its owner member. */
  async createCommunity(db: Executor, input: CreateCommunityInput): Promise<Community> {
    const v = parseInput(CreateCommunityInput, input, "community");
    return db.transaction(async (tx) => {
      const community = one(
        await tx
          .insert(communities)
          .values({ name: v.name, slug: v.slug, descriptionMd: v.descriptionMd, visibility: v.visibility, kind: v.kind, ownerBusinessId: v.ownerBusinessId ?? null, createdBy: v.createdBy ?? null, memberCount: v.createdBy ? 1 : 0 })
          .returning(),
        "community",
      );
      if (v.createdBy) await tx.insert(communityMembers).values({ communityId: community.id, userId: v.createdBy, businessId: v.ownerBusinessId ?? null, role: "owner" });
      return community;
    });
  },

  /** The owner changes what the community says about itself: its name, description, kind or visibility. */
  async updateCommunity(db: Executor, userId: string, communityId: string, patch: { name?: string; descriptionMd?: string; visibility?: (typeof VISIBILITY)[number]; kind?: (typeof COMMUNITY_KINDS)[number] }): Promise<Community> {
    const p = parseInput(z.object({ name: z.string().trim().min(1).max(120).optional(), descriptionMd: z.string().max(4000).optional(), visibility: z.enum(VISIBILITY).optional(), kind: z.enum(COMMUNITY_KINDS).optional() }), patch, "community");
    const me = await socialRepo.membership(db, userId, communityId);
    if (me?.status !== "active" || me.role !== "owner") throw new ForbiddenError("Only the community's owner can change it");
    if (!Object.keys(p).length) return socialRepo.getCommunity(db, communityId);
    return one(await db.update(communities).set(p).where(eq(communities.id, communityId)).returning(), "community", communityId);
  },

  /**
   * Joins a community, or accepts an invitation to it. A ban is final until a moderator lifts it; someone who is
   * already a member (active or muted) gets their row back; someone muted who left comes back muted.
   */
  async joinCommunity(db: Executor, userId: string, communityId: string, options: { businessId?: string | null; role?: (typeof COMMUNITY_ROLES)[number] } = {}): Promise<CommunityMember> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
      const current = existing[0];
      if (current) {
        if (current.status === "banned") throw new ValidationError("Banned from this community", { communityId });
        if (current.status === "active" || current.status === "muted") return current;
        const rejoined = one(
          await tx
            .update(communityMembers)
            .set({ status: current.mutedAt ? "muted" : "active", joinedAt: new Date(), ...(options.businessId !== undefined ? { businessId: options.businessId } : {}) })
            .where(eq(communityMembers.id, current.id))
            .returning(),
          "community member",
        );
        await tx.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, communityId));
        return rejoined;
      }
      const member = one(await tx.insert(communityMembers).values({ communityId, userId, businessId: options.businessId ?? null, role: options.role ?? "member" }).returning(), "community member");
      await tx.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, communityId));
      return member;
    });
  },

  /**
   * Leaves a community (a mute stays on record: see joinCommunity). The owner of a community joined by invitation stays:
   * once out, nobody could let them back in as its owner.
   */
  async leaveCommunity(db: Executor, userId: string, communityId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [community, me] = await Promise.all([socialRepo.getCommunity(tx, communityId), socialRepo.membership(tx, userId, communityId)]);
      if (me?.role === "owner" && community.visibility !== "public" && (READING as readonly string[]).includes(me.status)) throw new ValidationError(OWNER_STAYS, { communityId });
      const rows = await tx
        .update(communityMembers)
        .set({ status: "left" })
        .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), inArray(communityMembers.status, [...READING])))
        .returning({ id: communityMembers.id });
      if (rows.length) await tx.update(communities).set({ memberCount: sql`greatest(${communities.memberCount} - 1, 0)` }).where(eq(communities.id, communityId));
    });
  },

  /** The caller's membership row in a community, whatever its status (null when they have none). */
  async membership(db: Executor, userId: string, communityId: string): Promise<CommunityMember | null> {
    const rows = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Members, longest-standing first, up to `limit` (a community can be large; its `member_count` has the total). Active
   * ones by default; moderators also ask for muted and banned members to restore them.
   */
  async listMembers(db: Executor, communityId: string, limit = 200, statuses: readonly CommunityMember["status"][] = READING): Promise<CommunityMember[]> {
    return db
      .select()
      .from(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), inArray(communityMembers.status, [...statuses])))
      .orderBy(asc(communityMembers.joinedAt))
      .limit(limit);
  },

  /** True for a member who reads the community (active or muted). Posting needs `active` (see `membership`). */
  async isMember(db: Executor, userId: string, communityId: string): Promise<boolean> {
    const rows = await db
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), inArray(communityMembers.status, [...READING])))
      .limit(1);
    return rows.length > 0;
  },

  /** The viewer's role in each of these communities they are a member of (active or muted; others are absent). */
  async memberRoles(db: Executor, userId: string, communityIds: readonly string[]): Promise<Map<string, (typeof COMMUNITY_ROLES)[number]>> {
    if (!communityIds.length) return new Map();
    const rows = await db
      .select({ communityId: communityMembers.communityId, role: communityMembers.role })
      .from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), inArray(communityMembers.status, [...READING]), inArray(communityMembers.communityId, [...communityIds])));
    return new Map(rows.map((r) => [r.communityId, r.role]));
  },

  /** The caller as a moderator of the community: an active owner or moderator, or a Forbidden error. */
  async requireModerator(db: Executor, userId: string, communityId: string): Promise<CommunityMember> {
    const me = await socialRepo.membership(db, userId, communityId);
    if (me?.status !== "active" || (me.role !== "owner" && me.role !== "moderator")) throw new ForbiddenError("Only the community's owner and moderators can do this");
    return me;
  },

  // invitations -------------------------------------------------------------------------------------------------------
  /**
   * An owner or moderator invites one of their connections (an accepted connection, not blocked either way: an invite is
   * contact, so a stranger's id is no more an address here than in Messages). The invitation is an `invited` row the
   * person accepts by joining or declines; a member already in it is left as they are, and a ban is not undone.
   */
  async inviteToCommunity(db: Executor, inviterId: string, communityId: string, inviteeId: string): Promise<CommunityMember> {
    if (inviterId === inviteeId) throw new ValidationError("You are already in this community");
    return db.transaction(async (tx) => {
      await socialRepo.requireModerator(tx, inviterId, communityId);
      const [blocked, contacts] = await Promise.all([socialRepo.blockedWith(tx, inviterId, [inviteeId]), socialRepo.connectedWith(tx, inviterId, [inviteeId])]);
      if (blocked.has(inviteeId) || !contacts.has(inviteeId)) throw new ForbiddenError("You can invite your connections");
      const current = await socialRepo.membership(tx, inviteeId, communityId);
      if (current?.status === "banned") throw new ValidationError("This person is banned from the community; lift the ban first", { communityId });
      if (current && current.status !== "left") return current;
      if (current) return one(await tx.update(communityMembers).set({ status: "invited", invitedBy: inviterId, role: "member" }).where(eq(communityMembers.id, current.id)).returning(), "community member");
      return one(await tx.insert(communityMembers).values({ communityId, userId: inviteeId, role: "member", status: "invited", invitedBy: inviterId }).returning(), "community member");
    });
  },

  /** Declines an invitation: the row goes, as if it had never been sent. */
  async declineInvitation(db: Executor, userId: string, communityId: string): Promise<boolean> {
    const rows = await db
      .delete(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), eq(communityMembers.status, "invited")))
      .returning({ id: communityMembers.id });
    return rows.length > 0;
  },

  /** The invitations waiting for this person's answer, newest first, with their community (archived ones are left out). */
  async listInvitations(db: Executor, userId: string): Promise<{ community: Community; invitedBy: string | null; invitedAt: Date }[]> {
    const rows = await db
      .select({ community: communities, invitedBy: communityMembers.invitedBy, invitedAt: communityMembers.updatedAt })
      .from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "invited"), isNull(communities.archivedAt)))
      .orderBy(desc(communityMembers.updatedAt));
    return rows;
  },

  // member moderation -------------------------------------------------------------------------------------------------
  /**
   * An owner or moderator mutes (reads, cannot post), bans (out, cannot come back) or restores a member. Nobody acts on
   * the owner, and only the owner acts on a moderator.
   */
  async moderateMember(db: Executor, actorId: string, communityId: string, targetId: string, action: MemberModerationAction): Promise<CommunityMember> {
    const a = parseInput(z.enum(MEMBER_MODERATION_ACTIONS), action, "member action");
    if (actorId === targetId) throw new ValidationError("You cannot moderate yourself");
    return db.transaction(async (tx) => {
      const me = await socialRepo.requireModerator(tx, actorId, communityId);
      const target = await socialRepo.membership(tx, targetId, communityId);
      if (!target || target.status === "invited") throw new NotFoundError("community member", targetId);
      if (target.role === "owner") throw new ForbiddenError("Nobody can moderate the community's owner");
      if (target.role === "moderator" && me.role !== "owner") throw new ForbiddenError("Only the owner can moderate a moderator");
      const counted = (status: string) => (READING as readonly string[]).includes(status);
      let next: Partial<CommunityMember>;
      if (a === "mute") next = { status: target.status === "active" || target.status === "muted" ? "muted" : target.status, mutedAt: new Date() };
      else if (a === "ban") next = { status: "banned", role: "member" };
      else next = target.status === "banned" ? { status: "left", mutedAt: null } : { status: target.status === "muted" ? "active" : target.status, mutedAt: null };
      const updated = one(await tx.update(communityMembers).set(next).where(eq(communityMembers.id, target.id)).returning(), "community member");
      const delta = Number(counted(updated.status)) - Number(counted(target.status));
      if (delta) await tx.update(communities).set({ memberCount: sql`greatest(${communities.memberCount} + ${delta}, 0)` }).where(eq(communities.id, communityId));
      return updated;
    });
  },

  /** The owner makes an active member a moderator, or a moderator a member again. */
  async setMemberRole(db: Executor, ownerId: string, communityId: string, targetId: string, role: "moderator" | "member"): Promise<CommunityMember> {
    const r = parseInput(z.enum(["moderator", "member"]), role, "community role");
    return db.transaction(async (tx) => {
      const me = await socialRepo.membership(tx, ownerId, communityId);
      if (me?.status !== "active" || me.role !== "owner") throw new ForbiddenError("Only the community's owner can change roles");
      const target = await socialRepo.membership(tx, targetId, communityId);
      if (!target || target.status !== "active") throw new NotFoundError("community member", targetId);
      if (target.role === "owner") throw new ValidationError("The owner's role does not change");
      return one(await tx.update(communityMembers).set({ role: r }).where(eq(communityMembers.id, target.id)).returning(), "community member");
    });
  },

  // posts -------------------------------------------------------------------------------------------------------------
  /** Visible replies under each of these posts (posts without replies are absent). */
  async replyCounts(db: Executor, postIds: readonly string[]): Promise<Map<string, number>> {
    if (!postIds.length) return new Map();
    const rows = await db
      .select({ parentPostId: posts.parentPostId, n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(inArray(posts.parentPostId, [...postIds]), isNull(posts.archivedAt), eq(posts.status, "visible")))
      .groupBy(posts.parentPostId);
    return new Map(rows.flatMap((r) => (r.parentPostId ? [[r.parentPostId, Number(r.n)] as const] : [])));
  },

  /**
   * The feed: visible posts, plus (with `viewerId`) the viewer's own posts that are waiting for review, so an author
   * sees that their post was held rather than lost. Hidden and removed posts are for the moderators' queue only.
   */
  async listPosts(db: Executor, communityId: string, options: { parentPostId?: string | null; viewerId?: string } & PageInput = {}): Promise<Page<Post>> {
    const p = parseInput(PageInput, options, "page");
    const ks = timeKeyset<Post>(posts.createdAt, posts.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.communityId, communityId),
          isNull(posts.archivedAt),
          options.viewerId ? or(eq(posts.status, "visible"), and(eq(posts.status, "pending_review"), eq(posts.authorUserId, options.viewerId))) : eq(posts.status, "visible"),
          options.parentPostId === undefined ? isNull(posts.parentPostId) : options.parentPostId === null ? isNull(posts.parentPostId) : eq(posts.parentPostId, options.parentPostId),
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async getPost(db: Executor, postId: string): Promise<Post> {
    return one(await db.select().from(posts).where(eq(posts.id, postId)).limit(1), "post", postId);
  },

  /**
   * A new post by an active member (a muted one reads but does not post). The screen's verdict decides where it starts:
   * visible, or `pending_review` until a moderator approves it.
   */
  async createPost(db: Executor, input: CreatePostInput): Promise<Post> {
    const v = parseInput(CreatePostInput, input, "post");
    const me = await socialRepo.membership(db, v.authorUserId, v.communityId);
    if (me?.status === "muted") throw new ValidationError("A moderator muted you in this community; you can read it but not post", { communityId: v.communityId });
    if (me?.status !== "active") throw new ValidationError("Only members can post", { communityId: v.communityId });
    if (v.parentPostId) {
      // A reply goes under a visible top-level post of the same community; anything else reads as a missing post.
      const parent = (await db.select().from(posts).where(eq(posts.id, v.parentPostId)).limit(1))[0];
      if (!parent || parent.communityId !== v.communityId || parent.status !== "visible" || parent.archivedAt) throw new NotFoundError("post", v.parentPostId);
      if (parent.parentPostId) throw new ValidationError("Replies go under a post, not under another reply", { parentPostId: v.parentPostId });
    }
    const screening: PostScreening | Record<string, never> = v.screening ?? {};
    return one(
      await db
        .insert(posts)
        .values({ communityId: v.communityId, authorUserId: v.authorUserId, businessId: v.businessId ?? null, parentPostId: v.parentPostId ?? null, bodyMd: v.bodyMd, entityIds: v.entityIds, status: v.screening?.decision === "hold" ? "pending_review" : "visible", screening })
        .returning(),
      "post",
    );
  },

  /**
   * The author edits their own post. The new text is screened again (`screening`): a held edit goes back to review. A
   * post that members' reports hold stays held whatever the screen says (a moderator decides on the new text; an edit
   * is not a way out of a report). A post a moderator hid or removed stays as the moderator left it, and so does one its
   * author deleted.
   */
  async editPost(db: Executor, userId: string, postId: string, bodyMd: string, screening: z.input<typeof PostScreeningInput>): Promise<Post> {
    const body = parseInput(z.string().trim().min(1).max(20_000), bodyMd, "post body");
    const s = parseInput(PostScreeningInput, screening, "screening");
    return db.transaction(async (tx) => {
      const post = await socialRepo.getPost(tx, postId);
      if (post.authorUserId !== userId) throw new ForbiddenError("Only the author can edit a post");
      if (post.status === "hidden" || post.status === "removed" || post.archivedAt) throw new ValidationError("This post can no longer be edited", { postId });
      const me = await socialRepo.membership(tx, userId, post.communityId);
      if (me?.status !== "active") throw new ValidationError("Only members who can post can edit their posts", { postId });
      const heldByReports = post.status === "pending_review" && (await socialRepo.openReportCount(tx, postId)) >= REPORTS_TO_HOLD;
      return one(
        await tx
          .update(posts)
          .set({ bodyMd: body, editedAt: new Date(), screening: s, status: s.decision === "hold" || heldByReports ? "pending_review" : "visible" })
          .where(and(eq(posts.id, postId), eq(posts.status, post.status)))
          .returning(),
        "post",
        postId,
      );
    });
  },

  /** The author deletes their own post (whatever its status; a moderator's removal is final anyway). */
  async deleteOwnPost(db: Executor, userId: string, postId: string): Promise<Post> {
    const post = await socialRepo.getPost(db, postId);
    if (post.authorUserId !== userId) throw new ForbiddenError("Only the author can delete a post");
    if (post.status === "removed") return post;
    return db.transaction(async (tx) => {
      const updated = one(await tx.update(posts).set({ status: "removed", moderatedBy: userId, moderatedAt: new Date(), moderationNote: "Deleted by its author" }).where(eq(posts.id, postId)).returning(), "post", postId);
      await socialRepo.resolveReports(tx, postId, userId, "removed");
      return updated;
    });
  },

  /**
   * An owner or moderator acts on a post in their community: hide (out of the feed, restorable), remove (final) or
   * restore (approve a held or hidden post; on a visible one, dismiss its reports). A post its author deleted stays
   * deleted. Open reports on the post are resolved with the decision.
   */
  async moderatePost(db: Executor, actorId: string, postId: string, action: PostModerationAction, note?: string | null): Promise<Post> {
    const a = parseInput(z.enum(POST_MODERATION_ACTIONS), action, "post action");
    const n = parseInput(z.string().trim().max(500).nullable().optional(), note, "moderation note");
    return db.transaction(async (tx) => {
      const post = await socialRepo.getPost(tx, postId);
      await socialRepo.requireModerator(tx, actorId, post.communityId);
      if (post.status === "removed") throw new ValidationError("This post was removed; it cannot be changed", { postId });
      const status = a === "hide" ? "hidden" : a === "remove" ? "removed" : "visible";
      const updated = one(await tx.update(posts).set({ status, moderatedBy: actorId, moderatedAt: new Date(), moderationNote: n ?? null }).where(eq(posts.id, postId)).returning(), "post", postId);
      await socialRepo.resolveReports(tx, postId, actorId, a === "hide" ? "hidden" : a === "remove" ? "removed" : post.status === "visible" ? "dismissed" : "approved");
      return updated;
    });
  },

  /** Reports on a post that no moderator has resolved yet (one per member). */
  async openReportCount(db: Executor, postId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(postReports).where(and(eq(postReports.postId, postId), isNull(postReports.resolvedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  async resolveReports(db: Executor, postId: string, userId: string, resolution: (typeof POST_REPORT_RESOLUTIONS)[number]): Promise<number> {
    const rows = await db
      .update(postReports)
      .set({ resolvedAt: new Date(), resolvedBy: userId, resolution })
      .where(and(eq(postReports.postId, postId), isNull(postReports.resolvedAt)))
      .returning({ id: postReports.id });
    return rows.length;
  },

  /**
   * A member reports a visible post of their community (not their own) once. When REPORTS_TO_HOLD different members
   * have open reports on it, the post is held for review: out of the feed until a moderator decides.
   */
  async reportPost(db: Executor, reporterId: string, postId: string, input: { reason: (typeof POST_REPORT_REASONS)[number]; note?: string | null }): Promise<{ report: PostReport; held: boolean }> {
    const v = parseInput(z.object({ reason: z.enum(POST_REPORT_REASONS), note: z.string().trim().max(1000).nullable().optional() }), input, "report");
    return db.transaction(async (tx) => {
      const post = await socialRepo.getPost(tx, postId);
      if (!(await socialRepo.isMember(tx, reporterId, post.communityId)) || post.status !== "visible" || post.archivedAt) throw new NotFoundError("post", postId);
      if (post.authorUserId === reporterId) throw new ValidationError("You cannot report your own post; delete it instead", { postId });
      const inserted = await tx
        .insert(postReports)
        .values({ postId, communityId: post.communityId, reporterUserId: reporterId, reason: v.reason, note: v.note ?? null })
        .onConflictDoNothing({ target: [postReports.postId, postReports.reporterUserId] })
        .returning();
      const report = inserted[0] ?? one(await tx.select().from(postReports).where(and(eq(postReports.postId, postId), eq(postReports.reporterUserId, reporterId))).limit(1), "report");
      if ((await socialRepo.openReportCount(tx, postId)) < REPORTS_TO_HOLD) return { report, held: false };
      const held = await tx
        .update(posts)
        .set({ status: "pending_review", moderationNote: "Held after reports from members" })
        .where(and(eq(posts.id, postId), eq(posts.status, "visible")))
        .returning({ id: posts.id });
      return { report, held: held.length > 0 };
    });
  },

  /**
   * The moderators' queue for one community, oldest first: posts held by the screen or by reports, hidden posts, and
   * visible posts with open reports, each with its open report count and reasons.
   */
  async moderationQueue(db: Executor, communityId: string, limit = 100): Promise<ModerationQueueItem[]> {
    const reported = db.select({ postId: postReports.postId }).from(postReports).where(and(eq(postReports.communityId, communityId), isNull(postReports.resolvedAt)));
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.communityId, communityId), isNull(posts.archivedAt), or(inArray(posts.status, ["pending_review", "hidden"]), and(eq(posts.status, "visible"), inArray(posts.id, reported)))))
      .orderBy(asc(posts.createdAt), asc(posts.id))
      .limit(limit);
    if (!rows.length) return [];
    const reports = await db
      .select({ postId: postReports.postId, reason: postReports.reason })
      .from(postReports)
      .where(and(inArray(postReports.postId, rows.map((r) => r.id)), isNull(postReports.resolvedAt)));
    return rows.map((post) => {
      const mine = reports.filter((r) => r.postId === post.id);
      return { post, openReports: mine.length, reasons: [...new Set(mine.map((r) => r.reason))] };
    });
  },

  /** How many posts wait for this person across the communities they moderate (their Communities badge). */
  async moderationCount(db: Executor, userId: string): Promise<number> {
    const moderated = db
      .select({ communityId: communityMembers.communityId })
      .from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "active"), inArray(communityMembers.role, ["owner", "moderator"])));
    const reported = db.select({ postId: postReports.postId }).from(postReports).where(and(inArray(postReports.communityId, moderated), isNull(postReports.resolvedAt)));
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(inArray(posts.communityId, moderated), isNull(posts.archivedAt), or(eq(posts.status, "pending_review"), and(eq(posts.status, "visible"), inArray(posts.id, reported)))));
    return Number(rows[0]?.n ?? 0);
  },

  /** Invitations waiting for this person's answer (their Network badge). */
  async invitationCount(db: Executor, userId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "invited"), isNull(communities.archivedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  async setPostStatus(db: Executor, postId: string, status: (typeof posts.status.enumValues)[number]): Promise<Post> {
    return one(await db.update(posts).set({ status }).where(eq(posts.id, postId)).returning(), "post", postId);
  },

  // leaderboards (built nightly by the social service from verified metrics) ------------------------------------------
  async upsertLeaderboard(db: Executor, input: UpsertLeaderboardInput): Promise<Leaderboard> {
    const v = parseInput(UpsertLeaderboardInput, input, "leaderboard");
    const existing = await db
      .select()
      .from(leaderboards)
      .where(
        and(
          eq(leaderboards.boardKind, v.boardKind),
          eq(leaderboards.division, v.division),
          eq(leaderboards.period, v.period),
          v.archetype ? eq(leaderboards.archetype, v.archetype) : isNull(leaderboards.archetype),
          v.region ? eq(leaderboards.region, v.region) : isNull(leaderboards.region),
        ),
      )
      .limit(1);
    if (existing[0]) return one(await db.update(leaderboards).set({ metric: v.metric }).where(eq(leaderboards.id, existing[0].id)).returning(), "leaderboard");
    return one(await db.insert(leaderboards).values({ boardKind: v.boardKind, division: v.division, period: v.period, metric: v.metric, archetype: v.archetype ?? null, region: v.region ?? null }).returning(), "leaderboard");
  },

  async listLeaderboards(db: Executor, filter: { period?: string; boardKind?: string } = {}): Promise<Leaderboard[]> {
    return db
      .select()
      .from(leaderboards)
      .where(and(filter.period ? eq(leaderboards.period, filter.period) : undefined, filter.boardKind ? eq(leaderboards.boardKind, filter.boardKind) : undefined))
      .orderBy(desc(leaderboards.period), asc(leaderboards.boardKind), asc(leaderboards.division));
  },

  /**
   * Replaces a board's entries: ranks verified values of listed businesses (highest first), computes movement against
   * the previous positions and stamps computed_at. Unverified values never enter a board (the table's `check (verified)`
   * enforces BUILD §7.2 "verified only"), and neither do businesses that are not LIVE and committed; both are dropped
   * here so a caller can pass its whole metric set.
   */
  async setLeaderboardEntries(db: Executor, leaderboardId: string, entries: LeaderboardEntryInput[]): Promise<LeaderboardEntry[]> {
    const parsed = entries.map((e) => parseInput(LeaderboardEntryInput, e, "leaderboard entry"));
    return db.transaction(async (tx) => {
      await socialRepo.getLeaderboard(tx, leaderboardId);
      const previous = await tx.select({ businessId: leaderboardEntries.businessId, position: leaderboardEntries.position }).from(leaderboardEntries).where(eq(leaderboardEntries.leaderboardId, leaderboardId));
      const prevPos = new Map(previous.map((p) => [p.businessId, p.position]));
      // Only LIVE, committed, non-archived businesses take a position (the policy `is_public`): a Personal business's
      // numbers are never ranked, whoever passes them in.
      const ids = [...new Set(parsed.map((e) => e.businessId))];
      const listed = new Set(ids.length ? (await tx.select({ id: businesses.id }).from(businesses).where(and(inArray(businesses.id, ids), publicBusiness))).map((b) => b.id) : []);
      const ranked = parsed
        .filter((e) => e.verified && listed.has(e.businessId))
        .sort((a, b) => b.metricValue - a.metricValue || a.businessId.localeCompare(b.businessId))
        .map((e, i) => ({ ...e, position: i + 1 }));
      await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.leaderboardId, leaderboardId));
      const rows = ranked.length
        ? await tx
            .insert(leaderboardEntries)
            .values(
              ranked.map((e) => ({
                leaderboardId,
                businessId: e.businessId,
                position: e.position,
                movement: prevPos.has(e.businessId) ? (prevPos.get(e.businessId) as number) - e.position : 0,
                form: e.form,
                metricValue: numericText(e.metricValue) ?? "0",
                verified: e.verified,
              })),
            )
            .returning()
        : [];
      await tx.update(leaderboards).set({ computedAt: new Date() }).where(eq(leaderboards.id, leaderboardId));
      return rows.sort((a, b) => a.position - b.position);
    });
  },

  async getLeaderboard(db: Executor, leaderboardId: string): Promise<Leaderboard> {
    return one(await db.select().from(leaderboards).where(eq(leaderboards.id, leaderboardId)).limit(1), "leaderboard", leaderboardId);
  },

  /** A board's entries for businesses that are listed (LIVE, committed, not archived: the `leaderboard_entries_select` policy). */
  async leaderboardEntries(db: Executor, leaderboardId: string, limit = 100): Promise<LeaderboardEntry[]> {
    const rows = await db
      .select({ entry: leaderboardEntries })
      .from(leaderboardEntries)
      .innerJoin(businesses, eq(businesses.id, leaderboardEntries.businessId))
      .where(and(eq(leaderboardEntries.leaderboardId, leaderboardId), publicBusiness))
      .orderBy(asc(leaderboardEntries.position))
      .limit(limit);
    return rows.map((r) => r.entry);
  },

  /** A business's positions across boards (its profile's trophy cabinet strip). */
  async positionsForBusiness(db: Executor, businessId: string, period?: string): Promise<(LeaderboardEntry & { board: Leaderboard })[]> {
    const rows = await db
      .select({ entry: leaderboardEntries, board: leaderboards })
      .from(leaderboardEntries)
      .innerJoin(leaderboards, eq(leaderboards.id, leaderboardEntries.leaderboardId))
      .innerJoin(businesses, eq(businesses.id, leaderboardEntries.businessId))
      .where(and(eq(leaderboardEntries.businessId, businessId), publicBusiness, period ? eq(leaderboards.period, period) : undefined))
      .orderBy(desc(leaderboards.period), asc(leaderboards.boardKind));
    return rows.map((r) => ({ ...r.entry, board: r.board }));
  },

  /** LIVE → Personal: removes the business from every board (BUILD §7.3 "within 15 minutes"). */
  async removeBusinessFromLeaderboards(db: Executor, businessId: string): Promise<number> {
    const rows = await db.delete(leaderboardEntries).where(eq(leaderboardEntries.businessId, businessId)).returning({ id: leaderboardEntries.id });
    return rows.length;
  },

  // negotiations (business-scoped: businessId is party A) -------------------------------------------------------------
  async listNegotiations(db: Executor, businessId: string, filter: { status?: (typeof NEGOTIATION_STATUSES)[number] } = {}): Promise<NegotiationThread[]> {
    const f = parseInput(z.object({ status: z.enum(NEGOTIATION_STATUSES).optional() }), filter, "negotiation filter");
    return db
      .select()
      .from(negotiationThreads)
      .where(and(or(eq(negotiationThreads.businessA, businessId), eq(negotiationThreads.businessB, businessId)), f.status ? eq(negotiationThreads.status, f.status) : undefined))
      .orderBy(desc(negotiationThreads.createdAt));
  },

  async getNegotiation(db: Executor, businessId: string, threadId: string): Promise<NegotiationThread> {
    return one(
      await db.select().from(negotiationThreads).where(and(eq(negotiationThreads.id, threadId), or(eq(negotiationThreads.businessA, businessId), eq(negotiationThreads.businessB, businessId)))).limit(1),
      "negotiation thread",
      threadId,
    );
  },

  /** Opens a thread between this business (A) and another LIVE business (B). Final terms, signing and payment stay hard-gated. */
  async openNegotiation(db: Executor, businessId: string, input: CreateNegotiationInput): Promise<NegotiationThread> {
    const v = parseInput(CreateNegotiationInput, input, "negotiation");
    if (v.businessB === businessId) throw new ValidationError("A business cannot negotiate with itself", { businessId });
    const [a, b] = sortPair(businessId, v.businessB);
    const open = await db
      .select({ id: negotiationThreads.id })
      .from(negotiationThreads)
      .where(and(eq(negotiationThreads.status, "open"), eq(negotiationThreads.subject, v.subject), or(and(eq(negotiationThreads.businessA, a), eq(negotiationThreads.businessB, b)), and(eq(negotiationThreads.businessA, b), eq(negotiationThreads.businessB, a)))))
      .limit(1);
    if (open.length) throw new ValidationError("An open negotiation on this subject already exists", { threadId: open[0]!.id });
    return one(
      await db
        .insert(negotiationThreads)
        .values({ businessA: businessId, businessB: v.businessB, agentA: v.agentA ?? null, agentB: v.agentB ?? null, subject: v.subject, limitsSnapshot: v.limitsSnapshot, workflowId: v.workflowId ?? null })
        .returning(),
      "negotiation thread",
    );
  },

  async setNegotiationStatus(db: Executor, businessId: string, threadId: string, status: (typeof NEGOTIATION_STATUSES)[number], options: { transcriptRef?: string | null } = {}): Promise<NegotiationThread> {
    const s = parseInput(z.enum(NEGOTIATION_STATUSES), status, "negotiation status");
    await socialRepo.getNegotiation(db, businessId, threadId);
    const closed = s !== "open";
    return one(
      await db
        .update(negotiationThreads)
        .set({ status: s, ...(closed ? { closedAt: new Date() } : {}), ...(options.transcriptRef !== undefined ? { transcriptRef: options.transcriptRef } : {}) })
        .where(eq(negotiationThreads.id, threadId))
        .returning(),
      "negotiation thread",
      threadId,
    );
  },

  async openNegotiationsCount(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(negotiationThreads)
      .where(and(eq(negotiationThreads.status, "open"), or(eq(negotiationThreads.businessA, businessId), eq(negotiationThreads.businessB, businessId))));
    return Number(rows[0]?.n ?? 0);
  },
};
