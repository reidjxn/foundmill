/** What the Communities screens share: the join and leave mutations, and how a community's visibility and role read. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, UserCheck, Users, type LucideIcon } from "lucide-react";
import { useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export const COMMUNITY_VISIBILITY: Record<string, { label: string; icon: LucideIcon }> = {
  public: { label: "Public", icon: Globe },
  connections: { label: "Connections", icon: UserCheck },
  community: { label: "Community", icon: Users },
  private: { label: "Private", icon: Lock },
};

export const COMMUNITY_ROLE_WORD: Record<string, string> = { owner: "Owner", moderator: "Moderator", member: "Member" };

/**
 * Join and leave with the right side effects: queries refresh, a toast says what happened. A person joins as themselves;
 * speaking as a business is a separate choice made when posting (and the API only allows it for a LIVE business the
 * person may write for).
 */
export function useCommunityMembership() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: trpcPathPrefix("live.communities") as unknown[] });
  // The feed is for members. After leaving, the community reads as not joined and its cached posts go before the
  // refresh: otherwise the refresh asks for the feed again while the community still reads as joined, and the API's
  // "Join the community to read its feed" stays on the screen as an error instead of the join prompt.
  const dropFeed = (communityId: string) => {
    const forCommunity = (q: { queryKey: readonly unknown[] }) => (q.queryKey[1] as { input?: { communityId?: string } } | undefined)?.input?.communityId === communityId;
    qc.setQueriesData<{ isMember?: boolean; role?: unknown }>({ queryKey: trpcPathPrefix("live.communities.get") as unknown[], predicate: forCommunity }, (prev) => (prev ? { ...prev, isMember: false, role: null } : prev));
    qc.removeQueries({ queryKey: trpcPathPrefix("live.communities.posts") as unknown[], predicate: forCommunity });
  };
  const join = useMutation(trpc.live.communities.join.mutationOptions({ onSuccess: () => void refresh(), onError: (err) => toast({ title: "Could not join", description: errorMessage(err), tone: "bad" }) }));
  const leave = useMutation(
    trpc.live.communities.leave.mutationOptions({
      onSuccess: (_data, vars) => {
        dropFeed(vars.communityId);
        void refresh();
      },
      onError: (err) => toast({ title: "Could not leave", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return {
    pending: join.isPending || leave.isPending,
    pendingId: join.isPending ? join.variables?.communityId : leave.isPending ? leave.variables?.communityId : undefined,
    join: (communityId: string, name: string) => join.mutate({ communityId }, { onSuccess: () => toast({ title: `Joined ${name}`, tone: "good" }) }),
    leave: (communityId: string, name: string) => leave.mutate({ communityId }, { onSuccess: () => toast({ title: `Left ${name}`, tone: "info" }) }),
  };
}
