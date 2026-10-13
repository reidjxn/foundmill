"use client";
/**
 * Community feed widget (LIVE only, BUILD §11.14): recent posts from one community the founder belongs to.
 */
import { useMemo } from "react";
import { z } from "zod";
import { MessageCircle, Users } from "lucide-react";
import { Button, EmptyState, Timeline, type TimelineEvent } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { CommunityPostRow, CommunityRow, Page } from "../shared/types";

export const CommunityFeedSettings = z.object({
  communityId: z.string().nullable().default(null),
  rows: z.number().int().min(3).max(30).default(8),
});
export type CommunityFeedSettings = z.infer<typeof CommunityFeedSettings>;

/** The community to show: the chosen one, else the first the founder belongs to (the feed is for members). */
export function pickCommunity(communities: readonly CommunityRow[] | undefined, communityId: string | null): CommunityRow | undefined {
  const joined = (communities ?? []).filter((c) => c.role !== null);
  return (communityId ? joined.find((c) => c.id === communityId) : undefined) ?? joined[0];
}

export function postPreview(bodyMd: string, max = 140): string {
  const plain = bodyMd.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** The feed as a timeline. The founder's own post that moderation holds says so (only they see it in the feed). */
export function postsToTimeline(posts: readonly CommunityPostRow[]): TimelineEvent[] {
  return posts.map((p) => ({
    id: p.id,
    at: p.createdAt,
    title: p.authorName ?? "A member",
    description: postPreview(p.bodyMd),
    icon: MessageCircle,
    tone: p.status === "pending_review" ? ("warn" as const) : ("neutral" as const),
    ...(p.status === "pending_review" ? { statusWord: "Held for review" } : {}),
    actor: { name: p.authorName ?? "Member" },
    children: p.replyCount ? <span className="text-small text-secondary">{p.replyCount} replies</span> : undefined,
  }));
}

function CommunityFeedWidget({ settings }: WidgetProps<CommunityFeedSettings>) {
  const { navigate, gameMode = "personal" } = useWidgetData();
  const live = gameMode === "live";
  const communities = useWidgetQuery<CommunityRow[]>("live.communities.list", { limit: 50 }, { enabled: live });
  const community = useMemo(() => pickCommunity(communities.data, settings.communityId), [communities.data, settings.communityId]);
  const posts = useWidgetQuery<Page<CommunityPostRow>>("live.communities.posts", { communityId: community?.id, limit: settings.rows }, { enabled: live && !!community });
  const events = useMemo(() => postsToTimeline(posts.data?.items ?? []), [posts.data]);
  if (!live) {
    return (
      <WidgetFrame title="Community" data-widget="community_feed">
        <EmptyState icon={Users} className="py-4">
          Communities open once the business is live. Make it live in Settings to join one.
        </EmptyState>
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame
      title={community ? `Community · ${community.name}` : "Community"}
      data-widget="community_feed"
      queries={community ? [communities, posts] : [communities]}
      empty={communities.data && !community ? { icon: Users, text: "Join a community to see its posts here.", action: { label: "Browse communities", onClick: () => navigate("/communities") } } : posts.data && events.length === 0 ? { icon: MessageCircle, text: "No posts yet. Be the first to say hello." } : null}
      actions={community ? <Button size="sm" variant="ghost" className="px-1.5" onClick={() => navigate(routes.community(community.id))}>Open</Button> : null}
      footer={community?.memberCount ? <span>{community.memberCount} members</span> : undefined}
    >
      <Timeline events={events} order="desc" emptyText="No posts." />
    </WidgetFrame>
  );
}

export const communityFeedWidget = registerWidget<CommunityFeedSettings>({
  key: "community_feed",
  title: "Community feed",
  description: "Recent posts from one of your communities (live businesses).",
  icon: "users",
  surfaces: ["home"],
  defaultSize: { w: 4, h: 12, minW: 3, minH: 8 },
  settingsSchema: CommunityFeedSettings,
  defaultSettings: CommunityFeedSettings.parse({}),
  liveOnly: true,
  Component: CommunityFeedWidget,
});
