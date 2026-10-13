"use client";
/**
 * /communities/[id] (BUILD §6.2, §11.14): one community. A profile header with Join or Leave, the feed (posts, each with
 * its replies on demand) with a post box, and the member list. The feed is for members: a visitor sees the description
 * and the size and is asked to join. Post text is written by other people, so it is rendered without images and with
 * entity linking off (an `[[ent:…]]` in a post names something in the author's business, not the reader's). A post is
 * the person's own unless they choose to post as the business, a choice offered only when they may (`canSpeakAsBusiness`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Info, LogIn, LogOut, Lock, MessageSquare, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar, Button, Chip, Composer, FeedPost, Label, Markdown, Panel, ProfileHeader, StatusPill, Switch, useToast, useFormatters, useDateFormat, type ProfileChip, type ProfileFact } from "@foundmill/dugout";
import { canSpeakAsBusiness } from "@/lib/live";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { COMMUNITY_ROLE_WORD, COMMUNITY_VISIBILITY, useCommunityMembership } from "./communities";
import { PersonalNotice, usePeople, type People } from "./shared";
import { useLiveViewer } from "./viewer";

type PostRow = RouterOutputs["live"]["communities"]["posts"]["items"][number];

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

  const getQ = useQuery(trpc.live.communities.get.queryOptions({ communityId }, { retry: false, staleTime: 10_000 }));
  const community = getQ.data?.community;
  const isMember = getQ.data?.isMember === true;
  const postsQ = useQuery(trpc.live.communities.posts.queryOptions({ communityId, limit: FEED_LIMIT }, { enabled: isMember, staleTime: 10_000, refetchInterval: 30_000, retry: false }));
  const posts = useMemo(() => postsQ.data?.items ?? [], [postsQ.data]);
  const members = useMemo(() => getQ.data?.members ?? [], [getQ.data]);

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

  const post = useMutation(
    trpc.live.communities.post.mutationOptions({
      onSuccess: () => void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.communities.posts") as unknown[] }),
      onError: (err) => toast({ title: "Not posted", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const write = (body: string, parentPostId?: string) => post.mutateAsync({ communityId, bodyMd: body, parentPostId: parentPostId ?? null, businessId: mayPostAsBusiness && asBusiness ? businessId : null });
  // Posts and replies go out under the same choice, so both boxes say who they post as.
  const postingAs = mayPostAsBusiness && asBusiness ? data.business.name : "yourself";

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
  const joining = membership.pending && membership.pendingId === community.id;
  const memberActions = isMember ? (
    <Button size="sm" variant="ghost" icon={LogOut} loading={joining} onClick={() => membership.leave(community.id, community.name)} data-testid="community-leave">
      Leave
    </Button>
  ) : (
    <Button size="sm" icon={LogIn} loading={joining} onClick={() => membership.join(community.id, community.name)} data-testid="community-join">
      Join
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="community-screen" data-community-id={community.id} data-member={isMember}>
      <ProfileHeader
        avatar={<Avatar size={64} name={community.name} />}
        name={community.name}
        chips={chips}
        status={isMember ? <StatusPill tone="good">{COMMUNITY_ROLE_WORD[role ?? "member"] ?? "Member"}</StatusPill> : <StatusPill tone="neutral">Not joined</StatusPill>}
        facts={facts}
        actions={memberActions}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-gutter p-gutter">
          <PersonalNotice className="col-span-12" />
          <Panel
            title="Feed"
            span={8}
            flush
            loading={isMember && postsQ.isLoading}
            // A feed error belongs to a member's view only: a visitor (or someone who just left) sees the join prompt.
            error={isMember && postsQ.error ? errorMessage(postsQ.error) : undefined}
            onRetry={() => void postsQ.refetch()}
            empty={!isMember ? { icon: Lock, children: "Join this community to read its feed and post.", action: { label: "Join", icon: LogIn, onClick: () => membership.join(community.id, community.name) } } : undefined}
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
                note={`Posting as ${postingAs}. Only you post; an agent can draft, never send.`}
              />
              {mayPostAsBusiness ? (
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
                  onReply={() => toggleThread(p.id, true)}
                  communityId={communityId}
                  onWrite={write}
                  postingAs={postingAs}
                />
              ))}
            </div>
          </Panel>
          <div className="col-span-4 flex min-w-0 flex-col gap-gutter">
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
                  const name = m.userId === viewer.userId ? (viewer.displayName ?? "You") : people.name(m.userId);
                  return (
                    <li key={m.id} className="flex items-center gap-2 border-b border-subtle/50 px-panel-pad py-1.5 last:border-b-0">
                      <Avatar size={24} name={name} />
                      <span className="t-body-strong min-w-0 flex-1 truncate text-primary">{name}</span>
                      {m.userId === viewer.userId ? <Chip tone="neutral">You</Chip> : null}
                      {m.role !== "member" ? <Chip tone="info">{COMMUNITY_ROLE_WORD[m.role]}</Chip> : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedPostItem({ post, people, open, onToggle, onReply, communityId, onWrite, postingAs }: { post: PostRow; people: People; open: boolean; onToggle: () => void; onReply: () => void; communityId: string; onWrite: (body: string, parentPostId?: string) => Promise<unknown>; postingAs: string }) {
  const datePrefs = useDateFormat();
  return (
    <FeedPost
      author={people.name(post.authorUserId)}
      badge={<BusinessBadge people={people} businessId={post.businessId} />}
      at={post.createdAt}
      datePrefs={datePrefs}
      replyCount={post.replyCount}
      repliesOpen={open}
      onToggleReplies={onToggle}
      onReply={onReply}
      thread={open ? <ReplyThread communityId={communityId} parentId={post.id} onWrite={onWrite} postingAs={postingAs} /> : undefined}
      data-testid="feed-post"
      data-post-id={post.id}
    >
      <PostText>{post.bodyMd}</PostText>
    </FeedPost>
  );
}

/** The replies under one post, oldest first, and a box to add one (saying who the reply goes out as). */
function ReplyThread({ communityId, parentId, onWrite, postingAs }: { communityId: string; parentId: string; onWrite: (body: string, parentPostId?: string) => Promise<unknown>; postingAs: string }) {
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
      {replies.map((r) => (
        <FeedPost key={r.id} author={people.name(r.authorUserId)} badge={<BusinessBadge people={people} businessId={r.businessId} />} at={r.createdAt} datePrefs={datePrefs} data-testid="feed-reply">
          <PostText>{r.bodyMd}</PostText>
        </FeedPost>
      ))}
      {!q.isLoading && replies.length === 0 && !q.error ? <p className="px-panel-pad py-2 text-small text-secondary">No replies yet.</p> : null}
      <div className="px-panel-pad py-2">
        <Composer aria-label="Write a reply" label="Reply" rows={2} placeholder="Write a reply" onSubmit={(body) => onWrite(body, parentId)} note={`Replying as ${postingAs}.`} />
      </div>
    </div>
  );
}
