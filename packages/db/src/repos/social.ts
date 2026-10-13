/**
 * LIVE social layer — public_profiles, connections, message threads/messages, communities, posts,
 * leaderboards, negotiation_threads (BUILD §7.2 "LIVE social", §7.3, §11.14; routers live.*).
 *
 * Most of this is user-scoped, not business-scoped (connections and messages are between people), so the
 * account-scoped functions take `userId` first (ARCHITECTURE §4 exception). Leaderboards and negotiations are
 * business-facing. Personal businesses never appear in `publicProfiles`/`searchPublic`: the `public_profiles`
 * view only selects LIVE businesses (0012), so the visibility rule is enforced in SQL, not here.
 */
import { RESERVED_NAME_MESSAGE, isReservedName } from "@foundmill/config";
import { AppError, ARCHETYPES, DATA_REGIONS, ForbiddenError, NotFoundError, ValidationError, VISIBILITY } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import {
  businesses, communities, communityMembers, CONNECTION_STATUSES, connections, founderProfiles, leaderboardEntries, leaderboards, memberships, messages, messageThreads,
  NEGOTIATION_STATUSES, negotiationThreads, posts, publicProfiles,
  type COMMUNITY_ROLES, type Community, type CommunityMember, type Connection, type Leaderboard, type LeaderboardEntry, type Message, type MessageThread, type NegotiationThread, type Post, type PublicProfile,
} from "../schema";
import { Id, JsonObject, numericText, one, PageInput, parseInput, rowsOf, sqlState, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const CreateCommunityInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
  descriptionMd: z.string().default(""),
  visibility: z.enum(VISIBILITY).default("public"),
  ownerBusinessId: Id.nullable().optional(),
  createdBy: Id.nullable().optional(),
});
export type CreateCommunityInput = z.input<typeof CreateCommunityInput>;

export const CreatePostInput = z.object({
  communityId: Id,
  authorUserId: Id,
  businessId: Id.nullable().optional(),
  parentPostId: Id.nullable().optional(),
  bodyMd: z.string().trim().min(1).max(20_000),
  entityIds: z.array(Id).default([]),
});
export type CreatePostInput = z.input<typeof CreatePostInput>;

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

/** What a sender is told when a Send cannot go: not connected and blocked read the same, so a block is never announced. */
const CANNOT_MESSAGE = "You cannot message this person";
/** A thread subject is the sender's own words: it may not pose as the platform or its staff (audit GLS2F-06). */
const ThreadSubject = z.string().trim().max(200).refine((s) => !isReservedName(s, "subject"), RESERVED_NAME_MESSAGE);

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

  // connections (user-scoped) -----------------------------------------------------------------------------------------
  /**
   * A new request. Whoever has blocked the other, the answer is no: the blocker is told to unblock first; the blocked
   * person only learns that the request could not be sent (a block is never announced). One row exists per pair of
   * people, whichever of them asked: asking someone who already asked you (or is connected to you) returns that row. Two
   * requests racing for the same pair meet the unique index (23505) and get the winner's answer.
   */
  async requestConnection(db: Executor, fromUser: string, toUser: string, message?: string | null): Promise<Connection> {
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
    try {
      return await db.transaction(async (tx) => (await answerFor(tx)) ?? one(await tx.insert(connections).values({ fromUser: v.fromUser, toUser: v.toUser, message: v.message ?? null }).returning(), "connection"));
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

  /** Withdraws a request, ends a connection, or lifts a block; a block can only be lifted by whoever set it. */
  async removeConnection(db: Executor, userId: string, connectionId: string): Promise<void> {
    const rows = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
    const current = rows[0];
    if (!current || (current.fromUser !== userId && current.toUser !== userId)) return;
    if (current.status === "blocked" && current.blockedBy !== userId) throw new ValidationError("This connection cannot be removed", { connectionId });
    await db
      .delete(connections)
      .where(and(eq(connections.id, connectionId), or(eq(connections.fromUser, userId), eq(connections.toUser, userId)), or(sql`${connections.status} <> 'blocked'`, eq(connections.blockedBy, userId))));
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

  /** The thread between exactly these participants (created if missing). Low level: no checks on who may write to whom. */
  async findOrCreateThread(db: Executor, userId: string, participantIds: readonly string[], subject?: string | null): Promise<MessageThread> {
    const v = parseInput(z.object({ participantIds: z.array(Id).min(1), subject: ThreadSubject.nullable().optional() }), { participantIds, subject }, "thread");
    const members = [...new Set([userId, ...v.participantIds])].sort();
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(messageThreads)
        .where(and(isNull(messageThreads.archivedAt), sql`(select array_agg(x order by x) from unnest(${messageThreads.participantIds}) x) = array[${sql.join(members.map((m) => sql`${m}::uuid`), sql`, `)}]::uuid[]`))
        .limit(1);
      if (existing[0]) return existing[0];
      return one(await tx.insert(messageThreads).values({ participantIds: members, subject: v.subject ?? null }).returning(), "thread");
    });
  },

  /**
   * The thread a person's own Send opens to some recipients (up to MAX_MESSAGE_RECIPIENTS). Every recipient must exist
   * and be a connection (an accepted request), and nobody may have blocked the other; the last two read the same to the
   * sender, so a block is never announced. A stranger's id is not an address, and neither is a fellow member's of a group.
   */
  async startThread(db: Executor, userId: string, recipientIds: readonly string[], subject?: string | null): Promise<MessageThread> {
    const v = parseInput(z.object({ recipientIds: z.array(Id).min(1).max(MAX_MESSAGE_RECIPIENTS) }), { recipientIds }, "recipients");
    const others = [...new Set(v.recipientIds)].filter((id) => id !== userId);
    if (!others.length) throw new ValidationError("Choose someone other than yourself to write to");
    if (subject && isReservedName(subject, "subject")) throw new ValidationError(RESERVED_NAME_MESSAGE);
    return db.transaction(async (tx) => {
      const known = await socialRepo.existingUsers(tx, others);
      if (others.some((id) => !known.has(id))) throw new NotFoundError("recipient");
      const blocked = await socialRepo.blockedWith(tx, userId, others);
      const linked = await tx
        .select({ fromUser: connections.fromUser, toUser: connections.toUser })
        .from(connections)
        .where(and(eq(connections.status, "accepted"), or(and(eq(connections.fromUser, userId), inArray(connections.toUser, others)), and(eq(connections.toUser, userId), inArray(connections.fromUser, others)))));
      const contacts = new Set(linked.map((r) => (r.fromUser === userId ? r.toUser : r.fromUser)));
      if (others.some((id) => blocked.has(id) || !contacts.has(id))) throw new ForbiddenError(CANNOT_MESSAGE);
      return socialRepo.findOrCreateThread(tx, userId, others, subject);
    });
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

  async sendMessage(db: Executor, userId: string, threadId: string, body: string): Promise<Message> {
    const b = parseInput(z.string().trim().min(1).max(20_000), body, "message body");
    return db.transaction(async (tx) => {
      const thread = await socialRepo.getThread(tx, userId, threadId);
      if (thread.archivedAt) throw new ValidationError("This conversation is closed", { threadId });
      if ((await socialRepo.blockedWith(tx, userId, thread.participantIds.filter((id) => id !== userId))).size) throw new ForbiddenError(CANNOT_MESSAGE);
      const msg = one(await tx.insert(messages).values({ threadId, fromUser: userId, body: b, readBy: [userId] }).returning(), "message");
      await tx.update(messageThreads).set({ lastMessageAt: msg.createdAt }).where(eq(messageThreads.id, threadId));
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

  async unreadCount(db: Executor, userId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .where(and(sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, sql`not (${messages.readBy} @> array[${userId}::uuid])`));
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
   * people who share a community with you; Private to nobody. Whoever has contacted you (a request to connect, pending
   * or accepted, or a message in a thread you are in) is named as well, since they chose to make contact: a private
   * profile is shown only to the people it wrote to or asked to connect with. Businesses come from `public_profiles`
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
          // Whoever asked the viewer to connect made contact, and stays named after the viewer accepts: the row is no
          // longer "requested", but accepting must never make the person just accepted anonymous.
          if ((l.status === "requested" || l.status === "accepted") && l.fromUser === other && l.toUser === viewerId) contacted.add(other);
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

  // communities -------------------------------------------------------------------------------------------------------
  /** With `viewerId`, only what that user may see: public communities and the ones they belong to (communities_select). */
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
                sql`exists (select 1 from ${communityMembers} cm where cm.community_id = ${communities.id} and cm.user_id = ${options.viewerId}::uuid and cm.status = 'active')`,
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
        await tx.insert(communities).values({ name: v.name, slug: v.slug, descriptionMd: v.descriptionMd, visibility: v.visibility, ownerBusinessId: v.ownerBusinessId ?? null, createdBy: v.createdBy ?? null, memberCount: v.createdBy ? 1 : 0 }).returning(),
        "community",
      );
      if (v.createdBy) await tx.insert(communityMembers).values({ communityId: community.id, userId: v.createdBy, businessId: v.ownerBusinessId ?? null, role: "owner" });
      return community;
    });
  },

  async joinCommunity(db: Executor, userId: string, communityId: string, options: { businessId?: string | null; role?: (typeof COMMUNITY_ROLES)[number] } = {}): Promise<CommunityMember> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
      const current = existing[0];
      if (current) {
        if (current.status === "banned") throw new ValidationError("Banned from this community", { communityId });
        if (current.status === "muted") throw new ValidationError("Your membership is muted; a moderator can restore it", { communityId });
        if (current.status === "active") return current;
        const rejoined = one(await tx.update(communityMembers).set({ status: "active", joinedAt: new Date() }).where(eq(communityMembers.id, current.id)).returning(), "community member");
        await tx.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, communityId));
        return rejoined;
      }
      const member = one(await tx.insert(communityMembers).values({ communityId, userId, businessId: options.businessId ?? null, role: options.role ?? "member" }).returning(), "community member");
      await tx.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, communityId));
      return member;
    });
  },

  async leaveCommunity(db: Executor, userId: string, communityId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(communityMembers)
        .set({ status: "left" })
        .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), eq(communityMembers.status, "active")))
        .returning({ id: communityMembers.id });
      if (rows.length) await tx.update(communities).set({ memberCount: sql`greatest(${communities.memberCount} - 1, 0)` }).where(eq(communities.id, communityId));
    });
  },

  /** Active members, longest-standing first, up to `limit` (a community can be large; its `member_count` has the total). */
  async listMembers(db: Executor, communityId: string, limit = 200): Promise<CommunityMember[]> {
    return db.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.status, "active"))).orderBy(asc(communityMembers.joinedAt)).limit(limit);
  },

  async isMember(db: Executor, userId: string, communityId: string): Promise<boolean> {
    const rows = await db.select({ id: communityMembers.id }).from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), eq(communityMembers.status, "active"))).limit(1);
    return rows.length > 0;
  },

  /** The viewer's active role in each of these communities (communities they are not in are absent). */
  async memberRoles(db: Executor, userId: string, communityIds: readonly string[]): Promise<Map<string, (typeof COMMUNITY_ROLES)[number]>> {
    if (!communityIds.length) return new Map();
    const rows = await db
      .select({ communityId: communityMembers.communityId, role: communityMembers.role })
      .from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "active"), inArray(communityMembers.communityId, [...communityIds])));
    return new Map(rows.map((r) => [r.communityId, r.role]));
  },

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

  async listPosts(db: Executor, communityId: string, options: { parentPostId?: string | null } & PageInput = {}): Promise<Page<Post>> {
    const p = parseInput(PageInput, options, "page");
    const ks = timeKeyset<Post>(posts.createdAt, posts.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.communityId, communityId),
          isNull(posts.archivedAt),
          eq(posts.status, "visible"),
          options.parentPostId === undefined ? isNull(posts.parentPostId) : options.parentPostId === null ? isNull(posts.parentPostId) : eq(posts.parentPostId, options.parentPostId),
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async createPost(db: Executor, input: CreatePostInput): Promise<Post> {
    const v = parseInput(CreatePostInput, input, "post");
    if (!(await socialRepo.isMember(db, v.authorUserId, v.communityId))) throw new ValidationError("Only members can post", { communityId: v.communityId });
    if (v.parentPostId) {
      // A reply goes under a visible top-level post of the same community; anything else reads as a missing post.
      const parent = (await db.select().from(posts).where(eq(posts.id, v.parentPostId)).limit(1))[0];
      if (!parent || parent.communityId !== v.communityId || parent.status !== "visible" || parent.archivedAt) throw new NotFoundError("post", v.parentPostId);
      if (parent.parentPostId) throw new ValidationError("Replies go under a post, not under another reply", { parentPostId: v.parentPostId });
    }
    return one(
      await db.insert(posts).values({ communityId: v.communityId, authorUserId: v.authorUserId, businessId: v.businessId ?? null, parentPostId: v.parentPostId ?? null, bodyMd: v.bodyMd, entityIds: v.entityIds }).returning(),
      "post",
    );
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
