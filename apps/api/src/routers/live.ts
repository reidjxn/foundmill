/**
 * live.connections.* / messages.* / communities.* / leaderboards.* / profile.visibility.* (BUILD §11.14, Phase 4
 * skeleton). Human messages are sent by humans only; agents may draft but never call `messages.send`.
 */
import { repos } from "@foundmill/db";
import { ValidationError, VISIBILITY } from "@foundmill/shared";
import { z } from "zod";
import { Id, businessProcedure, emit, protectedProcedure, router } from "../trpc";

const Page = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() }).optional();

export const liveRouter = router({
  connections: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["requested", "accepted", "blocked"]).optional(), direction: z.enum(["incoming", "outgoing"]).optional() }).optional()).query(({ ctx, input }) => repos.social.listConnections(ctx.db, ctx.userId, input ?? {})),
    request: businessProcedure.input(z.object({ toUserId: Id, message: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
      if (ctx.business.gameMode !== "live") throw new ValidationError("Connections are a LIVE feature; this business is Personal");
      const connection = await repos.social.requestConnection(ctx.db, ctx.userId, input.toUserId, input.message ?? null);
      await ctx.rls((tx) => emit(tx, ctx, { type: "connection.requested", payload: { connectionId: connection.id, fromUserId: ctx.userId, toUserId: input.toUserId, fromBusinessId: ctx.businessId, fromEntityId: null, message: input.message ?? null } }));
      return connection;
    }),
    respond: protectedProcedure.input(z.object({ connectionId: Id, status: z.enum(["accepted", "blocked"]) })).mutation(({ ctx, input }) => repos.social.respondConnection(ctx.db, ctx.userId, input.connectionId, input.status)),
    remove: protectedProcedure.input(z.object({ connectionId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.removeConnection(ctx.db, ctx.userId, input.connectionId);
      return { removed: true };
    }),
  }),

  messages: router({
    threads: protectedProcedure.input(Page).query(({ ctx, input }) => repos.social.listThreads(ctx.db, ctx.userId, input ?? {})),
    list: protectedProcedure.input(z.object({ threadId: Id, limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
      const page = await repos.social.listMessages(ctx.db, ctx.userId, input.threadId, { limit: input.limit, cursor: input.cursor });
      await repos.social.markThreadRead(ctx.db, ctx.userId, input.threadId);
      return page;
    }),
    /** Human-to-human only: a signed-in person presses Send (agents may draft, never send). */
    send: protectedProcedure.input(z.object({ threadId: Id.optional(), toUserIds: z.array(Id).min(1).optional(), subject: z.string().max(200).optional(), body: z.string().min(1).max(20_000) })).mutation(async ({ ctx, input }) => {
      const threadId = input.threadId ?? (input.toUserIds ? (await repos.social.findOrCreateThread(ctx.db, ctx.userId, [ctx.userId, ...input.toUserIds], input.subject ?? null)).id : null);
      if (!threadId) throw new ValidationError("Give a thread or recipients");
      return repos.social.sendMessage(ctx.db, ctx.userId, threadId, input.body);
    }),
    unread: protectedProcedure.query(({ ctx }) => repos.social.unreadCount(ctx.db, ctx.userId)),
  }),

  communities: router({
    list: protectedProcedure.input(z.object({ visibility: z.enum(VISIBILITY).optional(), limit: z.number().int().min(1).max(200).default(50) }).optional()).query(({ ctx, input }) => repos.social.listCommunities(ctx.db, input ?? {})),
    get: protectedProcedure.input(z.object({ communityId: Id })).query(async ({ ctx, input }) => {
      const [community, members, isMember] = await Promise.all([repos.social.getCommunity(ctx.db, input.communityId), repos.social.listMembers(ctx.db, input.communityId), repos.social.isMember(ctx.db, ctx.userId, input.communityId)]);
      return { community, members, isMember };
    }),
    join: protectedProcedure.input(z.object({ communityId: Id, businessId: Id.optional() })).mutation(({ ctx, input }) => repos.social.joinCommunity(ctx.db, ctx.userId, input.communityId, { businessId: input.businessId ?? null })),
    leave: protectedProcedure.input(z.object({ communityId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.leaveCommunity(ctx.db, ctx.userId, input.communityId);
      return { left: true };
    }),
    posts: protectedProcedure.input(z.object({ communityId: Id, parentPostId: Id.nullable().optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => repos.social.listPosts(ctx.db, input.communityId, { parentPostId: input.parentPostId, limit: input.limit, cursor: input.cursor })),
    post: protectedProcedure.input(z.object({ communityId: Id, bodyMd: z.string().min(1).max(20_000), parentPostId: Id.nullable().optional(), businessId: Id.nullable().optional() })).mutation(async ({ ctx, input }) => {
      if (!(await repos.social.isMember(ctx.db, ctx.userId, input.communityId))) throw new ValidationError("Join the community before posting");
      return repos.social.createPost(ctx.db, { ...input, authorUserId: ctx.userId });
    }),
  }),

  leaderboards: router({
    list: protectedProcedure.input(z.object({ period: z.string().optional(), boardKind: z.string().optional() }).optional()).query(({ ctx, input }) => repos.social.listLeaderboards(ctx.db, input ?? {})),
    entries: protectedProcedure.input(z.object({ leaderboardId: Id, limit: z.number().int().min(1).max(500).default(100) })).query(({ ctx, input }) => repos.social.leaderboardEntries(ctx.db, input.leaderboardId, input.limit)),
    /** This business's positions (verified integration metrics only; AC-11.14.1). */
    positions: businessProcedure.input(z.object({ period: z.string().optional() })).query(({ ctx, input }) => repos.social.positionsForBusiness(ctx.db, ctx.businessId, input.period)),
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
