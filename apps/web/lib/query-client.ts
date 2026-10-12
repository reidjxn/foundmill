/**
 * One QueryClient per browser tab, a fresh one per server render (TanStack Query's SSR guidance).
 *
 * Freshness: 30 s by default. Routers the event stream keeps current (the shell refetches them on every event that
 * changes them, BusinessShell `INVALIDATE_ON_EVENT`) stay fresh for 5 minutes while the stream is connected, so moving
 * between screens does not refetch them; when the stream is down they fall back to the short default.
 */
import { QueryClient } from "@tanstack/react-query";
import { isStreamOpen } from "./stream-status";

export const DEFAULT_STALE_MS = 30_000;
/** Freshness of stream-kept data while the stream is connected. */
export const STREAM_KEPT_STALE_MS = 5 * 60_000;
/** Routers whose every change arrives as an event the shell invalidates on (and as mutations that invalidate them). */
export const STREAM_KEPT_ROUTERS: readonly string[] = ["inbox", "cycle", "finance", "department"];

/** The router of a tRPC query key (`[["inbox", "list"], {…}]` → "inbox"). */
export function routerOfKey(queryKey: readonly unknown[]): string | null {
  const path = queryKey[0];
  return Array.isArray(path) && typeof path[0] === "string" ? path[0] : null;
}

/** A `staleTime` that is `STREAM_KEPT_STALE_MS` for stream-kept routers while the stream is open, else `fallbackMs`. */
export function streamAwareStaleTime(fallbackMs: number = DEFAULT_STALE_MS, streamOpen: () => boolean = isStreamOpen): (query: { queryKey: readonly unknown[] }) => number {
  return (query) => {
    const router = routerOfKey(query.queryKey);
    return router !== null && STREAM_KEPT_ROUTERS.includes(router) && streamOpen() ? STREAM_KEPT_STALE_MS : fallbackMs;
  };
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: streamAwareStaleTime(DEFAULT_STALE_MS),
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          const code = (err as { data?: { code?: string } } | undefined)?.data?.code;
          // A rate limit is not a blip: retrying spends the allowance again and is refused again.
          if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "NOT_FOUND" || code === "TOO_MANY_REQUESTS") return false;
          return count < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
