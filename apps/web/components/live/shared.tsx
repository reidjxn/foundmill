"use client";
/** Small pieces the three LIVE screens share: the Personal-mode notice, the people lookup and the business logo. */
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useMemo } from "react";
import { Avatar, Crest, StatusPill, cn } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
import { monogram } from "@/lib/format";
import { UNNAMED_PERSON } from "@/lib/live";
import { useTRPC } from "@/lib/trpc-react";
import type { RouterOutputs } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";
import { ShellLinkButton } from "./ShellLinkButton";

export type PeopleLookup = RouterOutputs["live"]["people"]["lookup"];
export type PersonCard = PeopleLookup["users"][number];
export type BusinessCard = PeopleLookup["businesses"][number];

export interface People {
  person: (userId: string) => PersonCard | undefined;
  business: (businessId: string) => BusinessCard | undefined;
  /** The name to show for a user id: their display name, or "A founder" when their profile keeps it back. */
  name: (userId: string) => string;
  loading: boolean;
}

/**
 * Names for the ids a screen shows, one `live.people.lookup` call for all of them (the API applies each person's
 * profile visibility). Ids are sorted and de-duplicated so the same set always hits the same cache entry.
 */
export function usePeople(userIds: readonly string[], businessIds: readonly string[] = []): People {
  const trpc = useTRPC();
  const users = useMemo(() => [...new Set(userIds)].sort(), [userIds]);
  const businesses = useMemo(() => [...new Set(businessIds)].sort(), [businessIds]);
  const enabled = users.length + businesses.length > 0;
  const q = useQuery(trpc.live.people.lookup.queryOptions({ userIds: users, businessIds: businesses }, { enabled, staleTime: 60_000, placeholderData: (previous) => previous }));
  return useMemo(() => {
    const persons = new Map((q.data?.users ?? []).map((u) => [u.userId, u]));
    const cards = new Map((q.data?.businesses ?? []).map((b) => [b.businessId, b]));
    return { person: (id) => persons.get(id), business: (id) => cards.get(id), name: (id) => persons.get(id)?.displayName?.trim() || UNNAMED_PERSON, loading: enabled && q.isLoading };
  }, [q.data, q.isLoading, enabled]);
}

/** A business's logo from its public card; initials when the card has no brand colours or is not visible. */
export function BusinessLogo({ card, name, size = 20 }: { card?: BusinessCard; name: string; size?: 20 | 32 | 48 }) {
  if (!card?.kitPrimary || !card.kitSecondary || !name.trim()) return <Avatar size={size} name={name || "Business"} />;
  return <Crest seed={card.slug || card.businessId} kitPrimary={card.kitPrimary} kitSecondary={card.kitSecondary} monogram={monogram(name)} size={size} title={`${name} logo`} />;
}

/**
 * Shown above a LIVE screen while the current business is Personal: the screen still works for the founder
 * (connections, messages and communities belong to the person), but the business itself is off the network and boards.
 */
export function PersonalNotice({ className }: { className?: string }) {
  const { businessId, data } = useBusiness();
  if (data.business.gameMode === "live") return null;
  return (
    <div className={cn("surface-panel flex items-center gap-3 px-panel-pad py-2", className)} data-testid="personal-notice">
      <StatusPill tone="info" icon={Lock}>
        Personal
      </StatusPill>
      <p className="min-w-0 flex-1 text-body text-secondary">
        {data.business.name} is a Personal business, so it is not listed on the network or on leaderboards. Your own connections, messages and communities stay available.
      </p>
      <ShellLinkButton href={routes.settings(businessId, "mode")} size="sm">
        Open Settings › Mode
      </ShellLinkButton>
    </div>
  );
}

