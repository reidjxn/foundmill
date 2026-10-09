"use client";
/**
 * The tab's single StreamClient (docs/ARCHITECTURE.md §12: one WebSocket per tab) plus React hooks. The token comes
 * from the Supabase browser session, or the dev token under the development bypass.
 */
import { useEffect, useRef } from "react";
import { DEV_BEARER_TOKEN } from "@/lib/auth/constants";
import { isDevLike, publicEnv } from "@/lib/env";
import { createStreamClient, type StreamClient, type StreamHandler } from "@/lib/stream";
import { setStreamStatus } from "@/lib/stream-status";
import { getBrowserAccessToken } from "@/lib/supabase/client";

let client: StreamClient | null = null;

export function getStreamClient(): StreamClient {
  if (client) return client;
  client = createStreamClient({
    url: publicEnv().streamUrl,
    getToken: async () => (await getBrowserAccessToken()) ?? (isDevLike() ? DEV_BEARER_TOKEN : ""),
    onError: (err) => {
      if (err.code !== "unavailable") console.warn("[stream]", err.code, err.message, err.ch ?? "");
    },
    // Connected or not decides whether the shell polls (lib/stream-status.ts).
    onStatus: (status) => setStreamStatus(status),
  });
  return client;
}

/** Test hook: replace the singleton. */
export function setStreamClient(next: StreamClient | null): void {
  client = next;
  setStreamStatus(next?.state ?? "idle");
}

/**
 * Subscribe for the lifetime of the component. The handler always sees the latest closure; the subscription is
 * renewed only when the channel or focus changes.
 */
export function useStreamSubscription(channel: string | null | undefined, handler: StreamHandler, options: { focused?: boolean; enabled?: boolean } = {}): void {
  const latest = useRef(handler);
  latest.current = handler;
  const focused = options.focused ?? true;
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!channel || !enabled) return;
    const stream = getStreamClient();
    const off = stream.subscribe(channel, (e) => latest.current(e), { focused });
    return off;
  }, [channel, focused, enabled]);
}
