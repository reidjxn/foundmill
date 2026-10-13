/**
 * One QueryClient per browser tab, a fresh one per server render (TanStack Query's SSR guidance).
 *
 * Freshness: 30 s by default. Routers the event stream keeps current (the shell refetches them on every event that
 * changes them, BusinessShell `INVALIDATE_ON_EVENT`) stay fresh for 5 minutes, but only while their business's
 * channel has been live since they were fetched (lib/stream-status.ts): data fetched before the channel went live, or
 * while it was down or unsubscribed (another business on screen), may have missed an event and keeps the short default.
 * When a channel comes back after a gap, `resyncBusiness` refetches that business's queries (the stream does not
 * replay), and a tab that becomes visible again refetches the stale queries of the business on screen.
 */
import { QueryClient } from "@tanstack/react-query";
import { businessLiveSince } from "./stream-status";

export const DEFAULT_STALE_MS = 30_000;
/** Freshness of stream-kept data while its business's channel stays live. */
export const STREAM_KEPT_STALE_MS = 5 * 60_000;
/** Routers whose every change arrives as an event the shell invalidates on (and as mutations that invalidate them). */
export const STREAM_KEPT_ROUTERS: readonly string[] = ["inbox", "cycle", "finance", "department"];

/** The router of a tRPC query key (`[["inbox", "list"], {…}]` → "inbox"). */
export function routerOfKey(queryKey: readonly unknown[]): string | null {
  const path = queryKey[0];
  return Array.isArray(path) && typeof path[0] === "string" ? path[0] : null;
}

/** The business a tRPC query key reads (`[["inbox", "list"], { input: { businessId } }]`); null for account-level reads. */
export function businessOfKey(queryKey: readonly unknown[]): string | null {
  const meta = queryKey[1];
  const input = meta && typeof meta === "object" ? (meta as { input?: unknown }).input : undefined;
  const businessId = input && typeof input === "object" ? (input as { businessId?: unknown }).businessId : undefined;
  return typeof businessId === "string" ? businessId : null;
}

interface StaleTimeQuery {
  queryKey: readonly unknown[];
  state: { dataUpdatedAt: number };
}

/**
 * A `staleTime` that is `STREAM_KEPT_STALE_MS` for a stream-kept router's query whose business channel has been live
 * since the data was fetched, else `fallbackMs`.
 */
export function streamAwareStaleTime(fallbackMs: number = DEFAULT_STALE_MS, liveSince: (businessId: string) => number | null = businessLiveSince): (query: StaleTimeQuery) => number {
  return (query) => {
    const router = routerOfKey(query.queryKey);
    if (router === null || !STREAM_KEPT_ROUTERS.includes(router)) return fallbackMs;
    const businessId = businessOfKey(query.queryKey);
    const since = businessId === null ? null : liveSince(businessId);
    return since !== null && since <= query.state.dataUpdatedAt ? STREAM_KEPT_STALE_MS : fallbackMs;
  };
}

/**
 * The business's channel is live again after a gap (a reconnect, a refusal retried, a return to the business): events
 * sent meanwhile are not replayed, so refetch every query of that business. Mounted queries refetch now; the others
 * are marked stale and refetch when a screen shows them again.
 */
export function resyncBusiness(queryClient: QueryClient, businessId: string): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (query) => businessOfKey(query.queryKey) === businessId });
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: streamAwareStaleTime(DEFAULT_STALE_MS),
        // Back to a hidden tab: the business's stale reads refetch (a stream-kept one stays fresh only while its
        // channel stayed live). Account-level reads (the studio, profile) keep what they have.
        refetchOnWindowFocus: (query) => businessOfKey(query.queryKey) !== null,
        retry: (count, err) => {
          const code = (err as { data?: { code?: string } } | undefined)?.data?.code;
          // A rate limit is not a blip: retrying spends the allowance again and is refused again.
          // Nor is a model account that cannot pay (PAYMENT_REQUIRED, `model_billing`): it lasts until someone adds credit.
          if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "NOT_FOUND" || code === "TOO_MANY_REQUESTS" || code === "PAYMENT_REQUIRED") return false;
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
