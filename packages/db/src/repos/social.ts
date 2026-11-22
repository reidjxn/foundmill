/**
 * LIVE social layer — public_profiles, connections, message threads/messages, communities, posts,
 * negotiation_threads (BUILD §7.2 "LIVE social", §7.3, §11.14; routers live.*).
 *
 * Most of this is user-scoped, not business-scoped (connections and messages are between people), so the
 * account-scoped functions take `userId` first (ARCHITECTURE §4 exception). Negotiations are
 * business-facing. Personal businesses never appear in `publicProfiles`/`searchPublic`: the `public_profiles`
 * view only selects LIVE businesses (0012), so the visibility rule is enforced in SQL, not here.
 */
import { RESERVED_NAME_MESSAGE, isReservedName } from "@foundmill/config";
import { AppError, ForbiddenError, NotFoundError, OWNER_ROLES, ValidationError, VISIBILITY } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import {
  businesses, communities, COMMUNITY_KINDS, communityMembers, CONNECTION_STATUSES, connections, founderProfiles, memberships, messages, messageThreads,
  NEGOTIATION_STATUSES, negotiationThreads, POST_REPORT_REASONS, postReports, posts, publicProfiles,
  type COMMUNITY_ROLES, type Community, type CommunityMember, type Connection, type Message, type MessageThread, type NegotiationThread, type Post,
  type POST_REPORT_RESOLUTIONS, type PostReport, type PostScreening, type PublicProfile,
} from "../schema";
import { Id, JsonObject, one, PageInput, parseInput, rowsOf, sqlState, timeKeyset, toPage, type Executor, type Page } from "./_shared";
import { adultsRepo } from "./adults";
import { membershipNotEnded } from "./memberships";

/** True when no block stands between the viewer and the person in `other`, whichever of them set it (a block is never announced). */
const noBlockBetween = (viewerId: string, other: AnyColumn) =>
  sql`not exists (select 1 from ${connections} c where c.status = 'blocked' and ((c.from_user = ${viewerId}::uuid and c.to_user = ${other}) or (c.to_user = ${viewerId}::uuid and c.from_user = ${other})))`;

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

/** Why a moderator cannot approve their own post (H2). */
export const SELF_RESTORE = "You cannot approve your own post. Edit it to have it screened again, or another moderator can review it.";

/** A thread subject is the sender's own words: it may not pose as the platform or its staff (audit GLS2F-06). */
const ThreadSubject = z.string().trim().max(200).refine((s) => !isReservedName(s, "subject"), RESERVED_NAME_MESSAGE);

/** One call may write to at most this many people (a thread is a conversation, not a mailing list). */
export const MAX_MESSAGE_RECIPIENTS = 20;

/** A business that may appear on a board: LIVE, committed and not archived (the SQL `is_public`). */
const publicBusiness = and(eq(businesses.gameMode, "live"), isNotNull(businesses.committedAt), isNull(businesses.archivedAt));

/**
 * True when the business behind `businessId` is a seeded demo (0044 `is_demo`) the viewer does not belong to. A demo's
 * numbers are synthetic, so on the network it is shown only to its own members (`is_public` and `public_profiles`
 * leave it out for everyone else); null business ids are never hidden. An example membership (0065, "Explore an
 * example") is a read-only walk around the demo, not belonging to it, so it never lifts the demo onto the network.
 */
const demoHiddenFrom = (businessId: AnyColumn | SQL, viewerId: string): SQL =>
  sql`exists (select 1 from businesses demo where demo.id = ${businessId} and demo.is_demo and not exists (select 1 from memberships dm where dm.business_id = demo.id and dm.user_id = ${viewerId}::uuid and dm.source <> 'example'))`;

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

/**
 * The Network badge's counts as statements (the methods below run them one at a time; `badge` sends them as one), so
 * the two can never count differently.
 */
const badgeQueries = {
  /** Unread messages across the person's threads: threads they muted do not count. */
  unread: (db: Executor, userId: string) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .where(and(sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, sql`not (${messageThreads.mutedIds} @> array[${userId}::uuid])`, sql`not (${messages.readBy} @> array[${userId}::uuid])`)),
  /** Connection requests waiting for this person's answer. */
  incomingRequests: (db: Executor, userId: string) => db.select({ n: sql<number>`count(*)::int` }).from(connections).where(and(eq(connections.toUser, userId), eq(connections.status, "requested"))),
  /** Invitations waiting for this person's answer. */
  invitations: (db: Executor, userId: string) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "invited"), isNull(communities.archivedAt))),
  /** Posts waiting for this person across the communities they moderate. */
  moderation: (db: Executor, userId: string) => {
    const moderated = db
      .select({ communityId: communityMembers.communityId })
      .from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, "active"), inArray(communityMembers.role, ["owner", "moderator"])));
    const reported = db.select({ postId: postReports.postId }).from(postReports).where(and(inArray(postReports.communityId, moderated), isNull(postReports.resolvedAt)));
    return db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(inArray(posts.communityId, moderated), isNull(posts.archivedAt), or(eq(posts.status, "pending_review"), and(eq(posts.status, "visible"), inArray(posts.id, reported)))));
  },
  /** The person's own confirmation that they are 18 or older: the account's record (0100), which every check reads. */
  adultConfirmedAt: (_db: Executor, userId: string) => adultsRepo.confirmedAtSql(userId),
};

/** A text matched as a LIKE prefix, with its own wildcard characters taken literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

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
      .where(and(options.kind ? eq(publicProfiles.kind, options.kind) : undefined, or(sql`${publicProfiles.displayName} % ${term}`, sql`lower(${publicProfiles.displayName}) like lower(${escapeLike(term)}) || '%'`)))
      .orderBy(desc(sql`similarity(${publicProfiles.displayName}, ${term})`), asc(publicProfiles.displayName))
      .limit(limit);
  },

  // the network is for adults (0027; since 0100 the account's own confirmation at sign-up) -----------------------------
  /**
   * When this person confirmed that they are 18 or older; null when they have not (BUILD §11.14 "18+ only"). Reads the
   * account's record (`adult_confirmations`, 0100): a confirmation at sign-up counts for the network, and every row of
   * `network_attestations` was copied there and is kept in step.
   */
  async adultConfirmedAt(db: Executor, userId: string): Promise<Date | null> {
    return adultsRepo.confirmedAt(db, userId);
  },

  /**
   * The person's Network badge in one statement, one round trip (live.summary; until 2026-10-15 five statements on five
   * pooled connections): what `unreadCount`, `incomingRequestCount`, `invitationCount` and `moderationCount` count, and
   * whether `adultConfirmedAt` has a date.
   */
  async badge(db: Executor, userId: string): Promise<{ unreadMessages: number; requestsWaiting: number; invitations: number; moderation: number; adultConfirmed: boolean }> {
    const id = parseInput(Id, userId, "user id");
    const [row] = rowsOf<Record<"unreadMessages" | "requestsWaiting" | "invitations" | "moderation", number | string> & { adultConfirmed: boolean }>(
      await db.execute(
        sql`select ${badgeQueries.unread(db, id)} as "unreadMessages", ${badgeQueries.incomingRequests(db, id)} as "requestsWaiting", ${badgeQueries.invitations(db, id)} as "invitations", ${badgeQueries.moderation(db, id)} as "moderation", ${badgeQueries.adultConfirmedAt(db, id)} is not null as "adultConfirmed"`,
      ),
    );
    return { unreadMessages: Number(row?.unreadMessages ?? 0), requestsWaiting: Number(row?.requestsWaiting ?? 0), invitations: Number(row?.invitations ?? 0), moderation: Number(row?.moderation ?? 0), adultConfirmed: row?.adultConfirmed === true };
  },

  /**
   * Records the person's own confirmation that they are 18 or older, on the account (`adult_confirmations`, 0100; a
   * trigger writes the network's row too). The first one stands; asking again changes nothing.
   */
  async confirmAdult(db: Executor, userId: string): Promise<Date> {
    return (await adultsRepo.confirm(db, userId)).confirmedAt;
  },

  /**
   * "On {APP_NAME}" search for a signed-in person: the public profiles that match, minus the viewer's own founder row and
   * any founder who is blocked either way (a block is never announced, so those simply do not turn up). Businesses and
   * founders come from the `public_profiles` view, so only LIVE, committed businesses and founders who made their name
   * public can be found (BUILD §11.14).
   */
  async searchPublicFor(db: Executor, viewerId: string, q: string, options: { limit?: number } = {}): Promise<PublicProfile[]> {
    const limit = options.limit ?? 10;
    const rows = await socialRepo.searchPublic(db, q, { limit: limit + 10 });
    // One query for every founder in the page (a block either way, never announced).
    const blocked = await socialRepo.blockedWith(db, viewerId, [...new Set(rows.flatMap((r) => (r.kind === "founder" && r.userId && r.userId !== viewerId ? [r.userId] : [])))]);
    return rows.filter((r) => r.kind === "business" || (!!r.userId && r.userId !== viewerId && !blocked.has(r.userId))).slice(0, limit);
  },

  /**
   * One public profile and what hangs off it, from the same view: a business (by its id) with the founders who made
   * their name public, or a founder (by user id) with the LIVE businesses they run. Null when it is not public.
   */
  async publicProfileOf(db: Executor, kind: (typeof publicProfiles.kind.enumValues)[number], id: string): Promise<{ profile: PublicProfile; businesses: PublicProfile[]; founders: PublicProfile[] } | null> {
    const key = parseInput(Id, id, "profile id");
    if (kind === "business") {
      const profile = await socialRepo.publicProfile(db, key);
      if (!profile) return null;
      const founders = await db.select().from(publicProfiles).where(and(eq(publicProfiles.kind, "founder"), eq(publicProfiles.businessId, key))).orderBy(asc(publicProfiles.displayName));
      return { profile, businesses: [profile], founders };
    }
    const rows = await db.select().from(publicProfiles).where(and(eq(publicProfiles.kind, "founder"), eq(publicProfiles.userId, key)));
    const profile = rows[0];
    if (!profile) return null;
    const businessRows = await db
      .select()
      .from(publicProfiles)
      .where(and(eq(publicProfiles.kind, "business"), inArray(publicProfiles.businessId, rows.map((r) => r.businessId))))
      .orderBy(asc(publicProfiles.displayName));
    return { profile, businesses: businessRows, founders: [profile] };
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
    // existed), so whatever it writes commits with the request or not at all.
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
        // A block is never announced: to anyone but its blocker the row reads exactly like one that does not exist.
        if (current.blockedBy !== userId) throw new NotFoundError("connection", connectionId);
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
    // Someone else's block is invisible to you: removing it is the same quiet no-op as removing a row that is not there.
    if (current.status === "blocked" && current.blockedBy !== userId) return null;
    const deleted = await db
      .delete(connections)
      .where(and(eq(connections.id, connectionId), or(eq(connections.fromUser, userId), eq(connections.toUser, userId)), or(sql`${connections.status} <> 'blocked'`, eq(connections.blockedBy, userId))))
      .returning();
    return deleted[0] ?? null;
  },

  async listConnections(db: Executor, userId: string, filter: { status?: (typeof CONNECTION_STATUSES)[number]; direction?: "incoming" | "outgoing" } = {}): Promise<Connection[]> {
    const f = parseInput(z.object({ status: z.enum(CONNECTION_STATUSES).optional(), direction: z.enum(["incoming", "outgoing"]).optional() }), filter, "connection filter");
    const rows = await db
      .select()
      .from(connections)
      .where(f.direction === "incoming" ? eq(connections.toUser, userId) : f.direction === "outgoing" ? eq(connections.fromUser, userId) : or(eq(connections.fromUser, userId), eq(connections.toUser, userId)))
      .orderBy(desc(connections.createdAt));
    // A block is never announced. Its blocker sees it; the person who asked and was blocked keeps seeing their request as
    // still waiting (a request that vanished would say it was blocked); the person who was asked simply no longer has it.
    const seen = rows.flatMap((c): Connection[] => {
      if (c.status !== "blocked" || c.blockedBy === userId) return [c];
      return c.fromUser === userId ? [{ ...c, status: "requested", respondedAt: null, blockedBy: null }] : [];
    });
    return f.status ? seen.filter((c) => c.status === f.status) : seen;
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
    const v = parseInput(z.object({ participantIds: z.array(Id).min(1), subject: ThreadSubject.nullable().optional() }), { participantIds, subject }, "thread");
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
    if (subject && isReservedName(subject, "subject")) throw new ValidationError(RESERVED_NAME_MESSAGE);
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

  /**
   * A person's conversations, the latest activity first (the last message, else when the thread was opened). The
   * cursor carries that same instant and the id, so pages never repeat or skip a thread.
   */
  async listThreads(db: Executor, userId: string, page: PageInput = {}): Promise<Page<MessageThread>> {
    const p = parseInput(PageInput, page, "page");
    const ks = timeKeyset<MessageThread>(sql`coalesce(${messageThreads.lastMessageAt}, ${messageThreads.createdAt})`, messageThreads.id, (r) => ({ at: r.lastMessageAt ?? r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(messageThreads)
      .where(and(isNull(messageThreads.archivedAt), sql`${messageThreads.participantIds} @> array[${userId}::uuid]`, ks.after(p.cursor)))
      .orderBy(...ks.orderBy)
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
   * you). `onSent` runs in the same transaction, with the stored message and its thread.
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
    const rows = await badgeQueries.unread(db, userId);
    return Number(rows[0]?.n ?? 0);
  },

  /** Connection requests waiting for this person's answer. */
  async incomingRequestCount(db: Executor, userId: string): Promise<number> {
    const rows = await badgeQueries.incomingRequests(db, userId);
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
        // An example membership is a walk-through, not the viewer's business (0065); an ended one is not theirs any more.
        .where(and(eq(memberships.userId, viewerId), ne(memberships.source, "example"), membershipNotEnded, inArray(businesses.id, businessIds), isNull(businesses.archivedAt)));
      for (const b of own) cards.set(b.businessId, { businessId: b.businessId, name: b.name, slug: b.slug, kitPrimary: b.kitPrimary, kitSecondary: b.kitSecondary, archetype: b.archetype, live: b.gameMode === "live" });
    }
    return { users, businesses: [...cards.values()] };
  },

  /** The owner of a listed business (the longest-standing owner or cofounder): the person a request to connect with the business reaches. Null when it is not listed. */
  async listedBusinessOwner(db: Executor, businessId: string): Promise<string | null> {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES]), ne(memberships.source, "example"), publicBusiness))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    return rows[0]?.userId ?? null;
  },

  // communities -------------------------------------------------------------------------------------------------------
  /**
   * With `viewerId`, only what that user may see: public communities (leaving out a public community a demo business
   * owns unless the viewer belongs to that business or the community), the ones they belong to (active or muted) and the
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
                and(eq(communities.visibility, "public"), sql`not ${demoHiddenFrom(communities.ownerBusinessId, options.viewerId)}`),
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

  /** Which of these businesses are demo businesses (0044) the viewer does not belong to: the network does not show them. */
  async demoBusinessesHiddenFrom(db: Executor, viewerId: string, businessIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
    const ids = [...new Set(businessIds.filter((id): id is string => !!id))];
    if (!ids.length) return new Set();
    const rows = await db.select({ id: businesses.id }).from(businesses).where(and(inArray(businesses.id, ids), demoHiddenFrom(businesses.id, viewerId)));
    return new Set(rows.map((r) => r.id));
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
   * Joins a community, accepts an invitation to it, or rejoins it, as yourself or, with `businessId` (already checked by
   * the caller: a business you may speak for), as that business; joining again changes who you speak as (left out: it
   * stays). A ban is final until a moderator lifts it; someone muted who left comes back muted. `member_count` moves
   * only when a membership turns active, and only once however many joins race: each write is conditional on the row's
   * state, so a double-click or two tabs count one member.
   */
  async joinCommunity(db: Executor, userId: string, communityId: string, options: { businessId?: string | null; role?: (typeof COMMUNITY_ROLES)[number] } = {}): Promise<CommunityMember> {
    const businessId = options.businessId ?? null;
    const mine = and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId));
    const counted = (tx: Executor) => tx.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, communityId));
    return db.transaction(async (tx) => {
      const inserted = await tx.insert(communityMembers).values({ communityId, userId, businessId, role: options.role ?? "member" }).onConflictDoNothing({ target: [communityMembers.communityId, communityMembers.userId] }).returning();
      if (inserted[0]) {
        await counted(tx);
        return inserted[0];
      }
      // A row exists. Come back only from 'left' or 'invited' (a racing rejoin finds it active and counts nothing); a
      // banned member stays banned, an active or muted one stays as they are.
      const rejoined = await tx
        .update(communityMembers)
        .set({ status: sql`case when ${communityMembers.mutedAt} is not null then 'muted' else 'active' end`, joinedAt: new Date(), ...(options.businessId !== undefined ? { businessId } : {}) })
        .where(and(mine, inArray(communityMembers.status, ["left", "invited"])))
        .returning();
      if (rejoined[0]) {
        await counted(tx);
        return rejoined[0];
      }
      const current = one(await tx.select().from(communityMembers).where(mine).limit(1), "community member");
      if (current.status === "banned") throw new ValidationError("Banned from this community", { communityId });
      if (options.businessId === undefined || current.businessId === businessId || current.status !== "active") return current;
      return one(await tx.update(communityMembers).set({ businessId }).where(and(mine, eq(communityMembers.status, "active"))).returning(), "community member");
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
  /** Visible replies under each of these posts (posts without replies are absent); with `viewerId`, none by someone blocked either way. */
  async replyCounts(db: Executor, postIds: readonly string[], viewerId?: string): Promise<Map<string, number>> {
    if (!postIds.length) return new Map();
    const rows = await db
      .select({ parentPostId: posts.parentPostId, n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(inArray(posts.parentPostId, [...postIds]), isNull(posts.archivedAt), eq(posts.status, "visible"), viewerId ? noBlockBetween(viewerId, posts.authorUserId) : undefined))
      .groupBy(posts.parentPostId);
    return new Map(rows.flatMap((r) => (r.parentPostId ? [[r.parentPostId, Number(r.n)] as const] : [])));
  },

  /**
   * The feed: visible posts, plus (with `viewerId`) the viewer's own posts that are waiting for review, so an author
   * sees that their post was held rather than lost, and none by someone blocked either way with the viewer. Hidden and
   * removed posts are for the moderators' queue only.
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
          // H4: a block holds inside communities too: neither person reads the other's posts or replies.
          options.viewerId ? noBlockBetween(options.viewerId, posts.authorUserId) : undefined,
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
      // H4: nobody replies under the post of someone who blocked them, or whom they blocked (it reads as missing).
      if (parent.authorUserId !== v.authorUserId && (await socialRepo.blockedWith(db, v.authorUserId, [parent.authorUserId])).size) throw new NotFoundError("post", v.parentPostId);
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
      // Every open report counts here, not only the ones that could hold it: banning the reporters is no way out either.
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
   * deleted. Open reports on the post are resolved with the decision. A moderator never restores their own post.
   */
  async moderatePost(db: Executor, actorId: string, postId: string, action: PostModerationAction, note?: string | null): Promise<Post> {
    const a = parseInput(z.enum(POST_MODERATION_ACTIONS), action, "post action");
    const n = parseInput(z.string().trim().max(500).nullable().optional(), note, "moderation note");
    return db.transaction(async (tx) => {
      const post = await socialRepo.getPost(tx, postId);
      await socialRepo.requireModerator(tx, actorId, post.communityId);
      if (post.status === "removed") throw new ValidationError("This post was removed; it cannot be changed", { postId });
      // H2: nobody approves their own post or dismisses reports about it; the screen or another moderator decides.
      if (a === "restore" && post.authorUserId === actorId) throw new ForbiddenError(SELF_RESTORE);
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

  /**
   * The open reports that count towards holding a post (H1): from members who still read the community and joined it
   * before the post was written. Accounts that join after a post to report it together never hold it (the moderators
   * still see their reports in the queue).
   */
  async holdingReportCount(db: Executor, post: Pick<Post, "id" | "communityId" | "createdAt">): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(postReports)
      .innerJoin(communityMembers, and(eq(communityMembers.communityId, postReports.communityId), eq(communityMembers.userId, postReports.reporterUserId)))
      .where(and(eq(postReports.postId, post.id), isNull(postReports.resolvedAt), inArray(communityMembers.status, [...READING]), lt(communityMembers.joinedAt, post.createdAt)));
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
   * A member reports a visible post of their community (not their own) once. When REPORTS_TO_HOLD different members who
   * joined before it was written have open reports on it, the post is held for review: out of the feed until a moderator
   * decides.
   */
  async reportPost(db: Executor, reporterId: string, postId: string, input: { reason: (typeof POST_REPORT_REASONS)[number]; note?: string | null }): Promise<{ report: PostReport; held: boolean }> {
    const v = parseInput(z.object({ reason: z.enum(POST_REPORT_REASONS), note: z.string().trim().max(1000).nullable().optional() }), input, "report");
    return db.transaction(async (tx) => {
      const post = await socialRepo.getPost(tx, postId);
      if (!(await socialRepo.isMember(tx, reporterId, post.communityId)) || post.status !== "visible" || post.archivedAt) throw new NotFoundError("post", postId);
      if (post.authorUserId === reporterId) throw new ValidationError("You cannot report your own post; delete it instead", { postId });
      // H4: someone blocked either way with the author does not read the post, so cannot report it.
      if ((await socialRepo.blockedWith(tx, reporterId, [post.authorUserId])).size) throw new NotFoundError("post", postId);
      const inserted = await tx
        .insert(postReports)
        .values({ postId, communityId: post.communityId, reporterUserId: reporterId, reason: v.reason, note: v.note ?? null })
        .onConflictDoNothing({ target: [postReports.postId, postReports.reporterUserId] })
        .returning();
      const report = inserted[0] ?? one(await tx.select().from(postReports).where(and(eq(postReports.postId, postId), eq(postReports.reporterUserId, reporterId))).limit(1), "report");
      if ((await socialRepo.holdingReportCount(tx, post)) < REPORTS_TO_HOLD) return { report, held: false };
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
    const rows = await badgeQueries.moderation(db, userId);
    return Number(rows[0]?.n ?? 0);
  },

  /** Invitations waiting for this person's answer (their Network badge). */
  async invitationCount(db: Executor, userId: string): Promise<number> {
    const rows = await badgeQueries.invitations(db, userId);
    return Number(rows[0]?.n ?? 0);
  },

  async setPostStatus(db: Executor, postId: string, status: (typeof posts.status.enumValues)[number]): Promise<Post> {
    return one(await db.update(posts).set({ status }).where(eq(posts.id, postId)).returning(), "post", postId);
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
