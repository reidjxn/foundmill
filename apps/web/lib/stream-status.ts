/**
 * Whether the tab's event stream (apps/stream, one WebSocket per tab) is connected, readable outside React (query
 * defaults in lib/query-client.ts) and as a hook. While it is open the shell refetches what each event changes
 * (BusinessShell `INVALIDATE_ON_EVENT`), so polling stops and stream-kept queries stay fresh longer; while it is not,
 * the shell falls back to polling.
 */
import { useSyncExternalStore } from "react";
import type { StreamStatus } from "./stream";

let status: StreamStatus = "idle";
const listeners = new Set<() => void>();

export function setStreamStatus(next: StreamStatus): void {
  if (next === status) return;
  status = next;
  for (const l of listeners) l();
}

export function streamStatus(): StreamStatus {
  return status;
}

export function isStreamOpen(): boolean {
  return status === "open";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the stream is connected; re-renders when that changes. False on the server. */
export function useStreamOpen(): boolean {
  return useSyncExternalStore(subscribe, isStreamOpen, () => false);
}

/** How often to poll something the stream also keeps current: never while it is open, `everyMs` while it is not. */
export function pollUnlessStreaming(streamOpen: boolean, everyMs: number): number | false {
  return streamOpen ? false : everyMs;
}
