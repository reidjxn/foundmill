/**
 * live.connections.* / messages.* / communities.* / leaderboards.* / profile.visibility.* (BUILD §11.14, Phase 4
 * skeleton). Human messages are sent by humans only; agents may draft but never call `messages.send`.
 */
import { MAX_MESSAGE_RECIPIENTS, repos, type Business, type Executor } from "@foundmill/db";
import { ForbiddenError, NotFoundError, ValidationError, VISIBILITY, WRITE_ROLES } from "@foundmill/shared";
import { z } from "zod";
import { Id, businessProcedure, effectivePermission, emit, protectedProcedure, router, sectionWrite } from "../trpc";

const Page = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() }).optional();

type Ctx = { db: Executor; userId: string };

/** Ids per `lookupPeople` call (its limit for business ids). */
const LOOKUP_CHUNK = 500;

/** True when a business may appear on the network: LIVE, committed and not archived (the SQL `is_public`). */
function isListed(business: Pick<Business, "gameMode" | "committedAt" | "archivedAt">): boolean {
  return business.gameMode === "live" && business.committedAt !== null && business.archivedAt === null;
}

/**
 * A business the caller may speak as ("posting as Ledgerly"): they must belong to it with a role that writes, hold write
 * access to its `live` section (viewers and advisors never speak for a business; a restricted member may not either), and
 * the business must be listed. Null when none is named: the person speaks as themselves.
 */
async function speakingAs(ctx: Ctx, businessId: string | null | undefined): Promise<string | null> {
  if (!businessId) return null;
  const membership = await repos.memberships.get(ctx.db, businessId, ctx.userId);
  if (!membership) throw new ForbiddenError("You are not a member of that business");
  if (!WRITE_ROLES.includes(membership.role) || effectivePermission(membership, "live") !== "write") throw new ForbiddenError("You cannot speak for that business");
  const business = await repos.businesses.get(ctx.db, businessId, { includeArchived: true });
  if (!isListed(business)) throw new ValidationError("Only a LIVE, committed business can speak on the network");
  return businessId;
}

/** Which of these business ids the viewer may be shown: listed businesses, and their own in any mode. Others read as null. */
async function shownBusinessIds(ctx: Ctx, ids: readonly (string | null)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const shown = new Set<string>();
  // The lookup takes at most 500 ids a call; a page or member list is capped well below that, but never trust it to stay so.
  for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
    const { businesses } = await repos.social.lookupPeople(ctx.db, ctx.userId, { businessIds: wanted.slice(i, i + LOOKUP_CHUNK) });
    for (const b of businesses) shown.add(b.businessId);
  }
  return shown;
}

/**
 * The community, if the caller may see it: public ones, and any they belong to (the `communities_select` policy; this
 * router runs on the service connection, so the rule is applied here). A hidden community reads as missing.
 */
async function visibleCommunity(ctx: Ctx, communityId: string) {
  const [community, isMember] = await Promise.all([repos.social.getCommunity(ctx.db, communityId), repos.social.isMember(ctx.db, ctx.userId, communityId)]);
  if (community.archivedAt || (community.visibility !== "public" && !isMember)) throw new NotFoundError("community", communityId);
  return { community, isMember };
}

export const liveRouter = router({
  connections: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["requested", "accepted", "blocked"]).optional(), direction: z.enum(["incoming", "outgoing"]).optional() }).optional()).query(({ ctx, input }) => repos.social.listConnections(ctx.db, ctx.userId, input ?? {})),
    /** A LIVE business's writer asks a person to connect. One transaction: the request and its event commit together or not at all. */
    request: sectionWrite("live").input(z.object({ toUserId: Id, message: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
      if (ctx.business.gameMode !== "live") throw new ValidationError("Connections are a LIVE feature; this business is Personal");
      return ctx.rls(async (tx) => {
        const connection = await repos.social.requestConnection(tx, ctx.userId, input.toUserId, input.message ?? null);
        await emit(tx, ctx, { type: "connection.requested", payload: { connectionId: connection.id, fromUserId: ctx.userId, toUserId: input.toUserId, fromBusinessId: ctx.businessId, fromEntityId: null, message: input.message ?? null } });
        return connection;
      });
    }),
    respond: protectedProcedure.input(z.object({ connectionId: Id, status: z.enum(["accepted", "blocked"]) })).mutation(({ ctx, input }) => repos.social.respondConnection(ctx.db, ctx.userId, input.connectionId, input.status)),
    remove: protectedProcedure.input(z.object({ connectionId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.removeConnection(ctx.db, ctx.userId, input.connectionId);
      return { removed: true };
    }),
  }),

  messages: router({
    threads: protectedProcedure.input(Page).query(async ({ ctx, input }) => {
      const [page, unread] = await Promise.all([repos.social.listThreads(ctx.db, ctx.userId, input ?? {}), repos.social.unreadByThread(ctx.db, ctx.userId)]);
      return { ...page, items: page.items.map((t) => ({ ...t, unread: unread.get(t.id) ?? 0 })) };
    }),
    list: protectedProcedure.input(z.object({ threadId: Id, limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
      const page = await repos.social.listMessages(ctx.db, ctx.userId, input.threadId, { limit: input.limit, cursor: input.cursor });
      await repos.social.markThreadRead(ctx.db, ctx.userId, input.threadId);
      return page;
    }),
    /**
     * Human-to-human only: a signed-in person presses Send (agents may draft, never send). A new thread goes to at most
     * MAX_MESSAGE_RECIPIENTS people who exist, are not blocked either way, and are connections (or already share a thread).
     */
    send: protectedProcedure.input(z.object({ threadId: Id.optional(), toUserIds: z.array(Id).min(1).max(MAX_MESSAGE_RECIPIENTS).optional(), subject: z.string().max(200).optional(), body: z.string().min(1).max(20_000) })).mutation(async ({ ctx, input }) => {
      const threadId = input.threadId ?? (input.toUserIds ? (await repos.social.startThread(ctx.db, ctx.userId, input.toUserIds, input.subject ?? null)).id : null);
      if (!threadId) throw new ValidationError("Give a thread or recipients");
      return repos.social.sendMessage(ctx.db, ctx.userId, threadId, input.body);
    }),
    unread: protectedProcedure.query(({ ctx }) => repos.social.unreadCount(ctx.db, ctx.userId)),
  }),

  communities: router({
    /** What the caller may see (public ones and their own), each with their role in it (null when not a member). */
    list: protectedProcedure.input(z.object({ visibility: z.enum(VISIBILITY).optional(), limit: z.number().int().min(1).max(200).default(50) }).optional()).query(async ({ ctx, input }) => {
      const rows = await repos.social.listCommunities(ctx.db, { ...input, viewerId: ctx.userId });
      const [roles, shown] = await Promise.all([repos.social.memberRoles(ctx.db, ctx.userId, rows.map((c) => c.id)), shownBusinessIds(ctx, rows.map((c) => c.ownerBusinessId))]);
      return rows.map((c) => ({ ...c, ownerBusinessId: c.ownerBusinessId && shown.has(c.ownerBusinessId) ? c.ownerBusinessId : null, role: roles.get(c.id) ?? null }));
    }),
    /** The member list is for members only (community_members_select); anyone who may see the community gets the rest. */
    get: protectedProcedure.input(z.object({ communityId: Id })).query(async ({ ctx, input }) => {
      const { community, isMember } = await visibleCommunity(ctx, input.communityId);
      const members = isMember ? await repos.social.listMembers(ctx.db, input.communityId) : [];
      const shown = await shownBusinessIds(ctx, [community.ownerBusinessId, ...members.map((m) => m.businessId)]);
      const mask = <T extends string | null>(id: T) => (id && shown.has(id) ? id : null);
      return {
        community: { ...community, ownerBusinessId: mask(community.ownerBusinessId) },
        members: members.map((m) => ({ ...m, businessId: mask(m.businessId) })),
        isMember,
        role: members.find((m) => m.userId === ctx.userId)?.role ?? null,
      };
    }),
    /** Only public communities can be joined; the others are by invitation, so to a non-member they read as missing. */
    join: protectedProcedure.input(z.object({ communityId: Id, businessId: Id.optional() })).mutation(async ({ ctx, input }) => {
      await visibleCommunity(ctx, input.communityId);
      return repos.social.joinCommunity(ctx.db, ctx.userId, input.communityId, { businessId: await speakingAs(ctx, input.businessId) });
    }),
    leave: protectedProcedure.input(z.object({ communityId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.leaveCommunity(ctx.db, ctx.userId, input.communityId);
      return { left: true };
    }),
    /** The feed is for members (posts_select); each post carries its reply count and its author's name (when their profile shows it). */
    posts: protectedProcedure.input(z.object({ communityId: Id, parentPostId: Id.nullable().optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
      const { isMember } = await visibleCommunity(ctx, input.communityId);
      if (!isMember) throw new ForbiddenError("Join the community to read its feed");
      const page = await repos.social.listPosts(ctx.db, input.communityId, { parentPostId: input.parentPostId, limit: input.limit, cursor: input.cursor });
      const [replies, { users }, shown] = await Promise.all([
        repos.social.replyCounts(ctx.db, page.items.map((p) => p.id)),
        repos.social.lookupPeople(ctx.db, ctx.userId, { userIds: page.items.map((p) => p.authorUserId) }),
        shownBusinessIds(ctx, page.items.map((p) => p.businessId)),
      ]);
      const names = new Map(users.map((u) => [u.userId, u.displayName]));
      return { ...page, items: page.items.map((p) => ({ ...p, businessId: p.businessId && shown.has(p.businessId) ? p.businessId : null, replyCount: replies.get(p.id) ?? 0, authorName: names.get(p.authorUserId) ?? null })) };
    }),
    /** A reply goes under a visible top-level post of this community (the repo says "not found" for anything else). */
    post: protectedProcedure.input(z.object({ communityId: Id, bodyMd: z.string().min(1).max(20_000), parentPostId: Id.nullable().optional(), businessId: Id.nullable().optional() })).mutation(async ({ ctx, input }) => {
      const { isMember } = await visibleCommunity(ctx, input.communityId);
      if (!isMember) throw new ValidationError("Join the community before posting");
      return repos.social.createPost(ctx.db, { ...input, businessId: await speakingAs(ctx, input.businessId), authorUserId: ctx.userId });
    }),
  }),

  leaderboards: router({
    list: protectedProcedure.input(z.object({ period: z.string().optional(), boardKind: z.string().optional() }).optional()).query(({ ctx, input }) => repos.social.listLeaderboards(ctx.db, input ?? {})),
    get: protectedProcedure.input(z.object({ leaderboardId: Id })).query(({ ctx, input }) => repos.social.getLeaderboard(ctx.db, input.leaderboardId)),
    /** A board's entries, each with the business's public card (name, logo inputs) when it is listed; null otherwise. */
    entries: protectedProcedure.input(z.object({ leaderboardId: Id, limit: z.number().int().min(1).max(500).default(100) })).query(async ({ ctx, input }) => {
      const rows = await repos.social.leaderboardEntries(ctx.db, input.leaderboardId, input.limit);
      const { businesses } = await repos.social.lookupPeople(ctx.db, ctx.userId, { businessIds: rows.map((r) => r.businessId) });
      const cards = new Map(businesses.map((b) => [b.businessId, b]));
      return rows.map((r) => ({ ...r, businessName: cards.get(r.businessId)?.name ?? null, business: cards.get(r.businessId) ?? null }));
    }),
    /** This business's positions (verified integration metrics only; AC-11.14.1). */
    positions: businessProcedure.input(z.object({ period: z.string().optional() })).query(({ ctx, input }) => repos.social.positionsForBusiness(ctx.db, ctx.businessId, input.period)),
  }),

  people: router({
    /** Display names and logos for ids a page shows (people follow their profile visibility; see repos.social.lookupPeople). */
    lookup: protectedProcedure.input(z.object({ userIds: z.array(Id).max(200).default([]), businessIds: z.array(Id).max(200).default([]) })).query(({ ctx, input }) => repos.social.lookupPeople(ctx.db, ctx.userId, input)),
  }),

  profile: router({
    visibility: router({
      get: protectedProcedure.query(async ({ ctx }) => {
        const profile = await repos.founders.get(ctx.db, ctx.userId);
        return { visibility: profile?.visibility ?? "private", publicProfile: null };
      }),
      set: protectedProcedure.input(z.object({ visibility: z.enum(VISIBILITY) })).mutation(({ ctx, input }) => repos.founders.update(ctx.db, ctx.userId, { visibility: input.visibility })),
    }),
  }),
});
