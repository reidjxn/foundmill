/**
 * live.connections.* / messages.* / communities.* / posts.* / profile.visibility.* / summary (BUILD
 * §11.14). Human messages are sent by humans only; agents may draft but never call `messages.send`.
 *
 * Requests and messages are delivered to their recipient alone (services/live.ts): a signal on their own stream channel
 * refreshes their Network badge and lists in any business, and nothing is written to a business, so no member or advisor
 * of theirs can read it (FU-S-2). Posts pass a moderation screen before members see them; members report, authors edit
 * and delete, owners and moderators hide, restore and remove posts and mute, ban and restore members; communities are
 * created here and joined by invitation when they are not public.
 *
 * The network is for adults (BUILD §11.14 "18+ only"): a person confirms once that they are 18 or older before their
 * first step onto it (asking to connect, accepting, writing, starting, joining or posting in a community, inviting).
 * Stepping back never needs it: block, remove, leave, mute, report, delete and decline always work.
 */
import { randomUUID } from "node:crypto";
import { COMMUNITY_KINDS, MAX_MESSAGE_RECIPIENTS, MEMBER_MODERATION_ACTIONS, POST_MODERATION_ACTIONS, POST_REPORT_REASONS, PUBLIC_PROFILE_KINDS, repos, type Business, type CommunityMember, type Executor, type MessageThread, type Post, type PublicProfile } from "@foundmill/db";
import { ForbiddenError, NotFoundError, ValidationError, VISIBILITY, WRITE_ROLES } from "@foundmill/shared";
import { z } from "zod";
import type { Context } from "../context";
import { messageRecipients, screenText, signalPeople } from "../services/live";
import { takeCommunity, takeCommunityInvite, takeConnectionRequest, takeMessage, takePost, takePostReport } from "../services/live-limits";
import { Id, effectivePermission, liveGate, pgErrorCode, protectedProcedure as anyProtectedProcedure, router, sectionWrite as anySectionWrite, type Section } from "../trpc";

// Every LIVE procedure is closed while LIVE is (FLAGS.liveMode / LIVE_MODE, audit VLS2-X1).
const protectedProcedure = anyProtectedProcedure.use(liveGate);
const sectionWrite = (section: Section) => anySectionWrite(section).use(liveGate);

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

/** A public profile as the page shows it: only what the `public_profiles` view carries (no logo image: the retired crest URL stays out). */
function publicCard(p: PublicProfile) {
  return { kind: p.kind, businessId: p.businessId, userId: p.userId, name: p.displayName, slug: p.slug, archetype: p.archetype, kitPrimary: p.kitPrimary, kitSecondary: p.kitSecondary, region: p.region, since: p.committedAt };
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
 * The community, if the caller may see it: public ones, any they belong to (active or muted) and any they are invited to
 * (the `communities_select` policy; this router runs on the service connection, so the rule is applied here). A hidden
 * community reads as missing.
 */
async function visibleCommunity(ctx: Ctx, communityId: string) {
  const [community, membership] = await Promise.all([repos.social.getCommunity(ctx.db, communityId), repos.social.membership(ctx.db, ctx.userId, communityId)]);
  const isMember = membership?.status === "active" || membership?.status === "muted";
  const invited = membership?.status === "invited";
  if (community.archivedAt || (community.visibility !== "public" && !isMember && !invited)) throw new NotFoundError("community", communityId);
  // A demo business's community (synthetic posts) is there only for the demo's own members and the community's (0044).
  if (!isMember && !invited && (await repos.social.demoBusinessesHiddenFrom(ctx.db, ctx.userId, [community.ownerBusinessId])).size) throw new NotFoundError("community", communityId);
  const canModerate = membership?.status === "active" && (membership.role === "owner" || membership.role === "moderator");
  return { community, membership, isMember, invited, canPost: membership?.status === "active", canModerate };
}

/** Why the caller cannot post (or edit their post) in a community, or null when they can: only active members post. */
function postingBlocker(membership: CommunityMember | null): string | null {
  if (membership?.status === "active") return null;
  return membership?.status === "muted" ? "A moderator muted you in this community; you can read it but not post" : "Join the community before posting";
}

/** A thread as its participant sees it: whether *they* muted it, never who else did. */
function threadView(t: MessageThread, viewerId: string) {
  const { mutedIds, ...rest } = t;
  return { ...rest, muted: mutedIds.includes(viewerId) };
}

/**
 * A post as the viewer may see it: the screen's verdict and the moderation note are for its author and the community's
 * moderators; which moderator acted is for the moderators only (an author is told what happened, not who did it).
 */
function postView(p: Post, viewerId: string, canModerate: boolean) {
  const { screening, moderatedBy, moderationNote, ...rest } = p;
  const privileged = canModerate || p.authorUserId === viewerId;
  return { ...rest, screening: privileged && "decision" in screening ? screening : null, moderatedBy: canModerate ? moderatedBy : null, moderationNote: privileged ? moderationNote : null };
}

/** What a person is told before their 18+ confirmation is on record (FORBIDDEN; the LIVE pages offer the confirmation). */
export const ADULTS_ONLY = "The network is for adults. Confirm that you are 18 or older on Network to continue.";

/** Refuses a step onto the network until the caller has confirmed that they are 18 or older. */
async function requireAdult(ctx: Ctx): Promise<void> {
  if (!(await repos.social.adultConfirmedAt(ctx.db, ctx.userId))) throw new ForbiddenError(ADULTS_ONLY);
}

/** The active owner and moderators of a community: who a held or reported post is signalled to. */
async function moderatorsOf(db: Executor, communityId: string): Promise<string[]> {
  return (await repos.social.listMembers(db, communityId, 200, ["active"])).filter((m) => m.role === "owner" || m.role === "moderator").map((m) => m.userId);
}

const CommunityName = z.string().trim().min(1).max(120);
const CommunityDescription = z.string().max(4000);

/** "Fintech ops founders" → "fintech-ops-founders-3f9a2c": readable, and unique without asking the table first. */
function communitySlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base || "community"}-${suffix}`;
}

/** Screens a community's name and description as it screens posts; a held profile is refused with a sentence to act on. */
async function screenCommunityProfile(ctx: Pick<Context, "models" | "log"> & { userId?: string | null }, input: { name: string; descriptionMd: string; businessId: string | null }): Promise<void> {
  const verdict = await screenText(ctx, { text: `${input.name}\n\n${input.descriptionMd}`, kind: "community_profile", communityName: "", businessId: input.businessId, userId: ctx.userId ?? undefined });
  if (verdict.decision === "hold") throw new ValidationError("Moderation held this name or description. Change it and try again.", { flags: verdict.flags });
}

export const liveRouter = router({
  /**
   * The founder's Network badge, in any business and any mode: unread messages, requests and invitations, and posts to
   * moderate; and whether they have confirmed that they are 18 or older (the LIVE pages ask until they have).
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    // Five counts in one statement: one round trip on one pooled connection.
    const { unreadMessages, requestsWaiting, invitations, moderation, adultConfirmed } = await repos.social.badge(ctx.db, ctx.userId);
    return { unreadMessages, requestsWaiting, invitations, moderation, total: unreadMessages + requestsWaiting + invitations, adultConfirmed };
  }),

  connections: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["requested", "accepted", "blocked"]).optional(), direction: z.enum(["incoming", "outgoing"]).optional() }).optional()).query(({ ctx, input }) => repos.social.listConnections(ctx.db, ctx.userId, input ?? {})),
    /**
     * A LIVE business's writer asks a person to connect: by their user id (community members, post authors), or by a
     * listed business, which reaches its owner. A new request reaches the recipient alone (their badge
     * and Requests list, signalled on their own stream channel once it commits); asking again notifies nobody.
     */
    request: sectionWrite("live")
      .input(z.object({ toUserId: Id.optional(), toBusinessId: Id.optional(), message: z.string().trim().max(1000).optional() }).refine((v) => !!v.toUserId !== !!v.toBusinessId, { message: "Name a person or a business to connect with" }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.business.gameMode !== "live") throw new ValidationError("Connections are a LIVE feature; this business is Personal");
        const toUserId = input.toUserId ?? (await repos.social.listedBusinessOwner(ctx.db, input.toBusinessId!));
        if (!toUserId) throw new NotFoundError("business", input.toBusinessId);
        if (toUserId === ctx.userId) throw new ValidationError(input.toBusinessId ? "That is your own business" : "Cannot connect to yourself");
        await requireAdult(ctx);
        await takeConnectionRequest(ctx.limits, ctx.userId, toUserId);
        let created = false;
        const connection = await repos.social.requestConnection(ctx.db, ctx.userId, toUserId, input.message || null, {
          onCreated: async () => {
            created = true;
          },
        });
        if (created) await signalPeople(ctx, [toUserId], "connection_requested");
        return connection;
      }),
    /** Accept (the recipient) or block (either side). An acceptance refreshes the requester's lists; a block is never announced. */
    respond: protectedProcedure.input(z.object({ connectionId: Id, status: z.enum(["accepted", "blocked"]) })).mutation(async ({ ctx, input }) => {
      // Accepting is a step onto the network; a block never waits for anything.
      if (input.status === "accepted") await requireAdult(ctx);
      const connection = await repos.social.respondConnection(ctx.db, ctx.userId, input.connectionId, input.status);
      if (input.status === "accepted") await signalPeople(ctx, [connection.fromUser], "connection_changed");
      return connection;
    }),
    /**
     * Withdraws or ignores a request, removes a connection (which also closes the two people's direct thread to new
     * messages) or lifts the caller's own block.
     */
    remove: protectedProcedure.input(z.object({ connectionId: Id })).mutation(async ({ ctx, input }) => {
      const removed = await repos.social.removeConnection(ctx.db, ctx.userId, input.connectionId);
      // The other person's lists change too; lifting a block says nothing (they never saw it).
      if (removed && removed.status !== "blocked") await signalPeople(ctx, [removed.fromUser === ctx.userId ? removed.toUser : removed.fromUser], "connection_changed");
      return { removed: true };
    }),
    /**
     * Blocks a person, whether or not a connection exists (a stranger in a group, an ex-connection): no more messages or
     * requests either way. Never announced; lifted from the Blocked view.
     */
    block: protectedProcedure.input(z.object({ userId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.blockPerson(ctx.db, ctx.userId, input.userId);
      return { blocked: true };
    }),
  }),

  messages: router({
    threads: protectedProcedure.input(Page).query(async ({ ctx, input }) => {
      const [page, unread] = await Promise.all([repos.social.listThreads(ctx.db, ctx.userId, input ?? {}), repos.social.unreadByThread(ctx.db, ctx.userId)]);
      return { ...page, items: page.items.map((t) => ({ ...threadView(t, ctx.userId), unread: unread.get(t.id) ?? 0 })) };
    }),
    /**
     * One thread for its pane: who is in it (and who left), whether the caller is connected with each and has blocked
     * them, and whether the caller can write. Blocked and not connected read the same, so a block is never announced.
     */
    thread: protectedProcedure.input(z.object({ threadId: Id })).query(async ({ ctx, input }) => {
      const thread = await repos.social.getThread(ctx.db, ctx.userId, input.threadId);
      const others = thread.participantIds.filter((id) => id !== ctx.userId);
      const [contacts, mine, state] = await Promise.all([
        repos.social.connectedWith(ctx.db, ctx.userId, others),
        repos.social.listConnections(ctx.db, ctx.userId, { status: "blocked" }),
        repos.social.sendState(ctx.db, ctx.userId, thread),
      ]);
      const blockedByMe = new Set(mine.filter((c) => c.blockedBy === ctx.userId).map((c) => (c.fromUser === ctx.userId ? c.toUser : c.fromUser)));
      return {
        thread: threadView(thread, ctx.userId),
        participants: others.map((userId) => ({ userId, connected: contacts.has(userId), blockedByMe: blockedByMe.has(userId) })),
        canSend: state.canSend,
        closedReason: state.reason,
      };
    }),
    list: protectedProcedure.input(z.object({ threadId: Id, limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
      const page = await repos.social.listMessages(ctx.db, ctx.userId, input.threadId, { limit: input.limit, cursor: input.cursor });
      await repos.social.markThreadRead(ctx.db, ctx.userId, input.threadId);
      return page;
    }),
    /**
     * Human-to-human only: a signed-in person presses Send (agents may draft, never send). A new thread goes to at most
     * MAX_MESSAGE_RECIPIENTS people who exist, are not blocked either way, and are connections; a group also needs its
     * people connected with each other. Every Send rechecks that the sender is still connected with everyone in the
     * thread. The message reaches the others alone: their badge and the thread on Network, signalled on their own stream
     * channel once it commits (nothing is written to any business).
     */
    send: protectedProcedure.input(z.object({ threadId: Id.optional(), toUserIds: z.array(Id).min(1).max(MAX_MESSAGE_RECIPIENTS).optional(), subject: z.string().max(200).optional(), body: z.string().min(1).max(20_000) })).mutation(async ({ ctx, input }) => {
      if (!input.threadId && !input.toUserIds) throw new ValidationError("Give a thread or recipients");
      await requireAdult(ctx);
      // Throttled before anything is written: per person, and per thread (or per set of recipients for a first message).
      await takeMessage(ctx.limits, ctx.userId, input.threadId ?? [...input.toUserIds!].sort().join(","));
      let recipients: string[] = [];
      const message = await ctx.db.transaction(async (tx) => {
        const threadId = input.threadId ?? (await repos.social.startThread(tx, ctx.userId, input.toUserIds!, input.subject ?? null)).id;
        return repos.social.sendMessage(tx, ctx.userId, threadId, input.body, {
          onSent: async (_inner, msg, thread) => {
            recipients = messageRecipients({ message: msg, thread });
          },
        });
      });
      await signalPeople(ctx, recipients, "message_received", { threadId: message.threadId });
      return message;
    }),
    unread: protectedProcedure.query(({ ctx }) => repos.social.unreadCount(ctx.db, ctx.userId)),
    /** Leaves a thread: the caller stops reading it and getting its messages; the others see that they left. */
    leave: protectedProcedure.input(z.object({ threadId: Id })).mutation(async ({ ctx, input }) => {
      const thread = await repos.social.getThread(ctx.db, ctx.userId, input.threadId);
      const result = await repos.social.leaveThread(ctx.db, ctx.userId, input.threadId);
      await signalPeople(ctx, thread.participantIds.filter((id) => id !== ctx.userId), "connection_changed", { threadId: input.threadId });
      return result;
    }),
    /** Mutes a thread for the caller only: no badge and no signal for it; nobody else is told. */
    mute: protectedProcedure.input(z.object({ threadId: Id, muted: z.boolean() })).mutation(({ ctx, input }) => repos.social.setThreadMuted(ctx.db, ctx.userId, input.threadId, input.muted)),
  }),

  communities: router({
    /** What the caller may see (public ones, their own and the ones they are invited to), each with their role and invitation. */
    list: protectedProcedure.input(z.object({ visibility: z.enum(VISIBILITY).optional(), limit: z.number().int().min(1).max(200).default(50) }).optional()).query(async ({ ctx, input }) => {
      const rows = await repos.social.listCommunities(ctx.db, { ...input, viewerId: ctx.userId });
      const [roles, shown, invitations] = await Promise.all([
        repos.social.memberRoles(ctx.db, ctx.userId, rows.map((c) => c.id)),
        shownBusinessIds(ctx, rows.map((c) => c.ownerBusinessId)),
        repos.social.listInvitations(ctx.db, ctx.userId),
      ]);
      const invited = new Set(invitations.map((i) => i.community.id));
      return rows.map((c) => ({ ...c, ownerBusinessId: c.ownerBusinessId && shown.has(c.ownerBusinessId) ? c.ownerBusinessId : null, role: roles.get(c.id) ?? null, invited: invited.has(c.id) }));
    }),
    /**
     * The member list is for members only (community_members_select); anyone who may see the community gets the rest. A
     * member's moderation status is shown to the moderators only.
     */
    get: protectedProcedure.input(z.object({ communityId: Id })).query(async ({ ctx, input }) => {
      const { community, membership, isMember, invited, canPost, canModerate } = await visibleCommunity(ctx, input.communityId);
      const members = isMember ? await repos.social.listMembers(ctx.db, input.communityId) : [];
      const shown = await shownBusinessIds(ctx, [community.ownerBusinessId, ...members.map((m) => m.businessId)]);
      const mask = <T extends string | null>(id: T) => (id && shown.has(id) ? id : null);
      return {
        community: { ...community, ownerBusinessId: mask(community.ownerBusinessId) },
        members: members.map((m) => ({ id: m.id, userId: m.userId, role: m.role, joinedAt: m.joinedAt, businessId: mask(m.businessId), status: canModerate || m.userId === ctx.userId ? m.status : ("active" as const) })),
        isMember,
        invited,
        canPost,
        canModerate,
        role: isMember ? (membership?.role ?? null) : null,
        status: membership?.status ?? null,
      };
    }),
    /**
     * Starts a community with the caller as its owner (and, optionally, a LIVE business they speak for as its business).
     * Its name and description pass the moderation screen. A community that is not public is joined by invitation only.
     */
    create: protectedProcedure
      .input(z.object({ name: CommunityName, descriptionMd: CommunityDescription.default(""), visibility: z.enum(VISIBILITY).default("public"), kind: z.enum(COMMUNITY_KINDS).default("category"), businessId: Id.nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const ownerBusinessId = await speakingAs(ctx, input.businessId);
        await requireAdult(ctx);
        await takeCommunity(ctx.limits, ctx.userId);
        await screenCommunityProfile(ctx, { name: input.name, descriptionMd: input.descriptionMd, businessId: ownerBusinessId });
        const create = () => repos.social.createCommunity(ctx.db, { name: input.name, slug: communitySlug(input.name), descriptionMd: input.descriptionMd, visibility: input.visibility, kind: input.kind, ownerBusinessId, createdBy: ctx.userId });
        try {
          return await create();
        } catch (err) {
          // A slug clash is one in sixteen million; try once more with another suffix.
          if (pgErrorCode(err) === "23505") return create();
          throw err;
        }
      }),
    /** The owner changes the name, description, kind or visibility (screened like a new community). */
    update: protectedProcedure
      .input(z.object({ communityId: Id, name: CommunityName.optional(), descriptionMd: CommunityDescription.optional(), visibility: z.enum(VISIBILITY).optional(), kind: z.enum(COMMUNITY_KINDS).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { community, membership } = await visibleCommunity(ctx, input.communityId);
        // The owner check comes before the screen, so nobody else spends a model call (the repo checks again).
        if (membership?.status !== "active" || membership.role !== "owner") throw new ForbiddenError("Only the community's owner can change it");
        const { communityId, ...patch } = input;
        if (patch.name !== undefined || patch.descriptionMd !== undefined) await screenCommunityProfile(ctx, { name: patch.name ?? community.name, descriptionMd: patch.descriptionMd ?? community.descriptionMd, businessId: null });
        return repos.social.updateCommunity(ctx.db, ctx.userId, communityId, patch);
      }),
    /** Public communities are joined by anyone; the others only by someone invited (an invitation accepted is a join). */
    join: protectedProcedure.input(z.object({ communityId: Id, businessId: Id.optional() })).mutation(async ({ ctx, input }) => {
      const { community, invited, isMember } = await visibleCommunity(ctx, input.communityId);
      if (community.visibility !== "public" && !invited && !isMember) throw new NotFoundError("community", input.communityId);
      await requireAdult(ctx);
      return repos.social.joinCommunity(ctx.db, ctx.userId, input.communityId, { businessId: await speakingAs(ctx, input.businessId) });
    }),
    /** Declines an invitation. */
    decline: protectedProcedure.input(z.object({ communityId: Id })).mutation(async ({ ctx, input }) => ({ declined: await repos.social.declineInvitation(ctx.db, ctx.userId, input.communityId) })),
    /** Invitations waiting for the caller's answer, with who sent each. */
    invitations: protectedProcedure.query(async ({ ctx }) => {
      const rows = await repos.social.listInvitations(ctx.db, ctx.userId);
      const shown = await shownBusinessIds(ctx, rows.map((r) => r.community.ownerBusinessId));
      return rows.map((r) => ({ ...r, community: { ...r.community, ownerBusinessId: r.community.ownerBusinessId && shown.has(r.community.ownerBusinessId) ? r.community.ownerBusinessId : null } }));
    }),
    /** An owner or moderator invites one of their connections; the person sees the invitation on Network. */
    invite: protectedProcedure.input(z.object({ communityId: Id, userId: Id })).mutation(async ({ ctx, input }) => {
      await visibleCommunity(ctx, input.communityId);
      await requireAdult(ctx);
      await takeCommunityInvite(ctx.limits, ctx.userId);
      const before = await repos.social.membership(ctx.db, input.userId, input.communityId);
      const member = await repos.social.inviteToCommunity(ctx.db, ctx.userId, input.communityId, input.userId);
      if (member.status === "invited" && before?.status !== "invited") await signalPeople(ctx, [input.userId], "community_invited", { communityId: input.communityId });
      return { status: member.status };
    }),
    leave: protectedProcedure.input(z.object({ communityId: Id })).mutation(async ({ ctx, input }) => {
      await repos.social.leaveCommunity(ctx.db, ctx.userId, input.communityId);
      return { left: true };
    }),
    /**
     * The feed is for members (posts_select); each post carries its reply count and its author's name (when their profile
     * shows it). An author also sees their own posts that wait for review.
     */
    posts: protectedProcedure.input(z.object({ communityId: Id, parentPostId: Id.nullable().optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
      const { isMember, canModerate } = await visibleCommunity(ctx, input.communityId);
      if (!isMember) throw new ForbiddenError("Join the community to read its feed");
      const page = await repos.social.listPosts(ctx.db, input.communityId, { parentPostId: input.parentPostId, limit: input.limit, cursor: input.cursor, viewerId: ctx.userId });
      const [replies, { users }, shown] = await Promise.all([
        repos.social.replyCounts(ctx.db, page.items.map((p) => p.id)),
        repos.social.lookupPeople(ctx.db, ctx.userId, { userIds: page.items.map((p) => p.authorUserId) }),
        shownBusinessIds(ctx, page.items.map((p) => p.businessId)),
      ]);
      const names = new Map(users.map((u) => [u.userId, u.displayName]));
      return {
        ...page,
        items: page.items.map((p) => ({ ...postView(p, ctx.userId, canModerate), businessId: p.businessId && shown.has(p.businessId) ? p.businessId : null, replyCount: replies.get(p.id) ?? 0, authorName: names.get(p.authorUserId) ?? null })),
      };
    }),
    /**
     * A reply goes under a visible top-level post of this community (the repo says "not found" for anything else). The
     * text passes the moderation screen first: a held post waits for the community's owner and moderators, who are told.
     */
    post: protectedProcedure.input(z.object({ communityId: Id, bodyMd: z.string().min(1).max(20_000), parentPostId: Id.nullable().optional(), businessId: Id.nullable().optional() })).mutation(async ({ ctx, input }) => {
      const { community, membership, canModerate } = await visibleCommunity(ctx, input.communityId);
      // Before the screen, so a muted member spends no model call (the repo refuses them too).
      const blocker = postingBlocker(membership);
      if (blocker) throw new ValidationError(blocker);
      const businessId = await speakingAs(ctx, input.businessId);
      await requireAdult(ctx);
      await takePost(ctx.limits, ctx.userId);
      const screening = await screenText(ctx, { text: input.bodyMd, kind: "community_post", communityName: community.name, businessId, userId: ctx.userId });
      const post = await repos.social.createPost(ctx.db, { ...input, businessId, authorUserId: ctx.userId, screening });
      if (post.status === "pending_review") await signalPeople(ctx, await moderatorsOf(ctx.db, input.communityId), "moderation", { communityId: input.communityId });
      return { ...postView(post, ctx.userId, canModerate), held: post.status === "pending_review" };
    }),
    /** The moderators' queue: held, hidden and reported posts with their open reports, and the members who are muted or banned. */
    moderation: protectedProcedure.input(z.object({ communityId: Id })).query(async ({ ctx, input }) => {
      await visibleCommunity(ctx, input.communityId);
      await repos.social.requireModerator(ctx.db, ctx.userId, input.communityId);
      const [queue, restricted] = await Promise.all([repos.social.moderationQueue(ctx.db, input.communityId), repos.social.listMembers(ctx.db, input.communityId, 200, ["muted", "banned"])]);
      const { users } = await repos.social.lookupPeople(ctx.db, ctx.userId, { userIds: [...queue.map((q) => q.post.authorUserId), ...restricted.map((m) => m.userId)] });
      const names = new Map(users.map((u) => [u.userId, u.displayName]));
      return {
        items: queue.map((q) => ({ post: { ...postView(q.post, ctx.userId, true), authorName: names.get(q.post.authorUserId) ?? null }, openReports: q.openReports, reasons: q.reasons })),
        restricted: restricted.map((m: CommunityMember) => ({ userId: m.userId, status: m.status, role: m.role, name: names.get(m.userId) ?? null })),
      };
    }),
    /** An owner or moderator mutes, bans or restores a member (never the owner; a moderator only by the owner). */
    moderateMember: protectedProcedure.input(z.object({ communityId: Id, userId: Id, action: z.enum(MEMBER_MODERATION_ACTIONS) })).mutation(async ({ ctx, input }) => {
      await visibleCommunity(ctx, input.communityId);
      const member = await repos.social.moderateMember(ctx.db, ctx.userId, input.communityId, input.userId, input.action);
      return { userId: member.userId, status: member.status, role: member.role };
    }),
    /** The owner makes a member a moderator, or a moderator a member again. */
    setRole: protectedProcedure.input(z.object({ communityId: Id, userId: Id, role: z.enum(["moderator", "member"]) })).mutation(async ({ ctx, input }) => {
      await visibleCommunity(ctx, input.communityId);
      const member = await repos.social.setMemberRole(ctx.db, ctx.userId, input.communityId, input.userId, input.role);
      return { userId: member.userId, status: member.status, role: member.role };
    }),
  }),

  posts: router({
    /**
     * The author edits their own post; the new text is screened again (a held edit waits for review). A post written as a
     * business is edited only while the author may still speak for it (deleting it never needs that).
     */
    edit: protectedProcedure.input(z.object({ postId: Id, bodyMd: z.string().min(1).max(20_000) })).mutation(async ({ ctx, input }) => {
      const post = await repos.social.getPost(ctx.db, input.postId);
      if (post.authorUserId !== ctx.userId) throw new ForbiddenError("Only the author can edit a post");
      const { community, membership, canModerate } = await visibleCommunity(ctx, post.communityId);
      const blocker = postingBlocker(membership);
      if (blocker) throw new ValidationError(blocker);
      await speakingAs(ctx, post.businessId);
      await requireAdult(ctx);
      await takePost(ctx.limits, ctx.userId);
      const screening = await screenText(ctx, { text: input.bodyMd, kind: "community_post", communityName: community.name, businessId: post.businessId, userId: ctx.userId });
      const edited = await repos.social.editPost(ctx.db, ctx.userId, input.postId, input.bodyMd, screening);
      if (edited.status === "pending_review") await signalPeople(ctx, await moderatorsOf(ctx.db, post.communityId), "moderation", { communityId: post.communityId });
      return { ...postView(edited, ctx.userId, canModerate), held: edited.status === "pending_review" };
    }),
    /** The author deletes their own post, whatever its status. */
    delete: protectedProcedure.input(z.object({ postId: Id })).mutation(async ({ ctx, input }) => {
      const post = await repos.social.deleteOwnPost(ctx.db, ctx.userId, input.postId);
      return { postId: post.id, status: post.status };
    }),
    /** A member reports a post to the community's owner and moderators; enough reports hold it for review. */
    report: protectedProcedure.input(z.object({ postId: Id, reason: z.enum(POST_REPORT_REASONS), note: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => {
      await takePostReport(ctx.limits, ctx.userId);
      const { report, held } = await repos.social.reportPost(ctx.db, ctx.userId, input.postId, { reason: input.reason, note: input.note ?? null });
      await signalPeople(ctx, await moderatorsOf(ctx.db, report.communityId), "moderation", { communityId: report.communityId });
      return { reported: true, held };
    }),
    /** An owner or moderator hides, removes or restores a post; open reports are resolved with the decision, and the author is told. */
    moderate: protectedProcedure.input(z.object({ postId: Id, action: z.enum(POST_MODERATION_ACTIONS), note: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const post = await repos.social.moderatePost(ctx.db, ctx.userId, input.postId, input.action, input.note ?? null);
      await signalPeople(ctx, [post.authorUserId], "moderation", { communityId: post.communityId });
      return postView(post, ctx.userId, true);
    }),
  }),

  people: router({
    /** Display names and logos for ids a page shows (people follow their profile visibility; see repos.social.lookupPeople). */
    lookup: protectedProcedure.input(z.object({ userIds: z.array(Id).max(200).default([]), businessIds: z.array(Id).max(200).default([]) })).query(({ ctx, input }) => repos.social.lookupPeople(ctx.db, ctx.userId, input)),
    /**
     * "On {APP_NAME}": founders and businesses found by name among the public profiles (LIVE businesses, and founders who
     * made their name public). Only public-profile fields leave here; the viewer's own row and blocked people do not turn up.
     */
    search: protectedProcedure.input(z.object({ q: z.string().trim().min(2).max(120), limit: z.number().int().min(1).max(20).default(10) })).query(async ({ ctx, input }) => {
      const rows = await repos.social.searchPublicFor(ctx.db, ctx.userId, input.q, { limit: input.limit });
      return { hits: rows.map(publicCard) };
    }),
    /** One public profile page: the card, who is behind the business or which businesses a founder runs, and the viewer's connection to the founder. */
    profile: protectedProcedure.input(z.object({ kind: z.enum(PUBLIC_PROFILE_KINDS), id: Id })).query(async ({ ctx, input }) => {
      const found = await repos.social.publicProfileOf(ctx.db, input.kind, input.id);
      if (!found) throw new NotFoundError("profile", input.id);
      let connection: { id: string; status: "requested" | "accepted" | "blocked"; direction: "incoming" | "outgoing" } | null = null;
      const founderId = found.profile.kind === "founder" ? found.profile.userId : null;
      if (founderId && founderId !== ctx.userId) {
        const row = (await repos.social.listConnections(ctx.db, ctx.userId)).find((c) => (c.fromUser === founderId && c.toUser === ctx.userId) || (c.fromUser === ctx.userId && c.toUser === founderId));
        if (row) connection = { id: row.id, status: row.status, direction: row.toUser === ctx.userId ? "incoming" : "outgoing" };
      }
      return {
        profile: publicCard(found.profile),
        businesses: found.businesses.map(publicCard),
        founders: found.founders.map(publicCard),
        isSelf: founderId === ctx.userId,
        connection,
      };
    }),
  }),

  profile: router({
    /**
     * The person confirms that they are 18 or older (their own statement, recorded once; the network is for adults).
     * Asked on the LIVE pages before a first connection, message or post, and at Go live.
     */
    confirmAdult: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => ({ adultConfirmedAt: await repos.social.confirmAdult(ctx.db, ctx.userId) })),
    visibility: router({
      get: protectedProcedure.query(async ({ ctx }) => {
        const [profile, listed] = await Promise.all([repos.founders.get(ctx.db, ctx.userId), repos.social.publicProfileOf(ctx.db, "founder", ctx.userId)]);
        // `publicProfile`: how the founder is listed right now ("On {APP_NAME}"), null while the name is not public.
        return { visibility: profile?.visibility ?? "private", publicProfile: listed ? { ...publicCard(listed.profile), businesses: listed.businesses.map(publicCard) } : null };
      }),
      set: protectedProcedure.input(z.object({ visibility: z.enum(VISIBILITY) })).mutation(({ ctx, input }) => repos.founders.update(ctx.db, ctx.userId, { visibility: input.visibility })),
    }),
  }),
});
