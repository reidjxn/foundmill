"use client";
/**
 * /communities/[id] (BUILD §6.2, §11.14): one community. A profile header with Join or Leave (or the invitation to
 * accept or decline), the feed (posts, each with its replies on demand) with a post box, and the member list. The feed is
 * for members: a visitor sees the description and the size and is asked to join. Post text is written by other people,
 * so it is rendered without images and with entity linking off (an `[[ent:…]]` in a post names something in the author's
 * business, not the reader's). A post is the person's own unless they choose to post as the business, a choice offered
 * only when they may (`canSpeakAsBusiness`).
 *
 * Moderation (audit #28): every post passes a screen first, and a held one shows only to its author (marked "Held for
 * review") and to the moderators. Each post has a More menu: Report for members, Edit and Delete for its author, Hide,
 * Remove or Approve for the owner and moderators, and Ask to connect with its author. Owners and moderators also get the
 * review queue, an Invite button, and mute, ban and restore on members; the owner makes moderators. A muted member reads
 * but cannot post. Every member row offers Ask to connect.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Building2, Check, Clock, EyeOff, Flag, Info, LogIn, LogOut, Lock, MailOpen, MessageSquare, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, Trash2, UserPlus, UsersRound, VolumeX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Composer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FeedPost,
  Icon,
  Label,
  Markdown,
  Panel,
  ProfileHeader,
  StatusPill,
  Switch,
  useToast,
  useFormatters,
  useDateFormat,
  type ProfileChip,
  type ProfileFact,
} from "@foundmill/dugout";
import { canSpeakAsBusiness, leaveBlocker, postStatusLabel, reportReasonLabel } from "@/lib/live";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { COMMUNITY_ROLE_WORD, COMMUNITY_VISIBILITY, useCommunityMembership } from "./communities";
import { EditPostDialog, InviteDialog, ReportDialog } from "./community-dialogs";
import { ConnectControl, useAskToConnect, useConnectStates } from "./connect";
import { AdultNotice, PersonalNotice, usePeople, type People } from "./shared";
import { useLiveViewer } from "./viewer";

type PostRow = RouterOutputs["live"]["communities"]["posts"]["items"][number];
type QueueItem = RouterOutputs["live"]["communities"]["moderation"]["items"][number];

const FEED_LIMIT = 100;

/** The business a post was written for, as a chip next to the author. */
function BusinessBadge({ people, businessId }: { people: People; businessId: string | null }) {
  const name = businessId ? people.business(businessId)?.name : undefined;
  return name ? <Chip tone="neutral" icon={Building2}>{name}</Chip> : null;
}

function PostText({ children }: { children: string }) {
  return (
    <Markdown variant="body" images={false} entities={false}>
      {children}
    </Markdown>
  );
}

/** "Held for review" (and the like) for the people who can see a post that is not visible, and "Edited". */
function PostStatus({ post }: { post: Pick<PostRow, "status" | "editedAt"> }) {
  const label = postStatusLabel(post.status);
  return (
    <>
      {post.editedAt ? <Chip tone="neutral">Edited</Chip> : null}
      {label ? (
        <Chip tone="warn" icon={post.status === "pending_review" ? Clock : EyeOff} data-testid="post-status">
          {label}
        </Chip>
      ) : null}
    </>
  );
}

/** What a post's More menu can do for the viewer: their own post, someone else's, and a moderator's tools. */
interface PostMenuHandlers {
  viewerId: string;
  canModerate: boolean;
  canPost: boolean;
  onReport: (post: PostRow) => void;
  onEdit: (post: PostRow) => void;
  onDelete: (post: PostRow) => void;
  onModerate: (post: Pick<PostRow, "id">, action: "hide" | "remove" | "restore") => void;
  onConnect: (post: PostRow) => void;
  connectable: (userId: string) => boolean;
}

function PostMenu({ post, handlers, authorName }: { post: PostRow; handlers: PostMenuHandlers; authorName: string }) {
  const mine = post.authorUserId === handlers.viewerId;
  const items: { id: string; label: string; icon: typeof Flag; danger?: boolean; separator?: boolean; onSelect: () => void }[] = [];
  if (mine) {
    if (handlers.canPost && (post.status === "visible" || post.status === "pending_review")) items.push({ id: "edit", label: "Edit", icon: Pencil, onSelect: () => handlers.onEdit(post) });
    items.push({ id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => handlers.onDelete(post) });
  } else {
    if (handlers.connectable(post.authorUserId)) items.push({ id: "connect", label: `Ask ${authorName} to connect`, icon: UserPlus, onSelect: () => handlers.onConnect(post) });
    if (post.status === "visible") items.push({ id: "report", label: "Report", icon: Flag, onSelect: () => handlers.onReport(post) });
  }
  if (handlers.canModerate) {
    const first = items.length > 0;
    if (post.status !== "visible") items.push({ id: "restore", label: post.status === "pending_review" ? "Approve" : "Restore", icon: ShieldCheck, separator: first, onSelect: () => handlers.onModerate(post, "restore") });
    if (post.status === "visible" && !mine) items.push({ id: "hide", label: "Hide", icon: EyeOff, separator: first, onSelect: () => handlers.onModerate(post, "hide") });
    if (!mine) items.push({ id: "remove", label: "Remove", icon: Trash2, danger: true, onSelect: () => handlers.onModerate(post, "remove") });
  }
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`More for the post by ${authorName}`} data-testid="post-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it) => (
          <Fragment key={it.id}>
            {it.separator ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant={it.danger ? "danger" : "default"} onSelect={it.onSelect}>
              <Icon icon={it.icon} size="inline" /> {it.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CommunityScreen({ communityId }: { communityId: string }) {
  const { formatDate } = useFormatters();
  const { businessId, data } = useBusiness();
  const viewer = useLiveViewer();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const membership = useCommunityMembership();
  const mayPostAsBusiness = canSpeakAsBusiness({ business: data.business, membership: data.membership });
  const [asBusiness, setAsBusiness] = useState(false);
  const connect = useAskToConnect();
  const connectStates = useConnectStates();

  const getQ = useQuery(trpc.live.communities.get.queryOptions({ communityId }, { retry: false, staleTime: 10_000 }));
  const community = getQ.data?.community;
  const isMember = getQ.data?.isMember === true;
  const canModerate = getQ.data?.canModerate === true;
  const canPost = getQ.data?.canPost === true;
  const isOwner = getQ.data?.role === "owner";
  const postsQ = useQuery(trpc.live.communities.posts.queryOptions({ communityId, limit: FEED_LIMIT }, { enabled: isMember, staleTime: 10_000, refetchInterval: 30_000, retry: false }));
  const queueQ = useQuery(trpc.live.communities.moderation.queryOptions({ communityId }, { enabled: canModerate, staleTime: 10_000, retry: false }));
  const posts = useMemo(() => postsQ.data?.items ?? [], [postsQ.data]);
  const members = useMemo(() => getQ.data?.members ?? [], [getQ.data]);
  const queue = useMemo(() => queueQ.data?.items ?? [], [queueQ.data]);
  const restricted = useMemo(() => queueQ.data?.restricted ?? [], [queueQ.data]);

  const people = usePeople(
    useMemo(() => [...posts.map((p) => p.authorUserId), ...members.map((m) => m.userId)], [posts, members]),
    useMemo(() => [...posts.flatMap((p) => (p.businessId ? [p.businessId] : [])), ...members.flatMap((m) => (m.businessId ? [m.businessId] : []))], [posts, members]),
  );

  useShellChrome(
    { title: community?.name ?? "Community", breadcrumbs: [{ label: "Communities", href: "/communities", icon: UsersRound }, ...(community ? [{ label: community.name }] : [])] },
    [community?.name],
  );

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleThread = (id: string, force?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (force === true || (force === undefined && !next.has(id))) next.add(id);
      else next.delete(id);
      return next;
    });

  const refresh = (...paths: string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));
  const failed = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), tone: "bad" });

  const post = useMutation(
    trpc.live.communities.post.mutationOptions({
      onSuccess: (created) => {
        void refresh("live.communities.posts");
        if (created.held) toast({ title: "Held for review", description: "Moderation held your post. The community's moderators look at it before members see it; you can still edit or delete it.", tone: "warn" });
      },
      onError: failed("Not posted"),
    }),
  );
  const write = (body: string, parentPostId?: string) => post.mutateAsync({ communityId, bodyMd: body, parentPostId: parentPostId ?? null, businessId: mayPostAsBusiness && asBusiness ? businessId : null });

  // --- post and member moderation --------------------------------------------------------------------------------------
  const [reporting, setReporting] = useState<PostRow | null>(null);
  const [editing, setEditing] = useState<PostRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const deletePost = useMutation(trpc.live.posts.delete.mutationOptions({ onSuccess: () => void refresh("live.communities.posts"), onError: failed("Not deleted") }));
  const moderatePost = useMutation(trpc.live.posts.moderate.mutationOptions({ onSuccess: () => void refresh("live.communities.posts", "live.communities.moderation", "live.summary"), onError: failed("Not changed") }));
  const moderateMember = useMutation(trpc.live.communities.moderateMember.mutationOptions({ onSuccess: () => void refresh("live.communities.get", "live.communities.moderation"), onError: failed("Not changed") }));
  const setRole = useMutation(trpc.live.communities.setRole.mutationOptions({ onSuccess: () => void refresh("live.communities.get"), onError: failed("Role not changed") }));
  const decline = useMutation(trpc.live.communities.decline.mutationOptions({ onSuccess: () => void refresh("live.communities", "live.summary"), onError: failed("Could not decline") }));

  const moderationWord = { hide: "Hidden", remove: "Removed", restore: "Back in the feed" } as const;
  const postHandlers: PostMenuHandlers = {
    viewerId: viewer.userId,
    canModerate,
    canPost,
    onReport: setReporting,
    onEdit: setEditing,
    onDelete: (p) => deletePost.mutate({ postId: p.id }, { onSuccess: () => toast({ title: "Post deleted", tone: "info" }) }),
    onModerate: (p, action) => moderatePost.mutate({ postId: p.id, action }, { onSuccess: () => toast({ title: moderationWord[action], tone: "info" }) }),
    onConnect: (p) => connect.ask({ userId: p.authorUserId, name: people.name(p.authorUserId) }),
    // Only when a request can go: nobody yet, from a LIVE business the founder speaks for (the member list says why not).
    connectable: (userId) => !connect.blocker && connectStates.stateOf(userId) === "none",
  };
  const memberAction = (userId: string, action: "mute" | "ban" | "restore") =>
    moderateMember.mutate({ communityId, userId, action }, { onSuccess: () => toast({ title: action === "mute" ? `Muted ${people.name(userId)}` : action === "ban" ? `Banned ${people.name(userId)}` : `Restored ${people.name(userId)}`, description: action === "mute" ? "They can read but not post until you restore them." : undefined, tone: "info" }) });

  if (getQ.isLoading) return <div className="grid grid-cols-12 gap-gutter p-gutter"><Panel title="Community" span={12} loading data-testid="community-loading" /></div>;
  if (getQ.error || !community) {
    const code = trpcErrorCode(getQ.error);
    const missing = code === "NOT_FOUND" || code === "BAD_REQUEST";
    return (
      <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="community-screen" data-state="unavailable">
        <Panel
          title="Community"
          span={12}
          error={missing ? undefined : errorMessage(getQ.error)}
          onRetry={() => void getQ.refetch()}
          empty={missing ? { icon: Lock, title: "No such community", children: "It does not exist, or it is private and you are not a member.", action: { label: "All communities", icon: UsersRound, onClick: () => router.push("/communities") } } : undefined}
        />
      </div>
    );
  }

  const visibility = COMMUNITY_VISIBILITY[community.visibility];
  const chips: ProfileChip[] = [{ label: visibility?.label ?? community.visibility, icon: visibility?.icon }];
  const facts: ProfileFact[] = [
    { label: "Members", value: community.memberCount },
    { label: "Started", value: formatDate(community.createdAt) },
  ];
  const role = getQ.data?.role ?? null;
  const invited = getQ.data?.invited === true;
  const joining = membership.pending && membership.pendingId === community.id;
  const stays = leaveBlocker({ role, visibility: community.visibility });
  const memberActions = isMember ? (
    <span className="flex items-center gap-2">
      {canModerate ? (
        <Button size="sm" icon={UserPlus} onClick={() => setInviting(true)} data-testid="community-invite">
          Invite
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" icon={LogOut} loading={joining} disabled={!!stays} title={stays ?? undefined} onClick={() => membership.leave(community.id, community.name)} data-testid="community-leave">
        Leave
      </Button>
    </span>
  ) : invited ? (
    <span className="flex items-center gap-2">
      <Button size="sm" icon={LogIn} loading={joining} onClick={() => membership.join(community.id, community.name)} data-testid="community-join">
        Accept invitation
      </Button>
      <Button size="sm" variant="ghost" icon={X} loading={decline.isPending} onClick={() => decline.mutate({ communityId }, { onSuccess: () => router.push("/communities") })} data-testid="community-decline">
        Decline
      </Button>
    </span>
  ) : (
    <Button size="sm" icon={LogIn} loading={joining} onClick={() => membership.join(community.id, community.name)} data-testid="community-join">
      Join
    </Button>
  );
  const status = isMember ? (
    getQ.data?.status === "muted" ? (
      <StatusPill tone="warn" icon={VolumeX}>Muted</StatusPill>
    ) : (
      <StatusPill tone="good">{COMMUNITY_ROLE_WORD[role ?? "member"] ?? "Member"}</StatusPill>
    )
  ) : invited ? (
    <StatusPill tone="info" icon={MailOpen}>Invited</StatusPill>
  ) : (
    <StatusPill tone="neutral">Not joined</StatusPill>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="community-screen" data-community-id={community.id} data-member={isMember}>
      <ProfileHeader avatar={<Avatar size={64} name={community.name} />} name={community.name} chips={chips} status={status} facts={facts} actions={memberActions} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-gutter p-gutter">
          <PersonalNotice className="col-span-12" />
          <AdultNotice className="col-span-12" />
          <Panel
            title="Feed"
            span={8}
            flush
            loading={isMember && postsQ.isLoading}
            error={postsQ.error ? errorMessage(postsQ.error) : undefined}
            onRetry={() => void postsQ.refetch()}
            empty={!isMember ? { icon: Lock, children: invited ? "You are invited. Accept the invitation to read the feed and post." : "Join this community to read its feed and post.", action: { label: invited ? "Accept invitation" : "Join", icon: LogIn, onClick: () => membership.join(community.id, community.name) } } : undefined}
            actions={isMember ? <span className="text-small tabular-nums text-secondary">{posts.length} {posts.length === 1 ? "post" : "posts"}</span> : undefined}
            footer={postsQ.data?.nextCursor ? `Showing the latest ${FEED_LIMIT} posts.` : undefined}
            data-testid="community-feed"
          >
            <div className="border-b border-subtle p-panel-pad">
              <Composer
                aria-label="Write a post"
                label="Post"
                icon={MessageSquare}
                placeholder="Share something with the community"
                onSubmit={(body) => write(body)}
                disabled={!canPost}
                note={canPost ? `Posting as ${mayPostAsBusiness && asBusiness ? data.business.name : "yourself"}. Posts are screened before members see them. Only you post; an agent can draft, never send.` : "A moderator muted you here: you can read the feed, but not post until they restore you."}
              />
              {mayPostAsBusiness && canPost ? (
                <div className="mt-2 flex items-center gap-2">
                  <Switch id="post-as-business" size="sm" checked={asBusiness} onCheckedChange={setAsBusiness} />
                  <Label htmlFor="post-as-business" className="normal-case tracking-normal text-body text-secondary">
                    Post as {data.business.name}
                  </Label>
                </div>
              ) : null}
            </div>
            {posts.length === 0 && !postsQ.isLoading ? <p className="p-panel-pad text-body text-secondary" data-testid="feed-empty">Nothing posted yet. Start the conversation above.</p> : null}
            <div data-testid="feed-posts">
              {posts.map((p) => (
                <FeedPostItem
                  key={p.id}
                  post={p}
                  people={people}
                  open={open.has(p.id)}
                  onToggle={() => toggleThread(p.id)}
                  onReply={canPost && p.status === "visible" ? () => toggleThread(p.id, true) : undefined}
                  communityId={communityId}
                  onWrite={write}
                  handlers={postHandlers}
                />
              ))}
            </div>
          </Panel>
          <div className="col-span-4 flex min-w-0 flex-col gap-gutter">
            {canModerate ? <ModerationPanel queue={queue} restricted={restricted} loading={queueQ.isLoading} error={queueQ.error ? errorMessage(queueQ.error) : undefined} onRetry={() => void queueQ.refetch()} people={people} onModerate={postHandlers.onModerate} onRestore={(userId) => memberAction(userId, "restore")} /> : null}
            <Panel title="About" data-testid="community-about">
              {community.descriptionMd.trim() ? (
                <Markdown variant="body" images={false} entities={false}>
                  {community.descriptionMd}
                </Markdown>
              ) : (
                <p className="flex items-start gap-2 text-body text-secondary">
                  <Info aria-hidden className="mt-0.5 size-icon-inline shrink-0" />
                  This community has no description yet.
                </p>
              )}
            </Panel>
            <Panel
              title="Members"
              flush
              empty={!isMember ? { icon: Lock, children: "The member list is shown to members." } : members.length === 0 ? { icon: UsersRound, children: "No members yet." } : undefined}
              actions={isMember ? <span className="text-small tabular-nums text-secondary">{members.length}</span> : undefined}
              data-testid="community-members"
            >
              <ul>
                {members.map((m) => {
                  const me = m.userId === viewer.userId;
                  const name = me ? (viewer.displayName ?? "You") : people.name(m.userId);
                  const mayModerate = canModerate && !me && m.role !== "owner" && (isOwner || m.role !== "moderator");
                  return (
                    <li key={m.id} className="flex items-center gap-2 border-b border-subtle/50 px-panel-pad py-1.5 last:border-b-0" data-testid="community-member">
                      <Avatar size={24} name={name} />
                      <span className="t-body-strong min-w-0 flex-1 truncate text-primary">{name}</span>
                      {me ? <Chip tone="neutral">You</Chip> : null}
                      {m.role !== "member" ? <Chip tone="info">{COMMUNITY_ROLE_WORD[m.role]}</Chip> : null}
                      {m.status === "muted" ? <Chip tone="warn" icon={VolumeX}>Muted</Chip> : null}
                      {!me ? <ConnectControl state={connectStates.stateOf(m.userId)} name={name} blocker={connect.blocker} onAsk={() => connect.ask({ userId: m.userId, name })} /> : null}
                      {mayModerate ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`Moderate ${name}`} data-testid="member-menu" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {m.status === "muted" ? (
                              <DropdownMenuItem onSelect={() => memberAction(m.userId, "restore")}>
                                <Icon icon={Check} size="inline" /> Let them post again
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => memberAction(m.userId, "mute")}>
                                <Icon icon={VolumeX} size="inline" /> Mute (reads, cannot post)
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="danger" onSelect={() => memberAction(m.userId, "ban")}>
                              <Icon icon={Ban} size="inline" /> Ban from the community
                            </DropdownMenuItem>
                            {isOwner ? (
                              <>
                                <DropdownMenuSeparator />
                                {m.role === "moderator" ? (
                                  <DropdownMenuItem onSelect={() => setRole.mutate({ communityId, userId: m.userId, role: "member" }, { onSuccess: () => toast({ title: `${name} is a member again`, tone: "info" }) })}>
                                    <Icon icon={ShieldOff} size="inline" /> Make a member
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => setRole.mutate({ communityId, userId: m.userId, role: "moderator" }, { onSuccess: () => toast({ title: `${name} is a moderator`, tone: "good" }) })}>
                                    <Icon icon={ShieldCheck} size="inline" /> Make a moderator
                                  </DropdownMenuItem>
                                )}
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
      <ReportDialog postId={reporting?.id ?? null} authorName={reporting ? people.name(reporting.authorUserId) : ""} onOpenChange={(o) => !o && setReporting(null)} />
      <EditPostDialog post={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <InviteDialog communityId={communityId} communityName={community.name} memberIds={members.map((m) => m.userId)} open={inviting} onOpenChange={setInviting} />
      {connect.dialog}
    </div>
  );
}

/** For owners and moderators: posts waiting for a decision (held, hidden or reported) and members who are muted or banned. */
function ModerationPanel({
  queue,
  restricted,
  loading,
  error,
  onRetry,
  people,
  onModerate,
  onRestore,
}: {
  queue: readonly QueueItem[];
  restricted: readonly { userId: string; status: string; name: string | null }[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  people: People;
  onModerate: (post: Pick<PostRow, "id">, action: "hide" | "remove" | "restore") => void;
  onRestore: (userId: string) => void;
}) {
  const datePrefs = useDateFormat();
  return (
    <Panel
      title="To review"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={queue.length ? <StatusPill tone="warn" icon={Clock}>{queue.length} waiting</StatusPill> : undefined}
      empty={!loading && !error && queue.length === 0 && restricted.length === 0 ? { icon: ShieldCheck, children: "Nothing to review. Held and reported posts appear here." } : undefined}
      footer="Posts are screened by moderation before members see them; you decide on what it holds and what members report."
      data-testid="moderation-panel"
    >
      {queue.map((q) => (
        <FeedPost
          key={q.post.id}
          author={q.post.authorName ?? people.name(q.post.authorUserId)}
          at={q.post.createdAt}
          datePrefs={datePrefs}
          status={
            <>
              <PostStatus post={q.post} />
              {q.openReports ? <Chip tone="bad" icon={Flag}>{q.openReports === 1 ? "1 report" : `${q.openReports} reports`}</Chip> : null}
            </>
          }
          data-testid="moderation-item"
        >
          <PostText>{q.post.bodyMd}</PostText>
          {q.reasons.length ? <p className="mt-1 text-small text-secondary">Reported for: {q.reasons.map(reportReasonLabel).join(", ").toLowerCase()}</p> : null}
          {q.post.screening?.decision === "hold" && q.post.screening.flags.length ? <p className="mt-1 text-small text-secondary">Held by moderation: {q.post.screening.flags.join(", ").replace(/_/g, " ")}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" icon={ShieldCheck} onClick={() => onModerate(q.post, "restore")}>
              {q.post.status === "visible" ? "Keep it" : q.post.status === "hidden" ? "Restore" : "Approve"}
            </Button>
            {q.post.status !== "hidden" ? (
              <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => onModerate(q.post, "hide")}>
                Hide
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onModerate(q.post, "remove")}>
              Remove
            </Button>
          </div>
        </FeedPost>
      ))}
      {restricted.length ? (
        <ul className="border-t border-subtle">
          {restricted.map((m) => {
            const name = m.name ?? people.name(m.userId);
            return (
              <li key={m.userId} className="flex items-center gap-2 px-panel-pad py-1.5" data-testid="restricted-member">
                <Avatar size={24} name={name} />
                <span className="t-body-strong min-w-0 flex-1 truncate text-primary">{name}</span>
                <Chip tone={m.status === "banned" ? "bad" : "warn"}>{m.status === "banned" ? "Banned" : "Muted"}</Chip>
                <Button size="sm" variant="ghost" onClick={() => onRestore(m.userId)}>
                  {m.status === "banned" ? "Lift ban" : "Restore"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Panel>
  );
}

function FeedPostItem({ post, people, open, onToggle, onReply, communityId, onWrite, handlers }: { post: PostRow; people: People; open: boolean; onToggle: () => void; onReply?: () => void; communityId: string; onWrite: (body: string, parentPostId?: string) => Promise<unknown>; handlers: PostMenuHandlers }) {
  const datePrefs = useDateFormat();
  const author = people.name(post.authorUserId);
  return (
    <FeedPost
      author={author}
      badge={<BusinessBadge people={people} businessId={post.businessId} />}
      status={<PostStatus post={post} />}
      actions={<PostMenu post={post} handlers={handlers} authorName={author} />}
      at={post.createdAt}
      datePrefs={datePrefs}
      replyCount={post.replyCount}
      repliesOpen={open}
      onToggleReplies={post.status === "visible" ? onToggle : undefined}
      onReply={onReply}
      thread={open ? <ReplyThread communityId={communityId} parentId={post.id} onWrite={onWrite} handlers={handlers} canReply={!!onReply} /> : undefined}
      data-testid="feed-post"
      data-post-id={post.id}
      data-status={post.status}
    >
      <PostText>{post.bodyMd}</PostText>
    </FeedPost>
  );
}

/** The replies under one post, oldest first, and a box to add one. */
function ReplyThread({ communityId, parentId, onWrite, handlers, canReply }: { communityId: string; parentId: string; onWrite: (body: string, parentPostId?: string) => Promise<unknown>; handlers: PostMenuHandlers; canReply: boolean }) {
  const datePrefs = useDateFormat();
  const trpc = useTRPC();
  const q = useQuery(trpc.live.communities.posts.queryOptions({ communityId, parentPostId: parentId, limit: 100 }, { staleTime: 10_000, retry: false }));
  const replies = useMemo(() => [...(q.data?.items ?? [])].reverse(), [q.data]);
  const people = usePeople(
    useMemo(() => replies.map((r) => r.authorUserId), [replies]),
    useMemo(() => replies.flatMap((r) => (r.businessId ? [r.businessId] : [])), [replies]),
  );
  return (
    <div className="flex flex-col" data-testid="reply-thread">
      {q.isLoading ? <p className="px-panel-pad py-2 text-small text-secondary">Loading replies…</p> : null}
      {q.error ? <p className="px-panel-pad py-2 text-small text-status-bad" role="alert">{errorMessage(q.error)}</p> : null}
      {replies.map((r) => {
        const author = people.name(r.authorUserId);
        return (
          <FeedPost key={r.id} author={author} badge={<BusinessBadge people={people} businessId={r.businessId} />} status={<PostStatus post={r} />} actions={<PostMenu post={r} handlers={handlers} authorName={author} />} at={r.createdAt} datePrefs={datePrefs} data-testid="feed-reply">
            <PostText>{r.bodyMd}</PostText>
          </FeedPost>
        );
      })}
      {!q.isLoading && replies.length === 0 && !q.error ? <p className="px-panel-pad py-2 text-small text-secondary">No replies yet.</p> : null}
      {canReply ? (
        <div className="px-panel-pad py-2">
          <Composer aria-label="Write a reply" label="Reply" rows={2} placeholder="Write a reply" onSubmit={(body) => onWrite(body, parentId)} />
        </div>
      ) : null}
    </div>
  );
}
