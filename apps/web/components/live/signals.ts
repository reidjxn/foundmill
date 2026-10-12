"use client";
/**
 * The founder's LIVE badge in the shell, in every business and mode (audit #65): `live.summary` (unread messages,
 * requests and invitations waiting, posts to moderate), kept current by the founder's own stream channel `u:<userId>`.
 * A signal there (a request, a message, an invitation or a moderation change reached them) carries no content; it
 * refetches the `live` router's queries, so the badge, Network and the community pages show what arrived. Polling is the
 * safety net while the stream is not connected.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useStreamSubscription } from "@/lib/stream-client";
import { pollUnlessStreaming, useStreamOpen } from "@/lib/stream-status";
import { trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

const POLL_WITHOUT_STREAM_MS = 30_000;

/** The person's own stream channel (apps/stream lets only them subscribe). */
export const userChannel = (userId: string) => `u:${userId}`;

/** True for a LIVE signal frame (`{ type: "live.signal", kind, … }`); anything else on the channel is ignored. */
export function isLiveSignal(raw: unknown): raw is { type: "live.signal"; kind: string; threadId?: string; communityId?: string } {
  return typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "live.signal" && typeof (raw as { kind?: unknown }).kind === "string";
}

export interface NetworkBadge {
  /** Unread messages + requests + invitations: the Network item's badge. */
  total: number;
  /** Posts waiting for the founder in communities they moderate: the Communities item's badge. */
  moderation: number;
}

export function useNetworkBadge(userId: string | null): NetworkBadge {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const streamOpen = useStreamOpen();
  const summaryQ = useQuery(trpc.live.summary.queryOptions(undefined, { staleTime: 10_000, refetchInterval: pollUnlessStreaming(streamOpen, POLL_WITHOUT_STREAM_MS), retry: false }));
  const onSignal = useCallback(
    (raw: unknown) => {
      if (isLiveSignal(raw)) void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("live") as unknown[] });
    },
    [queryClient],
  );
  useStreamSubscription(userId ? userChannel(userId) : null, onSignal);
  const total = summaryQ.data?.total ?? 0;
  const moderation = summaryQ.data?.moderation ?? 0;
  return useMemo(() => ({ total, moderation }), [total, moderation]);
}
