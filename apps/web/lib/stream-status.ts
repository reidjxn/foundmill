/**
 * What the tab's event stream (apps/stream, one WebSocket per tab) keeps current, readable outside React (query
 * defaults in lib/query-client.ts) and as hooks. Liveness is per business: `ev:<businessId>` is live from the moment
 * the server acknowledges the subscription until the socket drops, the server refuses it or the tab leaves the
 * business. While a business's channel is live the shell refetches what each event changes (BusinessShell
 * `INVALIDATE_ON_EVENT`), so its stream-kept queries stay fresh longer and polling slows to a safety net; while it is
 * not, the shell polls. An open socket says nothing about a business whose channel it does not carry.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { businessChannel, type StreamStatus } from "./stream";

/** Polling while a business's channel is live: a safety net for changes that publish no event. */
export const SAFETY_POLL_MS = 60_000;

let status: StreamStatus = "idle";
/** Live channels → when they became live (this tab's clock). */
const liveSince = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** The socket's state (diagnostics; freshness follows the channels, below). */
export function setStreamStatus(next: StreamStatus): void {
  if (next === status) return;
  status = next;
  notify();
}

export function streamStatus(): StreamStatus {
  return status;
}

export function isStreamOpen(): boolean {
  return status === "open";
}

/** A channel became live (acknowledged by the server) or stopped being live. */
export function setChannelLive(channel: string, live: boolean, at: number = Date.now()): void {
  if (live === liveSince.has(channel)) return;
  if (live) liveSince.set(channel, at);
  else liveSince.delete(channel);
  notify();
}

/** Forget every channel (a replaced stream client). */
export function clearChannelLiveness(): void {
  if (liveSince.size === 0) return;
  liveSince.clear();
  notify();
}

/** When the business's channel became live, or null while it is not live. */
export function businessLiveSince(businessId: string): number | null {
  return liveSince.get(businessChannel(businessId)) ?? null;
}

export function isBusinessLive(businessId: string): boolean {
  return liveSince.has(businessChannel(businessId));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the channel (`ev:<businessId>`, `u:<userId>`) is live. */
export function isChannelLive(channel: string): boolean {
  return liveSince.has(channel);
}

/** True while the channel is live; re-renders when that changes. False on the server and for no channel. */
export function useChannelLive(channel: string | null): boolean {
  const read = useCallback(() => (channel ? isChannelLive(channel) : false), [channel]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** True while the business's event channel is live; re-renders when that changes. False on the server. */
export function useBusinessLive(businessId: string): boolean {
  const read = useCallback(() => isBusinessLive(businessId), [businessId]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** The socket's state, re-rendering when it changes. "idle" on the server. */
export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(subscribe, streamStatus, () => "idle");
}

/** How long a business's channel may be down before the shell says so: a blip never flashes a chip. */
export const CONNECTION_GRACE_MS = 3_000;
/**
 * With Builder view off (founder, 2026-11-08): only an outage longer than this shows anything, and then only the quiet
 * "Updates may be late" chip; a short reconnect shows nothing.
 */
export const LATE_NOTICE_MS = 30_000;
export type ConnectionNoticeState = "reconnecting" | "paused";

/**
 * What the top bar says about the live connection (audit RES-11): nothing while the business's channel is live or
 * within the grace after it dropped; "reconnecting" while the socket is trying again; "paused" when it is not (closed,
 * or the server refused the channel).
 */
export function connectionNotice(input: { live: boolean; status: StreamStatus; downForMs: number }, graceMs: number = CONNECTION_GRACE_MS): ConnectionNoticeState | null {
  if (input.live || input.downForMs < graceMs) return null;
  return input.status === "connecting" || input.status === "reconnecting" ? "reconnecting" : "paused";
}

/** The connection notice for a business, re-evaluated when the channel or the socket changes and once the grace runs out. */
export function useConnectionNotice(businessId: string, graceMs: number = CONNECTION_GRACE_MS): ConnectionNoticeState | null {
  const live = useBusinessLive(businessId);
  const status = useStreamStatus();
  const [downSince, setDownSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (live) {
      setDownSince(null);
      return;
    }
    const since = Date.now();
    setDownSince(since);
    setNow(since);
    const t = window.setTimeout(() => setNow(Date.now()), graceMs);
    return () => window.clearTimeout(t);
  }, [live, businessId, graceMs]);
  if (live || downSince === null) return null;
  return connectionNotice({ live, status, downForMs: now - downSince }, graceMs);
}

/**
 * How often to poll something the stream also keeps current: `everyMs` while its channel (the business's, or the
 * person's own `u:<userId>`) is not live, and a slow safety net (`SAFETY_POLL_MS`) while it is, for changes that publish no event and for a link that stalls.
 */
export function streamPollInterval(live: boolean, everyMs: number, safetyMs: number = SAFETY_POLL_MS): number {
  return live ? Math.max(everyMs, safetyMs) : everyMs;
}
