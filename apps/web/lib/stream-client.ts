"use client";
/**
 * The tab's single StreamClient (docs/ARCHITECTURE.md §12: one WebSocket per tab) plus React hooks. The token comes
 * from the Supabase browser session, or the dev token under the development bypass.
 *
 * Freshness follows each business's channel (lib/stream-status.ts). When `ev:<businessId>` comes back after a gap (a
 * reconnect, a silent socket replaced, a refusal retried, a return to the business) its queries are refetched, since
 * the stream does not replay what it sent meanwhile. A tab that becomes visible again, or a browser back online, has
 * the connection checked at once instead of at the next heartbeat.
 */
import { useEffect, useRef } from "react";
import { devBearerToken } from "@/lib/auth/dev-as";
import { publicEnv } from "@/lib/env";
import { getQueryClient, resyncBusiness } from "@/lib/query-client";
import { businessIdOfChannel, createStreamClient, type StreamClient, type StreamHandler } from "@/lib/stream";
import { clearChannelLiveness, setChannelLive, setStreamStatus } from "@/lib/stream-status";
import { getBrowserAccessToken } from "@/lib/supabase/client";

let client: StreamClient | null = null;
let watchingPage = false;

/** A channel became live or stopped being live: record it, and refetch a business that comes back after a gap. */
export function onStreamChannel(channel: string, live: boolean, detail: { resync: boolean }): void {
  setChannelLive(channel, live);
  const businessId = live && detail.resync ? businessIdOfChannel(channel) : null;
  if (businessId) void resyncBusiness(getQueryClient(), businessId);
}

function watchPage(): void {
  if (watchingPage || typeof document === "undefined") return;
  watchingPage = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") client?.checkConnection();
  });
  window.addEventListener("online", () => client?.checkConnection());
}

export function getStreamClient(): StreamClient {
  if (client) return client;
  client = createStreamClient({
    url: publicEnv().streamUrl,
    getToken: async () => (await getBrowserAccessToken()) ?? (devBearerToken() ?? ""),
    onError: (err) => {
      // Refusals that can heal are asked again by the client; the channel is not live (so the shell polls) until then.
      console.warn("[stream]", err.code, err.message, err.ch ?? "");
    },
    onStatus: (status) => setStreamStatus(status),
    onChannel: onStreamChannel,
  });
  watchPage();
  return client;
}

/** Test hook: replace the singleton. */
export function setStreamClient(next: StreamClient | null): void {
  client = next;
  setStreamStatus(next?.state ?? "idle");
  clearChannelLiveness();
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
