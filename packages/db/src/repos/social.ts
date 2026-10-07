/**
 * LIVE social layer — public_profiles, connections, message threads/messages, communities, posts,
 * leaderboards, negotiation_threads (BUILD §7.2 "LIVE social", §7.3, §11.14; routers live.*).
 *
 * Most of this is user-scoped, not business-scoped (connections and messages are between people), so the
 * account-scoped functions take `userId` first (ARCHITECTURE §4 exception). Leaderboards and negotiations are
 * business-facing. Personal businesses never appear in `publicProfiles`/`searchPublic`: the `public_profiles`
 * view only selects LIVE businesses (0012), so the visibility rule is enforced in SQL, not here.
 */
import { ARCHETYPES, DATA_REGIONS, ValidationError, VISIBILITY } from "@foundmill/shared";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  communities, communityMembers, CONNECTION_STATUSES, connections, leaderboardEntries, leaderboards, messages, messageThreads,
  NEGOTIATION_STATUSES, negotiationThreads, posts, publicProfiles,
  type COMMUNITY_ROLES, type Community, type CommunityMember, type Connection, type Leaderboard, type LeaderboardEntry, type Message, type MessageThread, type NegotiationThread, type Post, type PublicProfile,
} from "../schema";
import { Id, JsonObject, numericText, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

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
  async requestConnection(db: Executor, fromUser: string, toUser: string, message?: string | null): Promise<Connection> {
    const v = parseInput(z.object({ fromUser: Id, toUser: Id, message: z.string().max(1000).nullable().optional() }), { fromUser, toUser, message }, "connection request");
    if (v.fromUser === v.toUser) throw new ValidationError("Cannot connect to yourself", { fromUser });
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(connections)
        .where(or(and(eq(connections.fromUser, v.fromUser), eq(connections.toUser, v.toUser)), and(eq(connections.fromUser, v.toUser), eq(connections.toUser, v.fromUser))))
        .limit(1);
      const current = existing[0];
      if (current) {
        if (current.status === "blocked") throw new ValidationError("Connection is blocked", { connectionId: current.id });
        return current;
      }
      return one(await tx.insert(connections).values({ fromUser: v.fromUser, toUser: v.toUser, message: v.message ?? null }).returning(), "connection");
    });
  },

  /** Only the recipient may accept; either side may block. */
  async respondConnection(db: Executor, userId: string, connectionId: string, status: "accepted" | "blocked"): Promise<Connection> {
    const s = parseInput(z.enum(["accepted", "blocked"]), status, "connection status");
    return db.transaction(async (tx) => {
      const current = one(await tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1), "connection", connectionId);
      const isParty = current.fromUser === userId || current.toUser === userId;
      if (!isParty) throw new ValidationError("Not a party to this connection", { connectionId });
      if (s === "accepted" && current.toUser !== userId) throw new ValidationError("Only the recipient can accept", { connectionId });
      return one(await tx.update(connections).set({ status: s, respondedAt: new Date() }).where(eq(connections.id, connectionId)).returning(), "connection", connectionId);
    });
  },

  async removeConnection(db: Executor, userId: string, connectionId: string): Promise<void> {
    await db.delete(connections).where(and(eq(connections.id, connectionId), or(eq(connections.fromUser, userId), eq(connections.toUser, userId))));
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
  /** The thread between exactly these participants (created if missing). */
  async findOrCreateThread(db: Executor, userId: string, participantIds: readonly string[], subject?: string | null): Promise<MessageThread> {
    const v = parseInput(z.object({ participantIds: z.array(Id).min(1), subject: z.string().max(200).nullable().optional() }), { participantIds, subject }, "thread");
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
      await socialRepo.getThread(tx, userId, threadId);
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

  // communities -------------------------------------------------------------------------------------------------------
  async listCommunities(db: Executor, options: { visibility?: (typeof VISIBILITY)[number]; limit?: number } = {}): Promise<Community[]> {
    return db
      .select()
      .from(communities)
      .where(and(isNull(communities.archivedAt), options.visibility ? eq(communities.visibility, options.visibility) : undefined))
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

  async listMembers(db: Executor, communityId: string): Promise<CommunityMember[]> {
    return db.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.status, "active"))).orderBy(asc(communityMembers.joinedAt));
  },

  async isMember(db: Executor, userId: string, communityId: string): Promise<boolean> {
    const rows = await db.select({ id: communityMembers.id }).from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), eq(communityMembers.status, "active"))).limit(1);
    return rows.length > 0;
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
   * Replaces a board's entries: ranks verified values (highest first), computes movement against the previous
   * positions and stamps computed_at. Unverified values never enter a board (the table's `check (verified)`
   * enforces BUILD §7.2 "verified only"); they are dropped here so a caller can pass its whole metric set.
   */
  async setLeaderboardEntries(db: Executor, leaderboardId: string, entries: LeaderboardEntryInput[]): Promise<LeaderboardEntry[]> {
    const parsed = entries.map((e) => parseInput(LeaderboardEntryInput, e, "leaderboard entry"));
    return db.transaction(async (tx) => {
      await socialRepo.getLeaderboard(tx, leaderboardId);
      const previous = await tx.select({ businessId: leaderboardEntries.businessId, position: leaderboardEntries.position }).from(leaderboardEntries).where(eq(leaderboardEntries.leaderboardId, leaderboardId));
      const prevPos = new Map(previous.map((p) => [p.businessId, p.position]));
      const ranked = parsed
        .filter((e) => e.verified)
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

  async leaderboardEntries(db: Executor, leaderboardId: string, limit = 100): Promise<LeaderboardEntry[]> {
    return db.select().from(leaderboardEntries).where(eq(leaderboardEntries.leaderboardId, leaderboardId)).orderBy(asc(leaderboardEntries.position)).limit(limit);
  },

  /** A business's positions across boards (its profile's trophy cabinet strip). */
  async positionsForBusiness(db: Executor, businessId: string, period?: string): Promise<(LeaderboardEntry & { board: Leaderboard })[]> {
    const rows = await db
      .select({ entry: leaderboardEntries, board: leaderboards })
      .from(leaderboardEntries)
      .innerJoin(leaderboards, eq(leaderboards.id, leaderboardEntries.leaderboardId))
      .where(and(eq(leaderboardEntries.businessId, businessId), period ? eq(leaderboards.period, period) : undefined))
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
