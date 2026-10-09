/** What the Communities screens share: the join and leave mutations, and how a community's visibility and role read. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, UserCheck, Users, type LucideIcon } from "lucide-react";
import { useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";

export const COMMUNITY_VISIBILITY: Record<string, { label: string; icon: LucideIcon }> = {
  public: { label: "Public", icon: Globe },
  connections: { label: "Connections", icon: UserCheck },
  community: { label: "Community", icon: Users },
  private: { label: "Private", icon: Lock },
};

export const COMMUNITY_ROLE_WORD: Record<string, string> = { owner: "Owner", moderator: "Moderator", member: "Member" };

/**
 * Join and leave with the right side effects: queries refresh, a toast says what happened. A LIVE current business
 * joins as that business, so its posts carry its name; a Personal one joins as the founder alone.
 */
export function useCommunityMembership() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { businessId, data } = useBusiness();
  const live = data.business.gameMode === "live";
  const refresh = () => qc.invalidateQueries({ queryKey: trpcPathPrefix("live.communities") as unknown[] });
  const join = useMutation(trpc.live.communities.join.mutationOptions({ onSuccess: () => void refresh(), onError: (err) => toast({ title: "Could not join", description: errorMessage(err), tone: "bad" }) }));
  const leave = useMutation(trpc.live.communities.leave.mutationOptions({ onSuccess: () => void refresh(), onError: (err) => toast({ title: "Could not leave", description: errorMessage(err), tone: "bad" }) }));
  return {
    pending: join.isPending || leave.isPending,
    pendingId: join.isPending ? join.variables?.communityId : leave.isPending ? leave.variables?.communityId : undefined,
    join: (communityId: string, name: string) => join.mutate({ communityId, businessId: live ? businessId : undefined }, { onSuccess: () => toast({ title: `Joined ${name}`, tone: "good" }) }),
    leave: (communityId: string, name: string) => leave.mutate({ communityId }, { onSuccess: () => toast({ title: `Left ${name}`, tone: "info" }) }),
  };
}
